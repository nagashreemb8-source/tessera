# Start the Tessera backend on Windows.
#
#   powershell -ExecutionPolicy Bypass -File .\run_dev.ps1
#
# Creates backend\.venv if it is missing, installs requirements.txt, and starts
# Uvicorn with hot reload on http://localhost:8000 (docs at /docs).
# If .env is missing it copies .env.example and stops, so you can fill in your
# own Nebius values without them ever being typed into a terminal or chat.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Creating virtual environment in backend\.venv ..." -ForegroundColor Cyan
    py -m venv .venv
}

$python = ".\.venv\Scripts\python.exe"

Write-Host "Installing requirements ..." -ForegroundColor Cyan
& $python -m pip install --upgrade pip --quiet
& $python -m pip install -r requirements.txt

if (-not (Test-Path ".\.env")) {
    Copy-Item ".\.env.example" ".\.env"
    Write-Host ""
    Write-Host "Created backend\.env from .env.example." -ForegroundColor Yellow
    Write-Host "Fill in NEBIUS_API_KEY, NEBIUS_BASE_URL and NEBIUS_MODEL, then run this script again."
    Write-Host "Verify the model id with:  $python scripts\list_models.py"
    exit 1
}

Write-Host "Starting Tessera backend on http://localhost:8000 (docs: /docs) ..." -ForegroundColor Green
& $python -m uvicorn app.main:app --reload --port 8000
