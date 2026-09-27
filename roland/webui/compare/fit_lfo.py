#!/usr/bin/env python3
"""Fit the LFO tables (LFO_T in va-dsp.js) to Zenology.

Every run plays a sine (MEAS SAW, user slot 5, with VA_FORM=3) through an open
filter with velocity and matrix routes off, so the LFO shows up directly as the
note's pitch (or level); LFO1 is key-triggered unless a run says otherwise.
Render (every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \
       --slot 5 --notes 60 --set PCMS_PTL_1.VA_FORM=3 --set PCMT_PTL_1.CUTOFF=1023 \
       --set PCMT_PTL_1.MCTL_1_SENS1=0 --set PCMT_PTL_1.MCTL_2_SENS1=0 \
       --set PCMT_PTL_1.LEVEL_VSENS=0 --set PTL_LFO_1.LFO_1_KEY_TRIG=1 \
       --set PTL_LFO_1.LFO_2_KEY_TRIG=1"
    S="--set PTL_LFO_1.LFO_1_FORM=0"           # SIN
    $Z $S --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --hold 8 --dur 8.2 --param PTL_LFO_1.LFO_1_RATE \
       --values 0,64,128,192,256,320,384,448,512,576,640,704,768,832,896,960,1023 --out renders/lfo/rate
    $Z $S --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --hold 100 --dur 100.2 --param PTL_LFO_1.LFO_1_RATE \
       --values 0,32,64,96,128,160,192,224,256,288,320,352 --out renders/lfo/rate-slow
    $Z $S --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --hold 3 --dur 3.2 --param PTL_LFO_1.LFO_1_RATE \
       --values 896,912,928,944,960,976,992,1000,1008,1016,1020,1023 --out renders/lfo/rate-top
    $Z $S --set PTL_LFO_1.LFO_1_RATE=400 --hold 4 --dur 4.2 --param=PTL_LFO_1.LFO_1_PIT_DEPTH \
       --values=-100,-50,-25,-10,-3,1,3,10,25,50,75,90,100 --out renders/lfo/depth
    $Z $S --set PTL_LFO_1.LFO_1_RATE=400 --hold 4 --dur 4.2 --param=PTL_LFO_1.LFO_1_PIT_DEPTH \
       --values=5,15,20,30,35,40,45,55,60,65,70,80,85,95 --out renders/lfo/depth2
    $Z $S --set PTL_LFO_1.LFO_1_RATE=400 --hold 4 --dur 4.2 --param=PTL_LFO_1.LFO_1_TVA_DEPTH \
       --values=-100,-50,-25,10,25,50,75,100 --out renders/lfo/tva
    $Z --set PTL_LFO_1.LFO_1_FORM=7 --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --set PTL_LFO_1.LFO_1_RATE=640 \
       --repeat 2 --hold 60 --dur 60.2 --param PTL_LFO_1.LFO_1_KEY_TRIG --values 1 --out renders/lfo/shseq
    $Z --set PTL_LFO_1.LFO_1_FORM=9 --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --set PTL_LFO_1.LFO_1_RATE=640 \
       --repeat 2 --hold 20 --dur 20.2 --param PTL_LFO_1.LFO_1_KEY_TRIG --values 1 --out renders/lfo/vsin
    $Z --set PTL_LFO_1.LFO_1_FORM=8 --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --repeat 2 --hold 6 --dur 6.2 \
       --param PTL_LFO_1.LFO_1_RATE --values 128,400,640,900 --out renders/lfo/chs
    $Z $S --set PTL_LFO_1.LFO_1_PIT_DEPTH=50 --set PTL_LFO_1.LFO_1_RATE=512 --repeat 12 --hold 6 \
       --dur 6.2 --param PTL_LFO_1.LFO_1_RATE_DETN --values 32,127 --out renders/lfo/detn

Measured with the same runs but checked by eye rather than fitted (so not
written by this tool): waveforms (form), PHASE_POS (phase), OFFSET (ofst),
delay and fade modes (delay, fade, fmode0-3), key trigger (keytrig, ktoff with
--lead 0.6), LFO2's laws (lfo2, lfo2dep: LFO_2_* in PTL_LFO_1), pan (pan,
span: static PCMT_PTL_1.PAN), TVF depth (tvf: noise through TVF LPF at 512),
PWM (pwm, pwm-pw, pwm-saw, pwm-l1: SQR/SAW at note 48 driven by LFO2). The
notes on LFO and Partial.tick in va-dsp.js record each result.

    uv run --with numpy --with scipy webui/compare/fit_lfo.py            # report
    uv run --with numpy --with scipy webui/compare/fit_lfo.py --write    # update va-dsp.js
    uv run --with numpy --with scipy webui/compare/fit_lfo.py --validate # ours vs Zenology, as traces
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import hilbert

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_runs as vr  # noqa: E402

SR = vr.SR
DSP = ROOT / "webui/static/va-dsp.js"
RUNS = ROOT / "renders/lfo"


def current():
    return json.loads(re.search(r"/\*LFO_TABLES\*/(.*?)/\*END_LFO_TABLES\*/", DSP.read_text(), re.S).group(1))


def manifest(name):
    return json.loads((RUNS / name / "manifest.json").read_text())


def wav(name, v, take=0):
    m = manifest(name)
    f = m["files"][str(v)][str(m["notes"][0])]
    if take:
        f = f.replace(".wav", f"_r{take}.wav")
    _sr, d = wavfile.read(RUNS / name / f)
    d = d.astype(float)
    return d.mean(axis=1) if d.ndim > 1 else d


def onset(x, lead):
    i0 = int((lead - 0.02) * SR)
    a = np.abs(x[i0:i0 + SR])
    return (i0 + int(np.argmax(a > 0.02 * a.max()))) / SR


def pitch(x, note=60, hop=0.002, win=0.004):
    """(times s, semitones from the note): mean instantaneous frequency per window."""
    f = np.diff(np.unwrap(np.angle(hilbert(x)))) * SR / (2 * np.pi)
    n, h = int(win * SR), int(hop * SR)
    c = np.concatenate([[0], np.cumsum(f)])
    idx = np.arange(0, len(f) - n, h)
    fm = (c[idx + n] - c[idx]) / n
    f0 = 440 * 2 ** ((note - 69) / 12)
    return (idx + n / 2) / SR, 12 * np.log2(np.clip(fm, 1, None) / f0)


def amplitude(x, hop=0.002, win=0.008):
    a = np.abs(hilbert(x))
    n, h = int(win * SR), int(hop * SR)
    c = np.concatenate([[0], np.cumsum(a)])
    idx = np.arange(0, len(a) - n, h)
    return (idx + n / 2) / SR, (c[idx + n] - c[idx]) / n


def sine_fit(t, y, hz):
    """Least-squares sine at a known frequency: amplitude, phase (cycles), offset."""
    M = np.stack([np.sin(2 * np.pi * hz * t), np.cos(2 * np.pi * hz * t), np.ones_like(t)], 1)
    x, *_ = np.linalg.lstsq(M, y, rcond=None)
    return np.hypot(x[0], x[1]), np.arctan2(x[1], x[0]) / (2 * np.pi), x[2], np.std(y - M @ x)


def lfo_hz(t, y):
    """Frequency of a sine trajectory: best sine fit over a log grid, then refined.
    Works from ~1 cycle up (the 100 s renders of RATE 0 hold 1.2)."""
    def resid(hz):
        return sine_fit(t, y, hz)[3]
    grid = np.exp(np.linspace(np.log(0.005), np.log(200), 4000))
    grid = grid[grid < 0.5 / (t[1] - t[0])]
    r = np.array([resid(h) for h in grid])
    i = int(np.argmin(r))
    lo, hi = grid[max(0, i - 1)], grid[min(len(grid) - 1, i + 1)]
    for _ in range(40):
        a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        if resid(a) < resid(b):
            hi = b
        else:
            lo = a
    return (lo + hi) / 2


def held(name, v, take=0, fn=pitch, skip=0.05, **kw):
    m = manifest(name)
    x = wav(name, v, take)
    t0 = onset(x, m["lead"])
    t, y = fn(x, **kw)
    sel = (t > t0 + skip) & (t < t0 + m["hold"] - 0.05)
    return t[sel] - t0, y[sel]


def fit_rate():
    rates = {}
    for run in ("rate-slow", "rate", "rate-top"):
        m = manifest(run)
        for v in m["values"]:
            hop = 0.02 if m["hold"] > 20 else 0.0005 if v > 800 else 0.002
            t, y = held(run, v, hop=hop, win=max(hop, 0.004))
            rates.setdefault(v, []).append(lfo_hz(t, y))
    rv = np.array(sorted(rates))
    hz = np.array([np.median(rates[v]) for v in rv])
    body = rv <= 896
    k, c = np.polyfit(rv[body], np.log2(hz[body]), 1)
    f0, per_oct = 2 ** c, 1 / k
    # the periods are whole ms, so refine the law until rounding reproduces
    # every one that reads as a whole ms (a 1 ms miss drifts audibly: 5 st
    # of pitch trace over 8 s at RATE 704)
    per = 1000 / hz
    whole = (np.abs(per - np.round(per)) < 0.05) & body
    best = None
    for a in f0 * (1 + np.linspace(-0.004, 0.004, 161)):
        for b in per_oct + np.linspace(-0.15, 0.15, 121):
            law = 1000 / (a * 2 ** (rv[whole] / b))
            miss = int(np.sum(np.round(law) != np.round(per[whole])))
            err = float(np.sum((law - np.round(per[whole])) ** 2 / per[whole]))
            if best is None or (miss, err) < best[:2]:
                best = (miss, err, a, b)
    miss, _, f0, per_oct = best
    print(f"rate: f = {f0:.5f} x 2^(RATE/{per_oct:.3f}) Hz, rounded to whole ms "
          f"({whole.sum() - miss} of {whole.sum()} whole-ms periods reproduced)")
    for v, h in zip(rv, hz):
        pred = 1000 / round(1000 / (f0 * 2 ** (v / per_oct)))
        print(f"   {v:5d}  {h:9.4f} Hz  period {1000 / h:9.2f} ms   law {pred:9.4f}  ({1200 * np.log2(h / pred):+6.1f} cents)")
    top = [[int(v), int(round(1000 / h))] for v, h in zip(rv, hz) if v >= 992]
    return [round(float(f0), 6), round(float(per_oct), 3)], top


def fit_pitch():
    tab = {}
    for run in ("depth", "depth2"):
        m = manifest(run)
        hz = None
        for v in m["values"]:
            if abs(v) < 10:
                continue                          # too small to read a law from
            t, y = held(run, v)
            hz = hz or lfo_hz(t, y)
            a, *_ = sine_fit(t, y, hz)
            tab.setdefault(abs(v), []).append(a / (abs(v) / 100) ** 2)
    rows = [[d, round(float(np.mean(tab[d])), 1)] for d in sorted(tab)]
    print("pitch: semitones / (depth/100)^2:", rows)
    return [[0, rows[0][1]]] + rows


def fit_tva():
    m = manifest("tva")
    rows = {}
    for v in m["values"]:
        _t, a = held("tva", v, fn=amplitude, skip=0.1)
        rows.setdefault(abs(v), []).append(1 - a.min() / a.max())
    tab = [[0, 0.0]] + [[d, round(float(np.mean(r)), 3)] for d, r in sorted(rows.items())]
    print("tva: fraction removed at full swing:", tab)
    return tab


def fit_random(pitch_tab, hz):
    """S&H, one value per cycle; both takes (repeated notes) must agree."""
    k = np.interp(50, *np.array(pitch_tab).T) * 0.25
    seqs = []
    for take in (0, 1):
        t, y = held("shseq", 1, take, hop=0.004, win=0.008, skip=0)
        n = int((t[-1] - 0.05) * hz)
        seqs.append(np.array([np.median(y[(t > (c + 0.3) / hz) & (t < (c + 0.7) / hz)]) / k for c in range(n)]))
    n = min(map(len, seqs))
    diff = np.max(np.abs(seqs[0][:n] - seqs[1][:n]))
    s = np.clip(seqs[0][:n], -1, 1)
    print(f"random: {n} values, takes agree to {diff:.4f}; mean {s.mean():+.3f} std {s.std():.3f} "
          f"lag-1 corr {np.corrcoef(s[:-1], s[1:])[0, 1]:+.3f}; first {np.round(s[:6], 3)}")
    return [round(float(v), 3) for v in s]


def fit_vsin(pitch_tab, rnd, hz):
    k = np.interp(50, *np.array(pitch_tab).T) * 0.25
    t, y = held("vsin", 1, skip=0)
    amps = []
    for c in range(min(len(rnd), int(t[-1] * hz) - 1)):
        sel = (t > c / hz) & (t < (c + 1) / hz)
        amps.append(sine_fit(t[sel], y[sel], hz)[0] / k)
    r = np.abs(rnd[:len(amps)])
    b, a = np.polyfit(r, amps, 1)
    res = np.std(np.array(amps) - (a + b * r))
    print(f"vsin: amplitude = {a:.3f} + {b:.3f} |random[k]|  (corr {np.corrcoef(r, amps)[0, 1]:.4f}, resid {res:.4f})")
    return [round(float(a), 3), round(float(b), 3)]


def fit_detn(rate):
    """Per-note speed-up. The draws repeat in both runs, scaled by DETN, so
    the scale is the uniform draw's upper bound, estimated from the maximum."""
    m = manifest("detn")
    f0, per_oct = rate
    base = 1000 / round(1000 / (f0 * 2 ** (512 / per_oct)))
    out = {}
    for v in m["values"]:
        ups = []
        for take in range(m.get("repeat", 1)):
            t, y = held("detn", v, take)
            y = y - np.median(y)
            up = np.where((y[:-1] < 0) & (y[1:] >= 0))[0]
            zc = t[up] - y[up] * (t[up + 1] - t[up]) / (y[up + 1] - y[up])
            ups.append(((len(zc) - 1) / (zc[-1] - zc[0]) / base - 1) / (v / 127))
        out[v] = np.array(ups)
        print(f"detn: DETN {v:3d}  (Hz ratio - 1) x 127/DETN per note {np.round(ups, 3)}")
    u = np.unique(np.round(np.concatenate(list(out.values())), 2))
    n = len(u)
    top = float(u.max()) * (n + 1) / n
    print(f"detn: {n} distinct draws, max {u.max():.3f}; uniform bound {top:.3f}")
    return round(top, 3)


def fit_chs(st):
    """Match CHS's level and autocorrelation by rendering our synth through the
    same measurement."""
    stats = lambda y: np.array([y.std(), *(np.corrcoef(y[:-L], y[L:])[0, 1] for L in (1, 2, 3, 5))])
    k = np.interp(50, *np.array(st["pitch"]).T) * 0.25
    zen = []
    m = manifest("chs")
    for v in m["values"]:
        for take in range(m.get("repeat", 1)):
            _t, y = held("chs", v, take, hop=0.001, win=0.002)
            y = y / k
            if np.abs(y).max() < 1.5:            # skip a render the tracker lost
                zen.append(stats(y))
    zen = np.median(zen, axis=0)
    print(f"chs: Zenology std {zen[0]:.3f}, autocorr at 1/2/3/5 ms {np.round(zen[1:], 3)}")
    schema = vr.Schema.load()
    base = vr.base_tone(RUNS / "chs", m, schema)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        def ours(rate, amp=1.0):
            y = []
            for _ in range(2):
                o = vr.render(base, 60, 100, m, m["lead"], tmp, scale={"lfo": {**st, "chs": {"rate": rate, "amp": amp}}})
                t0 = onset(o, m["lead"])
                t, p = pitch(o, hop=0.001, win=0.002)
                sel = (t > t0 + 0.05) & (t < t0 + m["hold"] - 0.05)
                y.append(stats(p[sel] / k))
            return np.mean(y, axis=0)
        best = None
        for rate in (60, 80, 100, 125, 150, 175, 200, 250, 300, 400):
            s = ours(rate)
            err = float(np.sum((s[1:] - zen[1:]) ** 2))
            print(f"   rate {rate:4d} Hz: autocorr {np.round(s[1:], 3)}  err {err:.4f}")
            if best is None or err < best[1]:
                best = (rate, err, s[0])
        rate, _, sd = best
        amp = zen[0] / sd
        check = ours(rate, amp)
        print(f"chs: rate {rate} Hz, amp {amp:.3f} -> std {check[0]:.3f}, autocorr {np.round(check[1:], 3)}")
    return {"rate": rate, "amp": round(float(amp), 3)}


# run -> what to compare: the pitch trace (semitones), the level (dB) or the
# pan (L/R balance, dB); the spectrum runs (tvf, pwm*) go to validate_runs.py
VALIDATE = {
    "pitch": ["rate", "rate-top", "depth", "depth2", "form",       # form 8 = CHS: random, expect ~5 st "phase", "ofst", "delay", "fade",
              "fmode0", "fmode1", "fmode2", "fmode3", "keytrig", "ktoff", "lfo2", "lfo2dep", "shseq", "vsin"],
    "level": ["tva"],
    "pan": ["pan", "span"],
}


def validate():
    """Our synth vs Zenology per render, as traces: mean |diff| over the note
    (and 1.5 s past note-off for the OFF-IN/OFF-OUT fade modes, which act on
    release). fmode0 (ON-IN) needs no release; its render's note-off came
    ~0.3 s late (the DawDreamer glitch), which scored 8 st before the cut."""
    schema = vr.Schema.load()
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for what, runs in VALIDATE.items():
            for run in runs:
                if not (RUNS / run / "manifest.json").is_file():
                    continue
                m = manifest(run)
                base = vr.base_tone(RUNS / run, m, schema)
                g, _, pid = m["param"].partition(".")
                print(f"{run}  ({m['param']}, {what})")
                for v in m["values"]:
                    tone = vr.Tone(base.data, schema)
                    tone.set(g, pid, v)
                    note = m["notes"][0]
                    _sr, zd = wavfile.read(RUNS / run / m["files"][str(v)][str(note)])
                    zd = zd.astype(float)
                    t_on = onset(zd.mean(axis=1), m["lead"])
                    vr.render(tone, note, m["velocity"] or 100, m, t_on, tmp)
                    _sr, od = wavfile.read(tmp / "o.wav")
                    od = od.astype(float)
                    end = t_on + min(m["hold"] + (1.5 if run in ("fmode2", "fmode3") else -0.05), m["dur"] - t_on - 0.05)
                    if what == "pitch":
                        tz, z = pitch(zd.mean(axis=1), note)
                        to, o = pitch(od.mean(axis=1), note)
                    elif what == "level":
                        tz, z = amplitude(zd.mean(axis=1))
                        to, o = amplitude(od.mean(axis=1))
                        z, o = 20 * np.log10(z + 1e-9), 20 * np.log10(o + 1e-9)
                    else:
                        def bal(d):
                            t, l = amplitude(d[:, 0])
                            _, r = amplitude(d[:, 1])
                            # clamped: at +-64 one side is exactly silent in both
                            return t, np.clip(20 * np.log10((l + 1e-9) / (r + 1e-9)), -60, 60)
                        tz, z = bal(zd)
                        to, o = bal(od)
                    sel = (tz > t_on + 0.03) & (tz < end)
                    if what == "pitch":                  # a pitch reading needs a sound
                        ta, az = amplitude(zd.mean(axis=1))
                        tb, ao = amplitude(od.mean(axis=1))
                        sel &= (np.interp(tz, ta, az) > 0.01 * az.max()) & (np.interp(tz, tb, ao) > 0.01 * ao.max())
                    n = min(sel.sum(), len(o))
                    zz, oo = z[sel][:n], np.interp(tz[sel][:n], to, o)
                    if what == "level":                  # level-aligned: the law, not the gain
                        oo = oo - np.median(oo - zz)
                    live = np.isfinite(zz) & np.isfinite(oo) & ((zz > zz.max() - 60) if what == "level" else True)
                    err = float(np.mean(np.abs(zz[live] - oo[live])))
                    swing = float(np.percentile(zz[live], 95) - np.percentile(zz[live], 5))
                    unit = "st" if what == "pitch" else "dB"
                    print(f"   {v:>6}   |diff| {err:6.3f} {unit}   (Zenology swings {swing:6.2f} {unit})")
                    rows.append((run, v, what, err, swing))
    for what in VALIDATE:
        r = [x for x in rows if x[2] == what]
        if r:
            print(f"{what}: {len(r)} renders, median |diff| {np.median([x[3] for x in r]):.3f}, "
                  f"worst {max(r, key=lambda x: x[3])[:2]} {max(x[3] for x in r):.3f}")
    return 0


def fit_smooth(st):
    """The one-pole smoother on the LFO output, by the pitch trace at fast rates
    (where both its lag and its swing loss show)."""
    schema = vr.Schema.load()
    cases = [("rate", 832), ("rate-top", 896), ("rate-top", 960), ("rate-top", 992)]
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        data = []
        for run, v in cases:
            m = manifest(run)
            tone = vr.Tone(vr.base_tone(RUNS / run, m, schema).data, schema)
            tone.set("PTL_LFO_1", "LFO_1_RATE", v)
            x = wav(run, v)
            t_on = onset(x, m["lead"])
            tz, z = pitch(x, hop=0.0005, win=0.001)
            sel = (tz > t_on + 0.05) & (tz < t_on + min(1.5, m["hold"] - 0.05))
            data.append((tone, m, t_on, tz[sel], z[sel]))

        def err(ms):
            e = []
            for tone, m, t_on, tz, z in data:
                o = vr.render(tone, 60, 100, m, t_on, tmp, scale={"lfo": {**st, "smooth": ms}})
                to, p = pitch(o, hop=0.0005, win=0.001)
                e.append(np.mean(np.abs(z - np.interp(tz, to, p))))
            return float(np.mean(e))
        for ms in (0, 0.6, 1.2):
            print(f"   smooth {ms:.1f} ms: pitch trace |diff| {err(ms):.3f} st")
        lo, hi = 0.2, 3.0
        for _ in range(14):
            a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
            if err(a) < err(b):
                hi = b
            else:
                lo = a
        ms = round((lo + hi) / 2, 3)
        print(f"smooth: {ms} ms, pitch trace |diff| {err(ms):.3f} st at RATE {[c[1] for c in cases]}")
    return ms


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--skip-chs", action="store_true", help="keep the current CHS fit (it renders ~40 times)")
    ap.add_argument("--only", choices=["smooth"], help="refit one renders-based entry, keep the rest")
    ap.add_argument("--validate", action="store_true",
                    help="score our synth against every trace run instead of fitting")
    a = ap.parse_args(argv)
    if a.validate:
        return validate()

    st = current()
    if a.only == "smooth":
        st["smooth"] = fit_smooth(st)
        return write(st) if a.write else 0
    st["rate"], st["top"] = fit_rate()
    st["pitch"] = fit_pitch()
    st["tva"] = fit_tva()
    hz = 1000 / round(1000 / (st["rate"][0] * 2 ** (640 / st["rate"][1])))
    st["random"] = fit_random(st["pitch"], hz)
    st["vsin"] = fit_vsin(st["pitch"], np.array(st["random"]), hz)
    st["detn"] = fit_detn(st["rate"])
    if not a.skip_chs:
        st["chs"] = fit_chs(st)
    st["smooth"] = fit_smooth(st)
    return write(st) if a.write else 0


def write(st):
    src = DSP.read_text()
    m = re.search(r"/\*LFO_TABLES\*/(.*?)/\*END_LFO_TABLES\*/", src, re.S)
    DSP.write_text(src[:m.start(1)] + json.dumps(st) + src[m.end(1):])
    print(f"wrote LFO_T into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
