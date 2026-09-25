#!/usr/bin/env python3
"""Fit Zenology's amp envelope (TVA) from sine renders made with zen_bank.py.

A sine (VA_FORM SIN) with the filter open makes the amplitude envelope easy to
read. Render, per ADSR switch setting (slot 5 = "MEAS SAW", every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
       --slot 5 --notes 60 --set PCMS_PTL_1.VA_FORM=3 --set PCMT_PTL_1.CUTOFF=1023"
    V=0,128,256,384,512,640,768,896,1023
    E="--set PTL_AENV_1.L1=1023 --set PTL_AENV_1.L2=1023"
    # ADSR off (renders/aenv) - and the same four with ADSR_ENV_SW=1 into renders/adsr
    $Z --set PCMS_PTL_1.ADSR_ENV_SW=0 $E --hold 30 --dur 31 --set PTL_AENV_1.T2=0 \\
       --set PTL_AENV_1.T3=0 --set PTL_AENV_1.T4=0 --set PTL_AENV_1.L3=1023 \\
       --param PTL_AENV_1.T1 --values $V --out renders/aenv/attack
    $Z --set PCMS_PTL_1.ADSR_ENV_SW=0 $E --hold 1.0 --dur 31 --set PTL_AENV_1.T1=0 \\
       --set PTL_AENV_1.T2=0 --set PTL_AENV_1.T3=0 --set PTL_AENV_1.L3=1023 \\
       --param PTL_AENV_1.T4 --values $V --out renders/aenv/release
    $Z --set PCMS_PTL_1.ADSR_ENV_SW=0 $E --hold 2.0 --dur 2.4 --set PTL_AENV_1.T1=0 \\
       --set PTL_AENV_1.T2=0 --set PTL_AENV_1.T3=0 --set PTL_AENV_1.T4=0 \\
       --param PTL_AENV_1.L3 --values 0,32,64,128,256,384,512,640,768,896,1023 --out renders/aenv/level
    $Z --set PCMS_PTL_1.ADSR_ENV_SW=0 $E --hold 30 --dur 31 --set PTL_AENV_1.T1=0 \\
       --set PTL_AENV_1.T2=0 --set PTL_AENV_1.T4=0 --set PTL_AENV_1.L3=0 \\
       --param PTL_AENV_1.T3 --values $V --out renders/aenv/decay

    uv run --with numpy --with scipy webui/compare/fit_env.py            # report
    uv run --with numpy --with scipy webui/compare/fit_env.py --write    # update va-dsp.js

ADSR on (renders/adsr: the same sweeps, ADSR_ENV_SW=1; the guide: T2, L1, L2
are ignored), measured 2026-09-26:
  level      linear amplitude, L3 / 1023
  attack     to full level with its own curve (c2) and time table
  decay and  an analog-style RC fall: aimed delta below the target and stopped
  release    at it, tau = T / x, T from the shared time table, x and delta
             fitted. The decay's tau scales with the distance (a half-range
             decay takes half the time); the release's does not (from half
             level it falls at the same dB rate as from full)

Pitch envelope (renders/penv, a sine's instantaneous pitch; depth sweeps at
L3 = 256 with every time 0):

    $Z --set PCMS_PTL_1.ADSR_ENV_SW=0 --set PTL_PENV_1.T1=0 --set PTL_PENV_1.T2=0 \
       --set PTL_PENV_1.T3=0 --set PTL_PENV_1.L0=0 --set PTL_PENV_1.L1=0 --set PTL_PENV_1.L2=0 \
       --set PTL_PENV_1.L3=256 --hold 1.5 --dur 1.7 \
       --param=PTL_PENV_1.DEPTH --values=1,3,6,9,12,18,25,31,37,44,50,56,60,63,64,66,70,75,82,88,94,97,100 \
       --out renders/penv/depth2
  pdepth     semitones at full level (511) per depth; linear in level. Its
             segments are straight lines over the shared time table (T1 too),
             and in ADSR mode it follows the amp ADSR model - the synth's Env
             comment has the evidence.

ADSR off, as measured 2026-09-26:
  level      amplitude = (2^(L/b) - 1) / (2^(1023/b) - 1), b fitted (~125.6)
  attack     from 0: amplitude (1 - e^(-c s)) / (1 - e^(-c)) of its target,
             s = t / Tattack(T1) - its own time table
  other      T2, T3, T4 ramp L linearly between levels over the FULL time of
             the table, whatever the distance (a half-range decay takes all
             of it); the time table is shared by decay and release
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
from scipy.optimize import least_squares
from scipy.signal import hilbert

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
DSP = ROOT / "webui/static/va-dsp.js"


def envelope(path, smooth_ms=4):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    if np.abs(x).max() > 2:
        x /= 32768
    a = np.abs(hilbert(x))
    n = max(1, int(smooth_ms * SR / 1000))
    return np.convolve(a, np.ones(n) / n, mode="same")


def run(name):
    d = ROOT / name
    m = json.loads((d / "manifest.json").read_text())
    return m, {v: d / m["files"][str(v)][str(m["notes"][0])] for v in m["values"]}


def level_law(b):
    return lambda L: (2 ** (np.asarray(L, float) / b) - 1) / (2 ** (1023 / b) - 1)


def fit_level(name):
    m, files = run(name)
    t1 = m["lead"] + m["hold"]
    lv = {v: np.median(envelope(p)[int((t1 - 0.3) * SR):int((t1 - 0.05) * SR)]) for v, p in files.items()}
    L = np.array([v for v in lv if v >= 32], float)
    rel = np.array([20 * np.log10(lv[int(v)] / lv[1023]) for v in L])
    sol = least_squares(lambda p: 20 * np.log10(level_law(p[0])(L)) - rel, [128])
    b = float(sol.x[0])
    print(f"level law b = {b:.2f}")
    for v, r in zip(L, rel):
        print(f"  L {int(v):5d}  measured {r:7.2f} dB  law {20 * np.log10(level_law(b)(v)):7.2f}")
    return b


def fit_attack(name):
    m, files = run(name)
    lead = m["lead"]
    curves = {}
    for v, p in files.items():
        if v == 0:
            continue
        e = envelope(p)
        fin = e[int((lead + m["hold"] - 4) * SR):int((lead + m["hold"] - 1) * SR)].mean()
        t = np.arange(int(lead * SR), int((lead + m["hold"] - 1) * SR), 64)
        curves[v] = (t / SR - lead, e[t] / fin)
    shape = lambda tt, T, c: (1 - np.exp(-c * np.clip(tt / T, 0, 1))) / (1 - np.exp(-c))
    x0 = [1.0] + [np.log(max(0.01, tt[np.argmax(a >= 0.99)])) for tt, a in curves.values()]
    # a fixed window per curve (from its 99% time), so the residual keeps its length
    wins = [tt < np.exp(x) * 1.3 for x, (tt, _a) in zip(x0[1:], curves.values())]
    def resid(p):
        return np.concatenate([shape(tt[w], np.exp(p[1 + i]), p[0]) - a[w]
                               for i, ((tt, a), w) in enumerate(zip(curves.values(), wins))])
    sol = least_squares(resid, x0)
    c = float(sol.x[0])
    times = {v: float(np.exp(sol.x[1 + i])) for i, v in enumerate(curves)}
    # setting 0: the time to 99%, which the shape reaches at s ~ 1
    e0 = envelope(files[0])
    fin = e0[int((lead + 1) * SR):int((lead + 2) * SR)].mean()
    times[0] = float(np.argmax(e0[int(lead * SR):] >= 0.99 * fin) / SR)
    print(f"attack shape c = {c:.3f}  (rms {np.sqrt(np.mean(resid(sol.x) ** 2)):.4f})")
    return c, dict(sorted(times.items()))


def fit_fall(name, b, start_level=None, skip=()):
    """T for segments that ramp L linearly to 0 over the full time."""
    m, files = run(name)
    t0 = m["lead"] + (m["hold"] if start_level is None else 0)
    g = level_law(b)
    out = {}
    for v, p in files.items():
        if v in skip or v == 0:
            continue
        e = envelope(p, smooth_ms=1)
        full = (np.median(e[int((t0 - 0.3) * SR):int((t0 - 0.05) * SR)]) if start_level is None
                else e[int((t0 + 0.003) * SR):int((t0 + 0.01) * SR)].max())
        t = np.arange(int(t0 * SR), min(len(e), int((t0 + 29) * SR)), 16)
        tt, a = t / SR - t0, e[t] / full
        mk = a > 0.01
        fn = lambda q: (20 * np.log10(g(1023 * np.clip(1 - tt[mk] / np.exp(q[0]), 0, 1)) + 1e-6)
                        - 20 * np.log10(a[mk]))
        guess = 0.002048 * v if v <= 384 else 0.77 * 2 ** ((v - 384) / 124)
        best = min((least_squares(fn, [np.log(guess * f)]) for f in (0.7, 1.0, 1.4)), key=lambda s: s.cost)
        out[v] = (float(np.exp(best.x[0])), float(np.sqrt(np.mean(fn(best.x) ** 2))))
    return out


def semitones_at(path, t, note=60):
    """Median pitch of a sine render around time t, semitones from the note."""
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    f = np.diff(np.unwrap(np.angle(hilbert(x)))) * SR / (2 * np.pi)
    i = int(t * SR)
    # the mean: raw instantaneous frequency ripples asymmetrically, so its median
    # is biased (~0.13 semitone low on a steady C4); the mean is exact
    return float(12 * np.log2(np.mean(f[i:i + 4410]) / (440 * 2 ** ((note - 69) / 12))))


def interp_time(table, v):
    xs, ys = zip(*table)
    if v <= 384:
        return float(np.interp(v, xs, ys))
    return float(2 ** np.interp(v, xs, np.log2(ys)))


def fit_rc(names, time):
    """ADSR decay/release from full level to 0: a = (1+d) e^(-t/tau) - d, stopped
    at 0, tau = T / x with T the shared time table. One x and d over all runs."""
    curves = []
    for name in names:
        m, files = run(name)
        release = "T4" in m["param"]
        t0 = m["lead"] + (m["hold"] if release else 0)
        for v, p in files.items():
            if v == 0:
                continue
            e = envelope(p, smooth_ms=1)
            full = (np.median(e[int((t0 - 0.3) * SR):int((t0 - 0.05) * SR)]) if release
                    else e[int((t0 + 0.003) * SR):int((t0 + 0.01) * SR)].max())
            t = np.arange(int(t0 * SR), min(len(e), int((t0 + 29) * SR)), 16)
            tt, a = t / SR - t0, e[t] / full
            # down to -60 dB: the RC's end - where it cuts to silence - sets delta
            mk = a > 0.001
            curves.append((name, v, tt[mk], a[mk], interp_time(time, v)))
    def model(tt, T, x, d):
        return np.clip((1 + d) * np.exp(-tt * x / T) - d, 1e-6, None)
    def resid(p):
        return np.concatenate([20 * np.log10(model(tt, T, p[0], p[1])) - 20 * np.log10(a)
                               for _n, _v, tt, a, T in curves])
    sol = least_squares(resid, [4.3, 0.01], bounds=([0.5, 1e-5], [20, 0.5]))
    x, d = map(float, sol.x)
    print(f"\nADSR decay/release: tau = T / {x:.3f}, aimed {d:.4f} below the target")
    for n, v, tt, a, T in curves:
        r = np.sqrt(np.mean((20 * np.log10(model(tt, T, x, d)) - 20 * np.log10(a)) ** 2))
        print(f"  {n.split('/')[-1]:8s} {v:5d}  T {T:8.4f}  rms {r:.2f} dB")
    return x, d, curves


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)

    b = fit_level("renders/aenv/level")
    c, attack = fit_attack("renders/aenv/attack")
    rel = fit_fall("renders/aenv/release", b)
    dec = fit_fall("renders/aenv/decay", b, start_level=1023)
    extra = ROOT / "renders/aenv/release-768"      # a re-render; the first 768 glitched
    if (extra / "manifest.json").is_file():
        rel.update(fit_fall("renders/aenv/release-768", b))
    # DawDreamer occasionally glitches a render's note timing (2026-09-26: the 7th
    # render of aenv/release and of adsr/level - late or missing note-off);
    # renders/aenv/release-768 re-renders the first.
    print("\n  value   attack T (s)   decay/release T (s)")
    time = {}
    for v in sorted(set(rel) | set(dec) | set(attack)):
        ts = [x[0] for x in (rel.get(v), dec.get(v)) if x]
        if ts:
            time[v] = float(np.median(ts))
        print(f"  {v:5d}   {attack.get(v, float('nan')):10.4f}     "
              + "  ".join(f"{k} {x[0]:.4f} ({x[1]:.2f} dB)" for k, x in (("release", rel.get(v)), ("decay", dec.get(v))) if x))
    # setting 0 is not the ramp: a middle segment (T2/T3) at 0 is ~3 ms (the
    # zero-time level runs reach the sustain by ~5 ms), a release (T4) at 0 a
    # ~13 ms fade (-6 dB at 4.5 ms, -40 dB at 9.5 ms)
    time[0] = 0.003
    release0 = 0.013
    tables = {"b": round(b, 3), "c": round(c, 4),
              "attack": [[int(v), round(t, 5)] for v, t in sorted(attack.items())],
              "time": [[int(v), round(t, 5)] for v, t in sorted(time.items())],
              "release0": release0}
    # pitch envelope depth law
    pd = {0: 0.0}
    for name in ("renders/penv/depth", "renders/penv/depth2"):
        if (ROOT / name / "manifest.json").is_file():
            m, files = run(name)
            level = m["fixed"].get("PTL_PENV_1.L3", 256)
            for v, path in files.items():
                if v > 0:
                    pd[v] = semitones_at(path, 0.8) * 511 / level
    if len(pd) > 1:
        print("\npitch envelope: semitones at full level per depth")
        print("  " + "  ".join(f"{d}:{x:.2f}" for d, x in sorted(pd.items())))
        tables["pdepth"] = [[int(d), round(float(x), 3)] for d, x in sorted(pd.items())]

    # ADSR on
    if (ROOT / "renders/adsr/attack/manifest.json").is_file():
        c2, attack2 = fit_attack("renders/adsr/attack")
        x, delta, fits = fit_rc(["renders/adsr/decay", "renders/adsr/release"], sorted(time.items()))
        tables.update({"adsr": {"c": round(c2, 4),
                                "attack": [[int(v), round(t, 5)] for v, t in sorted(attack2.items())],
                                "x": round(x, 4), "delta": round(delta, 5)}})
    print(json.dumps(tables))
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*ENV_TABLES\*/(.*?)/\*END_ENV_TABLES\*/", src, re.S)
        if not m:
            raise SystemExit("ENV_TABLES markers not found in va-dsp.js")
        cur = json.loads(m.group(1) or "{}")
        body = json.dumps({**cur, **tables}, separators=(", ", ": "))
        DSP.write_text(src[:m.start(1)] + body + src[m.end(1):])
        print(f"wrote ENV tables into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
