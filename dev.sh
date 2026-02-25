#!/usr/bin/env bash
# dev.sh — Quick development launcher for Chess Helper Overlay
# Bypasses electron-forge's interactive CLI to run stably in background

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

echo "🔧 Building main process..."
npx esbuild src/main/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:electron \
  --external:sharp \
  --external:'screenshot-desktop' \
  --external:'chess.js' \
  --external:'electron-store' \
  --format=cjs \
  --define:MAIN_WINDOW_VITE_DEV_SERVER_URL='"http://localhost:5173"' \
  --define:MAIN_WINDOW_VITE_NAME='"main_window"' \
  --outfile=.vite/build/index.js \
  --sourcemap

npx esbuild src/main/preload.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --external:electron \
  --format=cjs \
  --outfile=.vite/build/preload.js

echo "🌐 Starting Vite renderer dev server..."
npx vite --config vite.renderer.config.ts --port 5173 --logLevel silent &
VITE_PID=$!
sleep 2

echo "🚀 Launching Chess Helper Overlay..."
./node_modules/.bin/electron .vite/build/index.js

# Clean up vite server when electron exits
kill $VITE_PID 2>/dev/null || true
