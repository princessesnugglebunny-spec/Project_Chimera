#!/usr/bin/env bash
# Download FRP client with retry, checksum verification, and caching.
# Usage: download-frp.sh <version> <os_arch> <output_dir> [cache_dir]
# Example: download-frp.sh 0.71.1 linux_amd64 /tmp/opencode /tmp/frp-cache
#
# Cache behavior:
# - Cache dir defaults to $RUNNER_TEMP/frp-cache
# - On GitHub Actions, use actions/cache@v4 to persist across runs
# - Cache key must include checksum to allow eviction on corruption
# - Without actions/cache, cache is intra-run only (cleared between builds)
#
# Checksum provenance:
# SHA256 hashes pinned below are verified against the GitHub Releases API
# digest field (api.github.com/repos/fatedier/frp/releases), which provides
# checksums for release assets. This is TLS-authenticated upstream data.
# FRP does not publish a separate checksum file.

set -euo pipefail

FRP_VERSION="${1:-}"
FRP_ASSET="${2:-}"
OUTPUT_DIR="${3:-}"
CACHE_DIR="${4:-${RUNNER_TEMP:-/tmp}/frp-cache}"

if [[ -z "$FRP_VERSION" || -z "$FRP_ASSET" || -z "$OUTPUT_DIR" ]]; then
  echo "Usage: download-frp.sh <version> <os_arch> <output_dir> [cache_dir]" >&2
  exit 1
fi

# Pinned SHA256 checksums for FRP v0.71.1 archives
# Source: GitHub Releases API digest field
# Verified: GET https://api.github.com/repos/fatedier/frp/releases/tags/v0.71.1
#           jq '.assets[] | {name, digest}'
# Supported platforms: Linux x64/ARM64, macOS x64/ARM64 (GitHub Actions runners)
declare -A FRP_CHECKSUMS=(
  ["0.71.1_linux_amd64"]="1d9875210972a5d1a62b2dc4c48df45ab0af05d3ca1b5e494a014428259df803"
  ["0.71.1_linux_arm64"]="8edf590b0c396fa42f9c147121a76af83cfc2002b08f5aef0ea1008c43482019"
  ["0.71.1_darwin_amd64"]="8acb59b6fb998cc8d209d1373d90bf70fa5ec3efeb4dfbc7bda6ce3abd78cb45"
  ["0.71.1_darwin_arm64"]="d15d0324b99e14619c9aa46e37f6db588c06a09be4bc6f7948890b6b61077842"
)

CHECKSUM_KEY="${FRP_VERSION}_${FRP_ASSET}"
EXPECTED_HASH="${FRP_CHECKSUMS[$CHECKSUM_KEY]:-}"

if [[ -z "$EXPECTED_HASH" ]]; then
  echo "ERROR: No pinned checksum for FRP ${FRP_VERSION} ${FRP_ASSET}" >&2
  echo "Supported versions/architectures:" >&2
  for key in "${!FRP_CHECKSUMS[@]}"; do echo "  $key" >&2; done
  exit 1
fi

ARCHIVE_NAME="frp_${FRP_VERSION}_${FRP_ASSET}.tar.gz"
DOWNLOAD_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${ARCHIVE_NAME}"
CACHE_FILE="${CACHE_DIR}/${ARCHIVE_NAME}"
CACHE_HASH_FILE="${CACHE_DIR}/${ARCHIVE_NAME}.sha256"
OUTPUT_ARCHIVE="${OUTPUT_DIR}/frp.tgz"
OUTPUT_BINARY="${OUTPUT_DIR}/frpc"

# Retry settings
MAX_RETRIES=3
CONNECT_TIMEOUT=10
MAX_TIME=120

verify_checksum() {
  local file="$1"
  local expected="$2"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  local actual
  actual=$(sha256sum "$file" 2>/dev/null | cut -d' ' -f1)
  if [[ "$actual" != "$expected" ]]; then
    echo "Checksum mismatch for $file" >&2
    echo "  Expected: $expected" >&2
    echo "  Actual:   $actual" >&2
    return 1
  fi
  return 0
}

download_with_retry() {
  local url="$1"
  local output="$2"
  local attempt=0
  local delay=2

  while (( attempt < MAX_RETRIES )); do
    attempt=$((attempt + 1))
    echo "Download attempt $attempt/$MAX_RETRIES: $url"

    if curl --fail --silent --show-error --location \
         --connect-timeout "$CONNECT_TIMEOUT" \
         --max-time "$MAX_TIME" \
         --output "$output" \
         "$url" 2>&1; then
      if [[ -f "$output" && -s "$output" ]]; then
        return 0
      fi
      echo "Download produced empty or missing file" >&2
    fi

    if (( attempt < MAX_RETRIES )); then
      echo "Retrying in ${delay}s..." >&2
      if [[ "${FRP_DOWNLOAD_TEST_MODE:-}" != "1" ]]; then
        sleep "$delay"
      fi
      delay=$((delay * 2))
    fi
  done

  echo "ERROR: Download failed after $MAX_RETRIES attempts" >&2
  echo "  URL: $url" >&2
  echo "  Host: $(hostname)" >&2
  echo "  Stage: FRP client download" >&2
  return 1
}

# Check cache first
mkdir -p "$CACHE_DIR" "$OUTPUT_DIR"

if [[ -f "$CACHE_FILE" ]]; then
  echo "Checking cached FRP archive: $CACHE_FILE"
  if verify_checksum "$CACHE_FILE" "$EXPECTED_HASH"; then
    echo "Using verified cached FRP archive"
    cp "$CACHE_FILE" "$OUTPUT_ARCHIVE"
  else
    echo "Cached archive corrupted or outdated, removing..."
    rm -f "$CACHE_FILE" "$CACHE_HASH_FILE"
  fi
fi

# Download if not cached or cache invalid
if [[ ! -f "$OUTPUT_ARCHIVE" ]] || ! verify_checksum "$OUTPUT_ARCHIVE" "$EXPECTED_HASH"; then
  echo "Downloading FRP ${FRP_VERSION} for ${FRP_ASSET}..."

  TEMP_DOWNLOAD="${OUTPUT_DIR}/frp-download-$$.tmp"
  trap 'rm -f "$TEMP_DOWNLOAD"' EXIT

  if ! download_with_retry "$DOWNLOAD_URL" "$TEMP_DOWNLOAD"; then
    exit 1
  fi

  # Verify downloaded archive
  echo "Verifying checksum..."
  if ! verify_checksum "$TEMP_DOWNLOAD" "$EXPECTED_HASH"; then
    echo "ERROR: Downloaded archive failed checksum verification" >&2
    echo "  URL: $DOWNLOAD_URL" >&2
    echo "  Expected: $EXPECTED_HASH" >&2
    rm -f "$TEMP_DOWNLOAD"
    exit 1
  fi

  mv "$TEMP_DOWNLOAD" "$OUTPUT_ARCHIVE"
  trap - EXIT

  # Update cache
  cp "$OUTPUT_ARCHIVE" "$CACHE_FILE"
  echo "$EXPECTED_HASH  $ARCHIVE_NAME" > "$CACHE_HASH_FILE"
  echo "Cached verified archive for future runs"
fi

# Extract frpc binary
echo "Extracting frpc binary..."
if ! tar -xzf "$OUTPUT_ARCHIVE" -C "$OUTPUT_DIR" --strip-components=1 "frp_${FRP_VERSION}_${FRP_ASSET}/frpc"; then
  echo "ERROR: Failed to extract frpc from archive" >&2
  echo "  Archive: $OUTPUT_ARCHIVE" >&2
  rm -f "$OUTPUT_ARCHIVE"
  exit 1
fi

if [[ ! -f "$OUTPUT_BINARY" ]]; then
  echo "ERROR: frpc binary not found after extraction" >&2
  exit 1
fi

chmod 755 "$OUTPUT_BINARY"
echo "FRP client ready: $OUTPUT_BINARY"
"$OUTPUT_BINARY" --version 2>/dev/null || true
