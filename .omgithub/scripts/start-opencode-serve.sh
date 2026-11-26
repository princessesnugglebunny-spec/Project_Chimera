#!/usr/bin/env bash
# Start (or restart) `opencode serve` on 127.0.0.1:$OPENCODE_WEB_PORT, optionally behind a local proxy relay.
# Usage: start-opencode-serve.sh [proxy-url|''] [--wait]
# Env: OPENCODE_BIN, OPENCODE_WEB_PORT, OPENCODE_WEB_DIR; --wait also needs OPENCODE_PASSWORD.
# Only `opencode serve` gets the proxy; GitHub hosts stay on the runner IP via NO_PROXY.
# The proxy must be a 127.0.0.1 relay so no credentials ever appear in argv or env.
set -uo pipefail
set +x
proxy="${1:-}" wait_ready="${2:-}"
: "${OPENCODE_BIN:?}" "${OPENCODE_WEB_PORT:?}" "${OPENCODE_WEB_DIR:?}"
if [[ -n "$proxy" && "$proxy" != http://127.0.0.1:* ]]; then echo 'start-opencode-serve: refusing a non-local proxy' >&2; exit 2; fi
pidfile="$OPENCODE_WEB_DIR/opencode.pid"
if [[ -s "$pidfile" ]]; then
  old="$(cat "$pidfile")"
  if [[ "$old" =~ ^[0-9]+$ ]] && kill -0 "$old" 2>/dev/null; then
    kill "$old" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$old" 2>/dev/null || break; sleep 0.2; done
    kill -9 "$old" 2>/dev/null || true
  fi
fi
# Step-only secrets never reach the server process.
clean=(env -u GITHUB_TOKEN -u GH_TOKEN -u ACTIONS_ID_TOKEN_REQUEST_TOKEN)
if [[ -n "$proxy" ]]; then
  no_proxy_hosts='localhost,127.0.0.1,::1,github.com,.github.com,githubusercontent.com,.githubusercontent.com,githubcopilot.com,.githubcopilot.com'
  # The admin-configured backup endpoint must never go through WARP.
  backup_host="${OMG_BACKUP_HOST:-}"
  if [[ -z "$backup_host" && -s "$OPENCODE_WEB_DIR/backup-host" ]]; then backup_host="$(tr -d '[:space:]' < "$OPENCODE_WEB_DIR/backup-host")"; fi
  [[ "$backup_host" =~ ^[A-Za-z0-9.-]+$ ]] && no_proxy_hosts="$no_proxy_hosts,$backup_host"
  clean+=(HTTPS_PROXY="$proxy" HTTP_PROXY="$proxy" https_proxy="$proxy" http_proxy="$proxy" NO_PROXY="$no_proxy_hosts" no_proxy="$no_proxy_hosts")
else
  clean+=(-u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy)
fi
nohup "${clean[@]}" "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "$OPENCODE_WEB_PORT" >> "$OPENCODE_WEB_DIR/opencode.log" 2>&1 &
echo $! > "$pidfile"
printf '%s\n' "$proxy" > "$OPENCODE_WEB_DIR/opencode-proxy"
[[ "$wait_ready" == --wait ]] || exit 0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 -u "opencode:${OPENCODE_PASSWORD:-}" "http://127.0.0.1:$OPENCODE_WEB_PORT/api/info" > /dev/null 2>&1; then exit 0; fi
  sleep 1
done
echo 'start-opencode-serve: server did not become healthy' >&2
exit 1
