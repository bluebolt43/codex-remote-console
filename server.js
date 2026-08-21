import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const publicDir = join(root, "public");
const managedThreadsFile = join(root, ".data", "threads.json");
const uploadDir = join(root, ".data", "uploads");
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "0.0.0.0";
const codexBin = process.env.CODEX_BIN || "codex";
const workspace = process.env.CODEX_CWD || root;
const sessionRoot = join(root, "workspace");

let nextId = 1;
let child;
let readyPromise;
const pending = new Map();
const approvals = new Map();
const clients = new Set();
const threads = new Map();
const managedThreadIds = new Set();
let managedThreadsLoaded = false;

function broadcast(type, data, threadId = null) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (!threadId || client.threadId === threadId) client.response.write(payload);
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

function virtualWorkspacePath(path) {
  const child = relative(sessionRoot, path);
  return child ? `/${child}` : "/";
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    send({ method, id, params });
  });
}

function handleMessage(message) {
  if (message.id !== undefined && !message.method) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }

  if (message.id !== undefined && message.method) {
    if (message.method.endsWith("requestApproval")) {
      const threadId = message.params?.threadId;
      approvals.set(String(message.id), { ...message, threadId });
      broadcast("approval", { requestId: String(message.id), ...message }, threadId);
      return;
    }
    send({ id: message.id, error: { code: -32601, message: "Unsupported request" } });
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

async function ensureCodex() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    child = spawn(codexBin, ["app-server"], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.on("data", (chunk) => broadcast("log", chunk.toString()));
    child.on("error", (error) => broadcast("fatal", error.message));
    child.on("exit", (code) => {
      broadcast("fatal", `Codex app-server exited (${code})`);
      for (const waiter of pending.values()) waiter.reject(new Error("Codex app-server exited"));
      pending.clear();
      readyPromise = null;
    });
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        handleMessage(JSON.parse(line));
      } catch {
        broadcast("log", line);
      }
    });
    await request("initialize", {
      clientInfo: { name: "codex_remote_console", title: "Codex Remote Console", version: "0.1.0" },
    });
    send({ method: "initialized", params: {} });
  })();
  return readyPromise;
}

function requiredThreadId(value) {
  if (!value?.trim()) throw new Error("threadId is required");
  return value.trim();
}

async function readBody(requestObject, maxLength = 1_000_000) {
  let body = "";
  for await (const chunk of requestObject) {
    body += chunk;
    if (body.length > maxLength) throw new Error("Request body too large");
  }
  return body ? JSON.parse(body) : {};
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function api(requestObject, response, url) {
  await ensureCodex();
  if (requestObject.method === "POST" && url.pathname === "/api/uploads") {
    const body = await readBody(requestObject, 12_000_000);
    const threadId = requiredThreadId(body.threadId);
    if (!/^[A-Za-z0-9_-]+$/.test(threadId)) throw new Error("Invalid threadId");
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
    const extension = extensions[body.type];
    if (!extension || typeof body.data !== "string") throw new Error("Unsupported image type");
    const content = Buffer.from(body.data, "base64");
    if (!content.length || content.length > 8_000_000) throw new Error("Image must be 8 MB or smaller");
    const threadUploadDir = join(uploadDir, threadId);
    await mkdir(threadUploadDir, { recursive: true });
    const path = join(threadUploadDir, `${randomUUID()}${extension}`);
    await writeFile(path, content);
    return json(response, 201, { path });
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
    const result = await request("thread/list", {
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
    });
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
    const result = await request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      serviceName: "codex_remote_console",
    });
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
    await request("thread/unsubscribe", { threadId });
    await request("thread/delete", { threadId });
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
      const result = await request("thread/resume", { threadId });
      state.snapshot = result.thread;
      state.active = result.thread.status?.type === "active";
    }
    return json(response, 200, { ...publicThreadState(threadId), thread: state.snapshot });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/session") {
    const threadId = requiredThreadId(url.searchParams.get("threadId"));
    const state = threadState(threadId);
    try {
      const result = await request("thread/read", { threadId, includeTurns: true });
      state.snapshot = result.thread;
      state.active = result.thread.status?.type === "active" || state.active;
    } catch (error) {
      if (!error.message.includes("not materialized yet")) throw error;
    }
    return json(response, 200, { ...publicThreadState(threadId), thread: { ...state.snapshot, turns: state.snapshot?.turns || [] } });
  }
  if (requestObject.method === "GET" && url.pathname === "/api/models") {
    return json(response, 200, await request("model/list", { limit: 100 }));
  }
  if (requestObject.method === "GET" && url.pathname === "/api/rate-limits") {
    return json(response, 200, await request("account/rateLimits/read"));
  }
  if (requestObject.method === "GET" && url.pathname === "/api/events") {
    const threadId = requiredThreadId(url.searchParams.get("threadId"));
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(`event: status\ndata: ${JSON.stringify(publicThreadState(threadId))}\n\n`);
    for (const [requestId, approval] of approvals) {
      if (approval.threadId === threadId) {
        response.write(`event: approval\ndata: ${JSON.stringify({ requestId, ...approval })}\n\n`);
      }
    }
    const client = { response, threadId };
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
    const result = await request("turn/start", params);
    return json(response, 202, result);
  }
  if (requestObject.method === "POST" && url.pathname === "/api/interrupt") {
    const body = await readBody(requestObject);
    const threadId = requiredThreadId(body.threadId);
    const state = threadState(threadId);
    if (!state.activeTurnId) return json(response, 409, { error: "No active turn" });
    await request("turn/interrupt", { threadId, turnId: state.activeTurnId });
    return json(response, 200, { ok: true });
  }
  if (requestObject.method === "POST" && url.pathname === "/api/approvals") {
    const body = await readBody(requestObject);
    const approval = approvals.get(String(body.requestId));
    if (!approval) return json(response, 404, { error: "Approval not found" });
    if (body.threadId !== approval.threadId) return json(response, 409, { error: "Approval belongs to another session" });
    if (!["accept", "acceptForSession", "decline", "cancel"].includes(body.decision)) {
      return json(response, 400, { error: "Invalid decision" });
    }
    approvals.delete(String(body.requestId));
    send({ id: approval.id, result: { decision: body.decision } });
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
      "cache-control": "no-cache",
    });
    response.end(content);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (requestObject, response) => {
  try {
    const url = new URL(requestObject.url, `http://${requestObject.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await api(requestObject, response, url);
    else await staticFile(response, url.pathname);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Codex Remote Console listening on http://${host}:${port}`);
  console.log(`Workspace: ${workspace}`);
});

function shutdown() {
  child?.kill("SIGTERM");
  server.close();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
