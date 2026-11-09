#!/usr/bin/env bash
# Builds the downloadable VisionHarness desktop installers.
#
#   ./scripts/build_desktop.sh              # backend sidecar + Tauri installers
#   SKIP_BACKEND=1 ./scripts/build_desktop.sh   # reuse the existing sidecar binary
#
# Outputs: web/src-tauri/target/release/bundle/{msi,nsis}/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
BIN_DIR="$ROOT/web/src-tauri/binaries"

mkdir -p "$ROOT/build/pyinstaller" "$BIN_DIR"

if [ "${SKIP_BACKEND:-0}" != "1" ]; then
  echo "==> Building Python backend sidecar ($TRIPLE)"
  pyinstaller --noconfirm --clean \
    --distpath "$ROOT/build/pyinstaller/dist" \
    --workpath "$ROOT/build/pyinstaller/work" \
    "$ROOT/packaging/visionharness-server.spec"

  cp "$ROOT/build/pyinstaller/dist/visionharness-server.exe" \
     "$BIN_DIR/visionharness-server-$TRIPLE.exe"
  echo "==> Sidecar: $BIN_DIR/visionharness-server-$TRIPLE.exe"
fi

if [ ! -f "$BIN_DIR/visionharness-server-$TRIPLE.exe" ]; then
  echo "error: missing sidecar $BIN_DIR/visionharness-server-$TRIPLE.exe" >&2
  echo "       run without SKIP_BACKEND=1 to build it" >&2
  exit 1
fi

echo "==> Building desktop app and installers"
cd "$ROOT/web"
npm run tauri build
