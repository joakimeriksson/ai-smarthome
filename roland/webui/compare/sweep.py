#!/usr/bin/env python3
"""Fit va-dsp.js SCALE constants against a Zenology capture.

Renders the same phrase for each combination of fit parameters and keeps the
one with the smallest average spectral difference. This is the step that turns
the UNFITTED guesses in va-dsp.js into measured values.

    uv run --with numpy --with scipy webui/compare/sweep.py \
        /tmp/laser.json refs/laser-sync-harp.wav

The winning values go into globalThis.__ZC_SCALE defaults in va-dsp.js - and
should be recorded with the capture they were fitted against, because a fit
against one patch is not proof for all patches.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///

import argparse
import itertools
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent


def load(path):
    sr, d = wavfile.read(path)
    x = d.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return x / 32768.0


def spectrum(x):
    _f, p = welch(x, SR, nperseg=4096, noverlap=2048)
    db = 10 * np.log10(np.maximum(p, 1e-16))
    return db - db.max()


def metric(ref_db, x):
    d = spectrum(x)
    n = min(len(ref_db), len(d))
    return float(np.mean(np.abs(d[:n] - ref_db[:n])))


def render(patch, out, scale, seq, gap, lead, dur):
    env = dict(os.environ, ZC_SCALE=json.dumps(scale))
    r = subprocess.run(
        ["node", str(ROOT / "webui/compare/render.mjs"), patch, out,
         "--seq", seq, "--gap", str(gap), "--lead", str(lead), "--dur", str(dur)],
        capture_output=True, text=True, env=env, cwd=ROOT)
    if r.returncode != 0:
        raise SystemExit(f"render failed: {r.stderr[:400]}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("patch", help="patch JSON from dump_va.py")
    ap.add_argument("reference", help="Zenology capture WAV")
    ap.add_argument("--seq", default="62,65,69,74,69,65")
    ap.add_argument("--gap", type=float, default=0.5)
    ap.add_argument("--lead", type=float, default=0.3)
    ap.add_argument("--top", type=int, default=8)
    a = ap.parse_args(argv)

    ref = load(a.reference)
    ref_db = spectrum(ref)
    dur = len(ref) / SR

    grid = {
        "cutBase": [20, 40, 80, 160, 320],
        "cutOct": [7, 8, 9, 10],
        "envMul": [0.5, 1.0, 2.0, 4.0],
    }
    combos = [dict(zip(grid, v)) for v in itertools.product(*grid.values())]
    print(f"reference {a.reference} ({dur:.2f}s), {len(combos)} combinations\n")

    results = []
    with tempfile.TemporaryDirectory() as tmp:
        out = str(Path(tmp) / "r.wav")
        for i, scale in enumerate(combos, 1):
            render(a.patch, out, scale, a.seq, a.gap, a.lead, dur)
            score = metric(ref_db, load(out))
            results.append((score, scale))
            if i % 20 == 0 or i == len(combos):
                print(f"  {i}/{len(combos)}  best so far "
                      f"{min(results)[0]:.2f} dB")

    results.sort(key=lambda r: r[0])
    print(f"\n  {'score':>7}   parameters")
    for score, scale in results[:a.top]:
        print(f"  {score:7.2f}   " +
              "  ".join(f"{k}={v}" for k, v in scale.items()))

    best_score, best = results[0]
    baseline = metric(ref_db, load(
        str(Path(tempfile.gettempdir()) / "zc_baseline.wav"))) if False else None
    print(f"\nbest: {best} at {best_score:.2f} dB")
    print("put these in va-dsp.js SCALE defaults, and record which capture "
          "they were fitted against.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
