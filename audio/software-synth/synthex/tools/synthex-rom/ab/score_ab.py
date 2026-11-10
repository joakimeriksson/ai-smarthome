#!/usr/bin/env python3
"""Score engine renders against Per Kristian's run-through, preset by preset.

    score_ab.py DATA RENDERS [--set stretch|solo] [--base OTHER.tsv] [--out THIS.tsv] [--no-codec]

DATA and RENDERS as render_ab.ts has them. The hardware is a 56 kb/s mono MP3, so each render goes through
lame at the same rate before it is compared (--no-codec skips that). Every number is level-free:

  spectrum  third-octave band levels over the whole clip, 63 Hz - 8 kHz, each side relative to its own total,
            floored 40 dB under its strongest band: dB rms
  tf        the same bands in 100 ms frames (hop 50 ms), relative to the clip's total, floored 40 dB under the
            strongest cell, over the cells where either side is above the floor: dB rms. A filter sweep or an
            envelope that is off shows here and not in `spectrum`.
  env       the level in 50 ms frames, each side relative to its own mean, floored at -40 dB: dB rms
  cen       the render's spectral centroid minus the hardware's, semitones (log frequency, 63 Hz - 8 kHz)

The render is slid up to +-80 ms to where the level profiles agree best. `score` is the mean of spectrum
and tf. For --set solo a preset's numbers are the means over its solo notes."""
import argparse, subprocess, sys, tempfile, os
from pathlib import Path
import numpy as np, scipy.io.wavfile as wf, scipy.signal as ss

SR = 44100
EDGES = 63 * 2 ** (np.arange(-0.5, 22) / 3)        # 22 third-octave bands centred 63 Hz .. 8 kHz
NAMES = {}
FLOOR = 40      # dB under the strongest band or cell: the recording's hum (60 and 120 Hz) and hiss sit 35-50 dB down

def load(p):
    sr, x = wf.read(str(p))
    x = x.astype(float)
    if x.ndim > 1: x = x.mean(1)
    assert sr == SR, p
    return x / (np.abs(x).max() + 1e-12)

def codec(p, tmp):
    mp3, wav = Path(tmp) / 'a.mp3', Path(tmp) / 'a.wav'
    subprocess.run(['lame', '--quiet', '-b', '56', '-m', 'm', '--resample', '44.1', '--lowpass', '11', str(p), str(mp3)], check=True)
    subprocess.run(['lame', '--quiet', '--decode', str(mp3), str(wav)], check=True)
    return load(wav)

def frames(x, n, hop):
    k = max(1, 1 + (len(x) - n) // hop)
    return np.stack([x[i * hop:i * hop + n] for i in range(k)])

def level(x, n=2205, hop=2205):
    return 10 * np.log10((frames(x, n, hop) ** 2).mean(1) + 1e-12)

def bands(x):
    f, t, S = ss.spectrogram(x, SR, nperseg=4410, noverlap=2205, nfft=8192, window='hann')
    return np.stack([S[(f >= lo) & (f < hi)].sum(0) for lo, hi in zip(EDGES, EDGES[1:])])    # band x frame

def align(h, e):
    a, b = level(h, 441, 441), level(e, 441, 441)
    a, b = np.maximum(a, a.max() - 40), np.maximum(b, b.max() - 40)
    n = min(len(a), len(b))
    best = (1e9, 0)
    for lag in range(-8, 9):
        u, v = (a[lag:n], b[:n - lag]) if lag >= 0 else (a[:n + lag], b[-lag:n])
        d = np.mean(((u - u.mean()) - (v - v.mean())) ** 2)
        best = min(best, (d, lag))
    lag = best[1] * 441            # hw leads by lag: drop lag samples of hw, or of the render if negative
    return (h[lag:], e) if lag >= 0 else (h, e[-lag:])

def compare(h, e):
    h, e = align(h, e)
    n = min(len(h), len(e))
    h, e = h[:n], e[:n]
    H, E = bands(h), bands(e)
    def lt(B):
        d = 10 * np.log10(B.sum(1) / B.sum() + 1e-12)
        return np.maximum(d, d.max() - FLOOR)
    a, b = lt(H), lt(E)
    spectrum = np.sqrt(np.mean((a - b) ** 2))
    def tfl(B):
        d = 10 * np.log10(B / B.sum() + 1e-12)
        return np.maximum(d, d.max() - FLOOR), d.max() - FLOOR
    (a2, fa), (b2, fb) = tfl(H), tfl(E)
    m = (a2 > fa) | (b2 > fb)
    tf = np.sqrt(np.mean((a2 - b2)[m] ** 2))
    la, lb = level(h), level(e)
    la, lb = np.maximum(la - la.max(), -40), np.maximum(lb - lb.max(), -40)
    env = np.sqrt(np.mean(((la - la.mean()) - (lb - lb.mean())) ** 2))
    fc = np.sqrt(EDGES[:-1] * EDGES[1:])
    cen = lambda B: 12 * (B.sum(1) * np.log2(fc)).sum() / B.sum()
    return spectrum, tf, env, cen(E) - cen(H)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('data'); ap.add_argument('renders')
    ap.add_argument('--set', default='stretch'); ap.add_argument('--base'); ap.add_argument('--out')
    ap.add_argument('--no-codec', action='store_true'); ap.add_argument('-q', action='store_true')
    a = ap.parse_args()
    data, ren = Path(a.data), Path(a.renders)
    for line in (data / 'diagnostics.tsv').read_text().splitlines()[1:]:
        w = line.split('\t'); NAMES[int(w[0])] = w[1]
    rows = {}
    with tempfile.TemporaryDirectory() as tmp:
        get = (lambda p: load(p)) if a.no_codec else (lambda p: codec(p, tmp))
        for slot in range(10, 50):
            if a.set == 'solo':
                nf = data / 'full' / f'{slot}-solo.txt'
                text = nf.read_text().strip() if nf.exists() else ''
                if not text: continue
                hw = load(data / 'full' / f'{slot}-hw.wav')
                r = []
                for k, s in enumerate(text.split(',')):
                    t, note, d = map(float, s.split(':'))
                    p = ren / f'{slot}-{k}.wav'
                    if not p.exists(): continue
                    i0 = int((t - 0.1) * SR)
                    seg = hw[max(0, i0):i0 + int((0.1 + min(d, 3)) * SR)]     # up to the note's end: what follows is not solo
                    e = get(p)[:len(seg)]
                    if len(seg) < SR // 4: continue
                    r.append(compare(seg / (np.abs(seg).max() + 1e-12), e))
                if r: rows[slot] = np.mean(r, 0)
            else:
                p = ren / f'{slot}.wav'
                if not p.exists(): continue
                hw = load(data / f'{slot}-hw.wav')
                rows[slot] = np.array(compare(hw, get(p)[:len(hw)]))
    base = {}
    if a.base:
        for line in Path(a.base).read_text().splitlines()[1:]:
            w = line.split('\t'); base[int(w[0])] = float(w[2])
    out = ['slot\tname\tscore\tspectrum\ttf\tenv\tcen' + ('\tvs_base' if base else '')]
    sc = {}
    for slot, (sp, tf, env, cen) in rows.items():
        sc[slot] = (sp + tf) / 2
        out.append(f'{slot}\t{NAMES.get(slot, "")}\t{sc[slot]:.2f}\t{sp:.2f}\t{tf:.2f}\t{env:.2f}\t{cen:+.1f}'
                   + (f'\t{sc[slot] - base[slot]:+.2f}' if slot in base else ''))
    if a.out: Path(a.out).write_text('\n'.join(out) + '\n')
    if not a.q: print('\n'.join(out))
    v = np.array(list(rows.values()))
    msg = f'{len(rows)} presets: score {np.mean(list(sc.values())):.3f}  spectrum {v[:,0].mean():.2f}  tf {v[:,1].mean():.2f}  env {v[:,2].mean():.2f}  |cen| {np.abs(v[:,3]).mean():.2f}'
    if base:
        d = np.array([sc[s] - base[s] for s in sc if s in base])
        msg += f'   vs base {d.mean():+.3f} ({(d < -0.1).sum()} better, {(d > 0.1).sum()} worse)'
    print(msg)

if __name__ == '__main__':
    main()
