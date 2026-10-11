#!/usr/bin/env python3
"""The web page's picks (web/tunes.json): where each tune is in HVSC, its header, the length of
the song from HVSC's Songlengths.md5, and tags measured from its own register stream
(player/psid.c on the host, build/psidlog): how much it uses hard sync, ring modulation, the
filter (a moving cutoff) and pulse-width modulation.
    tools/picks.py   (needs build/psidlog, the tunes in build/hvsc from tools/tunes.sh, and
                      build/Songlengths.md5 from HVSC's DOCUMENTS/)
SPDX-License-Identifier: BSD-2-Clause"""
import hashlib
import json
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HVSC = ROOT / "build" / "hvsc"
# (path in HVSC, song): the page's playlist, in order
PICKS = [
    ("MUSICIANS/G/Galway_Martin/Wizball.sid", 7),
    ("MUSICIANS/G/Galway_Martin/Rolands_Ratrace.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Sanxion.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Sanxion.sid", 2),
    ("MUSICIANS/G/Galway_Martin/Wizball.sid", 4),
    ("MUSICIANS/O/Ouwehand_Reyn/Contaxia.sid", 1),
    ("MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", 1),
    ("MUSICIANS/D/Daglish_Ben/Last_Ninja.sid", 1),
    ("MUSICIANS/F/Follin_Tim/Raw_Recruit.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Delta.sid", 1),
    ("MUSICIANS/T/Tel_Jeroen/Thats_the_Way_It_Is_main.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Commando.sid", 1),
    ("MUSICIANS/D/Daglish_Ben/Killer-Ring.sid", 1),
    ("MUSICIANS/H/Hubbard_Rob/Lightforce.sid", 1),
    ("MUSICIANS/O/Ouwehand_Reyn/Bad_Blood-City.sid", 1),
    ("MUSICIANS/G/Galway_Martin/Wizball.sid", 9),
    ("MUSICIANS/H/Hubbard_Rob/Pandora.sid", 1),
]


def lengths():
    out, path = {}, None
    for line in open(ROOT / "build" / "Songlengths.md5", encoding="latin-1"):
        if line.startswith("; /"):
            path = line[3:].strip()            # without the leading /
        elif "=" in line and path:
            md5, ls = line.strip().split("=", 1)
            out[path] = (md5, [secs(x) for x in ls.split()])
    return out


def secs(t):
    t = t.split("(")[0]
    m, s = t.split(":")
    return round(int(m) * 60 + float(s), 1)


def text(b):
    return b.split(b"\0")[0].decode("latin-1").strip()


def tags(sid, song, length):
    """The share of frames (play calls, 50 Hz) where a gated voice has sync / ring on; the
    filter: cutoff writes that change it per second, with a voice routed in; PWM: pulse width
    changes per second on a pulse voice."""
    with tempfile.TemporaryDirectory() as d:
        log = Path(d) / "t.sidlog"
        subprocess.run([str(ROOT / "build" / "psidlog"), str(sid), str(log), str(song),
                        str(min(90, length or 90))], check=True, capture_output=True)
        b = log.read_bytes()
    nev = struct.unpack_from("<I", b, 8 + 4 * 5)[0]
    regs = [0] * 32
    frames = {}
    cut = pw = 0
    last_frame = 0
    for i in range(nev):
        cyc, chip, r, v, _ = struct.unpack_from("<IBBBB", b, 8 + 28 + 8 * i)
        fr = cyc // 19656
        if fr != last_frame:
            for k in range(last_frame, fr):
                frames[k] = (any(regs[c] & 3 == 3 for c in (4, 11, 18)),
                             any(regs[c] & 5 == 5 and regs[c] & 0x10 for c in (4, 11, 18)))
            last_frame = fr
        if r in (0x15, 0x16) and regs[r] != v and regs[0x17] & 7:
            cut += 1
        if r in (2, 3, 9, 10, 16, 17) and regs[r] != v:
            pw += 1
        regs[r] = v
    n = max(1, len(frames))
    secs_ = n / 50
    sync = sum(f[0] for f in frames.values()) / n
    ring = sum(f[1] for f in frames.values()) / n
    t = []
    if sync > 0.05: t.append("sync")
    if ring > 0.05: t.append("ring")
    if cut / secs_ > 5: t.append("filter")
    if pw / secs_ > 20: t.append("pwm")
    return t, {"sync": round(sync, 3), "ring": round(ring, 3), "cutoff_per_s": round(cut / secs_, 1),
               "pw_per_s": round(pw / secs_, 1)}


def main():
    ls = lengths()
    out = []
    for path, song in PICKS:
        sid = HVSC / path
        b = sid.read_bytes()
        md5, songlen = ls.get(path, (None, []))
        if md5 != hashlib.md5(b).hexdigest():
            print(f"{path}: our copy is not HVSC's current one")
        length = songlen[song - 1] if song <= len(songlen) else None
        t, m = tags(sid, song, length)
        out.append({"path": path, "song": song, "songs": struct.unpack_from(">H", b, 14)[0],
                    "title": text(b[0x16:0x36]), "author": text(b[0x36:0x56]),
                    "released": text(b[0x56:0x76]), "length": length, "tags": t, "measured": m})
        print(f"{out[-1]['title']:28} #{song:<2} {length!s:>6}s {' '.join(t):24} {m}")
    out.append({"file": "house.sid", "song": 1, "songs": 1, "title": "Pocket Sync", "author": "fm1-sid",
                "released": "2026 ai-smarthome", "length": 30.7, "tags": ["sync", "ring", "filter", "pwm"],
                "note": "the firmware's own tune (tools/housetune.py), served with this page"})
    (ROOT / "web" / "tunes.json").write_text(json.dumps(
        {"source": "https://www.hvsc.c64.org/download/C64Music/", "picks": out}, indent=1) + "\n")
    print(f"web/tunes.json: {len(out)} picks")


if __name__ == "__main__":
    main()
