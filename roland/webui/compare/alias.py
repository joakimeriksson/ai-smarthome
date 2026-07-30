#!/usr/bin/env python3
"""Measure oscillator aliasing in a WAV.

A perfect sawtooth at f0 has energy only at integer multiples of f0. Any
component that is NOT near a harmonic is aliasing - a partial above Nyquist
folded back down. This script reports how much of the spectrum is off-harmonic,
which is the number to compare between our synth and Zenology.

    uv run --with numpy --with scipy webui/compare/alias.py out.wav --f0 2093

Use a high note: at C7 a saw has only ~10 harmonics below Nyquist, so anything
a naive oscillator folds back is loud and unambiguous.
"""

import argparse
import sys

import numpy as np
from scipy.io import wavfile


def analyse(path, f0, start=0.3, length=1.0, tol_cents=35, floor_db=-90):
    sr, data = wavfile.read(path)
    x = data[:, 0].astype(float) / 32768 if data.ndim > 1 else data.astype(float) / 32768
    seg = x[int(start * sr): int((start + length) * sr)]
    if len(seg) < 1024:
        raise SystemExit(f"{path}: too short to analyse")
    win = seg * np.hanning(len(seg))
    spec = np.abs(np.fft.rfft(win))
    freq = np.fft.rfftfreq(len(seg), 1 / sr)
    spec[freq < 20] = 0                      # ignore DC / rumble

    peak = spec.max()
    if peak <= 0:
        raise SystemExit(f"{path}: silent")
    db = 20 * np.log10(np.maximum(spec, 1e-12) / peak)

    # a bin is "harmonic" if within tol_cents of any k*f0 below Nyquist
    harmonics = np.arange(f0, sr / 2, f0)
    cents = 1200 * np.abs(np.log2(np.maximum(freq, 1e-9)[:, None] / harmonics[None, :]))
    near = (cents.min(axis=1) < tol_cents)

    audible = db > floor_db
    h_energy = (spec[near & audible] ** 2).sum()
    a_energy = (spec[~near & audible] ** 2).sum()
    ratio_db = 10 * np.log10(max(a_energy, 1e-20) / max(h_energy, 1e-20))

    # loudest single off-harmonic component
    off = np.where(~near & audible)[0]
    worst_i = off[np.argmax(spec[off])] if len(off) else None

    print(f"{path}")
    print(f"  f0 {f0:.1f} Hz, {len(harmonics)} harmonics below Nyquist")
    print(f"  off-harmonic energy: {ratio_db:+.1f} dB relative to harmonic energy")
    if worst_i is not None:
        print(f"  loudest alias: {freq[worst_i]:7.1f} Hz at {db[worst_i]:.1f} dBFS-peak")
    verdict = ("essentially alias-free" if ratio_db < -60 else
               "low aliasing" if ratio_db < -40 else
               "audible aliasing" if ratio_db < -20 else "heavy aliasing")
    print(f"  verdict: {verdict}")
    return ratio_db


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("wav", nargs="+")
    ap.add_argument("--f0", type=float, required=True, help="fundamental in Hz")
    a = ap.parse_args()
    for w in a.wav:
        analyse(w, a.f0)
    sys.exit(0)
