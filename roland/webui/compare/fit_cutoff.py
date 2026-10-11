#!/usr/bin/env python3
"""Fit SCALE.cutoffHz in va-dsp.js to Zenology renders from zen_bank.py.

SUPERSEDED by fit_vcf.py (2026-09-25), which fits every VCF model from a white-
noise probe and is not limited to cutoffs above the note's fundamental. Kept
because it still works for checking a saw-based run.

For each rendered CUTOFF value it finds the filter frequency at which OUR
filter produces the same harmonic pattern, then fits log2(Hz) against the raw
value - the exponential law cutoffHz assumes:

    uv run --with numpy --with scipy webui/compare/fit_cutoff.py renders/cutoff

How the match works: on a sustained saw, harmonic k has amplitude 1/k, so
A_k * k is the filter's magnitude at k*f0. Comparing that pattern (level
aligned by the median difference) removes the oscillator and the output gain,
leaving only the filter shape and corner. Harmonics more than 60 dB below the
strongest are ignored - that is Zenology's noise floor.

The tone needs a plain VA saw with nothing else moving the cutoff: filter
envelope depth, LFO depth, key follow and cutoff velocity sensitivity all 0.
"MEAS SAW" (user slot 5) is built that way. Also reports which filter feedback
matches best, since that is what SCALE.resoQ returns at RESO 0.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
GRID_FC = np.geomspace(15, 16000, 121)
GRID_Q = (0, 0.2, 0.35, 0.5, 0.707, 1.0)
FLOOR_DB = 60
#: a note can only locate a corner at or above this fraction of its f0
MIN_CORNER = 0.75


def note_hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def harmonics(x, f0, t0, t1):
    """Peak magnitude at each harmonic of f0 over the sustained part [t0, t1]."""
    seg = x[int(t0 * SR):int(t1 * SR)]
    w = np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(seg * w)) * 2 / w.sum()
    freqs = np.fft.rfftfreq(len(seg), 1 / SR)
    out = []
    k = 1
    while k * f0 < 18000:
        m = (freqs > k * f0 * 0.985) & (freqs < k * f0 * 1.015)
        out.append(spec[m].max() if m.any() else 0.0)
        k += 1
    return np.array(out)


def response_db(amps):
    """The filter magnitude a saw's harmonics imply: A_k * k, in dB."""
    k = np.arange(1, len(amps) + 1)
    return 20 * np.log10(np.maximum(amps * k, 1e-9))


def mismatch(ref_db, ours_db):
    keep = ref_db > ref_db.max() - FLOOR_DB
    n = min(len(ref_db), len(ours_db))
    d = (ref_db[:n] - ours_db[:n])[keep[:n]]
    return float(np.mean(np.abs(d - np.median(d))))


def build_library(patch, note, m, tmp):
    """Our filter's response at every (q, fc) in the grid, for one note."""
    out = Path(tmp) / f"n{note}"
    subprocess.run(
        ["node", str(ROOT / "webui/compare/render_grid.mjs"), str(patch), str(out),
         "--note", str(note), "--velocity", str(m["velocity"]),
         "--lead", str(m["lead"]), "--hold", str(m["hold"]), "--dur", str(m["dur"]),
         "--fc", ",".join(f"{f:.2f}" for f in GRID_FC),
         "--q", ",".join(map(str, GRID_Q))],
        check=True, cwd=ROOT)
    lib = {}
    for path in out.glob("*.f32"):
        q, fc = map(float, re.fullmatch(r"q([\d.]+)_fc([\d.]+)\.f32", path.name).groups())
        x = np.fromfile(path, dtype=np.float32).astype(float)
        lib[(q, fc)] = response_db(harmonics(x, note_hz(note), *window(m)))
    return lib


def window(m):
    """Skip the attack, stop before note-off."""
    return m["lead"] + 0.25, m["lead"] + m["hold"] - 0.15


def best_match(ref_db, lib):
    """(residual dB, q, fc Hz), fc refined between grid points."""
    scored = sorted((mismatch(ref_db, db), q, fc) for (q, fc), db in lib.items())
    s, q, fc = scored[0]
    row = sorted((f, r) for r, qq, f in scored if qq == q)
    fcs = [f for f, _ in row]
    i = fcs.index(fc)
    if 0 < i < len(row) - 1:
        (fa, sa), (fb, sb), (fc_, sc) = row[i - 1], row[i], row[i + 1]
        xa, xb, xc = np.log2([fa, fb, fc_])
        den = sa - 2 * sb + sc
        if den > 0:
            fc = float(2 ** (xb + 0.5 * (xb - xa) * (sa - sc) / den))
    return s, q, fc


def load(path):
    _sr, d = wavfile.read(path)
    return d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("run", help="directory written by zen_bank.py")
    ap.add_argument("--range", help="lo,hi: only fit the law on raw values in this range")
    ap.add_argument("--max-residual", type=float, default=1.0,
                    help="dB; above this our filter shape does not match, so the "
                         "point cannot test the law")
    a = ap.parse_args(argv)

    run = Path(a.run)
    m = json.loads((run / "manifest.json").read_text())
    if not m["param"].endswith(".CUTOFF"):
        raise SystemExit(f"{run} sweeps {m['param']}, not a CUTOFF")
    notes = m["notes"]
    print(f"{m['tone']!r} slot {m['slot']}, {m['param']} x {len(m['values'])}, "
          f"notes {notes}, velocity {m['velocity']} ({m['date']})")

    with tempfile.TemporaryDirectory() as tmp:
        libs = {n: build_library(run / "patch.json", n, m, tmp) for n in notes}

    rows = []
    print(f"\n  {'CUTOFF':>6}  " + "  ".join(f"{'n' + str(n) + ' Hz':>9} {'res':>5}" for n in notes)
          + "   spread")
    for v in m["values"]:
        fits = {}
        for n in notes:
            x = load(run / m["files"][str(v)][str(n)])
            ref = response_db(harmonics(x, note_hz(n), *window(m)))
            fits[n] = best_match(ref, libs[n])
        # A corner below the fundamental cannot be located: every harmonic is on
        # the filter slope, and level alignment absorbs where the slope starts.
        ok = {n: f for n, f in fits.items()
              if f[2] >= MIN_CORNER * note_hz(n) and f[0] < a.max_residual}
        hz = [f[2] for f in ok.values()]
        spread = f"{1200 * np.log2(max(hz) / min(hz)):4.0f} ct" if len(hz) > 1 else "   -"
        rows.append((v, list(ok.values())))
        print(f"  {v:6d}  " + "  ".join(
            f"{f[2]:9.1f} {f[0]:5.2f}" if n in ok else f"{'(' + format(f[2], '.0f') + ')':>9} {f[0]:5.2f}"
            for n, f in fits.items()) + f"   {spread}")
    print(f"  (parenthesised: not used - corner below {MIN_CORNER} x f0, "
          f"or residual >= {a.max_residual} dB)")

    if a.range:
        lo, hi = map(int, a.range.split(","))
        rows = [(v, f) for v, f in rows if lo <= v <= hi]
    used = [(v, f) for v, f in rows if f]
    if len(used) < 3:
        raise SystemExit("fewer than 3 usable points - widen --range or --max-residual")

    v = np.array([u[0] for u in used], dtype=float)
    y = np.array([np.mean([np.log2(f) for _s, _q, f in u[1]]) for u in used])
    octs, b = np.polyfit(v / 1023, y, 1)
    dev = np.abs(y - (octs * v / 1023 + b)).max() * 1200
    qs = [q for _v, f in used for _s, q, _f in f]
    q_best = max(set(qs), key=qs.count)

    print(f"\nfitted on CUTOFF {int(v.min())}..{int(v.max())} ({len(used)} points), "
          f"max deviation {dev:.0f} cents:")
    print(f"  cutBase = {2 ** b:.3f} Hz   cutOct = {octs:.3f}")
    print(f"  -> CUTOFF 0 = {2 ** b:.2f} Hz, 512 = {2 ** (b + octs * 512 / 1023):.1f} Hz, "
          f"1023 = {2 ** (b + octs):.0f} Hz")
    print(f"  best feedback at this tone's RESO: {q_best} "
          f"(chosen at {qs.count(q_best)} of {len(qs)} points)")
    print("\nput cutBase/cutOct in SCALE.cutoffHz in webui/static/va-dsp.js, with the "
          "tone and date they were fitted against")
    return 0


if __name__ == "__main__":
    sys.exit(main())
