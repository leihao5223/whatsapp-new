@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM 与 electron-builder extraFiles 一致：bat 放在 ZhaGouData.exe 同目录时，内核包在 resources\desktop-bundle
set "BUNDLE=%~dp0resources\desktop-bundle"
if not exist "%BUNDLE%\node.exe" (
  echo [错误] 未找到 portable Node：%BUNDLE%\node.exe
  echo 请确认本 bat 与 ZhaGouData.exe 在同一文件夹（解压后的 win-unpacked 根目录）。
  pause
  exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%BUNDLE%\pw-browsers"
if not exist "%BUNDLE%\pw-browsers" mkdir "%BUNDLE%\pw-browsers"

echo [ZhaGouData] 正在安装 Playwright Chromium 到程序目录（首次约几分钟）...
"%BUNDLE%\node.exe" "%BUNDLE%\node_modules\playwright\cli.js" install chromium
if errorlevel 1 (
  echo.
  echo [失败] 请检查网络、防火墙或代理后重试。
  pause
  exit /b 1
)

echo. > "%BUNDLE%\pw-browsers\.chromium-ready"
echo [完成] 已写入就绪标记，请重新打开 ZhaGouData.exe。
pause
