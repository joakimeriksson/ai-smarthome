#!/bin/sh
# The browser emulator (audio/fm-1/web) with the SID player firmware built in:
#   tools/webplayer.sh [FM1_DIR]   -> build/webemu  (cd build/webemu && python3 -m http.server 8642)
# FM1_DIR (default ../fm-1) must have the decoder fixes of PR #31 (flags, carry, 64-bit MAC);
# without them reSID's soft-double setup goes wrong and the player is almost silent.
# tools/webplayer.patch adds a "raw image" firmware entry (main.js) and boots it with fm1_boot
# at XIP 0x02000120 (worklet.js); the image goes next to the page as base64 JSON.
# build/webemu/artifact.html is index.html without its document skeleton, for publishing.
set -eu
cd "$(dirname "$0")/.."
FM1="$(cd "${1:-../fm-1}" && pwd)"
O="$PWD/build/webemu"
[ -f build/fw/sidplayer_xip.bin ] || firmware/build.sh
"$FM1/web/build.sh" "$O"
patch -s -d "$O" -p1 < tools/webplayer.patch
python3 - "$O" <<'PY'
import base64, json, re, sys
o = sys.argv[1]
img = open("build/fw/sidplayer_xip.bin", "rb").read()
json.dump({"image": "sidplayer_xip.bin", "base64": base64.b64encode(img).decode()}, open(f"{o}/sidplayer.json", "w"))
page = open(f"{o}/index.html").read()
body = re.sub(r"(?s)^.*?<title>.*?</title>", "<title>FM-1 SID Player</title>", page)
body = re.sub(r"(?mi)^[ \t]*(</?(html|head|body)\b[^>]*>|<meta [^>]*>|<!doctype html>)[ \t]*\n", "", body)
open(f"{o}/artifact.html", "w").write(body)
print(f"{o}: sidplayer.json ({len(img)} bytes), artifact.html")
PY
