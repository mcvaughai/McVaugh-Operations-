@echo off
REM Starts McVaugh Operations World (port 8787) and n8n (port 5678) in two windows, sharing data\n8n.env.
cd /d "%~dp0.."
if not exist data\n8n.env (echo Run scripts\setup-n8n.cmd first. & exit /b 1)
for /f "usebackq tokens=1,* delims==" %%a in ("data\n8n.env") do set "%%a=%%b"
set N8N_USER_FOLDER=%cd%\data\n8n
start "McVaugh Operations World" cmd /k node server\server.js
start "n8n" cmd /k n8n-runtime\node_modules\.bin\n8n.cmd start
echo World: http://localhost:8787   n8n: http://localhost:5678
