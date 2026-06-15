#!/usr/bin/env bash
# Pitch Navi 初回デプロイ（VM上で実行）。冪等。
set -e

echo "[1/6] swap (e2-micro 1GB対策)"
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi

echo "[2/6] base packages (git/curl)"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl

echo "[3/6] docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi

echo "[4/6] fetch app -> /opt/p3"
sudo mkdir -p /opt/p3
if [ -d /opt/p3/.git ]; then
  sudo git -C /opt/p3 fetch --all -q
  sudo git -C /opt/p3 reset --hard origin/main -q
else
  sudo git clone -q https://github.com/tenpoohlove/salespro.git /opt/p3
fi

echo "[5/6] env file"
sudo tee /opt/p3/.env.deploy >/dev/null <<'EOF'
DOMAIN=pitchnavi.8-231-192-187.sslip.io
SITE_URL=https://pitchnavi.8-231-192-187.sslip.io
ADMIN_EMAIL=tenpoohlove@gmail.com
FEATURE_VOICE_CLONE=false
EOF

echo "[6/6] build & up (初回ビルドは数分かかります)"
cd /opt/p3
sudo docker compose --env-file .env.deploy up -d --build

echo "=== DONE ==="
sudo docker compose ps
