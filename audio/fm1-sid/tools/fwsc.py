#!/usr/bin/env python3
"""The SID player as an FM-1 update package (.fwsc), installable the way community firmwares
are and bootable by ../fm-1's emulator page:
    tools/fwsc.py [OUT.fwsc]       (default web/sidplayer.fwsc)
The app is build/fw/sidplayer.bin (firmware/build.sh: the firmware with an empty tune pack, so
it plays its own tune and has the synth mode). The package is Felucca's: its update loader
(ext/Felucca/firmware/loader, built here with the JieLi toolchain) and tools/fm1pkg_make.py,
which takes three files of JieLi's AC79 SDK (Apache-2.0; tools/fetch_ext.sh fetches them into
ext/ac79sdk and checks them against Felucca's hashes). Ship LICENSES/Apache-2.0.txt with it.
SPDX-License-Identifier: GPL-3.0-only"""
import glob
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEL = ROOT / "ext" / "Felucca"
os.environ.setdefault("JIELI_TOOLCHAIN", (sorted(glob.glob(str(ROOT.parent / "fm-1" / "reference" / "toolchain" / "jieli-linux-toolchains-*"))) or [""])[-1])
os.environ.setdefault("AC79_SDK", str(ROOT / "ext" / "ac79sdk"))
sys.path.insert(0, str(FEL / "tools"))
os.chdir(FEL)                                   # (Felucca's build helpers use repo-relative paths)
import build as felucca                         # noqa: E402
import fm1pkg_make as pkg                       # noqa: E402

PRODUCT = "FM-1_900"                            # the identity Felucca's own development builds carry


def main(out):
    app = (ROOT / "build" / "fw" / "sidplayer.bin").read_bytes()
    for rel, sha in felucca.SDK_SHA256.items():
        if __import__("hashlib").sha256(pkg.sdk_file(rel)).hexdigest() != sha:
            raise SystemExit(f"{rel}: not the AC79NN_SDK_V1.2.1 file Felucca's packages are made with")
    ota = felucca.build_loader()
    data = pkg.ufw(pkg.flash_image(app, pkg.KEY), ota, PRODUCT)
    Path(out).write_bytes(data)
    print(f"{out}: {len(data)} bytes, app {len(app)} bytes, identity {PRODUCT}")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "web" / "sidplayer.fwsc")
