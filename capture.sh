#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p node "${RUNTIME_DIR:?}/scripts/default-capture.mjs"
