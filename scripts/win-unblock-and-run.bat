@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [ZhaGouData] 正在解除 Windows 对文件锁定...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Get-Location).Path; Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { Unblock-File -LiteralPath $_.FullName -ErrorAction SilentlyContinue; Remove-Item -LiteralPath ($_.FullName + ':Zone.Identifier') -ErrorAction SilentlyContinue }"
if exist "ZhaGouData.exe" (
  echo [ZhaGouData] 正在启动...
  start "" "%~dp0ZhaGouData.exe"
) else (
  echo 未找到 ZhaGouData.exe，请确认本 bat 与 exe 在同一文件夹。
  pause
)
echo.
echo 如果仍出现“Windows 已保护你的电脑”：
echo 1) 点击“更多信息”
echo 2) 点击“仍要运行”
