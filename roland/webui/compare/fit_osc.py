#!/usr/bin/env python3
"""Capture Zenology's VA waveforms as harmonic tables for va-dsp.js.

Zenology normalises its waveforms by level, and five of them (RAMP, JUNO,
TRI2, TRI3, SIN2) are shapes no formula here reproduced. So rather than guess,
this reads each waveform's harmonics - amplitude and phase - from renders with
the filter open and PW exactly 64, and writes them as tables the synth plays
back band-limited. Render (slot 5 = "MEAS SAW", every host quit; the
velocity -> PW route is switched off so PW stays at 64):

    uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
        --slot 5 --notes 24,36,48,60,72,84 --set PCMT_PTL_1.CUTOFF=1023 \\
        --set PCMT_PTL_1.MCTL_1_SENS1=0 \\
        --param PCMS_PTL_1.VA_FORM --values 0,1,2,3,4,5,6,7,8 --out renders/osc/octaves

    uv run --with numpy --with scipy webui/compare/fit_osc.py            # report
    uv run --with numpy --with scipy webui/compare/fit_osc.py --write    # update va-dsp.js

Levels are relative to Zenology's SAW, scaled so its fundamental equals that of
the synth's analytic +-1 saw (2/pi): every table then sits at Zenology's level
next to the saw. One table per waveform per octave (C1-C6): the low harmonics
do not change with pitch, but Zenology's top-end roll-off does (at 8 kHz a C2
saw is 5.6 dB below 1/k, a C4 saw 2.3 dB), so each octave keeps its own. The
synth plays the nearest one, band-limited to the pitch it plays at.

DawDreamer sometimes starts a note late or never releases it; the steady
stretch is found from each render, so those renders still work.

The harmonics are read at each render's TRUE pitch, measured from the SAW at
that note: Zenology rounds an oscillator's frequency to a multiple of
44100 / 2^20 Hz (0.042 Hz - C1 plays 0.91 cents sharp, C2 and C3 0.20 flat).
Reading at the nominal pitch instead smears the upper harmonics away over the
window (the first capture, 2026-09-26, lost 5 dB by harmonic 32 of C1 that way
and everything above harmonic ~55).

    uv run --with numpy --with scipy webui/compare/fit_osc.py --validate # ours vs Zenology
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

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
DSP = ROOT / "webui/static/va-dsp.js"
FORMS = ["SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"]
# SAW and SQR are tabled too: the synth plays their tables when PW is fixed at
# 64 and unmodulated, and its analytic (PW-following) versions otherwise
#: cosine phase of each table's fundamental at p = 0. Zenology's VA SAW FALLS
#: (measured: phi_k - k phi_1 = 0, +pi/2, pi, -pi/2 ...), so it is anchored to
#: the falling saw 1 - 2p, fundamental +(2/pi) sin 2 pi p - which is also what
#: the analytic PW morph plays. The rest start like a sine.
FUND_PHASE = {"SAW": -np.pi / 2}
TABLED = ["SAW", "SQR", "TRI", "SIN", "RAMP", "JUNO", "TRI2", "TRI3", "SIN2"]


def steady(x, hold_end):
    """Start and end (s) of the steady part: from 0.25 s after the note starts
    to shortly before it is released (or the render ends, if it never is)."""
    hop = 441
    rms = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    onset = np.argmax(rms > 0.5 * rms.max()) * hop / SR
    after = int(min(len(rms) - 1, (hold_end + 0.25) * SR / hop))
    end = (len(x) / SR - 0.05) if rms[after] > 0.5 * rms.max() else hold_end - 0.05
    return onset + 0.25, end


#: Zenology's oscillator frequency step: a 20-bit phase increment at 44.1 kHz
PITCH_STEP = 44100 / 2 ** 20


def read(path):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    return x / 32768 if d.dtype.kind == "i" else x


def true_f0(x, note, hold_end):
    """The pitch a harmonically rich render really plays, refined on rising
    harmonics (each step locates harmonic k to a small fraction of a bin)."""
    t0, end = steady(x, hold_end)
    seg = x[int(t0 * SR):int(end * SR)]
    n = len(seg)
    t = np.arange(n) / SR
    w = np.hanning(n)
    f = 440 * 2 ** ((note - 69) / 12)
    for k in (1, 4, 16, 64, 256):
        if k * f > 16000:
            break
        grid = k * f + np.linspace(-0.6, 0.6, 241) * SR / n          # +-0.6 bin
        mag = [np.abs(np.sum(seg * w * np.exp(-2j * np.pi * g * t))) for g in grid]
        f = grid[int(np.argmax(mag))] / k
    return f


def harmonics(path, note, count, hold_end, periods=32, per=2048, f0=None):
    """Amplitude and phase of harmonics 1..count over an exact number of periods
    of f0 (the render's true pitch; nominal if not given)."""
    x = read(path)
    f0 = f0 or 440 * 2 ** ((note - 69) / 12)
    count = min(count, int(0.49 * SR / f0))
    t0, end = steady(x, hold_end)
    periods = max(4, min(periods, int((end - t0) * f0)))
    P = SR / f0
    idx = t0 * SR + np.arange(periods * per) * (P / per)
    seg = np.interp(idx, np.arange(len(x)), x)
    spec = np.fft.rfft(seg) / (periods * per / 2)
    k = np.arange(1, count + 1)
    h = spec[k * periods]
    # np.interp resamples by linear interpolation, which low-passes the signal
    # by sinc^2(f / SR) (-1.5 dB at 10 kHz, -3.5 dB at 15 kHz); undo it
    h = h / np.sinc(k * f0 / SR) ** 2
    amp, ph = np.abs(h), np.angle(h)
    # phases relative to the fundamental, so the table starts where it does
    ph = np.mod(ph - k * ph[0] + np.pi, 2 * np.pi) - np.pi
    return amp, ph


def validate(m, run, notes, hold_end, pitch):
    """Ours vs Zenology per waveform and octave, each read at its own pitch:
    level = the fundamental, shape = harmonics 2.. relative to it (those within
    50 dB of the strongest), mean |dB| and the worst one."""
    import tempfile
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import validate_runs as vr
    schema = vr.Schema.load()
    base = vr.base_tone(run, m, schema)
    g, _, pid = m["param"].partition(".")
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        print("\n  form  note   pitch ours-zen   level     shape mean / worst (harmonic)   harmonics")
        for form in FORMS:
            for note in notes:
                tone = vr.Tone(base.data, schema)
                tone.set(g, pid, FORMS.index(form))
                vr.render(tone, note, m["velocity"] or 1, m, m["lead"], tmp, float32=True)
                # up to 16 kHz: above it our band limit drops a top harmonic or two
                count = min(900, int(16000 // pitch[note]))
                az, _ = harmonics(run / m["files"][str(FORMS.index(form))][str(note)], note, count,
                                  hold_end, f0=pitch[note])
                if form == "SAW":
                    ours_f0 = true_f0(read(tmp / "o.wav"), note, hold_end)
                    cents = 1200 * np.log2(ours_f0 / pitch[note])
                    validate.f0 = {**getattr(validate, "f0", {}), note: ours_f0}
                ao, _ = harmonics(tmp / "o.wav", note, count, hold_end, f0=validate.f0[note])
                level = 20 * np.log10(ao[0] / az[0])
                keep = az > az.max() * 10 ** (-50 / 20)
                keep[0] = False
                d = 20 * np.log10((ao[keep] + 1e-12) / az[keep]) - level
                kk = np.nonzero(keep)[0] + 1
                worst = int(np.argmax(np.abs(d))) if len(d) else 0
                rows.append((form, note, level, float(np.mean(np.abs(d))) if len(d) else 0.0,
                             float(np.abs(d).max()) if len(d) else 0.0))
                print(f"  {form:5s} {note:4d}   {cents if form == 'SAW' else 0:+6.2f} c      {level:+5.2f} dB   "
                      f"{rows[-1][3]:5.2f} / {rows[-1][4]:5.2f} dB" + (f" (k={kk[worst]})" if len(d) else "")
                      + f"   {keep.sum()}")
    lv = np.array([abs(r[2]) for r in rows]); sh = np.array([r[3] for r in rows])
    print(f"\n{len(rows)} renders: level |diff| mean {lv.mean():.2f} dB (worst {lv.max():.2f}); "
          f"shape mean {sh.mean():.2f} dB (worst render {sh.max():.2f})")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="renders/osc/octaves")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--validate", action="store_true",
                    help="render every waveform and octave through our synth and compare harmonics")
    a = ap.parse_args(argv)
    run = ROOT / a.run
    m = json.loads((run / "manifest.json").read_text())
    notes = sorted(int(n) for n in next(iter(m["files"].values())))
    hold_end = m["lead"] + m["hold"]

    # every waveform at a note shares the SAW's pitch (one oscillator)
    pitch = {}
    print("  note   nominal Hz   played Hz   cents   rounded to 44100/2^20")
    for note in notes:
        nom = 440 * 2 ** ((note - 69) / 12)
        pitch[note] = true_f0(read(run / m["files"]["0"][str(note)]), note, hold_end)
        print(f"  {note:4d}   {nom:10.4f}  {pitch[note]:10.4f}  {1200 * np.log2(pitch[note] / nom):+6.2f}"
              f"   {round(nom / PITCH_STEP) * PITCH_STEP:10.4f}")

    def H(form, note, count):
        path = run / m["files"][str(FORMS.index(form))][str(note)]
        return harmonics(path, note, count, hold_end, f0=pitch[note])

    if a.validate:
        return validate(m, run, notes, hold_end, pitch)

    saw_amp, _ = H("SAW", 36, 1)
    scale = (2 / np.pi) / saw_amp[0]
    print(f"scale: Zenology SAW fundamental at C2 {20 * np.log10(saw_amp[0]):.2f} dB -> 2/pi")

    tables = {}
    print("\n  form    fundamental dB rel. SAW at " + " ".join(f"n{n:<4d}" for n in notes))
    for form in FORMS:
        row = []
        for note in notes:
            f0 = 440 * 2 ** ((note - 69) / 12)
            count = min(900, int(19000 // f0))
            amp, ph = H(form, note, count)
            sa, _ = H("SAW", note, 1)
            row.append(20 * np.log10(amp[0] / sa[0]))
            if form in TABLED:
                a_ = amp * scale
                last = int(np.max(np.nonzero(a_ > 1e-5)[0])) + 1
                # Shift in time so the fundamental has a fixed phase (FUND_PHASE):
                # every octave's table then shares one phase origin, so a note
                # moving between tables does not jump, and SAW/SQR line up with
                # the analytic saw and square (fundamental -sin / +sin at p = 0).
                k = np.arange(1, len(ph) + 1)
                ph = np.angle(np.exp(1j * (ph - k * (ph[0] - FUND_PHASE.get(form, -np.pi / 2)))))
                tables.setdefault(form, []).append(
                    {"note": note, "a": [round(float(v), 6) for v in a_[:last]],
                     "p": [round(float(v), 4) for v in ph[:last]]})
        print(f"  {form:5s}   " + " ".join(f"{x:+6.2f}" for x in row))

    sq, _ = H("SQR", 36, 1)
    sqr_gain = float(sq[0] * scale / (4 / np.pi))    # our +-1 square's fundamental is 4/pi
    print(f"\nSQR gain (fundamental matched): {sqr_gain:.4f}")
    body = {"sqr": round(sqr_gain, 4), "tables": tables}
    size = len(json.dumps(body, separators=(",", ":")))
    print(f"table size {size / 1024:.0f} kB")
    if a.write:
        src = DSP.read_text()
        new, n = re.subn(r"/\*WAVE_TABLES\*/.*?/\*END_WAVE_TABLES\*/",
                         lambda _m: "/*WAVE_TABLES*/" + json.dumps(body, separators=(",", ":"))
                         + "/*END_WAVE_TABLES*/", src, flags=re.S)
        if n != 1:
            raise SystemExit("WAVE_TABLES markers not found exactly once in va-dsp.js")
        DSP.write_text(new)
        print(f"wrote {sum(len(v) for v in tables.values())} tables into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
