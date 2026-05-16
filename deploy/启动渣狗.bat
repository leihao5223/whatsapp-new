@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=(Get-Location).Path; Get-ChildItem -LiteralPath $r -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue }"
if not exist "ZhaGouData.exe" (
  echo [FAIL] 未找到 ZhaGouData.exe，请整包解压后再双击本文件。
  pause
  exit /b 1
)
start "" "%~dp0ZhaGouData.exe"
