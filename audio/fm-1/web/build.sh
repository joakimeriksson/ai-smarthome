#!/usr/bin/env bash
# Build the browser version into web/dist: the wasm module, the page, and the firmware images.
#   tools/fetch_firmwares.py && web/build.sh && (cd web/dist && python3 -m http.server 8642)
#   -> http://localhost:8642  (?fw=x0x picks a firmware, ?mhz=120 the clock)
# Uses rustup's stable toolchain for the wasm32 target (Homebrew's rustc has no wasm32 std);
# its rust-lld finds libLLVM through DYLD_FALLBACK_LIBRARY_PATH.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${RUSTUP_TC:-$HOME/.rustup/toolchains/stable-aarch64-apple-darwin}"
cd "$ROOT"
DYLD_FALLBACK_LIBRARY_PATH="$TC/lib" RUSTC="$TC/bin/rustc" "$TC/bin/cargo" build --release -p fm1-web \
  --target wasm32-unknown-unknown --target-dir target/wasm
mkdir -p web/dist/fw
cp target/wasm/wasm32-unknown-unknown/release/fm1_web.wasm web/dist/
cp web/index.html web/main.js web/worklet.js web/dist/
rm -f web/dist/felucca.bin
# the firmware images in web/firmwares.json (from tools/fetch_firmwares.py), plus the page's
# copy of the catalog with each image's path; missing images are left out with a warning
python3 - <<'EOF'
import json, pathlib, shutil
root = pathlib.Path(".")
cat = json.loads((root / "web/firmwares.json").read_text())
keep = []
for fw in cat["firmwares"]:
    stem = fw["package"].rsplit("/", 1)[1].removesuffix(".fwsc")
    src = root / "reference/firmwares" / f"{stem}.xip.bin"
    if not src.exists():
        print(f"warning: no {src} (run tools/fetch_firmwares.py {fw['id']}); left out")
        continue
    shutil.copyfile(src, root / "web/dist/fw" / f"{stem}.bin")
    keep.append({**fw, "file": f"fw/{stem}.bin"})
cat["firmwares"] = keep
(root / "web/dist/firmwares.json").write_text(json.dumps(cat, indent=1))
print(f"{len(keep)} firmwares -> web/dist/fw")
EOF
ls -la web/dist | grep -v "^total"
