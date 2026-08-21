import { createWriteStream, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const logFile = join(root, ".data", "server.log");
const previousLogFile = `${logFile}.1`;
const maxLogBytes = 10 * 1024 * 1024;
let logBytes = existsSync(logFile) ? statSync(logFile).size : 0;
let output = createWriteStream(logFile, { flags: "a", mode: 0o600 });

function rotate() {
  output.end();
  if (existsSync(previousLogFile)) rmSync(previousLogFile);
  if (existsSync(logFile)) renameSync(logFile, previousLogFile);
  output = createWriteStream(logFile, { flags: "a", mode: 0o600 });
  logBytes = 0;
}

function write(chunk) {
  if (logBytes && logBytes + chunk.length > maxLogBytes) rotate();
  logBytes += chunk.length;
  output.write(chunk);
}

const child = spawn(process.execPath, ["server.js"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", write);
child.stderr.on("data", write);
child.on("error", (error) => write(Buffer.from(`${error.stack || error.message}\n`)));
child.on("exit", (code, signal) => {
  output.end(() => process.exitCode = code ?? (signal ? 1 : 0));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
