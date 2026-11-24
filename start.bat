@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
where tsc.cmd >nul 2>nul || (echo TypeScript compiler tsc.cmd required & exit /b 1)
call tsc.cmd -p tsconfig.json || exit /b 1
python server.py
