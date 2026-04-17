@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  セールスアドバイザー 起動中...           ║
echo  ╚══════════════════════════════════════════╝
echo.

if not exist "node_modules" (
  echo  [初回セットアップ] パッケージをインストールしています...
  echo  （数分かかる場合があります）
  echo.
  npm install
  echo.
)

npm run dev
pause
