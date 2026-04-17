#!/usr/bin/env bash

set -euo pipefail

log() { echo "[OCI][INFO] $*"; }
warn() { echo "[OCI][WARN] $*" >&2; }
err() { echo "[OCI][ERROR] $*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Required command not found: $1"
    exit 1
  fi
}

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    err "Missing required env var: $key"
    exit 1
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${OCI_STATE_DIR:-${SCRIPT_DIR}/.state}"
STATE_FILE="${STATE_DIR}/oci.state.env"
mkdir -p "${STATE_DIR}"

save_state() {
  local key="$1"
  local value="$2"
  local tmp="${STATE_FILE}.tmp"
  if [[ -f "${STATE_FILE}" ]]; then
    grep -v "^${key}=" "${STATE_FILE}" >"${tmp}" || true
  else
    : >"${tmp}"
  fi
  printf '%s="%s"\n' "${key}" "${value}" >>"${tmp}"
  mv "${tmp}" "${STATE_FILE}"
}

load_state() {
  if [[ -f "${STATE_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${STATE_FILE}"
  fi
}

oci_cmd() {
  require_env OCI_REGION
  oci --region "${OCI_REGION}" "$@"
}

