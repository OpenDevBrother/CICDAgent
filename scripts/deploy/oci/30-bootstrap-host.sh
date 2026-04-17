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

require_cmd ssh

require_env OCI_INSTANCE_PUBLIC_IP
require_env OCI_SSH_PRIVATE_KEY_PATH

ssh_user="${OCI_SSH_USER:-ubuntu}"
host="${OCI_INSTANCE_PUBLIC_IP}"

log "Waiting for SSH availability on ${host}..."
for _ in $(seq 1 60); do
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -i "${OCI_SSH_PRIVATE_KEY_PATH}" "${ssh_user}@${host}" "echo ok" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

log "Bootstrapping base runtime on OCI host..."
ssh -o StrictHostKeyChecking=accept-new -i "${OCI_SSH_PRIVATE_KEY_PATH}" "${ssh_user}@${host}" <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

sudo apt-get update -y
sudo apt-get install -y nginx git python3-pip python3-venv curl unzip build-essential

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo npm install -g pm2 tsx
sudo systemctl enable nginx
sudo systemctl restart nginx

mkdir -p /home/ubuntu/sentinelqa
mkdir -p /home/ubuntu/testingqa
REMOTE

log "Host bootstrap complete."
