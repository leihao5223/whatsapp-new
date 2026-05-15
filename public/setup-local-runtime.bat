@echo off
chcp 65001 >nul
setlocal

echo ===========================================
echo QE 本机环境一键部署
echo ===========================================
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
  echo [错误] 未检测到 Python，请先安装 Python 3.11+ 后重试。
  pause
  exit /b 1
)

cd /d "%~dp0.."
echo [1/4] 切换到项目目录: %cd%

echo [2/4] 安装 Node 依赖...
call npm install
if %errorlevel% neq 0 (
  echo [错误] npm install 失败，请检查 Node.js 环境。
  pause
  exit /b 1
)

echo [2.5/4] 安装浏览器依赖 (Playwright Chromium)...
call npx playwright install chromium
if %errorlevel% neq 0 (
  echo [错误] Chromium 安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo [3/4] 安装 Python 依赖...
python -m pip install -r bridge/windows/requirements.txt
if %errorlevel% neq 0 (
  echo [错误] Python 依赖安装失败。
  pause
  exit /b 1
)

echo [3.5/4] 检查样本缓存目录权限...
if not exist ".cache" mkdir ".cache"
echo {"check":"ok"}> ".cache\_write_test.json"
if %errorlevel% neq 0 (
  echo [错误] 无法写入 .cache 目录，请以管理员权限运行或检查目录权限。
  pause
  exit /b 1
)
del /q ".cache\_write_test.json" >nul 2>nul

echo [3.8/4] 检查代理池配置...
if not exist ".env" (
  copy ".env.example" ".env" >nul
)
powershell -NoProfile -Command "if (-not (Select-String -Path '.env' -Pattern '^AVSOV_PROXY_POOL=' -Quiet)) { Add-Content -Path '.env' -Value 'AVSOV_PROXY_POOL=' }"
echo 已确保 .env 包含 AVSOV_PROXY_POOL 配置项（可留空，后续再填代理池）。

echo [4/4] 启动 Bridge + Runner ...
start "QE Bridge" cmd /k "cd /d %cd% && python bridge/windows/qq_bridge.py"
start "QE Runner" cmd /k "cd /d %cd% && set QQ_BRIDGE_URLS=http://127.0.0.1:9876/search && set QQ_RUNNER_WORKERS=qq-1 && set QQ_RUNNER_PORT=8790 && set AVSOV_BATCH_TOKEN=Qq1314520..0254131q && npm run runner:qq"
timeout /t 4 >nul

echo [自检] 检测服务健康状态...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9876/health > $null; Write-Host 'Bridge 健康检查: OK' } catch { Write-Host 'Bridge 健康检查: FAIL' }"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8790/health > $null; Write-Host 'Runner 健康检查: OK' } catch { Write-Host 'Runner 健康检查: FAIL' }"

echo.
echo 已启动本机服务:
echo - Bridge: http://127.0.0.1:9876/health
echo - Runner: http://127.0.0.1:8790/health
echo.
echo 下一步:
echo 1) 请在本机登录 QQ 并打开搜索框
echo 2) 返回网页“API配置”页，填入 Runtime 地址 http://127.0.0.1:8790
echo 3) 点击“检测是否部署完成”
echo 4) 若做 avsov 批量查询，请在 .env 中填写 AVSOV_PROXY_POOL（逗号分隔）
echo 5) 若搜索速度异常，请允许 QQ 与 Python 在前台访问窗口（防止截图/控件读取被系统拦截）
echo.
pause
exit /b 0
