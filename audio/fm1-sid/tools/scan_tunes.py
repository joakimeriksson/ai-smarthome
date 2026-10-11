#!/usr/bin/env python3
"""Find HVSC tunes that use hard sync / ring modulation and the filter, from their register
streams (build/sidlogger, libsidplayfp): per tune, the share of frames with a sounding synced
(ringed) voice, the share with the filter routed, and how often the cutoff moves.

    tools/scan_tunes.py MUSICIANS/G/Galway_Martin [MUSICIANS/H/Hubbard_Rob ...]
    tools/scan_tunes.py --songs MUSICIANS/G/Galway_Martin/Wizball.sid      every subtune

Tunes are cached in build/hvsc/ (not part of the repo).
SPDX-License-Identifier: BSD-2-Clause"""
import concurrent.futures as cf
import os
import re
import struct
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HVSC = os.environ.get("HVSC_MIRROR", "https://hvsc.brona.dk/HVSC/C64Music")
CACHE = ROOT / "build" / "hvsc"
FRAME = 19656
SECS = 20


def fetch(rel):
    p = CACHE / rel
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(urllib.request.urlopen(f"{HVSC}/{rel}").read())
    return p


def listing(d):
    html = urllib.request.urlopen(f"{HVSC}/{d}/").read().decode("latin1")
    return [f"{d}/{m}" for m in re.findall(r'href="([^"/]+\.sid)"', html)]


def analyse(log):
    b = log.read_bytes()
    nev = struct.unpack_from("<I", b, 28)[0]
    ctrl = {}                                # (chip, voice) -> control byte
    filt = {}                                # chip -> res_filt
    fc_moves = 0
    last_fc = {}
    frames = sync_fr = ring_fr = filt_fr = 0
    cur = 0
    seen = set()

    def close_frame():
        nonlocal frames, sync_fr, ring_fr, filt_fr
        frames += 1
        s = r = False
        for (c, v), x in ctrl.items():
            sounding = x & 0xF0 and x & 1
            s |= bool(sounding and x & 2)
            r |= bool(sounding and x & 4 and x & 0x10)
        sync_fr += s
        ring_fr += r
        filt_fr += any(f & 7 for f in filt.values())

    for i in range(nev):
        cyc, chip, reg, val, _ = struct.unpack_from("<IBBBB", b, 36 + 8 * i)
        while cyc // FRAME > cur:
            close_frame()
            cur += 1
        if reg in (4, 11, 18):
            ctrl[(chip, reg // 7)] = val
        elif reg == 0x17:
            filt[chip] = val
        elif reg == 0x16:
            if last_fc.get(chip) is not None and last_fc[chip] != val:
                fc_moves += 1
            last_fc[chip] = val
        seen.add(reg)
    close_frame()
    f = max(frames, 1)
    return sync_fr / f, ring_fr / f, filt_fr / f, fc_moves / SECS


def run(rel, song):
    p = fetch(rel)
    log = CACHE / (rel.replace("/", "_") + f".{song}.sidlog")
    info = log.with_suffix(".txt")
    if not (log.exists() and info.exists()):
        r = subprocess.run([str(ROOT / "build" / "sidlogger"), str(p), str(log), str(song), str(SECS)],
                           capture_output=True)
        if r.returncode or not log.exists():
            return None
        info.write_text(r.stderr.decode("latin1"))
    m = re.search(r"song (\d+) of (\d+)", info.read_text())
    return (rel, song, int(m.group(2)) if m else 1) + analyse(log)


def main():
    args = sys.argv[1:]
    jobs = []
    if args and args[0] == "--songs":
        for rel in args[1:]:
            first = run(rel, 1)
            jobs += [(rel, s) for s in range(1, (first[2] if first else 1) + 1)]
    else:
        for d in args:
            jobs += [(rel, 0) for rel in listing(d)]
    with cf.ThreadPoolExecutor(4) as ex:
        res = [r for r in ex.map(lambda j: run(*j), jobs) if r]
    res.sort(key=lambda r: -(r[3] + r[4]) * (0.25 + r[5]) * (1 + min(r[6], 20) / 10))
    print(f"{'tune':58s} song  sync  ring  filt  fc/s")
    for rel, song, songs, sy, ri, fi, fc in res[:40]:
        print(f"{rel[10:]:58s} {song or '-':>4}  {sy:4.2f}  {ri:4.2f}  {fi:4.2f}  {fc:5.1f}")


if __name__ == "__main__":
    main()
