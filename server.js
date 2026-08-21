import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PasskeyAuth } from "./passkey-auth.js";
import { FixedWindowLimiter } from "./security-controls.js";
import { CodexProvider } from "./providers/codex-provider.js";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const managedThreadsFile = join(root, ".data", "threads.json");
const uploadDir = join(root, ".data", "uploads");
const authEnabled = /^(1|true|yes|on)$/i.test(process.env.AUTH_ENABLED || "");
const persistentApprovalsEnabled = !authEnabled || /^(1|true|yes|on)$/i.test(process.env.ALLOW_PERSISTENT_APPROVALS || "");
const codexBin = process.env.CODEX_BIN || "codex";
const sessionRoot = join(root, "workspace");
const workspace = sessionRoot;
const publicPort = Number(process.env.PUBLIC_PORT || 8443);
const publicHost = process.env.PUBLIC_HOST || "0.0.0.0";
const openPort = Number(process.env.PORT || 8080);
const openHost = process.env.HOST || "0.0.0.0";
const passkeyRpID = process.env.PASSKEY_RP_ID || "";
const passkeyOrigin = process.env.PASSKEY_ORIGIN?.replace(/\/$/, "") || (passkeyRpID ? `https://${passkeyRpID}${publicPort && publicPort !== 443 ? `:${publicPort}` : ""}` : "");
const tlsCertFile = process.env.TLS_CERT_FILE || join(root, "auth", "fullchain.pem");
const tlsKeyFile = process.env.TLS_KEY_FILE || join(root, "auth", "privkey.pem");
const passkeyAuth = new PasskeyAuth({ dataFile: join(root, "auth", "devices.json"), rpID: passkeyRpID, origin: passkeyOrigin });
const requestLimiter = new FixedWindowLimiter({ limit: positiveIntegerEnv("REQUESTS_PER_MINUTE", 180), windowMs: 60_000 });
const uploadLimiter = new FixedWindowLimiter({ limit: positiveIntegerEnv("UPLOADS_PER_15_MINUTES", 20), windowMs: 15 * 60_000 });
const maxConnections = positiveIntegerEnv("MAX_CONNECTIONS", 200);
const maxSseConnections = positiveIntegerEnv("MAX_SSE_CONNECTIONS", 50);
const maxSseConnectionsPerIp = positiveIntegerEnv("MAX_SSE_CONNECTIONS_PER_IP", 5);
const maxThreadUploadBytes = positiveIntegerEnv("MAX_THREAD_UPLOAD_MB", 64) * 1024 * 1024;
const maxTotalUploadBytes = positiveIntegerEnv("MAX_TOTAL_UPLOAD_MB", 512) * 1024 * 1024;
const approvals = new Map();
const clients = new Set();
const threads = new Map();
const managedThreadIds = new Set();
let managedThreadsLoaded = false;
let uploadQueue = Promise.resolve();

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clientAddress(requestObject) {
  return String(requestObject.socket.remoteAddress || "unknown").replace(/^::ffff:/, "");
}

async function directoryBytes(path) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(childPath);
    else if (entry.isFile()) total += (await stat(childPath)).size;
  }
  return total;
}

function serializeUpload(task) {
  const result = uploadQueue.then(task, task);
  uploadQueue = result.catch(() => {});
  return result;
}

function broadcast(type, data, threadId = null) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (threadId && client.threadId !== threadId) continue;
    if (!client.response.write(payload)) {
      clients.delete(client);
      client.response.destroy();
    }
  }
}

function threadState(threadId) {
  if (!threads.has(threadId)) {
    threads.set(threadId, { threadId, activeTurnId: null, active: false, snapshot: null });
  }
  return threads.get(threadId);
}

function publicThreadState(threadId) {
  const state = threadState(threadId);
  return { threadId, activeTurnId: state.activeTurnId, active: state.active, workspace: state.snapshot?.cwd || workspace };
}

async function loadManagedThreads() {
  if (managedThreadsLoaded) return;
  managedThreadsLoaded = true;
  try {
    const saved = JSON.parse(await readFile(managedThreadsFile, "utf8"));
    for (const id of saved.threadIds || []) managedThreadIds.add(id);
  } catch {}
}

async function saveManagedThreads() {
  await mkdir(dirname(managedThreadsFile), { recursive: true });
  await writeFile(managedThreadsFile, `${JSON.stringify({ threadIds: [...managedThreadIds] }, null, 2)}\n`);
}

async function resolveSessionDirectory(value) {
  await mkdir(sessionRoot, { recursive: true });
  const virtualPath = String(value || "/");
  if (!virtualPath.startsWith("/")) throw new Error("Workspace path must start with /");
  const requestedPath = resolve(sessionRoot, `.${virtualPath}`);
  if (requestedPath !== sessionRoot && !requestedPath.startsWith(`${sessionRoot}/`)) {
    throw new Error("Cannot browse above the workspace root");
  }
  const path = await realpath(requestedPath);
  if (!(await stat(path)).isDirectory()) throw new Error("Path is not a directory");
  const canonicalRoot = await realpath(sessionRoot);
  if (path !== canonicalRoot && !path.startsWith(`${canonicalRoot}/`)) {
    throw new Error("Cannot browse outside the workspace root");
  }
  return path;
}

async function requireThreadWorkspace(thread) {
  if (!thread?.cwd) throw new Error("Invalid session workspace");
  const [path, canonicalRoot] = await Promise.all([realpath(thread.cwd), realpath(sessionRoot)]);
  if (path !== canonicalRoot && !path.startsWith(`${canonicalRoot}/`)) {
    throw new Error("Invalid session workspace");
  }
  return thread;
}

function virtualWorkspacePath(path) {
  const child = relative(sessionRoot, path);
  return child ? `/${child}` : "/";
}

async function pathIsInWorkspace(value) {
  if (!value) return false;
  try {
    const [path, canonicalRoot] = await Promise.all([realpath(String(value)), realpath(sessionRoot)]);
    return path === canonicalRoot || path.startsWith(`${canonicalRoot}/`);
  } catch {
    return false;
  }
}

async function requestsWorkspaceExpansion(message) {
  if (message.method === "item/fileChange/requestApproval") {
    return !await pathIsInWorkspace(message.params?.grantRoot);
  }
  if (message.method === "item/commandExecution/requestApproval") {
    const fileSystem = message.params?.additionalPermissions?.fileSystem;
    return Boolean(fileSystem?.write?.length || fileSystem?.entries?.some((entry) => entry.access === "write"));
  }
  if (message.method === "item/permissions/requestApproval") {
    const fileSystem = message.params?.permissions?.fileSystem;
    return Boolean(fileSystem?.write?.length || fileSystem?.entries?.some((entry) => entry.access === "write"));
  }
  return false;
}

async function handleMessage(message) {
  if (message.id !== undefined && message.method) {
    if (message.method.endsWith("requestApproval")) {
      const threadId = message.params?.threadId;
      if (await requestsWorkspaceExpansion(message)) {
        provider.resolveApproval(message.id, "decline");
        broadcast("log", "Blocked a request for filesystem access outside workspace", threadId);
        return;
      }
      approvals.set(String(message.id), { ...message, threadId });
      broadcast("approval", { requestId: String(message.id), allowPersistent: persistentApprovalsEnabled, ...message }, threadId);
      return;
    }
    provider.rejectRequest(message.id);
    return;
  }

  const params = message.params || {};
  const state = params.threadId ? threadState(params.threadId) : null;
  if (message.method === "turn/started") {
    state.active = true;
    state.activeTurnId = params.turn?.id || null;
    broadcast("status", publicThreadState(params.threadId), params.threadId);
  } else if (message.method === "turn/completed") {
    state.active = false;
    state.activeTurnId = null;
    broadcast("status", publicThreadState(params.threadId), params.threadId);
  }
  broadcast("codex", message, params.threadId);
}

const provider = new CodexProvider({
  binary: codexBin,
  workspace,
  sessionRoot,
  onMessage: handleMessage,
  onLog: (message) => broadcast("log", message),
  onFatal: (message) => broadcast("fatal", message),
});

function requiredThreadId(value) {
  const threadId = value?.trim();
  if (!threadId) throw new Error("Invalid threadId");
  if (!/^[A-Za-z0-9_-]+$/.test(threadId)) throw new Error("Invalid threadId");
  return threadId;
}

async function readBody(requestObject, maxLength = 1_000_000) {
  let body = "";
  for await (const chunk of requestObject) {
    body += chunk;
    if (body.length > maxLength) throw httpError("Request body too large", 413);
  }
  return body ? JSON.parse(body) : {};
}

function json(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function validPublicOrigin(requestObject) {
  return requestObject.headers["sec-fetch-site"] !== "cross-site" && requestObject.headers.origin === passkeyOrigin;
}

function isLoopback(requestObject) {
  const address = requestObject.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function authApi(requestObject, response, url, access) {
  const eventContext = {
    ip: clientAddress(requestObject),
    userAgent: requestObject.headers["user-agent"],
  };
  if (requestObject.method === "GET" && url.pathname === "/api/auth/status") {
    const isAuthenticated = !authEnabled || passkeyAuth.authenticated(requestObject.headers.cookie);
    return json(response, 200, {
      access,
      enabled: authEnabled,
      configured: authEnabled && passkeyAuth.configured,
      authenticated: isAuthenticated,
      pairingEnabled: passkeyAuth.pairingEnabled(),
      lastLoginAt: authEnabled && isAuthenticated ? await passkeyAuth.lastLoginAt() : null,
    });
  }
  if (!authEnabled) {
    if (requestObject.method === "GET" && url.pathname === "/api/auth/security-events") {
      return json(response, 200, { events: [] });
    }
    if (requestObject.method === "POST" && url.pathname === "/api/auth/logout") {
      return json(response, 200, { ok: true });
    }
    return false;
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/pair-codes") {
    if (!isLoopback(requestObject)) return json(response, 403, { error: "Pairing codes can only be created on the server computer" });
    return json(response, 201, passkeyAuth.createPairCode());
  }
  if (access === "public" && !validPublicOrigin(requestObject) && requestObject.method !== "GET") {
    return json(response, 403, { error: "Invalid request origin" });
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/register/options") {
    const body = await readBody(requestObject, 10_000);
    return json(response, 200, await passkeyAuth.registrationOptions(body.code, body.deviceName, clientAddress(requestObject)));
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/register/verify") {
    const body = await readBody(requestObject, 100_000);
    let device;
    try {
      device = await passkeyAuth.verifyRegistration(body.registrationId, body.response);
      await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "pairing", success: true });
    } catch (error) {
      await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "pairing", success: false });
      throw error;
    }
    response.setHeader("set-cookie", passkeyAuth.createSession(device, eventContext));
    return json(response, 200, { verified: true, device: { id: device.id, name: device.name } });
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/login/options") {
    return json(response, 200, await passkeyAuth.authenticationOptions(clientAddress(requestObject)));
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/login/verify") {
    const body = await readBody(requestObject, 100_000);
    let device;
    try {
      const result = await passkeyAuth.verifyAuthentication(body.authenticationId, body.response, eventContext.ip);
      device = result.device;
      await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "login", success: true });
      if (result.newAddress) {
        await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "login-new-address", success: true, alert: true });
        console.warn(`Security alert: paired device logged in from a new address (${eventContext.ip})`);
      }
    } catch (error) {
      const failure = passkeyAuth.recordLoginFailure(eventContext.ip);
      await passkeyAuth.recordSecurityEvent({ ...eventContext, type: failure.blocked ? "login-blocked" : "login", success: false, alert: failure.blocked });
      if (failure.blocked) console.warn(`Security alert: login address blocked (${eventContext.ip})`);
      throw error;
    }
    response.setHeader("set-cookie", passkeyAuth.createSession(device, eventContext));
    return json(response, 200, { verified: true });
  }
  if (access === "public" && requestObject.method === "POST" && url.pathname === "/api/auth/logout") {
    response.setHeader("set-cookie", passkeyAuth.clearSession(requestObject.headers.cookie));
    return json(response, 200, { ok: true });
  }
  if (access === "public" && passkeyAuth.authenticated(requestObject.headers.cookie) && requestObject.method === "GET" && url.pathname === "/api/auth/security-events") {
    return json(response, 200, { events: await passkeyAuth.recentSecurityEvents() });
  }
  const authenticated = access === "public" && passkeyAuth.authenticated(requestObject.headers.cookie);
  if (authenticated && requestObject.method === "GET" && url.pathname === "/api/auth/devices") {
    return json(response, 200, { devices: await passkeyAuth.listedDevices(requestObject.headers.cookie) });
  }
  if (authenticated && requestObject.method === "DELETE" && url.pathname === "/api/auth/devices") {
    const body = await readBody(requestObject, 10_000);
    const currentDeviceId = passkeyAuth.session(requestObject.headers.cookie)?.deviceId;
    if (!await passkeyAuth.revokeDevice(String(body.deviceId || ""))) return json(response, 404, { error: "Device not found" });
    await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "device-revoked", success: true });
    if (body.deviceId === currentDeviceId) response.setHeader("set-cookie", passkeyAuth.clearSession(requestObject.headers.cookie));
    return json(response, 200, { ok: true, current: body.deviceId === currentDeviceId });
  }
  if (authenticated && requestObject.method === "GET" && url.pathname === "/api/auth/sessions") {
    return json(response, 200, { sessions: passkeyAuth.listedSessions(requestObject.headers.cookie) });
  }
  if (authenticated && requestObject.method === "DELETE" && url.pathname === "/api/auth/sessions") {
    const body = await readBody(requestObject, 10_000);
    const currentSessionId = passkeyAuth.session(requestObject.headers.cookie)?.id;
    if (!passkeyAuth.revokeSession(String(body.sessionId || ""))) return json(response, 404, { error: "Session not found" });
    await passkeyAuth.recordSecurityEvent({ ...eventContext, type: "session-revoked", success: true });
    if (body.sessionId === currentSessionId) response.setHeader("set-cookie", passkeyAuth.clearSession(requestObject.headers.cookie));
    return json(response, 200, { ok: true, current: body.sessionId === currentSessionId });
  }
  return false;
}

async function api(requestObject, response, url) {
  await provider.start();
  if (requestObject.method === "POST" && url.pathname === "/api/uploads") {
    const body = await readBody(requestObject, 12_000_000);
    const threadId = requiredThreadId(body.threadId);
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
    const extension = extensions[body.type];
    if (!extension || typeof body.data !== "string") throw new Error("Unsupported image type");
    const content = Buffer.from(body.data, "base64");
    if (!content.length || content.length > 8_000_000) throw new Error("Image must be 8 MB or smaller");
    const rate = uploadLimiter.consume(`${clientAddress(requestObject)}:${threadId}`);
    if (!rate.allowed) {
      response.setHeader("retry-after", rate.retryAfterSeconds);
      return json(response, 429, { error: "Upload rate limit exceeded" });
    }
    return serializeUpload(async () => {
      const threadUploadDir = join(uploadDir, threadId);
      const [threadBytes, totalBytes] = await Promise.all([directoryBytes(threadUploadDir), directoryBytes(uploadDir)]);
      if (threadBytes + content.length > maxThreadUploadBytes || totalBytes + content.length > maxTotalUploadBytes) {
        throw httpError("Upload storage quota exceeded", 507);
      }
      await mkdir(threadUploadDir, { recursive: true });
      const path = join(threadUploadDir, `${randomUUID()}${extension}`);
      await writeFile(path, content);
      return json(response, 201, { path });
    });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/generated-image") {
    const threadId = requiredThreadId(url.searchParams.get("threadId"));
    const requestedPath = url.searchParams.get("path");
    const state = threads.get(threadId);
    const threadWorkspace = state?.snapshot?.cwd;
    if (!requestedPath || !threadWorkspace) return json(response, 404, { error: "Image not found" });

    const [path, cwd] = await Promise.all([realpath(requestedPath), realpath(threadWorkspace)]);
    if (!path.startsWith(`${cwd}/`)) return json(response, 403, { error: "Image is outside this session workspace" });
    if (!(await stat(path)).isFile()) return json(response, 404, { error: "Image not found" });
    const types = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".avif": "image/avif",
    };
    const contentType = types[extname(path).toLowerCase()];
    if (!contentType) return json(response, 415, { error: "Unsupported image type" });
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "private, no-store",
      "content-disposition": "inline",
    });
    response.end(await readFile(path));
    return;
  }
  if (requestObject.method === "GET" && url.pathname === "/api/directories") {
    const path = await resolveSessionDirectory(url.searchParams.get("path"));
    const entries = await readdir(path, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory())
      .map((entry) => entry.name).sort();
    const virtualPath = virtualWorkspacePath(path);
    return json(response, 200, {
      path: virtualPath,
      parent: virtualPath === "/" ? "/" : dirname(virtualPath),
      directories,
    });
  }
  if (requestObject.method === "POST" && url.pathname === "/api/directories") {
    const body = await readBody(requestObject);
    const parent = await resolveSessionDirectory(body.parent);
    const name = String(body.name || "").trim();
    if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) {
      throw new Error("Enter a valid folder name without / or \\");
    }
    const path = join(parent, name);
    try {
      await mkdir(path);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("A folder with this name already exists");
      throw error;
    }
    return json(response, 201, { path: virtualWorkspacePath(await realpath(path)) });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/threads") {
    await loadManagedThreads();
    const result = await provider.listSessions();
    const listedIds = new Set(result.data.map((thread) => thread.id));
    const loadedOnly = [...threads.values()]
      .map((state) => state.snapshot)
      .filter((thread) => thread && !listedIds.has(thread.id));
    const visible = [...loadedOnly, ...result.data]
      .filter((thread) => managedThreadIds.has(thread.id));
    const data = visible.map((thread) => {
      const state = threads.get(thread.id);
      return state ? { ...thread, status: { type: state.active ? "active" : "idle" } } : thread;
    });
    return json(response, 200, { ...result, data });
  }
  if (requestObject.method === "POST" && url.pathname === "/api/threads") {
    await loadManagedThreads();
    const body = await readBody(requestObject);
    const cwd = await resolveSessionDirectory(body.cwd);
    const result = await provider.createSession(cwd);
    const state = threadState(result.thread.id);
    state.snapshot = result.thread;
    managedThreadIds.add(result.thread.id);
    await saveManagedThreads();
    return json(response, 201, { thread: result.thread });
  }
  if (requestObject.method === "DELETE" && url.pathname === "/api/threads") {
    await loadManagedThreads();
    const body = await readBody(requestObject);
    const threadId = requiredThreadId(body.threadId);
    const state = threads.get(threadId);
    if (state?.active) return json(response, 409, { error: "Stop this session before deleting it" });
    await provider.deleteSession(threadId);
    await rm(join(uploadDir, threadId), { recursive: true, force: true });
    threads.delete(threadId);
    managedThreadIds.delete(threadId);
    for (const [requestId, approval] of approvals) {
      if (approval.threadId === threadId) approvals.delete(requestId);
    }
    await saveManagedThreads();
    return json(response, 200, { ok: true });
  }
  if (requestObject.method === "POST" && url.pathname === "/api/threads/resume") {
    const body = await readBody(requestObject);
    const threadId = requiredThreadId(body.threadId);
    const state = threadState(threadId);
    if (!state.snapshot) {
      const result = await provider.resumeSession(threadId);
      await requireThreadWorkspace(result.thread);
      state.snapshot = result.thread;
      state.active = result.thread.status?.type === "active";
    }
    await requireThreadWorkspace(state.snapshot);
    return json(response, 200, { ...publicThreadState(threadId), thread: state.snapshot });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/session") {
    const threadId = requiredThreadId(url.searchParams.get("threadId"));
    const state = threadState(threadId);
    try {
      const result = await provider.readSession(threadId);
      await requireThreadWorkspace(result.thread);
      state.snapshot = result.thread;
      state.active = result.thread.status?.type === "active" || state.active;
    } catch (error) {
      if (!error.message.includes("not materialized yet")) throw error;
    }
    return json(response, 200, { ...publicThreadState(threadId), thread: { ...state.snapshot, turns: state.snapshot?.turns || [] } });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/models") {
    return json(response, 200, await provider.listModels());
  }
  if (requestObject.method === "GET" && url.pathname === "/api/rate-limits") {
    return json(response, 200, await provider.readRateLimits());
  }
  if (requestObject.method === "GET" && url.pathname === "/api/events") {
    const threadId = requiredThreadId(url.searchParams.get("threadId"));
    const ip = clientAddress(requestObject);
    if (clients.size >= maxSseConnections || [...clients].filter((client) => client.ip === ip).length >= maxSseConnectionsPerIp) {
      return json(response, 429, { error: "Too many event connections" });
    }
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    if (!response.write(`event: status\ndata: ${JSON.stringify(publicThreadState(threadId))}\n\n`)) {
      response.destroy();
      return;
    }
    for (const [requestId, approval] of approvals) {
      if (approval.threadId === threadId) {
        if (!response.write(`event: approval\ndata: ${JSON.stringify({ requestId, allowPersistent: persistentApprovalsEnabled, ...approval })}\n\n`)) {
          response.destroy();
          return;
        }
      }
    }
    const client = { response, threadId, ip };
    clients.add(client);
    requestObject.on("close", () => clients.delete(client));
    return;
  }
  if (requestObject.method === "POST" && url.pathname === "/api/messages") {
    const body = await readBody(requestObject);
    const threadId = requiredThreadId(body.threadId);
    const state = threadState(threadId);
    if (state.active) return json(response, 409, { error: "A turn is already running in this session" });
    const imagePaths = [];
    for (const value of body.images || []) {
      const path = await realpath(String(value));
      if (!path.startsWith(`${join(uploadDir, threadId)}/`)) throw new Error("Invalid image path");
      imagePaths.push(path);
    }
    if (!body.text?.trim() && !imagePaths.length) return json(response, 400, { error: "Message or image is required" });
    const input = [];
    if (body.text?.trim()) input.push({ type: "text", text: body.text.trim(), text_elements: [] });
    input.push(...imagePaths.map((path) => ({ type: "localImage", path })));
    const params = {
      threadId,
      input,
    };
    if (body.clientUserMessageId) params.clientUserMessageId = body.clientUserMessageId;
    if (body.model) params.model = body.model;
    if (body.effort) params.effort = body.effort;
    const result = await provider.startTurn(params);
    return json(response, 202, result);
  }
  if (requestObject.method === "POST" && url.pathname === "/api/interrupt") {
    const body = await readBody(requestObject);
    const threadId = requiredThreadId(body.threadId);
    const state = threadState(threadId);
    if (!state.activeTurnId) return json(response, 409, { error: "No active turn" });
    await provider.interruptTurn(threadId, state.activeTurnId);
    return json(response, 200, { ok: true });
  }
  if (requestObject.method === "POST" && url.pathname === "/api/approvals") {
    const body = await readBody(requestObject);
    const approval = approvals.get(String(body.requestId));
    if (!approval) return json(response, 404, { error: "Approval not found" });
    if (body.threadId !== approval.threadId) return json(response, 409, { error: "Approval belongs to another session" });
    const allowedDecisions = persistentApprovalsEnabled ? ["accept", "acceptForSession", "decline", "cancel"] : ["accept", "decline", "cancel"];
    if (!allowedDecisions.includes(body.decision)) {
      return json(response, 400, { error: "Invalid decision" });
    }
    approvals.delete(String(body.requestId));
    provider.resolveApproval(approval.id, body.decision);
    broadcast("approval-resolved", { requestId: String(body.requestId) }, approval.threadId);
    return json(response, 200, { ok: true });
  }
  json(response, 404, { error: "Not found" });
}

async function staticFile(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (relative.includes("..")) return json(response, 400, { error: "Invalid path" });
  try {
    const content = await readFile(join(publicDir, relative));
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
    response.writeHead(200, {
      "content-type": `${types[extname(relative)] || "application/octet-stream"}; charset=utf-8`,
      "cache-control": relative === "pair.html" || relative === "pair.js" ? "no-store" : "no-cache",
    });
    response.end(content);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

function handler(access) {
  return async (requestObject, response) => {
  try {
    const url = new URL(requestObject.url, `${access === "public" ? "https" : "http"}://${requestObject.headers.host || "localhost"}`);
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("content-security-policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
    if (access === "public") response.setHeader("strict-transport-security", "max-age=31536000");

    const rate = requestLimiter.consume(clientAddress(requestObject));
    if (!rate.allowed) {
      response.setHeader("retry-after", rate.retryAfterSeconds);
      return json(response, 429, { error: "Too many requests" });
    }

    if (url.pathname.startsWith("/api/auth/")) {
      const registrationApi = url.pathname.startsWith("/api/auth/register/");
      if (access === "public" && registrationApi && !passkeyAuth.pairingEnabled()) {
        return json(response, 404, { error: "Pairing is not enabled" });
      }
      const handled = await authApi(requestObject, response, url, access);
      if (handled !== false) return;
    }

    const pairingAsset = ["/pair.html", "/pair.js"].includes(url.pathname);
    if (!authEnabled && pairingAsset) return json(response, 404, { error: "Authentication is not enabled" });
    if (pairingAsset && !passkeyAuth.pairingEnabled()) return json(response, 404, { error: "Pairing is not enabled" });
    const loginAsset = ["/login.html", "/login.js", "/passkey-client.js", "/app.css"].includes(url.pathname);
    const unauthenticatedAsset = loginAsset || pairingAsset;
    if (authEnabled && access === "public" && !passkeyAuth.authenticated(requestObject.headers.cookie) && !unauthenticatedAsset) {
      if (url.pathname.startsWith("/api/")) return json(response, 401, { error: "Authentication required" });
      const next = url.pathname === "/" ? "" : `?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
      response.writeHead(302, { location: `/login.html${next}` });
      return response.end();
    }
    if (authEnabled && access === "public" && !["GET", "HEAD"].includes(requestObject.method) && !validPublicOrigin(requestObject)) {
      return json(response, 403, { error: "Invalid request origin" });
    }
    if (url.pathname.startsWith("/api/")) await api(requestObject, response, url);
    else await staticFile(response, url.pathname);
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error ? error.message : String(error);
    const status = [400, 413, 429, 507].includes(error?.statusCode) ? error.statusCode
      : error instanceof SyntaxError || detail.includes("Invalid") || detail.includes("expired") || detail.includes("not paired") ? 400
        : 500;
    const message = status === 429 ? "Too many requests"
      : status === 413 ? "Request too large"
        : status === 507 ? "Storage quota exceeded"
          : status === 400 ? "Invalid request" : "Internal server error";
    json(response, status, { error: message });
  }
  };
}

let publicServer;

if (authEnabled) {
  if (!passkeyAuth.configured) throw new Error("PASSKEY_RP_ID is required when AUTH_ENABLED=true");
  const [cert, key] = await Promise.all([readFile(tlsCertFile), readFile(tlsKeyFile)]);
  publicServer = createHttpsServer({ cert, key }, handler("public"));
  publicServer.listen(publicPort, publicHost, () => {
    console.log(`Codex Remote Console listening on ${passkeyOrigin} (authentication enabled)`);
    console.log(`Workspace: ${workspace}`);
  });
} else {
  publicServer = createHttpServer(handler("open"));
  publicServer.listen(openPort, openHost, () => {
    console.log(`Codex Remote Console listening on http://${openHost}:${openPort} (authentication disabled)`);
    console.log(`Workspace: ${workspace}`);
  });
}

function shutdown() {
  provider.stop();
  publicServer.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

publicServer.maxConnections = maxConnections;
publicServer.requestTimeout = 30_000;
publicServer.headersTimeout = 10_000;
publicServer.keepAliveTimeout = 5_000;
