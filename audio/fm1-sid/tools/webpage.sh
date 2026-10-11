#!/bin/sh
# The web page (web/) with the FM-1 emulator's wasm, for a local look:
#   tools/webpage.sh [FM1_DIR]   -> build/pages   (cd build/pages && python3 -m http.server 8642)
# FM1_DIR (default ../fm-1) must have PR #31's decoder fixes (flags, carry, 64-bit MAC, the
# ALU / post-increment forms): without them the firmware halts. GitHub Pages builds the same
# thing from scripts/build-pages.mjs.
set -eu
cd "$(dirname "$0")/.."
FM1="$(cd "${1:-../fm-1}" && pwd)"
[ -f web/sidplayer.bin ] || firmware/build.sh
"$FM1/web/build.sh" "$PWD/build/fm1-web" >/dev/null
rm -rf build/pages
mkdir -p build/pages
cp web/index.html web/sid.js web/pack.js web/worklet.js web/tunes.json web/house.sid web/sidplayer.bin build/pages/
cp build/fm1-web/fm1_web.wasm build/pages/
cp build/fm1-web/fm1_web.wasm web/fm1_web.wasm && node web/smoke.mjs web; rm -f web/fm1_web.wasm
echo "build/pages: (cd build/pages && python3 -m http.server 8642) -> http://localhost:8642"
