@echo off
chcp 65001 > nul
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║  セールスアドバイザー 起動中...           ║
echo  ╚══════════════════════════════════════════╝
echo.
cd /d "%~dp0"
npm run dev
pause
