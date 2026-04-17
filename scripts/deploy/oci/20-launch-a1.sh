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

require_cmd oci

require_env OCI_COMPARTMENT_ID
require_env OCI_AD
require_env OCI_INSTANCE_SHAPE
require_env OCI_INSTANCE_OCPUS
require_env OCI_INSTANCE_MEMORY_GB
require_env OCI_BOOT_VOLUME_GB
require_env OCI_SSH_PUBLIC_KEY_PATH

OCI_INSTANCE_NAME="${OCI_INSTANCE_NAME:-sentinelqa-app-a1}"
subnet_id="${OCI_SUBNET_ID:-}"
if [[ -z "${subnet_id}" || "${subnet_id}" == "null" || "${subnet_id}" == "None" ]]; then
  err "No subnet id available. Run 10-network.sh first or set OCI_SUBNET_ID in env."
  exit 1
fi

instance_id="$(oci_cmd compute instance list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --display-name "${OCI_INSTANCE_NAME}" \
  --all \
  --query "data[?\"lifecycle-state\"!='TERMINATED'].id | [0]" \
  --raw-output)"

if [[ -n "${instance_id}" && "${instance_id}" != "null" && "${instance_id}" != "None" ]]; then
  log "Reusing existing instance: ${instance_id}"
else
  image_id="${OCI_IMAGE_ID:-}"
  if [[ -z "${image_id}" ]]; then
    image_id="$(oci_cmd compute image list \
      --compartment-id "${OCI_COMPARTMENT_ID}" \
      --shape "${OCI_INSTANCE_SHAPE}" \
      --operating-system "Canonical Ubuntu" \
      --operating-system-version "22.04" \
      --all \
      --sort-by TIMECREATED \
      --sort-order DESC \
      --query "data[0].id" \
      --raw-output)"
  fi

  if [[ -z "${image_id}" || "${image_id}" == "null" || "${image_id}" == "None" ]]; then
    err "Could not resolve Ubuntu image id for shape ${OCI_INSTANCE_SHAPE}. Set OCI_IMAGE_ID manually."
    exit 1
  fi

  shape_config="$(printf '{"ocpus":%s,"memoryInGBs":%s}' "${OCI_INSTANCE_OCPUS}" "${OCI_INSTANCE_MEMORY_GB}")"

  log "Launching ${OCI_INSTANCE_NAME} on ${OCI_INSTANCE_SHAPE} (${OCI_INSTANCE_OCPUS} OCPU / ${OCI_INSTANCE_MEMORY_GB} GB)..."
  instance_id="$(oci_cmd compute instance launch \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --availability-domain "${OCI_AD}" \
    --subnet-id "${subnet_id}" \
    --assign-public-ip true \
    --display-name "${OCI_INSTANCE_NAME}" \
    --shape "${OCI_INSTANCE_SHAPE}" \
    --shape-config "${shape_config}" \
    --image-id "${image_id}" \
    --boot-volume-size-in-gbs "${OCI_BOOT_VOLUME_GB}" \
    --ssh-authorized-keys-file "${OCI_SSH_PUBLIC_KEY_PATH}" \
    --wait-for-state RUNNING \
    --max-wait-seconds 1800 \
    --query "data.id" \
    --raw-output)"
fi

vnic_id="$(oci_cmd compute vnic-attachment list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --instance-id "${instance_id}" \
  --query "data[0].\"vnic-id\"" \
  --raw-output)"

public_ip="$(oci_cmd network vnic get \
  --vnic-id "${vnic_id}" \
  --query "data.\"public-ip\"" \
  --raw-output)"

save_state OCI_INSTANCE_ID "${instance_id}"
save_state OCI_INSTANCE_PUBLIC_IP "${public_ip}"
save_state OCI_SUBNET_ID "${subnet_id}"

log "Instance ready: ${instance_id}"
log "Public IP: ${public_ip}"
