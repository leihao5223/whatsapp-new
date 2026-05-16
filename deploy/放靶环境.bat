@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "BUNDLE=%~dp0resources\desktop-bundle"
if not exist "%~dp0runner.env" (
  echo [FAIL] 缺少 runner.env
  pause
  exit /b 1
)
if not exist "%BUNDLE%" (
  echo [FAIL] 缺少 resources\desktop-bundle
  pause
  exit /b 1
)
copy /Y "%~dp0runner.env" "%BUNDLE%\.env" >nul
echo [OK] 查号环境已写入
pause
