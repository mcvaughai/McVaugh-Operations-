#!/usr/bin/env bash
# Mac/Linux twin of setup-n8n.cmd
set -e; cd "$(dirname "$0")/.."
mkdir -p n8n-runtime data; (cd n8n-runtime && [ -f package.json ] || npm init -y >/dev/null; if [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; then npm install n8n@latest; else npm install n8n@1; fi)
if [ ! -f data/n8n.env ]; then
  S=$(node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))")
  printf 'MOW_N8N_SECRET=%s\nMOW_URL=http://localhost:8787\nN8N_PORT=5678\nN8N_LISTEN_ADDRESS=127.0.0.1\nN8N_SECURE_COOKIE=false\nN8N_BLOCK_ENV_ACCESS_IN_NODE=false\nN8N_DIAGNOSTICS_ENABLED=false\nN8N_RUNNERS_ENABLED=true\nMOW_QB_EXPORT_DIR=%s/data/qb-exports\n' "$S" "$PWD" > data/n8n.env
fi
mkdir -p data/qb-exports; echo "Done. Start with: scripts/start-all.sh"
