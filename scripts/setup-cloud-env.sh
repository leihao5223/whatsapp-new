#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export npm_config_cache="${QE_NPM_CACHE_DIR:-$ROOT_DIR/.npm-cache}"

echo "Using Node $(node --version) and npm $(npm --version)"
echo "Installing dependencies with npm cache at $npm_config_cache"

npm ci --cache "$npm_config_cache" --prefer-offline

echo "Verifying QE frontend toolchain"
npm run lint
npm run build
