#!/usr/bin/env bash
# Dead WARP proxy mid-build: restart `opencode serve` on the runner network instead of letting
# every model fail through a broken tunnel. No secrets here.
set -uo pipefail
set +x
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${OPENCODE_BIN:?}" "${OPENCODE_WEB_DIR:?}"
echo "[proxy] dropping the dead proxy; OpenCode now uses the runner network" >&2
bash "$here/start-opencode-serve.sh" "" --wait || exit 1

