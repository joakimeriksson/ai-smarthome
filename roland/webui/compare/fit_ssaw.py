#!/usr/bin/env python3
"""Fit Zenology's SuperSAW (OSC_TYPE SuperSAW) from zen_bank renders.

Measured 2026-09-26 (Zenology 2.0.9): the SuperSAW is 14 steady VA saws in two
stacks of 7 - an inner stack within about +-11 cents (the JP-8000 spread) and
an outer one out to about +-40 cents. SSAW_DETUNE does not move them: it fades
the outer stack in (0 -> ~32) and the inner one down (-> 127). The detunes are
fixed in cents at every pitch; every note restarts all 14 at fixed phases (the
note is sample-identical take to take); PW does nothing (byte-identical).

This tool measures, at C6 where the voices separate cleanly:
  cents   each voice's detune, from harmonic 3 of 20-second renders
  amp     each voice's level relative to one Zenology VA saw, per SSAW_DETUNE
  phase   each voice's start phase, from a least-squares fit of the 14
          fundamentals just after note-on

Render (slot 5 = "MEAS SAW", every host quit), then fit:

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
       --slot 5 --notes 84 --hold 20 --dur 20.3 --set PCMT_PTL_1.CUTOFF=1023 \\
       --set PCMT_PTL_1.MCTL_1_SENS1=0 --set PCMS_PTL_1.OSC_TYPE=3"
    $Z --param PCMS_PTL_1.SSAW_DETUNE --values 0,4,8,16,24,32,64,127 --out renders/ssaw/long
    $Z --param PCMS_PTL_1.SSAW_DETUNE --values 12,40,48,56,80,96,112 --out renders/ssaw/long2

    uv run --with numpy --with scipy webui/compare/fit_ssaw.py            # report
    uv run --with numpy --with scipy webui/compare/fit_ssaw.py --write    # update va-dsp.js

The fundamental: across C5-C7 Zenology's SuperSAW has a fundamental 2-4 dB
below its other harmonics (relative to its VA saw), growing with detune - but
unevenly from voice to voice (-1 to -9 dB), so per-voice waveforms are not quite
plain saws. The synth models the aggregate: a pitch-tracking 2-pole highpass
whose cutoff (hpf: [detune, fc / f0]) is fitted to the deficit, from

    $Z --notes 24,36,48,60,72,84,96 --hold 6 --dur 6.3 \
       --param PCMS_PTL_1.SSAW_DETUNE --values 0,16,32,64,127 --out renders/ssaw/grid
    (the same with OSC_TYPE left at VA, --param PCMS_PTL_1.VA_FORM --values 0,
     --hold 1.5 --dur 1.8, into renders/ssaw/grid-saw)

Only C5 and up are used: below that, voices 1.4 cents apart beat so slowly
(18 s at C2) that a few seconds of render measure the start phases, not the
spectrum.

Levels are relative to renders/osc/octaves (fit_osc.py's capture, same session
or not - it is only the per-voice reference, and Zenology's level drift is a
uniform ~0.5 dB that fit_osc's table already carries).
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
DSP = ROOT / "webui/static/va-dsp.js"
NOTE, K = 84, 3
#: nominal detunes (cents), refined per voice from the renders
INNER = [-10.8, -5.8, -1.4, 0.7, 2.8, 6.9, 11.6]
OUTER = [-35.7, -19.3, -16.1, -3.9, 9.6, 24.2, 39.5]
F0 = 440 * 2 ** ((NOTE - 69) / 12)


def load(path):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    return x / 32768 if np.abs(x).max() > 2 else x


def power_spec(x, t0, t1):
    seg = x[int(t0 * SR):int(t1 * SR)]
    w = np.blackman(len(seg))
    sp = (np.abs(np.fft.rfft(seg * w)) * 2 / w.sum()) ** 2
    return np.fft.rfftfreq(len(seg), 1 / SR), sp


def line_amp(fr, sp, fc, half=1.1):
    """Amplitude of one voice's line, summing its ~0.63 Hz modulation triplet."""
    m = (fr > fc - half) & (fr < fc + half)
    return float(np.sqrt(sp[m].sum()))


def refine(fr, sp, cents, half=1.1):
    """Peak of the triplet-summed power within +-0.6 cents, parabolically - two
    inner voices sit 2 cents apart, so a wider search finds the neighbour."""
    fc = K * F0 * 2 ** (cents / 1200)
    df = fr[1] - fr[0]
    lo, hi = fc * 2 ** (-0.6 / 1200), fc * 2 ** (0.6 / 1200)
    idx = np.nonzero((fr > lo) & (fr < hi))[0]
    n = max(3, int(2 * half / df))
    ps = np.convolve(sp, np.ones(n), mode="same")
    i = idx[np.argmax(ps[idx])]
    a, b, c = np.log(ps[i - 1:i + 2] + 1e-30)
    off = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) < 0 else 0.0
    return 1200 * np.log2((fr[i] + off * df) / (K * F0))


def runs():
    out = {}
    for name in ("renders/ssaw/long", "renders/ssaw/long2"):
        d = ROOT / name
        if not (d / "manifest.json").is_file():
            continue
        m = json.loads((d / "manifest.json").read_text())
        for v in m["values"]:
            if str(NOTE) in m["files"][str(v)]:
                out[v] = (d / m["files"][str(v)][str(NOTE)], m["lead"])
    return dict(sorted(out.items()))


def onset(x, lead):
    """Zenology's note-on sample: first sample above 1% of the early peak."""
    i0 = int((lead - 0.02) * SR)
    seg = np.abs(x[i0:i0 + int(0.1 * SR)])
    return (i0 + int(np.argmax(seg > 0.01 * seg.max()))) / SR


def phases(x, t_on, cents, span=0.9):
    """Least-squares fit of the 14 fundamentals over [t_on, t_on + span]."""
    n0, n1 = int(round(t_on * SR)), int(round((t_on + span) * SR))
    t = (np.arange(n0, n1) - n0) / SR
    f = F0 * 2 ** (np.asarray(cents) / 1200)
    B = np.hstack([np.cos(2 * np.pi * np.outer(t, f)), -np.sin(2 * np.pi * np.outer(t, f))])
    coef, *_ = np.linalg.lstsq(B, x[n0:n1], rcond=None)
    c = coef[:len(f)] + 1j * coef[len(f):]
    return np.abs(c), np.angle(c)


def bands(x, f0, t0, t1, n=6):
    """Energy per harmonic, summed over +-80 cents (every voice's line)."""
    fr, sp = power_spec(x, t0, t1)
    return np.array([10 * np.log10(sp[(fr > k * f0 * 2 ** (-80 / 1200))
                                      & (fr < k * f0 * 2 ** (80 / 1200))].sum())
                     for k in range(1, n + 1)])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)

    rs = runs()
    ref_m = json.loads((ROOT / "renders/osc/octaves/manifest.json").read_text())
    rfr, rsp = power_spec(load(ROOT / "renders/osc/octaves" / ref_m["files"]["0"][str(NOTE)]), 0.4, 1.3)
    ref = line_amp(rfr, rsp, K * F0, half=3)

    # 1. detunes: inner from detune 0 (outer absent), outer from 127 (inner low)
    fr0, sp0 = power_spec(load(rs[0][0]), 1.0, 20.0)
    fr1, sp1 = power_spec(load(rs[127][0]), 1.0, 20.0)
    cents = [refine(fr0, sp0, c) for c in INNER] + [refine(fr1, sp1, c) for c in OUTER]
    print("voice detunes (cents): " + " ".join(f"{c:+.2f}" for c in cents))

    # 2. levels per detune, relative to one VA saw
    amps = {}
    for v, (path, _lead) in rs.items():
        fr, sp = power_spec(load(path), 1.0, 20.0)
        amps[v] = [line_amp(fr, sp, K * F0 * 2 ** (c / 1200)) / ref for c in cents]
    print("\n detune   inner dB (7)                                    outer dB (7)")
    for v, row in amps.items():
        print(f"   {v:3d}   " + " ".join(f"{20 * np.log10(x):5.1f}" for x in row[:7]) + "   "
              + " ".join(f"{20 * np.log10(x):5.1f}" for x in row[7:]))

    # 3. start phases, from the fundamentals just after note-on. Each voice plays
    #    the SAW table, whose fundamental is +(2/pi) sin 2 pi p (cosine phase
    #    -pi/2 at p = 0), so start phase p = (theta + pi/2) / 2 pi.
    #    Inner voices are fitted at detune 0, where they play alone at full
    #    level; outer ones at 127. The fit includes all 14 either way.
    x0, x1 = load(rs[0][0]), load(rs[127][0])
    t_on = onset(x1, rs[127][1])
    _a0, th0 = phases(x0, onset(x0, rs[0][1]), cents)
    _a1, th1 = phases(x1, t_on, cents)
    theta = np.concatenate([th0[:7], th1[7:]])
    start = np.mod((theta + np.pi / 2) / (2 * np.pi), 1)
    print(f"\nnote-on at {t_on:.5f} s (manifest lead {rs[127][1]})")
    print("start phases (cycles):  " + " ".join(f"{p:.3f}" for p in start))
    # consistency: the same fit at detune 64, and at other notes where rendered
    for v in (8, 32, 64):
        if v in rs:
            xv = load(rs[v][0])
            _a, th = phases(xv, onset(xv, rs[v][1]), cents)
            d = np.angle(np.exp(1j * (th - theta)))
            print(f"  detune {v:3d}, phase vs the fit (rad): inner "
                  + " ".join(f"{d[i]:+.2f}" for i in range(7)) + "   outer "
                  + " ".join(f"{d[i]:+.2f}" if amps[v][i] > 0.05 else "  -  " for i in range(7, 14)))

    # 4. the fundamental deficit -> pitch-tracking highpass, per detune
    hpf = []
    g = ROOT / "renders/ssaw/grid"
    if (g / "manifest.json").is_file():
        gm = json.loads((g / "manifest.json").read_text())
        sm = json.loads((ROOT / "renders/ssaw/grid-saw/manifest.json").read_text())
        print("\nfundamental deficit vs harmonics 2-6 (SuperSAW over VA saw), notes >= 72:")
        for v in gm["values"]:
            ds = []
            for note in (72, 84, 96):
                f0 = 440 * 2 ** ((note - 69) / 12)
                z = load(g / gm["files"][str(v)][str(note)]); t = onset(z, gm["lead"])
                s_ = bands(z, f0, t + 0.8, gm["lead"] + gm["hold"] - 0.2)
                r_ = bands(load(ROOT / "renders/ssaw/grid-saw" / sm["files"]["0"][str(note)]), f0, 0.4, 1.5)
                d = s_ - r_
                ds.append(d[0] - np.mean(d[1:6]))
            deficit = -float(np.mean(ds))
            ratio = float((10 ** (deficit / 10) - 1) ** 0.25)      # 2-pole Butterworth at ratio x f0
            hpf.append([int(v), round(ratio, 4)])
            print(f"  detune {v:3d}: {' '.join(f'{x:+.1f}' for x in ds)} dB -> mean -{deficit:.2f} dB -> fc = {ratio:.3f} x f0")

    tables = {"cents": [round(float(c), 3) for c in cents],
              "phase": [round(float(p), 4) for p in start],
              "detune": [int(v) for v in amps],
              "amp": [[round(float(x), 5) for x in row] for row in amps.values()],
              "hpf": hpf}
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*SSAW_TABLES\*/(.*?)/\*END_SSAW_TABLES\*/", src, re.S)
        if not m:
            raise SystemExit("SSAW_TABLES markers not found in va-dsp.js")
        DSP.write_text(src[:m.start(1)] + json.dumps(tables, separators=(", ", ": ")) + src[m.end(1):])
        print(f"\nwrote SuperSAW tables into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
