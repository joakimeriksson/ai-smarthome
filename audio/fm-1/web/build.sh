#!/usr/bin/env bash
# Build the browser version into web/dist (or $1): the wasm module and the page. The page
# fetches the firmwares from their authors' sites at run time (web/firmwares.json, web/fwsc.js),
# so nothing else is bundled.
#   web/build.sh && (cd web/dist && python3 -m http.server 8642)
#   -> http://localhost:8642  (?fw=x0x picks a firmware, ?mhz=120 the clock)
# On macOS it uses rustup's stable toolchain for the wasm32 target (Homebrew's rustc has no
# wasm32 std; its rust-lld finds libLLVM through DYLD_FALLBACK_LIBRARY_PATH); elsewhere plain
# cargo with the wasm32-unknown-unknown target installed (rustup target add ...).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/web/dist}"
cd "$ROOT"
# one codegen unit and a higher inline threshold: 3-4% faster in node (esp32sim measured the
# same threshold; 8000 was slower there)
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
export RUSTFLAGS="${RUSTFLAGS:-} -Cllvm-args=-inline-threshold=2000"
# the function table exported and growable: the JIT installs compiled blocks in it (web/jit.js)
RUSTFLAGS="$RUSTFLAGS -Clink-arg=--export-table -Clink-arg=--growable-table"
TC="${RUSTUP_TC:-$HOME/.rustup/toolchains/stable-aarch64-apple-darwin}"
if [ -d "$TC" ]; then
  DYLD_FALLBACK_LIBRARY_PATH="$TC/lib" RUSTC="$TC/bin/rustc" "$TC/bin/cargo" build --release -p fm1-web \
    --target wasm32-unknown-unknown --target-dir target/wasm
else
  cargo build --release -p fm1-web --target wasm32-unknown-unknown --target-dir target/wasm
fi
rm -rf "$OUT"
mkdir -p "$OUT"
cp target/wasm/wasm32-unknown-unknown/release/fm1_web.wasm "$OUT/"
cp web/index.html web/main.js web/worklet.js web/jit.js web/fwsc.js web/firmwares.json "$OUT/"
ls -la "$OUT" | grep -v "^total"
