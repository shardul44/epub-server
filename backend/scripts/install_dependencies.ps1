# PowerShell script to install Python dependencies for PDF processing
# Run this script to set up the Python environment

$ErrorActionPreference = "Stop"

Write-Host "=== PDF Processing Dependencies Installer ===" -ForegroundColor Cyan
Write-Host ""

# Check if Python is available
try {
    $pythonPath = ".\venv\Scripts\python.exe"
    if (-not (Test-Path $pythonPath)) {
        Write-Host "ERROR: Virtual environment not found at .\venv" -ForegroundColor Red
        Write-Host "Please create a virtual environment first:" -ForegroundColor Yellow
        Write-Host "  python -m venv venv" -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "Found Python: $pythonPath" -ForegroundColor Green
    
    # Check current dependencies
    Write-Host ""
    Write-Host "Checking current dependencies..." -ForegroundColor Cyan
    & $pythonPath ".\scripts\check_dependencies.py"
    $checkResult = $LASTEXITCODE
    
    if ($checkResult -eq 0) {
        Write-Host ""
        Write-Host "All dependencies are already installed!" -ForegroundColor Green
        exit 0
    }
    
    # Install dependencies
    Write-Host ""
    Write-Host "Installing missing dependencies..." -ForegroundColor Cyan
    & $pythonPath -m pip install --upgrade pip
    & $pythonPath -m pip install -r requirements.txt
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
        exit 1
    }
    
    # Verify installation
    Write-Host ""
    Write-Host "Verifying installation..." -ForegroundColor Cyan
    & $pythonPath ".\scripts\check_dependencies.py"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "SUCCESS: All dependencies installed successfully!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "WARNING: Some dependencies may not have installed correctly" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
