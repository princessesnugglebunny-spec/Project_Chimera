#!/usr/bin/env bash
# Keep the egress mux alive on the SAME loopback port for the whole run:
# OpenCode holds HTTPS_PROXY=http://127.0.0.1:<port>, so a restart must rebind that port.
# Usage: egress-mux-supervisor.sh <mux-script> <device-proxy> [general-proxy|''] <port-file> <log-file>
set -uo pipefail
set +x
mux="${1:?mux script}" device="${2:?device proxy}" general="${3:-}" port_file="${4:?port file}" log="${5:?log file}"
child=''
restarts=0
stop() { [ -n "$child" ] && kill "$child" 2>/dev/null; exit 0; }
trap stop TERM INT
while true; do
  args=("$mux" "$device" "$general" "$port_file")
  if [ -s "$port_file" ]; then args+=(--port "$(cat "$port_file")"); fi
  node "${args[@]}" >> "$log" 2>&1 &
  child=$!
  wait "$child"
  code=$?
  child=''
  printf '[egress-mux] exited code=%s after %s restart(s)\n' "$code" "$restarts" >> "$log"
  restarts=$((restarts + 1))
  if [ "$restarts" -ge 50 ]; then printf '[egress-mux] too many restarts; giving up\n' >> "$log"; exit 2; fi
  sleep 0.25
done
