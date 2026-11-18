#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
/usr/bin/time -p node -e 'require("fs").writeFileSync(process.env.OPENCODE_WEB_DIR+"/deployment-output.json",JSON.stringify({project:process.cwd(),directory:process.cwd()}))'
/usr/bin/time -p node start.mjs
