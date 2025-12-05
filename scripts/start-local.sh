#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting backend..."
cd "$ROOT/backend"
python3 -m venv .venv
# shellcheck source=/dev/null
source .venv/bin/activate
pip install -r requirements.txt
export FLASK_SECRET_KEY="${FLASK_SECRET_KEY:-replace-me}"
export PORT="${PORT:-5001}"
nohup python app.py > "$ROOT/backend/nohup.out" 2>&1 &

echo "Backend started (logs: $ROOT/backend/nohup.out) on port $PORT"

echo "Starting frontend..."
cd "$ROOT/frontend"
npm install
echo "VITE_API_BASE_URL=${VITE_API_BASE_URL:-http://localhost:5001}" > .env.local
npm run dev > "$ROOT/frontend/nohup_frontend.out" 2>&1 &

echo "Frontend started (logs: $ROOT/frontend/nohup_frontend.out) on :5173"
echo "Done."
