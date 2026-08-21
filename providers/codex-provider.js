import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";

export class CodexProvider {
  constructor({ binary = "codex", workspace, sessionRoot, requestTimeoutMs = 120_000, onMessage, onLog, onFatal }) {
    this.binary = binary;
    this.workspace = workspace;
    this.sessionRoot = sessionRoot;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onMessage = onMessage;
    this.onLog = onLog;
    this.onFatal = onFatal;
    this.nextId = 1;
    this.child = null;
    this.readyPromise = null;
    this.pending = new Map();
  }

  send(message) {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, this.requestTimeoutMs);
      timeout.unref();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      this.send({ method, id, params });
    });
  }

  async handleMessage(message) {
    if (message.id !== undefined && !message.method) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    await this.onMessage?.(message);
  }

  async start() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      await mkdir(this.sessionRoot, { recursive: true });
      this.child = spawn(this.binary, ["app-server"], {
        cwd: this.workspace,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.child.stderr.on("data", (chunk) => this.onLog?.(chunk.toString()));
      this.child.on("error", (error) => this.onFatal?.(error.message));
      this.child.on("exit", (code) => {
        this.onFatal?.(`Codex app-server exited (${code})`);
        for (const waiter of this.pending.values()) waiter.reject(new Error("Codex app-server exited"));
        this.pending.clear();
        this.readyPromise = null;
        this.child = null;
      });
      createInterface({ input: this.child.stdout }).on("line", async (line) => {
        try {
          await this.handleMessage(JSON.parse(line));
        } catch {
          this.onLog?.(line);
        }
      });
      await this.request("initialize", {
        clientInfo: { name: "codex_remote_console", title: "Codex Remote Console", version: "0.1.0" },
      });
      this.send({ method: "initialized", params: {} });
    })();
    return this.readyPromise;
  }

  listSessions() {
    return this.request("thread/list", {
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["cli", "vscode", "exec", "appServer", "unknown"],
    });
  }

  createSession(cwd) {
    return this.request("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
      runtimeWorkspaceRoots: [this.sessionRoot],
      serviceName: "codex_remote_console",
    });
  }

  async deleteSession(threadId) {
    await this.request("thread/unsubscribe", { threadId });
    return this.request("thread/delete", { threadId });
  }

  resumeSession(threadId) {
    return this.request("thread/resume", { threadId });
  }

  readSession(threadId) {
    return this.request("thread/read", { threadId, includeTurns: true });
  }

  listModels() {
    return this.request("model/list", { limit: 100 });
  }

  readRateLimits() {
    return this.request("account/rateLimits/read");
  }

  startTurn(params) {
    return this.request("turn/start", params);
  }

  interruptTurn(threadId, turnId) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  resolveApproval(id, decision) {
    this.send({ id, result: { decision } });
  }

  rejectRequest(id) {
    this.send({ id, error: { code: -32601, message: "Unsupported request" } });
  }

  stop() {
    this.child?.kill("SIGTERM");
  }
}
