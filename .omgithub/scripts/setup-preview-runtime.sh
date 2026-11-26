#!/usr/bin/env bash
set -euo pipefail

# Preview startup needs tmux even when optional SSH access is disabled.
if ! command -v tmux >/dev/null 2>&1; then
  case "${RUNNER_OS:?}" in
    macOS) /usr/bin/time -p brew install tmux ;;
    Linux)
      /usr/bin/time -p sudo apt-get update
      /usr/bin/time -p sudo apt-get install -y tmux
      ;;
    *) echo "Unsupported preview runner: $RUNNER_OS" >&2; exit 1 ;;
  esac
fi
/usr/bin/time -p tmux -V
