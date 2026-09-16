@echo off
REM CareerPilot API — production-style single-worker launcher (P5.1)
REM ------------------------------------------------------------------
REM The in-process rate limiter is per-process: production MUST run exactly
REM ONE uvicorn worker. This launcher enforces that.
REM
REM Requirements:
REM   * backend\.env exists and is a valid production config
REM     (see backend\.env.production.example)
REM   * run from this repo; the launcher cds into backend\ where the .env lives
REM
REM The API listens ONLY on 127.0.0.1:8000 — the nginx proxy in deploy\nginx.conf
REM terminates TLS and forwards /api/* here. Never expose port 8000 publicly.
REM
REM On Linux/systemd, the equivalent is:  uvicorn app.main:app --host 127.0.0.1
REM     --port 8000 --workers 1  (see deploy\README.md for a unit example)

setlocal
cd /d "%~dp0..\backend"

REM Load production configuration from the local .env
if not exist ".env" (
  echo [ERROR] backend\.env not found. Copy backend\.env.production.example to .env and fill in the placeholders. 1>&2
  exit /b 1
)

py -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
exit /b %ERRORLEVEL%