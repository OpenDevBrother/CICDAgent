#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${1:-${SCRIPT_DIR}/oci-free-tier.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[OCI][ERROR] Env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/common.sh"
load_state

require_cmd curl
require_env OCI_INSTANCE_PUBLIC_IP

host="${OCI_INSTANCE_PUBLIC_IP}"

log "Running health checks for ${host}..."

curl -fsS "http://${host}/api/health" >/dev/null
log "Next.js API health OK"

curl -fsS "http://${host}:8000/health" >/dev/null
log "AI engine health OK"

log "Verification passed."
log "Next step: cut DNS/callback URLs to OCI host, then observe before EC2 retirement."
