#!/usr/bin/env bash
# Phone-first egress: probe omsite device-relay; if the owner's phone is online,
# mint a run token and start a local CONNECT relay whose upstream is that phone.
# OpenCode never sees the token — only http://127.0.0.1:PORT.
#
# Usage: device-proxy.sh <work-dir> <opencode-bin> <web-dir>
# Exit 0: <work-dir>/proxy-url holds http://127.0.0.1:PORT
# Exit 5: phone offline / available:false (caller continues to WARP)
# Other non-zero: setup error
# Always writes <work-dir>/status.json {"result":"device_ok|device_offline|device_error"}
set -uo pipefail
set +x
work="${1:?work dir}" opencode_bin="${2:?opencode binary}" web_dir="${3:?web dir}"
here="$(cd "$(dirname "$0")" && pwd)"
log() { printf '[device-proxy] %s\n' "$*" >&2; }
mkdir -p "$work" && chmod 700 "$work"
status() { printf '{"result":"%s"}\n' "$1" > "$work/status.json" 2>/dev/null || true; }
status device_error

umask 077
if ! timeout 25 node --input-type=module - "$work/creds.json" <<'NODE'
import { writeFileSync } from 'node:fs'
const env = process.env
const origin = String(env.OMGITHUB_ORIGIN || 'https://omgithub.com').replace(/\/$/, '')
const call = async (url, options) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return body
}
try {
  const id = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); id.searchParams.set('audience', origin)
  const { value } = await call(id, { headers: { authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } })
  const base = `${origin}/api/github/${env.GITHUB_REPOSITORY}/issues/${env.TRIGGER_ISSUE_NUMBER}/device-relay`
  const q = new URL(base)
  q.searchParams.set('run', env.GITHUB_RUN_ID)
  q.searchParams.set('attempt', String(env.GITHUB_RUN_ATTEMPT))
  const probe = await call(q, { headers: { authorization: `Bearer ${value}` } })
  if (!probe?.available) { console.error('[device-proxy] phone offline'); process.exit(5) }
  const issued = await call(base, {
    method: 'POST',
    headers: { authorization: `Bearer ${value}`, 'content-type': 'application/json' },
    body: JSON.stringify({ run: env.GITHUB_RUN_ID, attempt: Number(env.GITHUB_RUN_ATTEMPT) }),
  })
  if (!issued?.available || typeof issued.token !== 'string' || typeof issued.ws_url !== 'string') {
    console.error('[device-proxy] phone offline after issue')
    process.exit(5)
  }
  // Mask token fragments in job logs; never print full token.
  console.log(`::add-mask::${issued.token}`)
  writeFileSync(process.argv[2], JSON.stringify({
    token: issued.token,
    ws_url: issued.ws_url,
    max_bytes: issued.max_bytes,
    max_streams: issued.max_streams,
  }), { mode: 0o600 })
} catch (error) {
  const msg = String(error.message || error)
  if (/\b5\b/.test(process.exitCode) || false) process.exit(5)
  console.error(`[device-proxy] credentials unavailable (${msg.slice(0, 80)})`)
  process.exit(1)
}
NODE
then
  rc=$?
  rm -f "$work/creds.json"
  if [[ $rc -eq 5 ]]; then status device_offline; log 'phone offline'; exit 5; fi
  status device_error; exit 2
fi

rm -f "$work/relay.port"
# Drop to runner / fallback when the phone WS dies mid-run.
on_fail="$work/on-failure.sh"
cat > "$on_fail" <<FAIL
#!/usr/bin/env bash
set -uo pipefail
export OPENCODE_BIN=$(printf %q "$opencode_bin")
export OPENCODE_WEB_DIR=$(printf %q "$web_dir")
bash $(printf %q "$here/drop-proxy.sh") >/dev/null 2>&1 || true
FAIL
chmod 700 "$on_fail"

# Watch bytes file for last_error=offline and trigger drop once.
nohup node "$here/device-proxy-relay.mjs" "$work/creds.json" "$work/relay.port" "$web_dir/proxy-bytes.json" > "$work/relay.log" 2>&1 &
echo $! > "$work/relay.pid"
for _ in $(seq 1 50); do [[ -s "$work/relay.port" ]] && break; sleep 0.1; done
rm -f "$work/creds.json"
port="$(cat "$work/relay.port" 2>/dev/null)"
stop() { kill "$(cat "$work/relay.pid" 2>/dev/null)" 2>/dev/null; rm -f "$work/relay.pid"; }
[[ "$port" =~ ^[0-9]+$ ]] || { log 'relay did not start'; stop; status device_error; exit 2; }

# Background watcher: if relay records offline/cap, drop the proxy once.
(
  seen=0
  for _ in $(seq 1 3600); do
    sleep 2
    err="$(node -p 'try{String(require(process.argv[1]).last_error||"")}catch{""}' "$web_dir/proxy-bytes.json" 2>/dev/null || true)"
    if [[ "$err" == offline || "$err" == *cap* || "$err" == shutdown ]]; then
      if [[ $seen -eq 0 ]]; then seen=1; bash "$on_fail" || true; fi
      break
    fi
    kill -0 "$(cat "$work/relay.pid" 2>/dev/null)" 2>/dev/null || break
  done
) >/dev/null 2>&1 &

proxy="http://127.0.0.1:$port"
log "relay up on $proxy"
status device_ok
printf '%s\n' "$proxy" > "$work/proxy-url"
exit 0
