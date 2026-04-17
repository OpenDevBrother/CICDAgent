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
require_cmd scp
require_cmd rsync

require_env OCI_INSTANCE_PUBLIC_IP
require_env OCI_SSH_PRIVATE_KEY_PATH

ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
ssh_user="${OCI_SSH_USER:-ubuntu}"
host="${OCI_INSTANCE_PUBLIC_IP}"
target_repo_url="${TARGET_REPO_URL:-https://github.com/Manjunath5513/TestingQA.git}"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  err "Missing root .env at ${ROOT_DIR}/.env"
  exit 1
fi
if [[ ! -f "${ROOT_DIR}/ai-engine/.env" ]]; then
  err "Missing ai-engine/.env at ${ROOT_DIR}/ai-engine/.env"
  exit 1
fi

log "Syncing app code to OCI host..."
rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude ".next" \
  --exclude "ai-engine/.venv" \
  -e "ssh -o StrictHostKeyChecking=accept-new -i ${OCI_SSH_PRIVATE_KEY_PATH}" \
  "${ROOT_DIR}/" "${ssh_user}@${host}:/home/ubuntu/sentinelqa/"

log "Uploading env files..."
scp -o StrictHostKeyChecking=accept-new -i "${OCI_SSH_PRIVATE_KEY_PATH}" \
  "${ROOT_DIR}/.env" "${ssh_user}@${host}:/home/ubuntu/sentinelqa/.env"
scp -o StrictHostKeyChecking=accept-new -i "${OCI_SSH_PRIVATE_KEY_PATH}" \
  "${ROOT_DIR}/ai-engine/.env" "${ssh_user}@${host}:/home/ubuntu/sentinelqa/ai-engine/.env"

log "Running deploy steps on OCI host..."
ssh -o StrictHostKeyChecking=accept-new -i "${OCI_SSH_PRIVATE_KEY_PATH}" "${ssh_user}@${host}" <<REMOTE
set -euo pipefail

if [[ ! -d /home/ubuntu/testingqa/.git ]]; then
  git clone "${target_repo_url}" /home/ubuntu/testingqa || true
fi

cd /home/ubuntu/sentinelqa
npm ci
npm run build

python3 -m venv /home/ubuntu/venv
/home/ubuntu/venv/bin/pip install --upgrade pip
/home/ubuntu/venv/bin/pip install -r /home/ubuntu/sentinelqa/ai-engine/requirements.txt
/home/ubuntu/venv/bin/pip install axoniq

cd /home/ubuntu/sentinelqa
npx playwright install chromium --with-deps || true

cat > /home/ubuntu/sentinelqa/ecosystem.config.cjs <<'PM2EOF'
module.exports = {
  apps: [
    {
      name: "dashboard",
      script: "npm",
      args: "start",
      cwd: "/home/ubuntu/sentinelqa",
      env: { PORT: 3000, NODE_ENV: "production" },
    },
    {
      name: "ai-engine",
      script: "/home/ubuntu/venv/bin/python",
      args: "server.py",
      cwd: "/home/ubuntu/sentinelqa/ai-engine",
      interpreter: "none",
    },
    {
      name: "telegram-bot",
      script: "npx",
      args: "tsx scripts/telegram-bot.ts",
      cwd: "/home/ubuntu/sentinelqa",
    },
    {
      name: "slack-bot",
      script: "npx",
      args: "tsx scripts/slack-bot.ts",
      cwd: "/home/ubuntu/sentinelqa",
    },
    {
      name: "axon",
      script: "/home/ubuntu/venv/bin/axon",
      args: "ui --watch --no-open --port 8420",
      cwd: "/home/ubuntu/testingqa",
      interpreter: "none",
    },
    {
      name: "target-app",
      script: "npx",
      args: "serve /home/ubuntu/testingqa -l 5173",
      cwd: "/home/ubuntu/sentinelqa",
    },
  ],
};
PM2EOF

cat > /tmp/sentinelqa-nginx.conf <<'NGINXEOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 10M;
    proxy_read_timeout 300s;
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    location /api/ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }
}
NGINXEOF

sudo mv /tmp/sentinelqa-nginx.conf /etc/nginx/sites-available/sentinelqa
sudo ln -sf /etc/nginx/sites-available/sentinelqa /etc/nginx/sites-enabled/sentinelqa
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

cd /home/ubuntu/sentinelqa
pm2 delete all || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | bash || true
REMOTE

log "App deployment complete."
log "Remember to verify env values include VECTOR_PROVIDER=qdrant before cutover."
