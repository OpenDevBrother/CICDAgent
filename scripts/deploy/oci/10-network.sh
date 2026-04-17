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
require_env OCI_REGION

if [[ -n "${OCI_SUBNET_ID:-}" ]]; then
  log "Using existing subnet from env: ${OCI_SUBNET_ID}"
  save_state OCI_SUBNET_ID "${OCI_SUBNET_ID}"
  exit 0
fi

OCI_DISPLAY_PREFIX="${OCI_DISPLAY_PREFIX:-sentinelqa}"
OCI_VCN_CIDR="${OCI_VCN_CIDR:-10.20.0.0/16}"
OCI_SUBNET_CIDR="${OCI_SUBNET_CIDR:-10.20.1.0/24}"
OCI_PUBLIC_SSH_CIDR="${OCI_PUBLIC_SSH_CIDR:-0.0.0.0/0}"
OCI_ALLOW_HTTP_CIDR="${OCI_ALLOW_HTTP_CIDR:-0.0.0.0/0}"
OCI_ALLOW_HTTPS_CIDR="${OCI_ALLOW_HTTPS_CIDR:-0.0.0.0/0}"

vcn_name="${OCI_DISPLAY_PREFIX}-vcn"
igw_name="${OCI_DISPLAY_PREFIX}-igw"
rt_name="${OCI_DISPLAY_PREFIX}-rt"
sl_name="${OCI_DISPLAY_PREFIX}-sl"
subnet_name="${OCI_DISPLAY_PREFIX}-public-subnet"

log "Creating/reusing OCI network resources in ${OCI_REGION}..."

vcn_id="$(oci_cmd network vcn list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --query "data[?\"display-name\"=='${vcn_name}'].id | [0]" \
  --raw-output)"

if [[ -z "${vcn_id}" || "${vcn_id}" == "null" || "${vcn_id}" == "None" ]]; then
  vcn_id="$(oci_cmd network vcn create \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --cidr-block "${OCI_VCN_CIDR}" \
    --display-name "${vcn_name}" \
    --dns-label "sentinelvcn" \
    --query "data.id" \
    --raw-output)"
  log "Created VCN: ${vcn_id}"
else
  log "Reusing VCN: ${vcn_id}"
fi

igw_id="$(oci_cmd network internet-gateway list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --query "data[?\"display-name\"=='${igw_name}'].id | [0]" \
  --raw-output)"

if [[ -z "${igw_id}" || "${igw_id}" == "null" || "${igw_id}" == "None" ]]; then
  igw_id="$(oci_cmd network internet-gateway create \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --vcn-id "${vcn_id}" \
    --is-enabled true \
    --display-name "${igw_name}" \
    --query "data.id" \
    --raw-output)"
  log "Created Internet Gateway: ${igw_id}"
else
  log "Reusing Internet Gateway: ${igw_id}"
fi

rt_id="$(oci_cmd network route-table list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --vcn-id "${vcn_id}" \
  --query "data[?\"display-name\"=='${rt_name}'].id | [0]" \
  --raw-output)"

route_rules="[{\"cidrBlock\":\"0.0.0.0/0\",\"networkEntityId\":\"${igw_id}\"}]"
if [[ -z "${rt_id}" || "${rt_id}" == "null" || "${rt_id}" == "None" ]]; then
  rt_id="$(oci_cmd network route-table create \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --vcn-id "${vcn_id}" \
    --display-name "${rt_name}" \
    --route-rules "${route_rules}" \
    --query "data.id" \
    --raw-output)"
  log "Created Route Table: ${rt_id}"
else
  log "Reusing Route Table: ${rt_id}"
fi

sl_id="$(oci_cmd network security-list list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --vcn-id "${vcn_id}" \
  --query "data[?\"display-name\"=='${sl_name}'].id | [0]" \
  --raw-output)"

ingress_rules="[
  {\"protocol\":\"6\",\"source\":\"${OCI_PUBLIC_SSH_CIDR}\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":22,\"max\":22}}},
  {\"protocol\":\"6\",\"source\":\"${OCI_ALLOW_HTTP_CIDR}\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":80,\"max\":80}}},
  {\"protocol\":\"6\",\"source\":\"${OCI_ALLOW_HTTPS_CIDR}\",\"tcpOptions\":{\"destinationPortRange\":{\"min\":443,\"max\":443}}}
]"
egress_rules='[{"protocol":"all","destination":"0.0.0.0/0"}]'

if [[ -z "${sl_id}" || "${sl_id}" == "null" || "${sl_id}" == "None" ]]; then
  sl_id="$(oci_cmd network security-list create \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --vcn-id "${vcn_id}" \
    --display-name "${sl_name}" \
    --ingress-security-rules "${ingress_rules}" \
    --egress-security-rules "${egress_rules}" \
    --query "data.id" \
    --raw-output)"
  log "Created Security List: ${sl_id}"
else
  log "Reusing Security List: ${sl_id}"
fi

subnet_id="$(oci_cmd network subnet list \
  --compartment-id "${OCI_COMPARTMENT_ID}" \
  --vcn-id "${vcn_id}" \
  --query "data[?\"display-name\"=='${subnet_name}'].id | [0]" \
  --raw-output)"

if [[ -z "${subnet_id}" || "${subnet_id}" == "null" || "${subnet_id}" == "None" ]]; then
  subnet_id="$(oci_cmd network subnet create \
    --compartment-id "${OCI_COMPARTMENT_ID}" \
    --vcn-id "${vcn_id}" \
    --cidr-block "${OCI_SUBNET_CIDR}" \
    --display-name "${subnet_name}" \
    --dns-label "appsubnet" \
    --route-table-id "${rt_id}" \
    --security-list-ids "[\"${sl_id}\"]" \
    --prohibit-public-ip-on-vnic false \
    --query "data.id" \
    --raw-output)"
  log "Created Subnet: ${subnet_id}"
else
  log "Reusing Subnet: ${subnet_id}"
fi

save_state OCI_VCN_ID "${vcn_id}"
save_state OCI_IGW_ID "${igw_id}"
save_state OCI_ROUTE_TABLE_ID "${rt_id}"
save_state OCI_SECURITY_LIST_ID "${sl_id}"
save_state OCI_SUBNET_ID "${subnet_id}"

log "Network ready. Subnet OCID saved."
