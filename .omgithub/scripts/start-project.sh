#!/usr/bin/env bash
# Start the saved project and publish readiness only after both HTTP checks pass.
set -euo pipefail
cd "${PROJECT_DIR:?}"
: "${OPENCODE_WEB_DIR:?}" "${APP_URL:?}"
PORT="${APP_PORT:-3000}"
export PORT
startup_timeout="${STARTUP_TIMEOUT_SECONDS:-600}"
[[ "$startup_timeout" =~ ^[1-9][0-9]*$ ]] || { echo 'STARTUP_TIMEOUT_SECONDS must be a positive integer.' >&2; exit 1; }
/usr/bin/time -p test -f start.sh
/usr/bin/time -p bash -n start.sh
current_commit="${CHECKPOINT_COMMIT:-}"
previous_commit=""
[[ ! -f "$OPENCODE_WEB_DIR/served-commit" ]] || previous_commit="$(/usr/bin/time -p cat "$OPENCODE_WEB_DIR/served-commit")"
# Reuse an in-flight build for this checkpoint when a readiness retry returns.
starting=false
if [[ -f "$OPENCODE_WEB_DIR/starting-commit" ]] && [[ "$(/usr/bin/time -p cat "$OPENCODE_WEB_DIR/starting-commit")" == "$current_commit" ]] && /usr/bin/time -p tmux has-session -t app-server 2>/dev/null; then
  starting=true
fi
if [[ "${RESTART_APP:-false}" == true ]] || { [[ "$starting" == false ]] && { [[ -n "$current_commit" && "$previous_commit" != "$current_commit" ]] || ! /usr/bin/time -p curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/" >/dev/null; }; }; then
  /usr/bin/time -p rm -f "$OPENCODE_WEB_DIR/ready-preview-url"
  /usr/bin/time -p tmux kill-session -t app-server 2>/dev/null || true
  /usr/bin/time -p node "${RUNTIME_DIR:?}/scripts/reclaim-preview-port.mjs"
  /usr/bin/time -p /usr/bin/printf '%s' "$current_commit" > "$OPENCODE_WEB_DIR/starting-commit"
  # Pass paths through tmux's environment; keep the script in the foreground.
  /usr/bin/time -p tmux new-session -d -s app-server -c "$PROJECT_DIR" \
    -e "RUNTIME_DIR=${RUNTIME_DIR:?}" -e "OPENCODE_WEB_DIR=$OPENCODE_WEB_DIR" -e "PORT=$PORT" -e "STARTUP_LOG=$OPENCODE_WEB_DIR/app.log" \
    'bash start.sh > "$STARTUP_LOG" 2>&1'
fi
ready=false
for ((attempt=0; attempt<(startup_timeout + 1) / 2; attempt++)); do
  /usr/bin/time -p tmux has-session -t app-server 2>/dev/null || { echo 'Startup process exited. Inspect app.log.' >&2; exit 1; }
  if /usr/bin/time -p curl --fail --silent --max-time 3 "http://127.0.0.1:$PORT/" >/dev/null; then
    ready=true
    break
  fi
  /usr/bin/time -p tmux has-session -t app-server 2>/dev/null || { echo 'Startup process exited. Inspect app.log.' >&2; exit 1; }
  /usr/bin/time -p sleep 2
done
[[ "$ready" == true ]] || { echo "Local startup failed after ${startup_timeout}s. Inspect app.log." >&2; exit 75; }
/usr/bin/time -p rm -f "$OPENCODE_WEB_DIR/starting-commit"
# Local readiness is independent of a temporary public tunnel failure.
/usr/bin/time -p /usr/bin/printf '%s' "$current_commit" > "$OPENCODE_WEB_DIR/served-commit"
for ((attempt=0; attempt<12; attempt++)); do
  status="$(/usr/bin/time -p curl --silent --show-error --location --max-time 10 --output "$OPENCODE_WEB_DIR/public-readiness.log" --write-out '%{http_code}' "$APP_URL")" || status=000
  if [[ "$status" == 2* ]]; then
    /usr/bin/time -p /usr/bin/printf '%s' "$APP_URL" > "$OPENCODE_WEB_DIR/ready-preview-url"
    if [[ -n "${OPENCODE_CONTROL_PORT:-}" ]]; then
      /usr/bin/time -p curl --fail --silent --max-time 5 "http://127.0.0.1:$OPENCODE_CONTROL_PORT/omgithub/heartbeat" >/dev/null || true
    fi
    echo 'Local and public preview are ready.'
    exit 0
  fi
  if [[ "$status" == 4* && "$status" != 408 && "$status" != 429 ]]; then
    echo "Public preview rejected the request (HTTP $status). Inspect public-readiness.log." >&2
    exit 1
  fi
  /usr/bin/time -p sleep 2
done
echo 'Public preview did not become ready.' >&2
exit 75
