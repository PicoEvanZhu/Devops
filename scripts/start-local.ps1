param()
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Output "Starting backend..."
Push-Location (Join-Path $root "backend")

python -m venv .venv

# 在 PowerShell 中激活虚拟环境
$activate = Join-Path (Join-Path $PWD ".venv") "Scripts\Activate.ps1"
if (Test-Path $activate) {
    & $activate
} else {
    Write-Warning "无法找到 Activate.ps1，确保 Python 创建了虚拟环境"
}

pip install -r requirements.txt

if (-not $env:FLASK_SECRET_KEY) { $env:FLASK_SECRET_KEY = "replace-me" }
if (-not $env:PORT) { $env:PORT = "5001" }

# 后端以新进程启动
Start-Process -NoNewWindow -FilePath python -ArgumentList "app.py" -WorkingDirectory (Join-Path $root "backend")
Write-Output "Backend started on port $env:PORT"

Write-Output "Starting frontend..."
Push-Location (Join-Path $root "frontend")
npm install
if (-not $env:VITE_API_BASE_URL) { $env:VITE_API_BASE_URL = "http://localhost:5001" }
# 前端以新进程启动
Start-Process -NoNewWindow -FilePath npm -ArgumentList "run","dev"
Write-Output "Frontend started on :5173"
Pop-Location
Pop-Location
