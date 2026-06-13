#!/usr/bin/env bash
# GCP Compute Engine VM(Debian/Ubuntu)上で最初に1回だけ実行するセットアップ。
# Docker と docker compose プラグインを入れ、アプリ配置先を用意する。
set -euo pipefail

echo "==> Docker をインストールします..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
else
  echo "    Docker は既に入っています。"
fi

echo "==> 現在のユーザーを docker グループに追加します（sudo無しでdockerを使うため）..."
sudo usermod -aG docker "$USER" || true

echo "==> アプリ配置ディレクトリ /opt/p3 を作成します..."
sudo mkdir -p /opt/p3
sudo chown "$USER":"$USER" /opt/p3

echo ""
echo "✅ セットアップ完了。次の手順:"
echo "  1) いったんログアウト→再ログイン（dockerグループ反映のため）"
echo "  2) アプリ一式を /opt/p3 に配置（git clone もしくは scp）"
echo "  3) cd /opt/p3 && cp .env.deploy.example .env.deploy && 値を編集"
echo "  4) docker compose --env-file .env.deploy up -d --build"
echo "  5) docker compose logs -f app  で起動ログを確認"
