#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="$project_dir/.data"
pid_file="$runtime_dir/server.pid"
log_file="$runtime_dir/server.log"
port="${PORT:-8080}"
host="${HOST:-0.0.0.0}"

print_access_urls() {
  node --input-type=module -e '
    import { networkInterfaces } from "node:os";
    const [host, port] = process.argv.slice(1);
    const format = (address) => address.includes(":") ? `[${address}]` : address;
    console.log("Available URLs:");
    if (host !== "0.0.0.0" && host !== "::") {
      console.log(`  http://${format(host)}:${port}`);
      process.exit(0);
    }
    console.log(`  Local:   http://127.0.0.1:${port}`);
    const addresses = new Set();
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries || []) {
        if (!entry.internal && (entry.family === "IPv4" || entry.family === 4)) addresses.add(entry.address);
      }
    }
    for (const address of addresses) console.log(`  Network: http://${address}:${port}`);
    if (!addresses.size) console.log("  Network: no LAN IPv4 address detected");
  ' "$host" "$port"
}

find_server_pids() {
  local pid cwd command

  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1 || true)"
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    if [[ "$cwd" == "$project_dir" && "$command" == *"node server.js"* ]]; then
      printf '%s\n' "$pid"
    fi
  done < <(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
}

start_server() {
  local pids pid
  pids="$(find_server_pids)"
  if [[ -n "$pids" ]]; then
    echo "codex-remote-console is already running (PID ${pids//$'\n'/, })."
    print_access_urls
    return 0
  fi

  mkdir -p "$runtime_dir"
  cd "$project_dir"
  : >"$log_file"
  nohup node server.js >>"$log_file" 2>&1 &
  pid=$!
  printf '%s\n' "$pid" >"$pid_file"

  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "codex-remote-console failed to start:" >&2
      tail -n 20 "$log_file" >&2
      return 1
    fi
    if grep -q "Codex Remote Console listening" "$log_file"; then
      echo "codex-remote-console started (PID $pid)."
      print_access_urls
      return 0
    fi
    sleep 0.1
  done

  echo "codex-remote-console is starting (PID $pid). Check: $0 status"
}

stop_server() {
  local pids pid running
  pids="$(find_server_pids)"
  if [[ -z "$pids" ]]; then
    rm -f "$pid_file"
    echo "codex-remote-console is not running."
    return 0
  fi

  echo "Stopping codex-remote-console (PID ${pids//$'\n'/, })..."
  while IFS= read -r pid; do
    kill "$pid" 2>/dev/null || true
    kill -CONT "$pid" 2>/dev/null || true
  done <<<"$pids"

  for _ in {1..50}; do
    running="$(find_server_pids)"
    [[ -z "$running" ]] && break
    sleep 0.1
  done

  running="$(find_server_pids)"
  if [[ -n "$running" ]]; then
    echo "Force-stopping codex-remote-console (PID ${running//$'\n'/, })..."
    while IFS= read -r pid; do
      kill -KILL "$pid" 2>/dev/null || true
    done <<<"$running"
  fi

  rm -f "$pid_file"
  echo "codex-remote-console stopped."
}

status_server() {
  local pids
  pids="$(find_server_pids)"
  if [[ -n "$pids" ]]; then
    echo "codex-remote-console is running (PID ${pids//$'\n'/, })."
    print_access_urls
  else
    echo "codex-remote-console is not running."
    return 1
  fi
}

case "${1:-}" in
  start) start_server ;;
  stop) stop_server ;;
  restart) stop_server; start_server ;;
  status) status_server ;;
  logs) touch "$log_file"; tail -f "$log_file" ;;
  *) echo "Usage: $0 {start|stop|restart|status|logs}" >&2; exit 2 ;;
esac
