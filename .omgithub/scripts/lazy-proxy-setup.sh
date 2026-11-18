#!/usr/bin/env bash
# Lazy egress, called once by run-with-model-fallback.mjs when Default started on Fusion with
# WARP skipped (WARP_LAZY=1) and the chain now reaches a free OpenCode model. Phone first for
# opencode.ai / openrouter.ai, WARP for models.opencode.ai, else the runner network. Restarts
# `opencode serve` behind the chosen 127.0.0.1 relay (the session lives on disk).
# Exit 0 = device and/or WARP, 1 = unchanged (runner network).
set -uo pipefail
set +x
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
: "${OPENCODE_BIN:?}" "${OPENCODE_WEB_DIR:?}"
tmp="${RUNNER_TEMP:-/tmp}"
record() { LAZY_RESULT="$1" node -e 'const fs=require("fs"),f=process.env.OPENCODE_WEB_DIR+"/warp-status.json";let s={};try{s=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}
fs.writeFileSync(f,JSON.stringify({...s,lazy:process.env.LAZY_RESULT}))' 2>/dev/null || true; }

DEVICE=''
work_device="$tmp/device-proxy-lazy"
if bash "$here/device-proxy.sh" "$work_device" "$OPENCODE_BIN" "$OPENCODE_WEB_DIR" > /dev/null \
  && DEVICE="$(cat "$work_device/proxy-url" 2>/dev/null)" && [[ "$DEVICE" == http://127.0.0.1:* ]]; then
  :
else
  DEVICE=''
fi

GENERAL=''
proxy="$(bash "$here/warp-proxy.sh" "$tmp/warp" "$OPENCODE_BIN" 2>&2 | tail -n 1)"
if [[ "$proxy" == http://127.0.0.1:* ]]; then
  GENERAL="$proxy"
fi

if [[ -n "$DEVICE" ]]; then
  composed="$(bash "$here/compose-egress-proxy.sh" "$tmp/egress-mux-lazy" "$DEVICE" "$GENERAL" || true)"
  if [[ "$composed" == http://127.0.0.1:* ]] && bash "$here/start-opencode-serve.sh" "$composed" --wait; then
    echo "lazy proxy: device mux ready (models via ${GENERAL:+general}${GENERAL:-direct})" >&2
    record device; exit 0
  fi
fi

if [[ -n "$GENERAL" ]] && bash "$here/start-opencode-serve.sh" "$GENERAL" --wait; then
  echo "lazy proxy: WARP ready" >&2; record warp; exit 0
fi

bash "$here/start-opencode-serve.sh" "" --wait >/dev/null 2>&1 || true
echo "lazy proxy: WARP unavailable; runner network" >&2; record none; exit 1

