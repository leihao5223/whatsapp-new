$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

function Stop-ZhaGouDataQuiet {
  Stop-Process -Name "ZhaGouData" -ErrorAction SilentlyContinue
  # Route through cmd so taskkill's "not found" message does not surface as a terminating NativeCommandError.
  $null = cmd.exe /c "taskkill /F /IM ZhaGouData.exe /T >nul 2>&1"
}

# Skip code-sign tool download (avoids symlink errors). Use CSC_LINK when you have a cert.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host "==> vite build"
npm run build

$bundle = Join-Path (Get-Location) "desktop-bundle"
if (Test-Path $bundle) {
  Remove-Item $bundle -Recurse -Force
}
New-Item -ItemType Directory -Path (Join-Path $bundle "scripts") | Out-Null

Copy-Item "scripts\local-qq-runner.mjs" (Join-Path $bundle "scripts\") -Force
Copy-Item "scripts\landing-handlers.mjs" (Join-Path $bundle "scripts\") -Force
Copy-Item "scripts\avsov-batch-runner.mjs" (Join-Path $bundle "scripts\") -Force
Copy-Item "scripts\avsov-search-core.mjs" (Join-Path $bundle "scripts\") -Force
Copy-Item "scripts\engine" (Join-Path $bundle "scripts\engine") -Recurse -Force

$cacheDir = Join-Path $bundle ".cache"
New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
if (Test-Path "deploy\auth-users.json") {
  Copy-Item "deploy\auth-users.json" (Join-Path $cacheDir "auth-users.json") -Force
  Write-Host "    Bundled sub-account -> desktop-bundle/.cache/auth-users.json"
}
if (Test-Path ".env") {
  Copy-Item ".env" (Join-Path $bundle ".env") -Force
  Write-Host "    Copied .env -> desktop-bundle/.env"
} elseif (Test-Path "deploy\runner.env") {
  Copy-Item "deploy\runner.env" (Join-Path $bundle ".env") -Force
  Write-Host "    Copied deploy/runner.env -> desktop-bundle/.env"
}

$pkg = @'
{
  "name": "zhagou-runner-bundle",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright": "^1.59.1"
  }
}
'@
Set-Content -Path (Join-Path $bundle "package.json") -Value $pkg -Encoding UTF8

Write-Host "==> npm install (runner bundle)"
Push-Location $bundle
npm install --omit=dev
Pop-Location

$nodeVer = "v20.18.1"
$zipName = "node-$nodeVer-win-x64.zip"
$zipUrl = "https://nodejs.org/dist/$nodeVer/$zipName"
$nodeExe = Join-Path $bundle "node.exe"

if (-not (Test-Path $nodeExe)) {
  Write-Host "==> download Node $nodeVer"
  $ProgressPreference = "SilentlyContinue"
  # Avoid partial/HTML responses from older TLS defaults.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $tempZip = Join-Path $env:TEMP ("nodejs-portable-" + [Guid]::NewGuid().ToString() + ".zip")
  $extract = Join-Path $env:TEMP ("nodejs-expand-" + [Guid]::NewGuid().ToString())
  $minZipBytes = 15MB
  try {
    $ok = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      if (Test-Path $tempZip) { Remove-Item $tempZip -Force -ErrorAction SilentlyContinue }
      Invoke-WebRequest -Uri $zipUrl -OutFile $tempZip -UseBasicParsing
      $len = (Get-Item -LiteralPath $tempZip).Length
      if ($len -lt $minZipBytes) {
        Write-Host "WARN: download too small ($len bytes), retry $attempt/3"
        Start-Sleep -Seconds 2
        continue
      }
      if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
      New-Item -ItemType Directory -Path $extract -Force | Out-Null
      try {
        [System.IO.Compression.ZipFile]::ExtractToDirectory($tempZip, $extract)
      } catch {
        Write-Host "WARN: Zip extract failed: $($_.Exception.Message); retry $attempt/3"
        Start-Sleep -Seconds 2
        continue
      }
      $inner = Join-Path $extract "node-$nodeVer-win-x64"
      $candidate = Join-Path $inner "node.exe"
      if (-not (Test-Path -LiteralPath $candidate)) {
        throw "node.exe missing after extract: $candidate"
      }
      Copy-Item -LiteralPath $candidate -Destination $nodeExe -Force
      $ok = $true
      break
    }
    if (-not $ok) {
      throw "Node zip download/extract failed after 3 tries. URL: $zipUrl"
    }
  } finally {
    Remove-Item $tempZip -Force -ErrorAction SilentlyContinue
    Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# 可选：打包时预装 Chromium 进 pw-browsers（体积增大 ~150MB+，对方离线可直接用）。跳过：$env:SKIP_PLAYWRIGHT_BUNDLE='1'
if (-not $env:SKIP_PLAYWRIGHT_BUNDLE) {
  Write-Host "==> playwright install chromium -> desktop-bundle/pw-browsers (可选预装，下载较大)"
  $pwPath = Join-Path $bundle "pw-browsers"
  New-Item -ItemType Directory -Path $pwPath -Force | Out-Null
  $env:PLAYWRIGHT_BROWSERS_PATH = $pwPath
  $cli = Join-Path $bundle "node_modules\playwright\cli.js"
  if (-not (Test-Path $cli)) {
    Write-Host "WARN: playwright cli missing, skip browser bundle"
  } else {
    & $nodeExe $cli install chromium
    if ($LASTEXITCODE -eq 0) {
      Set-Content -LiteralPath (Join-Path $pwPath ".chromium-ready") -Value (Get-Date).ToString("o") -Encoding utf8
      Write-Host "    Chromium bundled under pw-browsers"
    } else {
      Write-Host "WARN: playwright install exited $LASTEXITCODE; EXE 首次启动仍会尝试自动安装"
    }
  }
} else {
  Write-Host "==> SKIP_PLAYWRIGHT_BUNDLE set — 浏览器内核留给客户端首次启动下载"
}

$releaseRoot = Join-Path (Get-Location) "release"
$unpackedOut = Join-Path $releaseRoot "win-unpacked"
$useAlternateOut = $false
$alternateReleaseSubdir = $null

if (Test-Path $unpackedOut) {
  Write-Host "==> stash old release\win-unpacked (close ZhaGouData.exe first)"
  Stop-ZhaGouDataQuiet
  Start-Sleep -Seconds 3
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $bakName = "win-unpacked.bak-$stamp"
  $resolved = $false
  foreach ($i in 1..2) {
    try {
      Rename-Item -LiteralPath $unpackedOut -NewName $bakName -ErrorAction Stop
      Write-Host ('    Old build renamed to: release\' + $bakName)
      $resolved = $true
      break
    } catch {
      if ($i -lt 2) {
        Write-Host "WARN: rename blocked, retry after 3s ($i/2)..."
        Stop-ZhaGouDataQuiet
        Start-Sleep -Seconds 3
      }
    }
  }
  if (-not $resolved) {
    Write-Host "WARN: Could not rename old win-unpacked; trying full delete..."
    try {
      Remove-Item -LiteralPath $unpackedOut -Recurse -Force -ErrorAction Stop
      Write-Host "    Removed previous release\win-unpacked"
      $resolved = $true
    } catch {
      Write-Host "WARN: Delete blocked (file lock). Building into a fresh folder outside release\ (avoids tooling locks on release\)."
      # Keep output outside release\ so electron-builder does not treat it like a prior half-built tree under the same root.
      $alternateReleaseSubdir = "electron-out-$stamp"
      $useAlternateOut = $true
    }
  }
}

Write-Host "==> electron-builder (dir / win-unpacked)"
if ($useAlternateOut) {
  $outRel = $alternateReleaseSubdir.Replace("\", "/")
  Write-Host "    (electron-builder output dir: $outRel)"
  npx --yes electron-builder --win dir --x64 ("-c.directories.output=" + $outRel)
} else {
  npx --yes electron-builder --win dir --x64
}
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if ($useAlternateOut) {
  $unpackedFinal = Join-Path (Get-Location) (Join-Path $alternateReleaseSubdir "win-unpacked")
} else {
  $unpackedFinal = Join-Path (Get-Location) "release\win-unpacked"
}
$zipOut = Join-Path (Get-Location) "release\ZhaGouData-win-x64.zip"
$zipMade = $false
if (Test-Path $unpackedFinal) {
  if (Test-Path $zipOut) {
    Remove-Item $zipOut -Force -ErrorAction SilentlyContinue
  }
  Write-Host "==> zip distributable"
  try {
    Compress-Archive -LiteralPath $unpackedFinal -DestinationPath $zipOut -Force -ErrorAction Stop
    $zipMade = $true
  } catch {
    Write-Host "WARN: In-place zip failed (file lock on app.asar is common if the IDE indexes the folder)."
  }
  if (-not $zipMade) {
    $stage = Join-Path $env:TEMP ("zhagou-zip-" + [Guid]::NewGuid().ToString())
    try {
      New-Item -ItemType Directory -Path $stage | Out-Null
      $null = & robocopy.exe $unpackedFinal $stage /E /R:2 /W:2 /NFL /NDL /NJH /NJS
      if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed (exit $LASTEXITCODE)"
      }
      Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipOut -Force -ErrorAction Stop
      $zipMade = $true
      Write-Host "    Created zip via TEMP staging copy."
    } catch {
      Write-Host "WARN: Zip skipped. Pack the folder manually or close programs locking app.asar, then zip:"
      Write-Host "  $unpackedFinal"
    } finally {
      if ($null -ne $stage -and (Test-Path -LiteralPath $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

$exePath = Join-Path $unpackedFinal "ZhaGouData.exe"
Write-Host "Done. Run: $exePath"
if ($zipMade) {
  Write-Host "Or share: release\ZhaGouData-win-x64.zip"
} else {
  Write-Host "Zip was not created; share the whole win-unpacked folder above."
}
if ($useAlternateOut) {
  Write-Host "NOTE: release\win-unpacked was locked by another program; delete it manually when safe."
  Write-Host "NOTE: This build output is under the project root folder shown above, not release\win-unpacked."
}
