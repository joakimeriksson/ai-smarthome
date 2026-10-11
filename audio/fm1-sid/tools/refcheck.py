#!/usr/bin/env python3
"""Compare a replayed tune with a reference render (sidplayfp): align on the RMS envelope
(sidplayfp starts with a silent power-on stretch), then report the waveform correlation
and the correlation of log spectrograms over the aligned part.
    tools/refcheck.py REF.wav OURS.wav [...]
SPDX-License-Identifier: BSD-2-Clause"""
import sys, wave
import numpy as np


def rd(f):
    with wave.open(f) as w:
        ch = w.getnchannels()
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(float).reshape(-1, ch).mean(1) / 32768


def logspec(x):
    n, h = 2048, 512
    win = np.hanning(n)
    fr = np.array([x[i:i + n] * win for i in range(0, len(x) - n, h)])
    return np.log10(np.abs(np.fft.rfft(fr, axis=1))[:, :700] + 1e-4)


def align(ref, x):
    """lag (samples) with ref[lag + i] ~ x[i]: coarse on 10 ms RMS, then fine on samples"""
    hop = 441
    er = np.array([np.sqrt(np.mean(ref[i:i + hop] ** 2)) for i in range(0, len(ref) - hop, hop)])
    ex = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    m = min(len(ex), len(er)) - 400
    # sidplayfp starts with ~1.9 s of power-on silence plus the tune's own init before its first SID write (1.88 .. 2.49 s seen): search 1.8 .. 2.6 s
    # (repetitive music
    # correlates at whole-bar offsets too)
    best = max(range(180, 260), key=lambda L: np.corrcoef(er[L:L + m], ex[:m])[0, 1] if L + m <= len(er) else -1)
    c = best * hop
    seg = x[44100:44100 * 4]
    fine = max(range(c - hop, c + hop), key=lambda L: abs(np.dot(ref[44100 + L:44100 + L + len(seg)], seg)) if L >= -44100 else 0)
    return fine


def main():
    ref = rd(sys.argv[1])
    for f in sys.argv[2:]:
        x = rd(f)
        lag = align(ref, x)
        n = min(len(ref) - lag, len(x))
        a, b = ref[lag:lag + n], x[:n]
        wc = np.dot(a, b) / np.sqrt(np.dot(a, a) * np.dot(b, b))
        sa, sb = logspec(a), logspec(b)
        sc = np.mean([np.corrcoef(sa[i], sb[i])[0, 1] for i in range(len(sa)) if sa[i].std() > 0 and sb[i].std() > 0])
        print(f"{f:44s} lag {lag / 44.1:7.1f} ms  waveform r {wc:6.3f}  spectrum r {sc:5.3f}")


if __name__ == "__main__":
    main()
