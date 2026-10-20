@echo off
REM One-time setup of n8n next to McVaugh Operations World (same machine, local only).
REM Installs n8n into .\n8n-runtime (not globally), creates data\n8n.env with a shared secret, and the QB export folder.
setlocal
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js 22+ is required: https://nodejs.org & exit /b 1)
if not exist n8n-runtime mkdir n8n-runtime
cd n8n-runtime
if not exist package.json call npm init -y >nul
for /f "tokens=1 delims=v." %%v in ('node -v') do set NODEMAJOR=%%v
set N8NSPEC=n8n@1
if %NODEMAJOR% GEQ 24 set N8NSPEC=n8n@latest
echo Node %NODEMAJOR% detected - installing %N8NSPEC% (n8n 2.x needs Node 24+; this downloads a few hundred MB, 5-10 minutes)...
call npm install %N8NSPEC% || (echo npm install failed & exit /b 1)
cd ..
if not exist data mkdir data
if not exist data\n8n.env (
  for /f %%s in ('node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"') do set SECRET=%%s
  (
    echo MOW_N8N_SECRET=%SECRET%
    echo MOW_URL=http://localhost:8787
    echo N8N_PORT=5678
    echo N8N_LISTEN_ADDRESS=127.0.0.1
    echo N8N_SECURE_COOKIE=false
    echo N8N_BLOCK_ENV_ACCESS_IN_NODE=false
    echo N8N_DIAGNOSTICS_ENABLED=false
    echo N8N_RUNNERS_ENABLED=true
    echo MOW_QB_EXPORT_DIR=C:\McVaugh\qb-exports
  ) > data\n8n.env
  echo Created data\n8n.env with a new shared secret.
)
if not exist C:\McVaugh\qb-exports mkdir C:\McVaugh\qb-exports
echo.
echo Done. Next: run scripts\start-all.cmd, open http://localhost:5678, create the owner account,
echo then import n8n\mow-heartbeat.json and n8n\mow-qb-export-watch.json (Workflows - Import from file) and switch them Active.
