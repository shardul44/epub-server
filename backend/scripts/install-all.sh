#!/usr/bin/env bash
# Install all dependencies for full Kitaboo stack (Node + Python + optional system tools)
# Run from repo root or backend: ./backend/scripts/install-all.sh  or  ./scripts/install-all.sh

set -e
BACKEND="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND"

echo "=== 1. npm install ==="
npm install

echo ""
echo "=== 2. Python venv ==="
if [ ! -d venv ]; then
  python3 -m venv venv || python -m venv venv
  echo "Created venv."
else
  echo "venv already exists."
fi

# Activate venv (bash/zsh)
VENV_PY="$BACKEND/venv/bin/python"
VENV_PIP="$BACKEND/venv/bin/pip"
[ -f "$VENV_PY" ] || { VENV_PY="$BACKEND/venv/Scripts/python"; VENV_PIP="$BACKEND/venv/Scripts/pip"; }

echo ""
echo "=== 3. pip install (all Python deps) ==="
"$VENV_PIP" install -r requirements-all.txt || {
  echo "Trying lighter set (numpy, faster-whisper, torch, torchaudio)..."
  "$VENV_PIP" install numpy faster-whisper torch torchaudio
}
echo "Python packages installed."

echo ""
echo "=== 4. System tools (optional) ==="
if command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg OK."
else
  echo "FFmpeg not found. Install: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)"
fi
echo "eSpeak NG (for Aeneas/G2P): install via package manager or https://github.com/espeak-ng/espeak-ng/releases"
echo "MFA models (if USE_MFA=1): https://mfa-models.readthedocs.io/"

echo ""
echo "=== Done ==="
echo "Activate venv: source venv/bin/activate"
echo "Then start backend: npm run dev"
