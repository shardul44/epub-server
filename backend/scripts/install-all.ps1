# Install all dependencies for full Kitaboo stack (Node + Python + optional system tools)
# Run from repo root or backend: .\backend\scripts\install-all.ps1  or  .\scripts\install-all.ps1

$ErrorActionPreference = "Stop"
$Backend = $PSScriptRoot + "\.."
if (-not (Test-Path $Backend)) { $Backend = ".\backend" }
if (-not (Test-Path $Backend)) { $Backend = "." }
Set-Location $Backend

Write-Host "=== 1. npm install ===" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "npm install failed." -ForegroundColor Red; exit 1 }

Write-Host "`n=== 2. Python venv ===" -ForegroundColor Cyan
$venvPath = Join-Path $Backend "venv"
if (-not (Test-Path $venvPath)) {
    python -m venv venv
    if ($LASTEXITCODE -ne 0) { Write-Host "Create venv failed. Install Python 3.10-3.12." -ForegroundColor Red; exit 1 }
    Write-Host "Created venv." -ForegroundColor Green
} else {
    Write-Host "venv already exists." -ForegroundColor Green
}

$py = Join-Path $venvPath "Scripts\python.exe"
$pip = Join-Path $venvPath "Scripts\pip.exe"
if (-not (Test-Path $py)) { $py = Join-Path $venvPath "bin\python"; $pip = Join-Path $venvPath "bin\pip" }

Write-Host "`n=== 3. pip install (all Python deps) ===" -ForegroundColor Cyan
& $pip install -r requirements-all.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Trying lighter set (numpy, faster-whisper, torch, torchaudio)..." -ForegroundColor Yellow
    & $pip install numpy "faster-whisper" torch torchaudio
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "pip install had errors. Run manually with venv active:" -ForegroundColor Yellow
    Write-Host "  .\venv\Scripts\Activate.ps1" -ForegroundColor Gray
    Write-Host "  pip install -r requirements-all.txt" -ForegroundColor Gray
} else {
    Write-Host "Python packages installed." -ForegroundColor Green
}

Write-Host "`n=== 4. System tools (optional) ===" -ForegroundColor Cyan
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ff) {
    Write-Host "FFmpeg not found. Install: winget install Gyan.FFmpeg" -ForegroundColor Yellow
} else {
    Write-Host "FFmpeg OK." -ForegroundColor Green
}
Write-Host "eSpeak NG (for Aeneas/G2P): download from https://github.com/espeak-ng/espeak-ng/releases" -ForegroundColor Gray
Write-Host "MFA models (if USE_MFA=1): https://mfa-models.readthedocs.io/" -ForegroundColor Gray

Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Activate venv: .\venv\Scripts\Activate.ps1" -ForegroundColor Gray
Write-Host "Then start backend: npm run dev" -ForegroundColor Gray
