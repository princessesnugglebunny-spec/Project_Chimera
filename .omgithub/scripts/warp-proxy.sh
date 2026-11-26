#!/usr/bin/env bash
# Start a per-job Cloudflare WARP HTTP proxy that egresses over WARP IPv6.
#
# Usage: warp-proxy.sh <work-dir> <opencode-bin>
# On success: prints the proxy URL (http://127.0.0.1:PORT) as the last stdout
# line, leaves wireproxy running (pid in <work-dir>/wireproxy.pid), exit 0.
# On failure: exit 1. The caller then starts OpenCode the old way.
#
# GitHub-hosted runners have no IPv6. The WireGuard tunnel itself runs over
# IPv4 (UDP to engage.cloudflareclient.com) and carries WARP's inner IPv6
# address, so OpenCode's calls leave from a WARP IPv6 (2a09:bac*) instead of
# the shared, usually exhausted WARP IPv4 NAT address.
set -uo pipefail

WGCF_VERSION=2.3.1
WIREPROXY_VERSION=1.1.3
MAX_REGISTRATIONS=2
PROBE_SECONDS=90
EGRESS_PREFIX=2a09:bac
KEEP_IPV4_FALLBACK=true
TRACE_URL=https://www.cloudflare.com/cdn-cgi/trace
PROBE_MODELS=(opencode/deepseek-v4.1-flash-free opencode/glm-5.3-flash-free opencode/mimo-v2.6-flash-free opencode/big-pickle)

work="${1:?work dir}"
opencode_bin="${2:?opencode binary}"
log() { printf '[warp] %s\n' "$*" >&2; }

case "$(uname -s)/$(uname -m)" in
  Linux/x86_64)  wgcf_asset=wgcf_${WGCF_VERSION}_linux_amd64;  wgcf_sha=4fb7a136aa470ece11d17949c7db07b040ec9c604742dc8680bcf1889f85d0c8
                 wp_asset=wireproxy_linux_amd64.tar.gz;        wp_sha=e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c ;;
  Linux/aarch64) wgcf_asset=wgcf_${WGCF_VERSION}_linux_arm64;  wgcf_sha=710ab2d8ac145d81a4cf0c11bdb0e05914f77ae2a45f67b87e718d84b4cb7301
                 wp_asset=wireproxy_linux_arm64.tar.gz;        wp_sha=370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6 ;;
  Darwin/arm64)  wgcf_asset=wgcf_${WGCF_VERSION}_darwin_arm64; wgcf_sha=45be8d5ea91fd0b938a1775fd3e0b29a33b756b6cc67a0a9f305bcf86ff608c2
                 wp_asset=wireproxy_darwin_arm64.tar.gz;       wp_sha=28d34342c48c309b628d9c06ab4efc05b82fba49821f360605c02139c02547a5 ;;
  Darwin/x86_64) wgcf_asset=wgcf_${WGCF_VERSION}_darwin_amd64; wgcf_sha=de295a28dd7503cd779c9afa2bf2e59435107bace94bdc0b57b66d8c9d9408ad
                 wp_asset=wireproxy_darwin_amd64.tar.gz;       wp_sha=5d89742a0f381d9508d3ad828a0d300dceee24fa49015427eaff42a23f7a50bd ;;
  *) log "unsupported platform $(uname -s)/$(uname -m)"; exit 1 ;;
esac

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
# Portable time limit (macOS has no coreutils timeout).
bounded() {
  local seconds="$1"; shift
  "$@" & local pid=$!
  ( sleep "$seconds"; kill -TERM "$pid" 2>/dev/null; sleep 3; kill -KILL "$pid" 2>/dev/null ) & local guard=$!
  wait "$pid"; local rc=$?
  kill "$guard" 2>/dev/null; wait "$guard" 2>/dev/null
  return "$rc"
}
fetch() { # url sha dest
  curl --fail --silent --show-error --location --retry 3 --max-time 60 "$1" -o "$3" || return 1
  [[ "$(sha256 "$3")" == "$2" ]] || { log "checksum mismatch for $1"; return 1; }
}

mkdir -p "$work/bin" && chmod 700 "$work"
wgcf="$work/bin/wgcf" wireproxy="$work/bin/wireproxy"
if [[ ! -x "$wgcf" ]]; then
  fetch "https://github.com/ViRb3/wgcf/releases/download/v${WGCF_VERSION}/${wgcf_asset}" "$wgcf_sha" "$wgcf" || { log 'wgcf download failed'; exit 1; }
  chmod +x "$wgcf"
fi
if [[ ! -x "$wireproxy" ]]; then
  fetch "https://github.com/whyvl/wireproxy/releases/download/v${WIREPROXY_VERSION}/${wp_asset}" "$wp_sha" "$work/wireproxy.tar.gz" || { log 'wireproxy download failed'; exit 1; }
  tar -xzf "$work/wireproxy.tar.gz" -C "$work/bin" wireproxy && chmod +x "$wireproxy" || { log 'wireproxy unpack failed'; exit 1; }
fi

# /64 of an IPv6 address (expands "::"), e.g. 2a09:bac5:1:2::3 -> 2a09:bac5:1:2::/64.
prefix64() {
  printf '%s\n' "$1" | awk -F'::' '/:/ { n = split($1, a, ":"); m = (NF > 1 && $2 != "") ? split($2, b, ":") : 0
    for (i = n + 1; i <= 8 - m; i++) a[i] = "0"; for (i = 1; i <= m; i++) a[8 - m + i] = b[i]
    out = ""; for (i = 1; i <= 4; i++) out = out (i > 1 ? ":" : "") (a[i] == "" ? "0" : tolower(a[i])); print out "::/64" }' | tr -cd '0-9a-f:/'
}
free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }

stop_proxy() {
  [[ -f "$work/wireproxy.pid" ]] && kill "$(cat "$work/wireproxy.pid")" 2>/dev/null
  rm -f "$work/wireproxy.pid"
}

# One tiny anonymous free-tier call with the real OpenCode client, isolated
# from the job's OpenCode data so it neither uses the account's auth nor
# leaves a session behind. 0 = served twice in a row, 4 = rate limited, 2 = failed, 3 = no usable model.
probe_model() {
  local proxy="$1" probe="$work/probe" model out rc
  rm -rf "$probe"; mkdir -p "$probe/project" "$probe/data" "$probe/config" "$probe/cache" "$probe/state"
  printf '{"plugin":[],"permission":{"*":"allow"}}\n' > "$probe/opencode.json"
  # A single lucky answer is not enough (issue 38: WARP passed one probe, then the real
  # request hit FreeUsageLimit 3s later), so a model must answer twice in a row.
  for model in "${PROBE_MODELS[@]}"; do
    local pass
    for pass in 1 2; do
      out="$probe/run-${model//\//_}-$pass.jsonl"
      ( cd "$probe/project" && HTTPS_PROXY="$proxy" HTTP_PROXY="$proxy" https_proxy="$proxy" http_proxy="$proxy" \
          NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 \
          XDG_DATA_HOME="$probe/data" XDG_CONFIG_HOME="$probe/config" XDG_CACHE_HOME="$probe/cache" XDG_STATE_HOME="$probe/state" \
          OPENCODE_CONFIG="$probe/opencode.json" OPENCODE_API_KEY= OPENCODE_AUTH_JSON= OPENROUTER_API_KEY= \
          bounded "$PROBE_SECONDS" "$opencode_bin" run --standalone --model "$model" --format json 'Reply with exactly: OK' ) > "$out" 2>&1
      rc=$?
      if grep -q '"type":"text"' "$out"; then
        if [[ $pass == 1 ]]; then log "model probe: $model answered through WARP (1/2), confirming"; continue; fi
        log "model probe: $model answered twice in a row through WARP"; return 0
      fi
      if grep -Eqi 'FreeUsageLimit|free usage limit|"status":429|\b429\b|rate.?limit' "$out"; then
        log "model probe: $model rate limited (429) on this WARP exit (pass $pass)"; return 4
      fi
      if grep -Eqi 'ModelDeprecated|model.{0,40}(not found|unavailable|deprecated)|ProviderModelNotFound' "$out"; then
        log "model probe: $model unavailable, trying the next free model"; continue 2
      fi
      log "model probe: $model failed (exit $rc, pass $pass): $(tr '\n' ' ' < "$out" | grep -Eo '"(message|name)":"[^"]{0,160}' | head -2 | tr '\n' ' ')"
      return 2
    done
  done
  return 3
}

# Admin stats (no secrets): last attempt, /48 egress prefix, colo, and whether
# every exit that reached the probe was rate limited (429) vs a setup error.
probed=0; limited=0; last_prefix=''; last_prefix64=''; last_colo=''; exits=''
write_status() {
  printf '{"result":"%s","attempt":%s,"egress_prefix":"%s","egress_prefix64":"%s","colo":"%s","probed":%s,"rate_limited":%s,"exits":[%s]}\n' \
    "$1" "${attempt:-0}" "$last_prefix" "$last_prefix64" "$last_colo" "$probed" "$limited" "$exits" > "$work/status.json" 2>/dev/null || true
}
for attempt in $(seq 1 "$MAX_REGISTRATIONS"); do
  stop_proxy
  reg="$work/reg-$attempt"; rm -rf "$reg"; mkdir -p "$reg"
  if ! ( cd "$reg" && bounded 60 "$wgcf" register --accept-tos >/dev/null 2>&1 && bounded 60 "$wgcf" generate >/dev/null 2>&1 ) || [[ ! -s "$reg/wgcf-profile.conf" ]]; then
    log "attempt $attempt: wgcf register/generate failed"; sleep 3; continue
  fi
  port="$(free_port)"
  # Prefer AAAA (ResolveStrategy = ipv6) so OpenCode (opencode.ai has AAAA)
  # always leaves from WARP IPv6. With KEEP_IPV4_FALLBACK the IPv4 address
  # stays, so IPv4-only hosts (MCP servers, etc.) still work via WARP's IPv4
  # NAT instead of failing; the egress check below still requires IPv6.
  # The probe always runs on an IPv6-only config (keep4=false), so a 429 or OK
  # reflects this exit's WARP IPv6 and never the shared WARP IPv4 NAT. Once the
  # probe passes and KEEP_IPV4_FALLBACK is on, wireproxy restarts on the same
  # port with IPv4 kept for IPv4-only hosts (MCP servers, etc.).
  make_conf() { awk -v port="$port" -v keep4="$1" '
    function addrs(key, value,   n, parts, i, out) {
      n = split(value, parts, ","); out = ""
      for (i = 1; i <= n; i++) { gsub(/^[ \t]+|[ \t]+$/, "", parts[i]); if (keep4 == "true" || parts[i] ~ /:/) out = out (out == "" ? "" : ", ") parts[i] }
      if (out != "") print key " = " out
    }
    /^[ \t]*(Address|DNS)[ \t]*=/ { key = $0; sub(/[ \t]*=.*/, "", key); gsub(/[ \t]/, "", key); val = $0; sub(/^[^=]*=[ \t]*/, "", val); addrs(key, val); next }
    { print }
    END { print ""; print "[Resolve]"; print "ResolveStrategy = ipv6"; print ""; print "[http]"; print "BindAddress = 127.0.0.1:" port }
  ' "$reg/wgcf-profile.conf"; }
  make_conf false > "$reg/wireproxy.conf"; make_conf "$KEEP_IPV4_FALLBACK" > "$reg/wireproxy-keep4.conf"
  chmod 600 "$reg/wgcf-account.toml" "$reg/wgcf-profile.conf" "$reg/wireproxy.conf" "$reg/wireproxy-keep4.conf" 2>/dev/null
  grep -Eq '^Address = .*:' "$reg/wireproxy.conf" || { log "attempt $attempt: WARP profile has no IPv6 address"; continue; }
  nohup "$wireproxy" -c "$reg/wireproxy.conf" > "$work/wireproxy.log" 2>&1 &
  echo $! > "$work/wireproxy.pid"
  proxy="http://127.0.0.1:$port"
  trace=''
  for _ in $(seq 1 15); do
    trace="$(curl --silent --max-time 8 --proxy "$proxy" "$TRACE_URL" 2>/dev/null || true)"
    [[ "$trace" == *"warp=on"* ]] && break
    kill -0 "$(cat "$work/wireproxy.pid")" 2>/dev/null || break
    sleep 1
  done
  egress="$(printf '%s\n' "$trace" | sed -n 's/^ip=//p')"
  if [[ "$egress" != "$EGRESS_PREFIX"* ]]; then
    log "attempt $attempt: unexpected WARP egress '${egress:-none}' (want ${EGRESS_PREFIX}*): $(tail -n 2 "$work/wireproxy.log" 2>/dev/null | tr '\n' ' ' | cut -c1-200)"; continue
  fi
  last_colo="$(printf '%s\n' "$trace" | sed -n 's/^colo=//p' | tr -cd 'A-Z' | cut -c1-3)"
  last_prefix="$(printf '%s' "$egress" | awk -F: 'NF>3 {print $1":"$2":"$3"::/48"}' | tr -cd '0-9a-fA-F:/')"
  last_prefix64="$(prefix64 "$egress")"
  log "attempt $attempt: WARP egress $egress ($last_colo, ${last_prefix64:-?})"
  probe_model "$proxy"; rc=$?
  exits="${exits:+$exits,}{\"prefix64\":\"$last_prefix64\",\"colo\":\"$last_colo\",\"probe\":$rc}"
  [[ "$rc" != 3 ]] && probed=$((probed + 1))
  [[ "$rc" == 4 ]] && limited=$((limited + 1))
  if [[ "$rc" == 0 || "$rc" == 3 ]]; then
    [[ "$rc" == 3 ]] && log 'model probe: no probe model available; keeping the verified WARP egress'
    if [[ "$KEEP_IPV4_FALLBACK" == true ]] && ! cmp -s "$reg/wireproxy.conf" "$reg/wireproxy-keep4.conf"; then
      stop_proxy
      nohup "$wireproxy" -c "$reg/wireproxy-keep4.conf" > "$work/wireproxy.log" 2>&1 &
      echo $! > "$work/wireproxy.pid"
      ready=''
      for _ in $(seq 1 15); do
        [[ "$(curl --silent --max-time 8 --proxy "$proxy" "$TRACE_URL" 2>/dev/null)" == *"warp=on"* ]] && { ready=1; break; }
        sleep 1
      done
      [[ -n "$ready" ]] || { log "attempt $attempt: IPv4-fallback restart failed"; continue; }
    fi
    printf '%s\n' "$egress" > "$work/egress"
    write_status ok
    printf '%s\n' "$proxy"
    exit 0
  fi
done
stop_proxy
if (( probed > 0 && limited == probed )); then write_status 429_fallback; else write_status setup_failed; fi
log "WARP setup failed after $MAX_REGISTRATIONS registrations"
exit 1
