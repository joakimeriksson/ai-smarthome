#!/usr/bin/env python3
"""Compare our render against a Zenology capture, and say what to fit next.

Two measurements, because they point at different constants in va-dsp.js:

  spectrum  - Welch-averaged log spectrum, level-normalised. Differences here
              are timbre: the cutoff curve, resonance, oscillator shape.
  envelope  - RMS over time. Differences here are the envelope-time curve, and
              they are the ones you can fix without touching the filter.

Level is normalised away first: the plugin's output gain is not something we
are trying to match, and leaving it in would swamp everything else.

    uv run --with numpy --with scipy webui/compare/compare.py \
        refs/laser-sync-harp.wav renders/laser.wav
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///

import argparse
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
BANDS = [(20, 120), (120, 400), (400, 1200), (1200, 3500), (3500, 9000), (9000, 20000)]


def load(path):
    sr, d = wavfile.read(path)
    x = d.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(axis=1)
    x /= 32768.0
    if sr != SR:
        raise SystemExit(f"{path}: {sr} Hz, expected {SR}")
    return x


def avg_log_spectrum(x):
    """Welch-averaged, level-invariant - stable for patches that animate."""
    f, p = welch(x, SR, nperseg=4096, noverlap=2048)
    db = 10 * np.log10(np.maximum(p, 1e-16))
    return f, db - db.max()


def envelope(x, hop=0.02):
    n = int(hop * SR)
    frames = len(x) // n
    e = np.array([np.sqrt(np.mean(x[i * n:(i + 1) * n] ** 2)) for i in range(frames)])
    return e / max(e.max(), 1e-12)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("reference", help="Zenology capture")
    ap.add_argument("ours", help="our render")
    a = ap.parse_args(argv)

    ref, ours = load(a.reference), load(a.ours)
    n = min(len(ref), len(ours))
    ref, ours = ref[:n], ours[:n]

    f, dref = avg_log_spectrum(ref)
    _, dours = avg_log_spectrum(ours)
    diff = dours - dref
    band_mask = (f >= 20) & (f <= 20000)
    overall = float(np.mean(np.abs(diff[band_mask])))

    print(f"reference : {a.reference}")
    print(f"ours      : {a.ours}")
    print(f"\naverage spectral difference: {overall:.1f} dB   "
          f"(lower is closer; Synthex's fitted laser harp reached ~5 dB)\n")
    print("  band            ours vs reference")
    for lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        if not m.any():
            continue
        d = float(np.mean(diff[m]))
        arrow = "brighter" if d > 2 else "darker" if d < -2 else "close"
        print(f"  {lo:5}-{hi:<5} Hz   {d:+6.1f} dB   {arrow}")

    eref, eours = envelope(ref), envelope(ours)
    m = min(len(eref), len(eours))
    eref, eours = eref[:m], eours[:m]
    err = float(np.mean(np.abs(eref - eours)))
    print(f"\nenvelope difference: {err:.3f} (0 = identical shape)")

    def decay_to(e, frac):
        peak = int(np.argmax(e))
        below = np.where(e[peak:] < frac)[0]
        return (below[0] * 0.02) if len(below) else None

    for frac, name in ((0.5, "half"), (0.1, "tenth")):
        a_, b_ = decay_to(eref, frac), decay_to(eours, frac)
        if a_ and b_:
            print(f"  time to {name} level: reference {a_:.2f}s, ours {b_:.2f}s"
                  f"  ({'ours shorter' if b_ < a_ else 'ours longer'})")

    print("\nwhat to fit first:")
    hi_d = float(np.mean(diff[(f >= 1200) & (f < 9000)]))
    if abs(hi_d) > 4:
        print(f"  SCALE.cutoffHz - we are {abs(hi_d):.0f} dB "
              f"{'brighter' if hi_d > 0 else 'darker'} in the 1.2-9 kHz range")
    if err > 0.12:
        print("  SCALE.envTime - the amplitude shape differs materially")
    if abs(hi_d) <= 4 and err <= 0.12:
        print("  nothing dominant - move to per-parameter sweeps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
