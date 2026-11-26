#!/usr/bin/env bash
set -euo pipefail

# Keep the CLI and its matching browser outside the generated project.
runtime="$HOME/.local/share/omgithub-playwright"
/usr/bin/time -p mkdir -p "$runtime/output" /usr/local/bin
/usr/bin/time -p npm install --prefix "$runtime" --no-save --no-package-lock @playwright/cli@0.1.19 playwright
/usr/bin/time -p "$runtime/node_modules/.bin/playwright" install chromium
/usr/bin/time -p tee "$runtime/metal.json" >/dev/null <<JSON
{
  "outputDir": "$runtime/output",
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "channel": "chromium",
      "headless": false,
      "args": ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-angle=metal"]
    }
  }
}
JSON
# An executable wrapper also works in fresh SSH shells without Actions env.
node_dir="$(dirname "$(command -v node)")"
/usr/bin/time -p cp "$(dirname "${BASH_SOURCE[0]}")/wip-screenshots.cjs" "$(dirname "${BASH_SOURCE[0]}")/wip-screenshot-hook.cjs" "$runtime/"
/usr/bin/time -p tee "$runtime/playwright-cli" >/dev/null <<WRAPPER
#!/usr/bin/env bash
export PATH="$node_dir:\$PATH"
export PLAYWRIGHT_MCP_OUTPUT_DIR="$runtime/output"
export OMGITHUB_CAPTURE_WEB_DIR="${OPENCODE_WEB_DIR:-}"
export OMGITHUB_PLAYWRIGHT_ROOT="$runtime"
export NODE_OPTIONS="--require=$runtime/wip-screenshot-hook.cjs \${NODE_OPTIONS:-}"
for arg in "\$@"; do
  case "\$arg" in
    -*) continue ;;
    open) exec "$runtime/node_modules/.bin/playwright-cli" "\$@" --config "$runtime/metal.json" ;;
    *) break ;;
  esac
done
exec "$runtime/node_modules/.bin/playwright-cli" "\$@"
WRAPPER
/usr/bin/time -p chmod 755 "$runtime/playwright-cli"
/usr/bin/time -p sudo -n ln -sfn "$runtime/playwright-cli" /usr/local/bin/playwright-cli
/usr/bin/time -p printf '%s\n' /usr/local/bin >> "$GITHUB_PATH"
/usr/bin/time -p /usr/local/bin/playwright-cli --version
