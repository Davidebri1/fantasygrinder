#!/usr/bin/env pwsh
# Fantasy Grinder — one-command local dev launcher (Windows / pwsh).
#
# What it does, in order:
#   1. Install backend Python deps into .venv (one-time, ~30s).
#   2. Build the React frontend into frontend/react/dist (one-time, ~30s).
#   3. Run Django migrations against db.sqlite3 (one-time).
#   4. Seed sample slates (NBA / MMA / Golf) on first run.
#   5. Start Django on :8000 with the React build served at "/".
#
# Usage:
#   pwsh bin/dev.ps1           # full setup + start
#   pwsh bin/dev.ps1 --reset   # nuke .venv, dist, db.sqlite3, node_modules and start over
#
# Open http://localhost:8000 — that's the app.

param([switch]$Reset)

$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $ROOT

if ($Reset) {
    Write-Host "[dev] --reset: removing .venv, dist, db.sqlite3, node_modules"
    Remove-Item -Recurse -Force "$ROOT/backend/django/.venv" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$ROOT/backend/django/db.sqlite3" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$ROOT/frontend/react/dist" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$ROOT/frontend/react/node_modules" -ErrorAction SilentlyContinue
}

# ─── Backend venv + deps ─────────────────────────────────────────────────
$VENV = "$ROOT/backend/django/.venv"
if (-not (Test-Path $VENV)) {
    Write-Host "[dev] creating venv at $VENV"
    python -m venv $VENV
}
$VENV_PY = "$VENV/Scripts/python.exe"
& $VENV_PY -m pip install --quiet --upgrade pip
& $VENV_PY -m pip install --quiet -r "$ROOT/backend/django/requirements.txt"

# ─── Frontend build ──────────────────────────────────────────────────────
if (-not (Test-Path "$ROOT/frontend/react/node_modules")) {
    Write-Host "[dev] installing frontend deps (one-time, ~60s)"
    Push-Location "$ROOT/frontend/react"
    npm install --silent
    Pop-Location
}
if (-not (Test-Path "$ROOT/frontend/react/dist/index.html")) {
    Write-Host "[dev] building frontend (one-time, ~10s)"
    Push-Location "$ROOT/frontend/react"
    npm run build 2>&1 | Out-Null
    Pop-Location
}

# ─── DB migrate + seed ───────────────────────────────────────────────────
Push-Location "$ROOT/backend/django"
$env:DJANGO_SETTINGS_MODULE = "config.settings_dev"
$env:PYTHONPATH = "."
if (-not (Test-Path "db.sqlite3") -or $Reset) {
    & $VENV_PY manage.py makemigrations common nba mma golf --noinput
    & $VENV_PY manage.py migrate --noinput
    & $VENV_PY manage.py load_sample_data
}
Pop-Location

# ─── Run ─────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================================"
Write-Host "  Fantasy Grinder is starting..."
Write-Host "    Open: http://localhost:8000/"
Write-Host "  Press Ctrl+C to stop."
Write-Host "================================================================"
Write-Host ""

Push-Location "$ROOT/backend/django"
$env:DJANGO_SETTINGS_MODULE = "config.settings_dev"
$env:PYTHONPATH = "."
& $VENV_PY manage.py runserver 0.0.0.0:8000 --noreload
