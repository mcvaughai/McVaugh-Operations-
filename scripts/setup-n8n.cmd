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
  REM Written by node, not by batch: inside an if-block %VAR% expands before the for-loop runs and the secret would be blank.
  node -e "const fs=require('fs');const s=require('crypto').randomBytes(24).toString('base64url');fs.writeFileSync('data/n8n.env',['MOW_N8N_SECRET='+s,'MOW_URL=http://localhost:8787','N8N_PORT=5678','N8N_LISTEN_ADDRESS=127.0.0.1','N8N_SECURE_COOKIE=false','N8N_BLOCK_ENV_ACCESS_IN_NODE=false','N8N_DIAGNOSTICS_ENABLED=false','N8N_RUNNERS_ENABLED=true','MOW_QB_EXPORT_DIR=C:\\McVaugh\\qb-exports',''].join('\r\n'));console.log('Created data\\n8n.env with a new shared secret.')"
)
for /f "usebackq tokens=1,* delims==" %%a in ("data\n8n.env") do if "%%a"=="MOW_N8N_SECRET" if "%%b"=="" (
  echo data\n8n.env has a blank MOW_N8N_SECRET ^(older setup bug^). Delete data\n8n.env and run this script again.
  exit /b 1
)
if not exist C:\McVaugh\qb-exports mkdir C:\McVaugh\qb-exports
echo.
echo Done. Next: run scripts\start-all.cmd, open http://localhost:5678, create the owner account,
echo then import n8n\mow-heartbeat.json and n8n\mow-qb-export-watch.json (Workflows - Import from file) and switch them Active.
