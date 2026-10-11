#!/usr/bin/env python3
"""Fit the partial delay time (DELAY_T in va-dsp.js) and validate the partial
delay modes and the key / velocity windows against Zenology.

Every run plays a sine (MEAS SAW, user slot 5, VA_FORM=3) through an open
filter with velocity and matrix routes off. --no-retry matters: a delayed
partial starts late on purpose, and zen_bank's late-note re-render would start
the next take inside the previous note. Render (every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \
       --slot 5 --no-retry --set PCMS_PTL_1.VA_FORM=3 --set PCMT_PTL_1.CUTOFF=1023 \
       --set PCMT_PTL_1.MCTL_1_SENS1=0 --set PCMT_PTL_1.MCTL_2_SENS1=0 --set PCMT_PTL_1.LEVEL_VSENS=0"
    $Z --notes 72 --repeat 2 --hold 9 --dur 9.5 --param PCMT_PTL_1.DLY_TIME \
       --values 16,32,64,128,192,256,320,384,448,512,640,768 --out renders/pmt/dly-time
    $Z --notes 72 --repeat 2 --hold 13 --dur 13.5 --param PCMT_PTL_1.DLY_TIME \
       --values 480,544,576,608,704,832,896,960,1023 --out renders/pmt/dly-time2
    D="--notes 72 --param PCMT_PTL_1.DELAY_MODE"
    $Z $D --values 0,1,2,3 --hold 1.0 --dur 4 --set PCMT_PTL_1.DLY_TIME=384 --out renders/pmt/dly-mode
    $Z $D --values 0,1,2,3 --hold 0.3 --dur 2 --set PCMT_PTL_1.DLY_TIME=384 --out renders/pmt/dly-hold
    $Z $D --values 0,2,3 --hold 1.0 --dur 4 --set PCMT_PTL_1.DLY_TIME=0 --out renders/pmt/dly-koff0
    $Z $D --values 0,2,3 --hold 3 --dur 4 --set PCMT_PTL_1.DLY_TIME=384 --set PTL_AENV_1.T1=384 \
       --out renders/pmt/dly-att
    $Z $D --values 0,2,3 --hold 1.5 --dur 4 --set PCMT_PTL_1.DLY_TIME=128 --set PTL_AENV_1.T3=512 \
       --set PTL_AENV_1.L3=200 --out renders/pmt/dly-dcy
    $Z --notes 72 --hold 3 --dur 3.5 --set PCMT_PTL_1.DLY_TIME_SYNC=1 \
       --param PCMT_PTL_1.DLY_TIME_NOTE --values 9,12,15 --out renders/pmt/dly-sync
    (dly-penv, dly-lfo: a pitch envelope / key-triggered LFO under DLY_TIME 384 -
     both start when the partial does)
    $Z --notes 36,48,54,60,72,84,90,96,102 --hold 0.5 --dur 0.7 \
       --param PCMT_PMT.PMT_1_KFADE_UP --values 0 --out renders/pmt/krange-ref
    $Z --notes 85,87,90,93,96,102,108 --hold 0.5 --dur 0.7 --set PCMT_PMT.PMT_1_KRANGE_LO=0 \
       --set PCMT_PMT.PMT_1_KRANGE_UP=84 --param PCMT_PMT.PMT_1_KFADE_UP --values 6,12,24 \
       --out renders/pmt/krange-up2
    $Z --notes 36,42,48,53,55,57,59 --hold 0.5 --dur 0.7 --set PCMT_PMT.PMT_1_KRANGE_LO=60 \
       --param PCMT_PMT.PMT_1_KFADE_LO --values 6,12,24 --out renders/pmt/krange-lo2
    $Z --notes 72 --hold 0.5 --dur 0.7 --set PCMT_PMT.PMT_1_VRANGE_LO=64 --set PCMT_PMT.PMT_1_VRANGE_UP=100 \
       --set PCMT_PMT.PMT_1_VFADE_LO=32 --set PCMT_PMT.PMT_1_VFADE_UP=20 --param velocity \
       --values 16,32,48,56,64,80,100,110,120,127 --out renders/pmt/vrange

    uv run --with numpy --with scipy webui/compare/fit_pmt.py              # report the delay law
    uv run --with numpy --with scipy webui/compare/fit_pmt.py --write      # update va-dsp.js
    uv run --with numpy --with scipy webui/compare/fit_pmt.py --validate   # ours vs Zenology
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

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_runs as vr  # noqa: E402

SR = vr.SR
DSP = ROOT / "webui/static/va-dsp.js"
RUNS = ROOT / "renders/pmt"
TRACE_RUNS = ["dly-mode", "dly-hold", "dly-koff0", "dly-att", "dly-dcy", "dly-sync"]
LEVEL_RUNS = ["krange-ref", "krange-up2", "krange-lo2", "vrange"]


def manifest(run):
    return json.loads((RUNS / run / "manifest.json").read_text())


def mono(path):
    _sr, d = wavfile.read(path)
    return d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)


def take(run, v, k=0, note=None):
    m = manifest(run)
    f = m["files"][str(v)][str(note or m["notes"][0])]
    return mono(RUNS / run / (f.replace(".wav", f"_r{k}.wav") if k else f))


def start_time(x, lead, thr_db=-40):
    """Seconds from note-on to the first sample within thr_db of the loudest 5 ms."""
    pk = np.sqrt(np.max(np.convolve(x ** 2, np.ones(220) / 220, "same")))
    a = np.abs(x[int(lead * SR):])
    hit = a > pk * 10 ** (thr_db / 20)
    return float(np.argmax(hit)) / SR if hit.any() else None


def frames(x, hop=0.01):
    n = int(hop * SR)
    k = len(x) // n
    return 20 * np.log10(np.sqrt(np.mean(x[:k * n].reshape(k, n) ** 2, axis=1)) + 1e-9)


def fit_delay():
    pts = {0: 0.0}
    for run in ("dly-time", "dly-time2"):
        m = manifest(run)
        for v in m["values"]:
            ts = [start_time(take(run, v, k), m["lead"]) for k in range(m.get("repeat", 1))]
            ts = [t for t in ts if t is not None]
            # a take whose note-on came late (DawDreamer) starts late - use the earliest
            pts[v] = min(ts)
            flag = "" if max(ts) - min(ts) < 0.002 else f"   (a take {max(ts) - min(ts):+.3f} s late, dropped)"
            print(f"DLY_TIME {v:4d}: {min(ts):7.4f} s  ({min(ts) / v * 1000:6.3f} ms per step){flag}")
    return [[v, round(t, 4)] for v, t in sorted(pts.items())]


def validate():
    """Level traces (10 ms frames, dB) of the delay runs, and held levels of the
    window runs: ours vs Zenology."""
    schema = vr.Schema.load()
    worst = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for run in TRACE_RUNS + LEVEL_RUNS:
            if not (RUNS / run / "manifest.json").is_file():
                continue
            m = manifest(run)
            base = vr.base_tone(RUNS / run, m, schema)
            g, _, pid = m["param"].partition(".")
            by_vel = m["param"] == "velocity"
            print(f"{run}  ({m['param']})")
            for v in m["values"]:
                tone = vr.Tone(base.data, schema)
                if not by_vel:
                    tone.set(g, pid, v)
                for note in m["notes"]:
                    z = take(run, v, note=note)
                    o = vr.render(tone, note, v if by_vel else (m["velocity"] or 100), m, m["lead"], tmp)
                    if run in TRACE_RUNS:
                        fz, fo = frames(z), frames(o)
                        n = min(len(fz), len(fo))
                        fz, fo = fz[:n], fo[:n]
                        top = max(fz.max(), fo.max())
                        live = (fz > top - 40) | (fo > top - 40)
                        err = float(np.mean(np.abs(np.maximum(fz[live], top - 40) - np.maximum(fo[live], top - 40)))) if live.any() else 0.0
                        on_z, on_o = start_time(z, m["lead"]), start_time(o, m["lead"])
                        on = (f"starts {on_z:.3f} / {on_o:.3f} s" if on_z is not None and on_o is not None
                              else f"starts {on_z} / {on_o}")
                        print(f"   {v:>4}: trace |diff| {err:5.2f} dB   ({on}, Zenology / ours)")
                        worst.append((err, run, v))
                    else:
                        a, b = int((m["lead"] + 0.1) * SR), int((m["lead"] + m["hold"] - 0.05) * SR)
                        lz, lo = (20 * np.log10(np.sqrt(np.mean(y[a:b] ** 2)) + 1e-12) for y in (z, o))
                        if lz < -150 and lo < -150:
                            print(f"   {v:>4} n{note}: both silent")
                            continue
                        print(f"   {v:>4} n{note}: Zenology {lz:7.2f} dB, ours {lo:7.2f} dB ({lo - lz:+.2f})")
                        worst.append((abs(lo - lz) if lz > -150 and lo > -150 else 99, run, (v, note)))
    worst.sort(reverse=True)
    print("worst:", [(round(e, 2), r, v) for e, r, v in worst[:5]])
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--validate", action="store_true")
    a = ap.parse_args(argv)
    if a.validate:
        return validate()
    st = {"time": fit_delay()}
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*DELAY_TABLES\*/(.*?)/\*END_DELAY_TABLES\*/", src, re.S)
        DSP.write_text(src[:m.start(1)] + json.dumps(st) + src[m.end(1):])
        print(f"wrote DELAY_T into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
