#!/usr/bin/env python3
"""Fit the voice-level laws (VOICE_T in va-dsp.js) to Zenology: unison,
Analog Feel, and the per-note randoms (PIT_RND, PAN_RND, Pitch Drift).

Every run plays a sine (MEAS SAW, user slot 5, with VA_FORM=3) through an open
filter with velocity and matrix routes off. Render (every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \
       --slot 5 --set PCMS_PTL_1.VA_FORM=3 --set PCMT_PTL_1.CUTOFF=1023 \
       --set PCMT_PTL_1.MCTL_1_SENS1=0 --set PCMT_PTL_1.MCTL_2_SENS1=0 --set PCMT_PTL_1.LEVEL_VSENS=0"
    $Z --notes 72 --repeat 2 --hold 8 --dur 8.2 --param PCMT_CMN.ANALOG_FEEL \
       --values 0,5,10,20,40,64,127 --out renders/af/af
    $Z --notes 60 --set PCMS_PTL_1.OSC_TYPE=4 --set PCMS_PTL_1.FILTER_TYPE=0 --set PCMT_PTL_1.FILTER_TYPE=1 \
       --set PCMT_PTL_1.CUTOFF=640 --set PCMT_PTL_1.RESO=900 --hold 8 --dur 8.2 \
       --param PCMT_CMN.ANALOG_FEEL --values 0,127 --out renders/af/af-flt
    $Z --tone renders/struct/test.svz#0 --set PCMS_PTL_1.VA_FORM=3 --set PCMS_PTL_2.VA_FORM=3 \
       --set PCMS_PMT.PTL_PHS_LOCK=1 --notes 72 --hold 8 --dur 8.2 \
       --param PCMT_CMN.ANALOG_FEEL --values 0,20,127 --out renders/af/af-pair
    U="--set PCMS_CMN.UNISON_SW=1"
    $Z $U --set PCMS_CMN.UNISON_SIZE=4 --notes 84 --repeat 2 --hold 6 --dur 6.2 \
       --param PCMS_CMN.UNISON_DETN --values 0,5,10,20,50,100 --out renders/af/uni-detn
    $Z $U --set PCMS_CMN.UNISON_DETN=50 --notes 84 --hold 6 --dur 6.2 \
       --param PCMS_CMN.UNISON_SIZE --values 2,3,4,5,6,7,8 --out renders/af/uni-size
    $Z --set PCMS_CMN.UNISON_SIZE=4 --set PCMS_CMN.UNISON_DETN=0 --notes 84 --repeat 3 --hold 3 --dur 3.2 \
       --param PCMS_CMN.UNISON_SW --values 0,1 --out renders/af/uni-sw
    $Z --notes 72 --repeat 8 --hold 0.6 --dur 0.8 --param PCMT_PTL_1.PAN_RND --values 0,32,63 --out renders/af/panrnd
    $Z --notes 72 --repeat 8 --hold 0.6 --dur 0.8 --param PCMT_PTL_1.PIT_RND --values 100,1200 --out renders/af/pitrnd
    $Z --notes 72 --repeat 2 --hold 6 --dur 6.2 --set PCMS_CMN.RND_PIT_NUM=4 \
       --param PCMS_CMN.RND_PIT_VAL --values 0,64,255 --out renders/af/drift
    $Z --notes 72 --repeat 2 --hold 6 --dur 6.2 --set PCMS_CMN.RND_PIT_VAL=255 \
       --param PCMS_CMN.RND_PIT_NUM --values 0,1,8 --out renders/af/drnum
    $Z --notes 72 --repeat 2 --hold 6 --dur 6.2 --param PCMS_CMN.CONDITION --values 0,50,100 --out renders/af/cond

(af-flt, drnum and cond are checked by eye: Analog Feel leaves the filter
alone, RND_PIT_NUM 0 redraws the drift per note, CONDITION moves pitch by ~1
cent at most on a ZEN-Core tone.)

    uv run --with numpy --with scipy webui/compare/fit_voice.py              # report
    uv run --with numpy --with scipy webui/compare/fit_voice.py --write      # update va-dsp.js
    uv run --with numpy --with scipy webui/compare/fit_voice.py --validate   # ours vs Zenology
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
from scipy.optimize import least_squares
from scipy.signal import find_peaks, lfilter

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import fit_lfo as fl  # noqa: E402  (pitch/amplitude traces, onset)
import validate_runs as vr  # noqa: E402

SR = vr.SR
DSP = ROOT / "webui/static/va-dsp.js"
RUNS = ROOT / "renders/af"
LAGS = np.array([0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5])
HOP = 0.005


def current():
    return json.loads(re.search(r"/\*VOICE_TABLES\*/(.*?)/\*END_VOICE_TABLES\*/", DSP.read_text(), re.S).group(1))


def manifest(run):
    return json.loads((RUNS / run / "manifest.json").read_text())


def stereo(run, v, take=0, note=None):
    m = manifest(run)
    note = note or m["notes"][0]
    f = m["files"][str(v)][str(note)]
    if take:
        f = f.replace(".wav", f"_r{take}.wav")
    _sr, d = wavfile.read(RUNS / run / f)
    d = d.astype(float)
    return m, (d if d.ndim > 1 else np.stack([d, d], 1))


def drift_trace(x, lead, note=72, t1=7.9):
    t0 = fl.onset(x, lead)
    t, p = fl.pitch(x, note, hop=HOP, win=0.01)
    sel = (t > t0 + 0.3) & (t < t0 + t1)
    return p[sel] * 100


def stats(g):
    """Sample std and autocorrelation at LAGS of one trace."""
    return np.array([g.std()] + [np.corrcoef(g[:-int(L / HOP)], g[int(L / HOP):])[0, 1] for L in LAGS])


# --- unison -------------------------------------------------------------------

def voices(run, v, take=0):
    """(cents, dB) of each unison voice, from the spectrum of a C6 sine."""
    m, d = stereo(run, v, take)
    t0 = fl.onset(d.mean(axis=1), m["lead"])
    seg = d[int((t0 + 0.2) * SR):int((t0 + m["hold"] - 0.1) * SR)].mean(axis=1)
    n = 1 << 20
    S = np.abs(np.fft.rfft(seg * np.blackman(len(seg)), n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    c = 1200 * np.log2(np.maximum(fr, 1) / (440 * 2 ** ((84 - 69) / 12)))
    sel = (c > -150) & (c < 150)
    s = S[sel]
    pk, _ = find_peaks(s, height=s.max() * 0.05, distance=40)
    return c[sel][pk], 20 * np.log10(s[pk] / s.max())


def level(run, v, take=0):
    m, d = stereo(run, v, take)
    x = d.mean(axis=1)
    t0 = fl.onset(x, m["lead"])
    seg = x[int((t0 + 0.2) * SR):int((t0 + m["hold"] - 0.1) * SR)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)))


def fit_unison():
    rows = []
    for v in (10, 20, 50, 100):
        c, _db = voices("uni-detn", v)
        rows.append(max(abs(c)) / v)
        print(f"unison: DETN {v:3d}, size 4: voices at {np.round(c, 2)} cents")
    for n in (3, 5, 8):
        c, _db = voices("uni-size", n)
        want = np.linspace(-25, 25, n)
        print(f"unison: size {n}, DETN 50: voices at {np.round(c, 2)}  (evenly spaced: {np.round(want, 2)})")
    detune = float(np.mean(rows))
    ref = level("uni-sw", 0)
    per = []
    for n in range(2, 9):
        dl = level("uni-size", n) - ref
        # N detuned voices add in power: dl = 10 log N + 20 log g, g = 10^(k (N-1) / 20)
        per.append((dl - 10 * np.log10(n)) / (n - 1))
        print(f"unison: size {n}: {dl:+.2f} dB over one voice -> {per[-1]:+.3f} dB per extra voice")
    gain = float(np.mean(per))
    print(f"unison: outer voice at +-{detune:.4f} x DETN cents; {gain:+.3f} dB per extra voice")
    # DETN 0: the voices share one frequency but not one phase - the level is
    # steady, 7-8 dB up where in-phase voices would give +9. For start phases
    # uniform in +-a cycles, E|sum|^2 = N + N(N-1) sinc^2(2a); solve for a
    m = manifest("uni-sw")
    s2 = [(10 ** ((level("uni-sw", 1, k) - ref) / 20) / 10 ** (gain * 3 / 20)) ** 2 for k in range(m["repeat"])]
    sinc = np.sqrt(max(0.0, (np.mean(s2) - 4) / 12))
    xs = np.linspace(1e-4, np.pi, 100000)
    a = float(xs[np.argmin(np.abs(np.sin(xs) / xs - sinc))] / (2 * np.pi))
    print(f"unison: DETN 0, size 4: |sum of voices| {np.round(np.sqrt(s2), 2)} of 4 -> start phases in +-{a:.3f} cycles")
    return round(detune, 4), round(gain, 3), round(a, 3)


# --- Analog Feel --------------------------------------------------------------

def simulate(af, n_runs, seconds, rng):
    """Sample stats of the synth's drift model over traces as long as ours."""
    n = int(seconds / HOP)
    out = []
    for _ in range(n_runs):
        g = np.zeros(n)
        for t, w in ((af["t1"], af["w"]), (af["t2"], 1 - af["w"])):
            if w <= 0:
                continue
            a = np.exp(-HOP / t)
            v = (1 - a) ** 4 * (1 + a * a) / (1 - a * a) ** 3 / 3
            x = rng.uniform(-1, 1, n)
            y0 = rng.standard_normal() * np.sqrt(v)           # a stationary start, as the synth
            y1, _ = lfilter([1 - a], [1, -a], x, zi=[a * y0])
            ys, _ = lfilter([1 - a], [1, -a], y1, zi=[a * y0])
            g += ys * np.sqrt(w / v)
        out.append(stats(g * af["sd"]))
    return np.mean(out, axis=0)


def fit_af():
    m = manifest("af")
    zen = []
    for take in range(m.get("repeat", 1)):
        g = drift_trace(stereo("af", 127, take)[1].mean(axis=1), m["lead"]) / 127
        zen.append(stats(g))
        print(f"analog feel: take {take}: rms {zen[-1][0]:.3f} cents per AF unit, autocorr {np.round(zen[-1][1:], 3)}")
    # linear in AF: every take at every AF is the same curve, scaled
    for v in (5, 20, 64):
        for take in range(m.get("repeat", 1)):
            a = drift_trace(stereo("af", v, take)[1].mean(axis=1), m["lead"])
            b = drift_trace(stereo("af", 127, take)[1].mean(axis=1), m["lead"]) * v / 127
            k = min(len(a), len(b))
            print(f"analog feel: AF {v:3d} take {take} = AF 127 x {v}/127 to {np.std(a[:k] - b[:k]):.2f} cents "
                  f"(corr {np.corrcoef(a[:k], b[:k])[0, 1]:.4f})")
    zen = np.mean(zen, axis=0)
    seconds = 7.6

    def resid(p):
        af = {"sd": p[0], "t1": p[1], "t2": p[2], "w": p[3]}
        s = simulate(af, 24, seconds, np.random.default_rng(1))
        return np.concatenate([[(s[0] - zen[0]) / zen[0] * 2], s[1:] - zen[1:]])
    r = least_squares(resid, [0.3, 0.1, 1.0, 0.6], bounds=([0.05, 0.02, 0.2, 0.0], [2, 1.0, 10, 1.0]),
                      diff_step=0.05)
    af = {"sd": round(float(r.x[0]), 4), "t1": round(float(r.x[1]), 4),
          "t2": round(float(r.x[2]), 4), "w": round(float(r.x[3]), 4)}
    s = simulate(af, 48, seconds, np.random.default_rng(2))
    print(f"analog feel: model {af}\n   Zenology rms {zen[0]:.3f}, autocorr {np.round(zen[1:], 3)}"
          f"\n   model    rms {s[0]:.3f}, autocorr {np.round(s[1:], 3)}")
    return af


# --- per-note randoms ---------------------------------------------------------

def pan_of(d, t0):
    a, b = int((t0 + 0.05) * SR), int((t0 + 0.5) * SR)
    L, R = np.sqrt(np.mean(d[a:b, 0] ** 2)), np.sqrt(np.mean(d[a:b, 1] ** 2))
    r = min(L, R) / max(L, R)
    q = np.linspace(0, 1, 10001)
    p = q[np.argmax((1 - q) / np.minimum(1 + q, 1.427) <= r)]    # the measured pan law
    return (p if R >= L else -p) * 63


def fit_randoms():
    m = manifest("pitrnd")
    u = {}
    for v in m["values"]:
        cs = []
        for take in range(m["repeat"]):
            _m, d = stereo("pitrnd", v, take)
            x = d.mean(axis=1)
            t0 = fl.onset(x, m["lead"])
            t, p = fl.pitch(x, 72, hop=0.01, win=0.04)
            cs.append(np.median(p[(t > t0 + 0.1) & (t < t0 + 0.5)]) * 100 / v)
        u[v] = np.array(cs)
        print(f"PIT_RND {v:4d}: offset / depth per note {np.round(cs, 3)}")
    print(f"PIT_RND: the draws agree across depths to {np.max(np.abs(u[100] - u[1200])):.3f}; |u| max {np.abs(u[1200]).max():.3f}")
    m = manifest("panrnd")
    pans = {}
    for v in m["values"]:
        pans[v] = []
        for take in range(m["repeat"]):
            _m, d = stereo("panrnd", v, take)
            pans[v].append(pan_of(d, fl.onset(d.mean(axis=1), m["lead"])))
        print(f"PAN_RND {v:3d}: pan per note {np.round(pans[v], 1)}")
    k = np.array(pans[32]) / 32
    top = float(np.abs(k).max())
    print(f"PAN_RND: offset / depth at 32 reaches {top:.2f} (8 notes); at 63 the same draws x 63/32, clamped")
    m = manifest("drift")
    offs = []
    for v in m["values"]:
        if not v:
            continue
        _m, d = stereo("drift", v)
        x = d.mean(axis=1)
        t0 = fl.onset(x, m["lead"])
        t, p = fl.pitch(x, 72, hop=0.01, win=0.02)
        offs.append(np.median(p[(t > t0 + 0.1) & (t < t0 + 5.9)]) * 100 / v)
        print(f"Pitch Drift {v:3d}: {offs[-1] * v:+.2f} cents ({offs[-1]:+.4f} per unit)")
    return 1.0, 2.0 if top <= 2 else round(top, 2), round(float(np.max(np.abs(offs))), 4)


# --- validation ---------------------------------------------------------------

def validate():
    """Ours vs Zenology: the unison spectra and levels, and Analog Feel's beat
    between two identical sines (a statistic, since both drifts are random)."""
    schema = vr.Schema.load()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for run in ("uni-size", "uni-detn", "uni-saw"):
            m = manifest(run)
            base = vr.base_tone(RUNS / run, m, schema)
            g, _, pid = m["param"].partition(".")
            for v in m["values"]:
                tone = vr.Tone(base.data, schema)
                tone.set(g, pid, v)
                note = m["notes"][0]
                z = vr.load(RUNS / run / m["files"][str(v)][str(note)])
                t_on = vr.onset(z, m["lead"])
                o = vr.render(tone, note, m["velocity"] or 100, m, t_on, tmp)
                a, b = int((t_on + 0.2) * SR), int((t_on + m["hold"] - 0.1) * SR)
                lz, lo = (20 * np.log10(np.sqrt(np.mean(y[a:b] ** 2))) for y in (z, o))
                bz, bo = vr.bands(z[a:b]), vr.bands(o[a:b])
                keep = bz > bz.max() - 50
                dd = (bo - bz)[keep]
                print(f"{run} {v:4d}: level {lo - lz:+.2f} dB, spectrum {np.mean(np.abs(dd - np.median(dd))):.2f} dB")
        m = manifest("af-pair")
        base = vr.base_tone(RUNS / "af-pair", m, schema)
        for v in m["values"]:
            tone = vr.Tone(base.data, schema)
            tone.set("PCMT_CMN", "ANALOG_FEEL", v)
            z = vr.load(RUNS / "af-pair" / m["files"][str(v)]["72"])
            t_on = vr.onset(z, m["lead"])
            rows = []
            for y in [z] + [vr.render(tone, 72, 100, m, t_on, tmp) for _ in range(4 if v else 1)]:
                ta, amp = fl.amplitude(y, hop=0.01, win=0.02)
                db = 20 * np.log10(amp[(ta > t_on + 0.3) & (ta < t_on + 7.9)] + 1e-9)
                seg = y[int((t_on + 0.3) * SR):int((t_on + 7.9) * SR)]
                rows.append((20 * np.log10(np.sqrt(np.mean(seg ** 2))), db.std()))
            (lz, sz), ours = rows[0], np.array(rows[1:])
            print(f"af-pair AF {v:3d}: Zenology level {lz:.2f} dB, beat {sz:.2f} dB rms | ours level "
                  f"{ours[:, 0].mean():.2f} dB (+-{ours[:, 0].std():.2f}), beat {ours[:, 1].mean():.2f} dB rms")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--validate", action="store_true")
    a = ap.parse_args(argv)
    if a.validate:
        return validate()
    st = current()
    st["uniDetune"], st["uniGain"], st["uniPhase"] = fit_unison()
    st["af"] = fit_af()
    st["pitRnd"], st["panRnd"], st["drift"] = fit_randoms()
    print(json.dumps(st))
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*VOICE_TABLES\*/(.*?)/\*END_VOICE_TABLES\*/", src, re.S)
        DSP.write_text(src[:m.start(1)] + json.dumps(st) + src[m.end(1):])
        print(f"wrote VOICE_T into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
