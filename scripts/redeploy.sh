#!/usr/bin/env bash
# Pitch Navi 再デプロイ（VM上で実行）。冪等。
# 最新mainを取得 → .env.deploy を生成（声クローン=ON維持）→ ビルド&再起動。
# 使い方（VM上）: setsid bash /opt/p3/scripts/redeploy.sh > /tmp/deploy.log 2>&1 < /dev/null &
set -e

cd /opt/p3
echo "[1/3] fetch latest main"
sudo git fetch --all -q
sudo git reset --hard origin/main -q

echo "[2/3] write .env.deploy (FEATURE_VOICE_CLONE=true を維持)"
sudo tee /opt/p3/.env.deploy >/dev/null <<'EOF'
DOMAIN=pitchnavi.8-231-192-187.sslip.io
SITE_URL=https://pitchnavi.8-231-192-187.sslip.io
ADMIN_EMAIL=tenpoohlove@gmail.com
FEATURE_VOICE_CLONE=true
EOF

echo "[3/3] build & up"
sudo docker compose --env-file .env.deploy up -d --build

echo "=== REDEPLOY DONE ==="
sudo docker compose ps
