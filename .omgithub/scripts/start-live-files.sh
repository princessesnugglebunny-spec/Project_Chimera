#!/usr/bin/env bash
set -euo pipefail

/usr/bin/time -p npm ci --prefix "$RUNTIME_DIR/scripts/live-files" --no-audit --no-fund
nohup node "$RUNTIME_DIR/scripts/live-files/server.mjs" > "$OPENCODE_WEB_DIR/live-files.log" 2>&1 &
/usr/bin/time -p printf '%s\n' "$!" > "$OPENCODE_WEB_DIR/live-files.pid"
for _ in {1..15}; do
  if /usr/bin/time -p curl --fail --silent --max-time 3 "http://127.0.0.1:$PROJECT_FILE_PORT/" >/dev/null; then
    exit 0
  fi
  /usr/bin/time -p sleep 1
done
/usr/bin/time -p sed -n '1,160p' "$OPENCODE_WEB_DIR/live-files.log" >&2
exit 1
