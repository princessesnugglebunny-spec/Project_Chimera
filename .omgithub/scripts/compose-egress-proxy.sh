#!/usr/bin/env bash
# Compose phone-first egress: front mux over device relay (+ optional WARP).
# Usage: compose-egress-proxy.sh <work-dir> <device-proxy-url> [general-proxy-url]
# Prints http://127.0.0.1:PORT on stdout (last line). models.opencode.ai never uses the device.
set -uo pipefail
set +x
work="${1:?work dir}" device="${2:?device proxy url}" general="${3:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$work"
rm -f "$work/mux.port"
# Supervise the mux on one fixed port: OpenCode keeps HTTPS_PROXY for the whole run, so a
# crashed mux must come back on the same port instead of leaving every call ECONNREFUSED.
# The log also lands in OPENCODE_WEB_DIR so it ships with the run artifacts.
log="${OPENCODE_WEB_DIR:-$work}/egress-mux.log"
mkdir -p "$(dirname "$log")"
nohup bash "$here/egress-mux-supervisor.sh" "$here/egress-mux.mjs" "$device" "$general" "$work/mux.port" "$log" \
  > "$work/mux-supervisor.log" 2>&1 &
echo $! > "$work/mux.pid"
for _ in $(seq 1 50); do [[ -s "$work/mux.port" ]] && break; sleep 0.1; done
port="$(cat "$work/mux.port" 2>/dev/null || true)"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "compose-egress-proxy: mux did not start" >&2; exit 2; }
printf 'http://127.0.0.1:%s\n' "$port"
