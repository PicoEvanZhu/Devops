#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# One‑click deploy script
# - Packages current repo
# - Uploads to remote server
# - Ensures Docker + docker‑compose exist (Ubuntu/Debian best effort)
# - Runs `docker-compose up -d --build` in remote app directory
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# Optional env overrides:
#   SERVER_USER   (default: root)
#   SERVER_IP     (default: 158.178.215.93)
#   REMOTE_DIR    (default: /opt/devops-app)
###############################################################################

SERVER_USER="${SERVER_USER:-root}"
SERVER_IP="${SERVER_IP:-158.178.215.93}"
REMOTE_DIR="${REMOTE_DIR:-/opt/devops-app}"

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
ARCHIVE_NAME="devops-app-${TIMESTAMP}.tar.gz"

echo "==> Packing project into ${ARCHIVE_NAME} (excluding .git & node_modules)..."
tar czf "${ARCHIVE_NAME}" \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='dist' \
  .

echo "==> Uploading archive to ${SERVER_USER}@${SERVER_IP}:/tmp/${ARCHIVE_NAME} ..."
scp "${ARCHIVE_NAME}" "${SERVER_USER}@${SERVER_IP}:/tmp/${ARCHIVE_NAME}"

echo "==> Deploying on remote server ${SERVER_IP} ..."
ssh "${SERVER_USER}@${SERVER_IP}" bash -s <<EOF
set -euo pipefail

echo "[remote] Using app directory: ${REMOTE_DIR}"
mkdir -p "${REMOTE_DIR}"
cd "${REMOTE_DIR}"

echo "[remote] Cleaning old contents..."
rm -rf ./*

echo "[remote] Unpacking archive..."
tar xzf "/tmp/${ARCHIVE_NAME}" -C "${REMOTE_DIR}"

echo "[remote] Ensuring Docker is installed..."
if ! command -v docker >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update || true
    apt-get install -y docker.io || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker || true
  fi
fi

echo "[remote] Ensuring docker-compose is installed..."
if ! command -v docker-compose >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get install -y docker-compose || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker-compose || true
  fi
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable docker || true
  systemctl start docker || true
fi

echo "[remote] docker-compose up -d --build ..."
docker-compose down || true
docker-compose up -d --build

echo "[remote] Deployment finished."
EOF

echo "==> Cleaning local archive..."
rm -f "${ARCHIVE_NAME}"

echo "==> Done."
echo "Frontend: http://${SERVER_IP}:5101"
echo "Backend:  http://${SERVER_IP}:5100"

