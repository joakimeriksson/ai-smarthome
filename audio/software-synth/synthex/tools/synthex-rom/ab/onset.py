#!/usr/bin/env python3
"""The notes' onsets against Per Kristian's run-through: per preset and band, the loudest 30 ms within -40 .. +130 ms
of every note (free of the transcription's timing), render minus hardware, each side relative to its own total over
the clip. score_ab.py's frames are 100 ms: a note's first 30 ms does not show there.

    onset.py DATA RENDERS NOTESDIR [slots]

DATA and RENDERS as render_ab.ts has them; the render goes through score_ab.py's codec and alignment. The columns
fA fD aA aD are the preset's filter and amp attack and decay steps (0..15)."""
import sys, json, tempfile
from pathlib import Path
import numpy as np, scipy.signal as ss
W = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(W / "ab"))
import score_ab as sa
SR = 44100
BANDS = [(40, 300), (300, 1000), (1000, 3000), (3000, 9000)]
raw = json.load(open(W / "data/rom_presets_raw.json"))
def band_env(x):
    out = []
    for lo, hi in BANDS:
        y = ss.sosfiltfilt(ss.butter(4, [lo, hi], "bp", fs=SR, output="sos"), x)
        out.append(y ** 2)
    return np.array(out)
def onset_levels(x, ts, win=(0.0, 0.04)):
    P = band_env(x); tot = np.mean(x ** 2)
    r = []
    for t in ts:
        if win == "peak":                      # the loudest 30 ms within -40 .. +130 ms of the note: free of timing
            a, b, w = max(0, int((t - 0.04) * SR)), int((t + 0.13) * SR), int(0.03 * SR)
            if b >= P.shape[1]: continue
            c = np.cumsum(P[:, a:b], 1); m = (c[:, w:] - c[:, :-w]).max(1) / w
            r.append(10 * np.log10(m / tot + 1e-9)); continue
        a, b = int((t + win[0]) * SR), int((t + win[1]) * SR)
        if b < P.shape[1]: r.append(10 * np.log10(P[:, a:b].mean(1) / tot + 1e-9))
    return np.array(r)
def one(data, rend, notes, slot, tmp, win="peak"):
    h = sa.load(data / f"{slot}-hw.wav"); e = sa.codec(rend / f"{slot}.wav", tmp)
    h2, e2 = sa.align(h, e)
    lag = len(h) - len(h2) if len(h2) < len(h) else -(len(e) - len(e2))        # hw samples dropped (+) or render's (-)
    ev = sorted(tuple(float(v) for v in it.split(":")) for it in (notes / f"{slot}.txt").read_text().strip().split(","))
    ts = [t for i, (t, n, d) in enumerate(ev) if all(abs(t - u) > 0.17 or j == i for j, (u, _, _) in enumerate(ev)) and t + 0.05 < 3]
    sh = max(lag, 0) / SR
    H = onset_levels(h2, [t - sh for t in ts if t - sh >= 0], win); E = onset_levels(e2, [t - sh for t in ts if t - sh >= 0], win)
    n = min(len(H), len(E))
    return (E[:n] - H[:n]), H[:n], E[:n]
if __name__ == "__main__":
    data, rend, notes = map(Path, sys.argv[1:4])
    slots = [int(s) for s in sys.argv[4].split(",")] if len(sys.argv) > 4 else range(10, 50)
    print("slot fA fD aA aD  n   <300  .3-1k  1-3k  3-9k   (render - hardware, each note's loudest 30 ms, dB)")
    tot = []
    with tempfile.TemporaryDirectory() as tmp:
        for s in slots:
            d, H, E = one(data, rend, notes, s, tmp)
            if not len(d): continue
            p = raw[s - 10] if len(raw) >= 40 else None
            m = d.mean(0); tot.append(m)
            ix = " ".join(f"{p[k] >> 4:2d}" for k in (20, 22, 21, 23)) if p else ""
            print(f"{s:3d}  {ix} {len(d):2d} " + " ".join(f"{v:6.1f}" for v in m))
    tot = np.array(tot); print("mean abs", " ".join(f"{v:6.1f}" for v in np.abs(tot).mean(0)), " mean", " ".join(f"{v:6.1f}" for v in tot.mean(0)))
