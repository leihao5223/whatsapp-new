$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

if (-not (Test-Path "release")) {
  Write-Error "release 目录不存在，请先执行 npm run build:desktop"
}

$exes = Get-ChildItem "release" -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "portable|ZhaGou" }
if (-not $exes) {
  $exes = Get-ChildItem "release" -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue
}

if (-not $exes) {
  Write-Error "release 下未找到 exe，请检查 electron-builder 是否成功"
}

Write-Host "找到的构建产物："
$exes | ForEach-Object { Write-Host (" - " + $_.FullName + " (" + [math]::Round($_.Length/1MB, 2) + " MB)") }

$bundle = Join-Path (Get-Location) "desktop-bundle"
if (-not (Test-Path (Join-Path $bundle "node.exe"))) {
  Write-Warning "desktop-bundle\\node.exe 不存在（若已清理 desktop-bundle 属正常，仅检查 release 即可）"
}

Write-Host "verify:desktop-build OK"
