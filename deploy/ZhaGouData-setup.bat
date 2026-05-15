@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "ROOT=%~dp0"
set "BUNDLE=%ROOT%resources\desktop-bundle"
set "CACHE=%BUNDLE%\.cache"
set "AUTH_DST=%CACHE%\auth-users.json"
if not exist "%BUNDLE%\node.exe" (
  echo [FAIL] 缺少 resources\desktop-bundle\node.exe
  echo 请把本 bat 和 auth-users.json 放在 ZhaGouData.exe 同一文件夹后再运行。
  pause
  exit /b 1
)
if not exist "%CACHE%" mkdir "%CACHE%"
if not exist "%ROOT%auth-users.json" (
  echo [FAIL] 缺少 auth-users.json，请与 bat 放在同一目录。
  pause
  exit /b 1
)
copy /Y "%ROOT%auth-users.json" "%AUTH_DST%" >nul
if errorlevel 1 (
  echo [FAIL] 无法写入 %AUTH_DST%
  pause
  exit /b 1
)
echo [OK] 子账号配置已写入

if exist "%ROOT%runner.env" (
  copy /Y "%ROOT%runner.env" "%BUNDLE%\.env" >nul
  echo [OK] 查号环境已配置
) else (
  echo [WARN] 缺少 runner.env，立即执行会失败
)

set "PW=%BUNDLE%\pw-browsers"
set "MARKER=%PW%\.chromium-ready"
if exist "%MARKER%" (
  echo [OK] 浏览器内核已就绪
  goto :done
)
echo [RUN] 正在安装浏览器内核，请保持联网...
set "PLAYWRIGHT_BROWSERS_PATH=%PW%"
if not exist "%PW%" mkdir "%PW%"
"%BUNDLE%\node.exe" "%BUNDLE%\node_modules\playwright\cli.js" install chromium
if errorlevel 1 (
  echo [FAIL] 浏览器内核安装失败，请检查网络后重新运行本 bat
  pause
  exit /b 1
)
echo. > "%MARKER%"
echo [OK] 浏览器内核安装完成

:done
if not exist "%ROOT%ZhaGouData.exe" (
  echo [WARN] 当前目录未找到 ZhaGouData.exe
) else (
  echo [OK] 已找到 ZhaGouData.exe
)
echo.
echo ========== 检测结果 ==========
echo 账号: c522377
echo 密码: Qq1314520.
echo.
echo 若上面均为 [OK]，请双击 ZhaGouData.exe 登录。
echo 若出现 [FAIL]，把本窗口文字截图发给管理员。
echo ==============================
pause
