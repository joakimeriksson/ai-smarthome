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


def harmonics(path, note, count, hold_end, periods=32, per=2048):
    """Amplitude and phase of harmonics 1..count over an exact number of periods."""
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    f0 = 440 * 2 ** ((note - 69) / 12)
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


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="renders/osc/octaves")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    run = ROOT / a.run
    m = json.loads((run / "manifest.json").read_text())
    notes = sorted(int(n) for n in next(iter(m["files"].values())))
    hold_end = m["lead"] + m["hold"]

    def H(form, note, count):
        path = run / m["files"][str(FORMS.index(form))][str(note)]
        return harmonics(path, note, count, hold_end)

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
