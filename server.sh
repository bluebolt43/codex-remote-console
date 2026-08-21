#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
runtime_dir="$project_dir/.data"
auth_dir="$project_dir/auth"
auth_config="$auth_dir/config.env"

if [[ -f "$auth_config" ]]; then
  set -a
  # This owner-only file is intentionally local and excluded from Git.
  source "$auth_config"
  set +a
fi
pid_file="$runtime_dir/server.pid"
log_file="$runtime_dir/server.log"
auth_enabled="${AUTH_ENABLED:-false}"
if [[ "$auth_enabled" =~ ^(1|true|yes|on)$ ]]; then
  port="${PUBLIC_PORT:-8443}"
else
  port="${PORT:-8080}"
fi

auth_is_enabled() {
  [[ "$auth_enabled" =~ ^(1|true|yes|on)$ ]]
}

local_addresses() {
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true
  fi
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null || true
  fi
}

print_access_urls() {
  echo "Available URL:"
  if auth_is_enabled; then
    if [[ -n "${PASSKEY_ORIGIN:-}" ]]; then
      echo "  Protected: $PASSKEY_ORIGIN"
    else
      echo "  Protected: https://${PASSKEY_RP_ID:-<hostname>}:${PUBLIC_PORT:-8443}"
    fi
  else
    local address found=false
    while IFS= read -r address; do
      [[ -n "$address" ]] || continue
      echo "  LAN: http://$address:${PORT:-8080}"
      found=true
    done < <(local_addresses)
    [[ "$found" == true ]] || echo "  LAN: http://<computer-ip>:${PORT:-8080}"
  fi
}

warn_auth_permissions() {
  local mode
  mode="$(stat -c '%a' "$auth_dir" 2>/dev/null || stat -f '%Lp' "$auth_dir" 2>/dev/null || true)"
  if [[ -n "$mode" && $((8#$mode & 077)) -ne 0 ]]; then
    echo "WARNING: $auth_dir does not enforce owner-only permissions (mode $mode)." >&2
    echo "Do not store an unencrypted TLS private key there on a multi-user computer." >&2
  fi
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
  if auth_is_enabled; then
    mkdir -p "$auth_dir"
    chmod 700 "$auth_dir"
    [[ ! -f "$auth_config" ]] || chmod 600 "$auth_config"
    warn_auth_permissions
  fi
  cd "$project_dir"
  : >"$log_file"
  nohup node log-runner.js >/dev/null 2>&1 &
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

create_pair_code() {
  if ! auth_is_enabled; then
    echo "Pairing is unavailable because authentication is disabled." >&2
    echo "Set AUTH_ENABLED=true in auth/config.env and restart the server first." >&2
    return 1
  fi
  node --input-type=module -e '
    import https from "node:https";
    const origin = new URL(process.argv[1]);
    const request = https.request({
      hostname: "127.0.0.1",
      port: origin.port || 443,
      path: "/api/auth/pair-codes",
      method: "POST",
      servername: origin.hostname,
      headers: { host: origin.host },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => body += chunk);
      response.on("end", () => {
        try {
          const data = JSON.parse(body);
          if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(data.error || `HTTP ${response.statusCode}`);
          console.log("One-time pairing password:", data.code);
          console.log("Expires in: 5 minutes");
          console.log("Pair URL:", `${origin.origin}/pair.html`);
        } catch (error) {
          console.error(`Could not create pairing code: ${error.message}`);
          process.exitCode = 1;
        }
      });
    });
    request.on("error", (error) => {
      console.error(`Could not create pairing code: ${error.message}`);
      console.error("Start the server first with: ./server.sh start");
      process.exitCode = 1;
    });
    request.end();
  ' "${PASSKEY_ORIGIN:-}"
}

case "${1:-}" in
  start) start_server ;;
  stop) stop_server ;;
  restart) stop_server; start_server ;;
  status) status_server ;;
  pair) create_pair_code ;;
  logs) touch "$log_file"; tail -f "$log_file" ;;
  *) echo "Usage: $0 {start|stop|restart|status|pair|logs}" >&2; exit 2 ;;
esac
