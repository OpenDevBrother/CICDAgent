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

require_cmd oci
require_cmd ssh
require_cmd scp

require_env OCI_REGION
require_env OCI_COMPARTMENT_ID
require_env OCI_AD
require_env OCI_INSTANCE_SHAPE
require_env OCI_INSTANCE_OCPUS
require_env OCI_INSTANCE_MEMORY_GB
require_env OCI_BOOT_VOLUME_GB
require_env OCI_SSH_PUBLIC_KEY_PATH

if [[ "${OCI_INSTANCE_SHAPE}" != "VM.Standard.A1.Flex" ]]; then
  err "Only VM.Standard.A1.Flex is allowed by this module to avoid paid shape drift."
  exit 1
fi

if (( OCI_INSTANCE_OCPUS < 1 || OCI_INSTANCE_OCPUS > 4 )); then
  err "OCI_INSTANCE_OCPUS must be between 1 and 4 for Always Free A1 target."
  exit 1
fi

if (( OCI_INSTANCE_MEMORY_GB < 1 || OCI_INSTANCE_MEMORY_GB > 24 )); then
  err "OCI_INSTANCE_MEMORY_GB must be between 1 and 24 for Always Free A1 target."
  exit 1
fi

if (( OCI_BOOT_VOLUME_GB < 47 || OCI_BOOT_VOLUME_GB > 200 )); then
  err "OCI_BOOT_VOLUME_GB must stay in 47-200 range (Always Free storage budget)."
  exit 1
fi

if [[ ! -f "${OCI_SSH_PUBLIC_KEY_PATH}" ]]; then
  err "SSH public key file not found: ${OCI_SSH_PUBLIC_KEY_PATH}"
  exit 1
fi

log "Checking OCI auth/session..."
oci_cmd iam region-subscription list --all --query 'data[]."region-name"' --output table >/dev/null

log "Checking A1 shape visibility in AD..."
shape_count="$(oci_cmd compute shape list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --availability-domain "${OCI_AD}" \
  --all \
  --query "length(data[?shape=='${OCI_INSTANCE_SHAPE}'])" \
  --raw-output)"

if [[ "${shape_count}" == "0" ]]; then
  warn "A1 shape not visible in ${OCI_AD}. This may be capacity-related in your home region."
else
  log "A1 shape visible in ${OCI_AD}."
fi

log "Preflight passed."
log "Using shape=${OCI_INSTANCE_SHAPE}, ocpus=${OCI_INSTANCE_OCPUS}, memory_gb=${OCI_INSTANCE_MEMORY_GB}, boot_gb=${OCI_BOOT_VOLUME_GB}."
