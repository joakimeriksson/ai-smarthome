#!/usr/bin/env python3
"""Fetch the community firmwares listed in web/firmwares.json into reference/firmwares/:
<stem>.fwsc (the update package as published), <stem>.app.bin (its app, via
tools/fwsc_extract.mjs) and <stem>.xip.bin (the app behind 0x120 bytes of padding, the image
`fm1-live --bin` and the web build load at 0x02000120). Existing files are kept.
    tools/fetch_firmwares.py [id ...]
"""
import json, pathlib, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "reference" / "firmwares"
cat = json.loads((ROOT / "web" / "firmwares.json").read_text())
want = set(sys.argv[1:])
OUT.mkdir(parents=True, exist_ok=True)
for fw in cat["firmwares"]:
    if want and fw["id"] not in want:
        continue
    stem = fw["package"].rsplit("/", 1)[1].removesuffix(".fwsc")
    pkg, app, xip = OUT / f"{stem}.fwsc", OUT / f"{stem}.app.bin", OUT / f"{stem}.xip.bin"
    if not pkg.exists():
        req = urllib.request.Request(fw["package"], headers={"User-Agent": "fm1-emu"})
        data = urllib.request.urlopen(req, timeout=60).read()
        if len(data) < 100_000 or data[:20].lstrip().startswith(b"<"):
            print(f"{fw['id']}: {fw['package']} is not a package ({len(data)} bytes)")
            continue
        pkg.write_bytes(data)
    if not app.exists():
        subprocess.run(["node", str(ROOT / "tools" / "fwsc_extract.mjs"), str(pkg), str(app)], check=True)
    if not xip.exists():
        xip.write_bytes(bytes(0x120) + app.read_bytes())
    print(f"{fw['id']:14} {stem}.xip.bin  {xip.stat().st_size} bytes")
