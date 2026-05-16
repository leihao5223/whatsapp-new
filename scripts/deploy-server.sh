#!/usr/bin/env bash
set -euo pipefail
REMOTE="${DEPLOY_SSH:-ssh -p 27637 -o BatchMode=yes root@107.149.189.110}"
BRANCH="${DEPLOY_BRANCH:-cursor/qe-system-scaffold-de8c}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/whatsapp-new}"

git push -u origin "$BRANCH"

$REMOTE bash -s "$BRANCH" "$REMOTE_DIR" <<'REMOTE'
set -euo pipefail
BRANCH="$1"
DIR="$2"
cd "$DIR"
export PATH="/root/.nvm/versions/node/v20.20.2/bin:${PATH:-}"
git fetch origin
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
npm ci
npm run build
chmod -R a+rX dist
systemctl restart qe-runner
echo "Deployed $BRANCH on $(hostname)"
REMOTE
