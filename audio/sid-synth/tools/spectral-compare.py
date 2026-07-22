#!/usr/bin/env python3
"""spectral-compare.py - AUDIO-level comparison of an original .sid against a rip.

tools/rip-compare.js measures note onsets, pitch, gate length and ADSR. It is
blind to TIMBRE - Terra Cresta scored 100% onset / 100% pitch while having no
filter at all and sounding badly wrong. This renders both sides through the
same engine (sidplayfp) and compares what you actually hear.

Usage:
  python3 tools/spectral-compare.py orig.wav rip.wav [--plot out.png] [--label NAME]

Render the wavs first (see tools/rip-audio.sh), e.g.
  tools/bin/sidplayfp --sidlite -q -m -f44100 -o1 -t20 -w orig.wav song.sid

Calibration on the guard corpus (20 s, mean log-spectral distance):
    ~7-8 dB   a good rip     (Commando 7.1, Monty 8.4)
    ~12 dB    audibly wrong  (Terra Cresta before the PWM work)
    ~15 dB    two DIFFERENT songs - the floor for "unrelated"
Centroid correlation is positive for the same song and negative for unrelated
material, so read it as "does the brightness contour track", not as a score.
"""
import sys, wave, argparse
import numpy as np

NFFT, HOP = 2048, 512


def load(path):
    with wave.open(path, 'rb') as w:
        n, sr = w.getnframes(), w.getframerate()
        a = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float64)
        if w.getnchannels() == 2:
            a = a.reshape(-1, 2).mean(axis=1)
    return a / 32768.0, sr


def stft(x):
    win = np.hanning(NFFT)
    frames = 1 + (len(x) - NFFT) // HOP
    return np.array([np.abs(np.fft.rfft(x[i * HOP:i * HOP + NFFT] * win))
                     for i in range(frames)])


def align(SA, SB, max_lag=40):
    """Align on the loudness envelope - a rip is offset by a few frames."""
    def norm(S):
        e = S.sum(1)
        return (e - e.mean()) / (e.std() + 1e-9)
    ea, eb = norm(SA), norm(SB)
    best = max(range(-max_lag, max_lag + 1),
               key=lambda L: np.dot(ea[max(0, L):len(ea) + min(0, L)],
                                    eb[max(0, -L):len(eb) + min(0, -L)]))
    if best > 0:
        SA, SB = SA[best:], SB[:len(SB) - best]
    elif best < 0:
        SA, SB = SA[:len(SA) + best], SB[-best:]
    m = min(len(SA), len(SB))
    return SA[:m], SB[:m], best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('orig')
    ap.add_argument('rip')
    ap.add_argument('--plot', metavar='OUT.PNG')
    ap.add_argument('--label', default='')
    ap.add_argument('--plot-seconds', type=float, default=8.0)
    args = ap.parse_args()

    a, sr = load(args.orig)
    b, _ = load(args.rip)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]

    SA, SB, lag = align(stft(a), stft(b))
    print(f"aligned: lag {lag} STFT frames ({lag * HOP / sr * 1000:.0f} ms), "
          f"{len(SA)} frames compared")

    LA = 20 * np.log10(SA + 1e-6)
    LB = 20 * np.log10(SB + 1e-6)
    mean_d = np.abs(LA - LB).mean()
    print(f"log-spectral distance: {mean_d:.2f} dB mean  |  "
          f"{np.sqrt(((LA - LB) ** 2).mean()):.2f} dB rms"
          f"   [good ~7-8, wrong ~12, unrelated ~15]")

    freqs = np.fft.rfftfreq(NFFT, 1 / sr)
    print(f"\n{'band':>15} | {'orig dB':>8} {'rip dB':>8} {'diff':>7}")
    edges = [0, 120, 300, 800, 2000, 5000, 12000, sr / 2]
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (freqs >= lo) & (freqs < hi)
        if not sel.any():
            continue
        da = 20 * np.log10(SA[:, sel].mean() + 1e-9)
        db = 20 * np.log10(SB[:, sel].mean() + 1e-9)
        print(f"{lo:6.0f}-{hi:6.0f}Hz | {da:8.1f} {db:8.1f} {db - da:+7.1f} "
              f"{'#' * min(30, int(abs(db - da)))}")

    def centroid(S):
        return (S * freqs).sum(1) / (S.sum(1) + 1e-9)
    ca, cb = centroid(SA), centroid(SB)
    print(f"\nspectral centroid: orig {ca.mean():7.0f} Hz  rip {cb.mean():7.0f} Hz "
          f"({cb.mean() - ca.mean():+.0f})")
    print(f"  movement (std):  orig {ca.std():7.0f}     rip {cb.std():7.0f}")
    print(f"  correlation:     {np.corrcoef(ca, cb)[0, 1]:.3f}  "
          f"(brightness contour; negative = unrelated)")
    rms = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
    print(f"\noverall level: orig {rms(a):.1f} dB  rip {rms(b):.1f} dB "
          f"({rms(b) - rms(a):+.1f})")

    if args.plot:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        nfr = int(args.plot_seconds * sr / HOP)
        fsel = freqs <= 8000
        fig, axes = plt.subplots(1, 2, figsize=(15, 3.6))
        for ax, (S, tag) in zip(axes, [(SA, 'ORIGINAL'), (SB, 'RIP')]):
            ax.imshow(20 * np.log10(S[:nfr, fsel].T + 1e-6), origin='lower',
                      aspect='auto', vmin=-70, vmax=10, cmap='magma',
                      extent=[0, args.plot_seconds, 0, freqs[fsel][-1] / 1000])
            ax.set_title(f'{args.label} — {tag}'.strip(' —'), fontsize=11)
            ax.set_ylabel('kHz')
            ax.set_xlabel('seconds')
        plt.tight_layout()
        plt.savefig(args.plot, dpi=95)
        print(f"\nwrote {args.plot}")


if __name__ == '__main__':
    main()
