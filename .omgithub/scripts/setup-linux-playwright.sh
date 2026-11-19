#!/usr/bin/env bash
set -euo pipefail
runtime="$HOME/.local/share/omgithub-playwright"
/usr/bin/time -p mkdir -p "$runtime/output"
# Bound mirror stalls, including apt calls launched by Playwright's dependency installer.
/usr/bin/time -p sudo -n tee /etc/apt/apt.conf.d/80omgithub-network >/dev/null <<'APT'
Acquire::ForceIPv4 "true";
Acquire::Retries "1";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT
/usr/bin/time -p timeout --kill-after=10s 300s sudo -n apt-get update
# Bound the install too: a stalled mirror once held this for six minutes with no network activity,
# leaving the run without a heartbeat. Continue without the GPU stack rather than hang the build.
/usr/bin/time -p timeout --kill-after=10s 900s sudo -n apt-get install -y mesa-vulkan-drivers vulkan-tools xvfb xauth lsof \
  || { echo '::warning title=Playwright GPU packages::apt-get install did not finish in 15 minutes; continuing without mesa-vulkan-drivers'; sudo -n dpkg --configure -a || true; }
/usr/bin/time -p npm install --prefix "$runtime" --no-save --no-package-lock @playwright/cli@0.1.19 playwright
/usr/bin/time -p "$runtime/node_modules/.bin/playwright" install --with-deps chromium
/usr/bin/time -p tee "$runtime/linux.json" >/dev/null <<JSON
{
  "outputDir": "$runtime/output",
  "browser": {
    "browserName": "chromium",
    "launchOptions": {
      "channel": "chromium",
      "headless": false,
      "args": ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu", "--use-angle=vulkan", "--enable-features=Vulkan", "--use-vulkan=swiftshader", "--use-webgpu-adapter=swiftshader", "--disable-vulkan-surface"]
    }
  }
}
JSON
# Keep one display alive across CLI calls and fresh SSH shells.
if [[ ! -s "$runtime/display" ]] || ! kill -0 "$(cat "$runtime/xvfb.pid" 2>/dev/null)" 2>/dev/null; then
  : > "$runtime/display"
  /usr/bin/time -p bash -c 'nohup Xvfb -displayfd 3 -screen 0 1440x900x24 -nolisten tcp 3>"$1/display" >"$1/xvfb.log" 2>&1 </dev/null & echo $! >"$1/xvfb.pid"' _ "$runtime"
  /usr/bin/time -p timeout 15 bash -c 'until test -s "$1/display"; do sleep 0.1; done' _ "$runtime"
fi
node_dir="$(dirname "$(command -v node)")"
/usr/bin/time -p cp "$(dirname "${BASH_SOURCE[0]}")/wip-screenshots.cjs" "$(dirname "${BASH_SOURCE[0]}")/wip-screenshot-hook.cjs" "$runtime/"
/usr/bin/time -p tee "$runtime/playwright-cli" >/dev/null <<WRAPPER
#!/usr/bin/env bash
set -euo pipefail
export PATH="$node_dir:\$PATH"
export DISPLAY=":\$(cat "$runtime/display")"
export PLAYWRIGHT_MCP_OUTPUT_DIR="$runtime/output"
export OMGITHUB_CAPTURE_WEB_DIR="${OPENCODE_WEB_DIR:-}"
export OMGITHUB_PLAYWRIGHT_ROOT="$runtime"
export NODE_OPTIONS="--require=$runtime/wip-screenshot-hook.cjs \${NODE_OPTIONS:-}"
for arg in "\$@"; do
  case "\$arg" in
    -*) continue ;;
    open) exec "$runtime/node_modules/.bin/playwright-cli" "\$@" --config "$runtime/linux.json" ;;
    *) break ;;
  esac
done
exec "$runtime/node_modules/.bin/playwright-cli" "\$@"
WRAPPER
/usr/bin/time -p chmod 755 "$runtime/playwright-cli"
/usr/bin/time -p sudo -n ln -sfn "$runtime/playwright-cli" /usr/local/bin/playwright-cli
if [[ -n "${GITHUB_PATH:-}" ]]; then
  /usr/bin/time -p printf '%s\n' /usr/local/bin >> "$GITHUB_PATH"
fi
/usr/bin/time -p /usr/local/bin/playwright-cli --version
