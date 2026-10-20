#!/usr/bin/env bash
cd "$(dirname "$0")/.."; set -a; . data/n8n.env; set +a; export N8N_USER_FOLDER="$PWD/data/n8n"
node server/server.js & n8n-runtime/node_modules/.bin/n8n start
