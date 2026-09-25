#!/usr/bin/env python3
"""Score our synth's filters against Zenology renders from zen_bank.py.

Every run directory carries its tone changes in manifest.json, so this renders
the same settings through our voice (render.mjs) and compares:

  noise runs (OSC_TYPE = Noise)  the filter response: each synth's render over
                                 its own open-filter noise, 1/6-octave smoothed,
                                 compared from 25 Hz to 16 kHz down to 55 dB
                                 below the peak
  saw runs                       the filter alone: each synth's harmonics over
                                 its own open saw, so oscillator differences
                                 cancel; harmonics within 60 dB of the loudest

    uv run --with numpy --with scipy webui/compare/validate_filters.py \\
        "renders/fd/*" "renders/tvf/cut-*" "renders/tvf-saw/*"

References (render once, slot 5 = "MEAS SAW", every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py --slot 5"
    $Z --notes 60 --hold 3.0 --dur 3.4 --set PCMS_PTL_1.OSC_TYPE=4 \\
       --param PCMT_PTL_1.CUTOFF --values 1023 --out renders/noise-open
    $Z --notes 48 --set PCMT_PTL_1.CUTOFF=1023 --param PCMS_PTL_1.PW --values 64 --out renders/saw-open

Settings at RESO 1023 are reported but left out of the summary: the filter
self-oscillates there and a response is not defined.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import glob
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fit_vcf import psd, smooth  # noqa: E402
from fit_vcf_nl import BANK, Renderer  # noqa: E402

SR = 44100


def harmonics(path, f0):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    if np.abs(x).max() > 2:
        x /= 32768
    seg = x[int(0.35 * SR):int(1.15 * SR)]
    w = np.hanning(len(seg))
    sp = np.abs(np.fft.rfft(seg * w)) * 2 / w.sum()
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    return np.array([sp[(fr > k * f0 * 0.985) & (fr < k * f0 * 1.015)].max()
                     for k in range(1, 200) if k * f0 < 16000])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("runs", nargs="+", help="run directories or globs")
    ap.add_argument("--noise-ref", default="renders/noise-open")
    ap.add_argument("--saw-ref", default="renders/saw-open")
    ap.add_argument("--bank", default=str(BANK))
    a = ap.parse_args(argv)

    dirs = sorted({Path(d) for pat in a.runs for d in glob.glob(str(ROOT / pat))
                   if (Path(d) / "manifest.json").is_file()})
    if not dirs:
        raise SystemExit("no run directories matched")

    def first_file(run):
        m = json.loads((ROOT / run / "manifest.json").read_text())
        return ROOT / run / next(iter(next(iter(m["files"].values())).values()))

    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        render = Renderer(a.bank, tmp)
        refs = {}
        for d in dirs:
            m = json.loads((d / "manifest.json").read_text())
            fixed = {tuple(k.split(".")): v for k, v in m["fixed"].items()}
            group, pid = m["param"].split(".")
            note = m["notes"][0]
            noise = fixed.get(("PCMS_PTL_1", "OSC_TYPE")) == 4
            if noise and "noise" not in refs:
                f, z0 = psd(first_file(a.noise_ref))
                _f, o0 = psd(render({("PCMS_PTL_1", "OSC_TYPE"): 4, ("PCMT_PTL_1", "CUTOFF"): 1023},
                                    60, True, {}))
                refs["noise"] = (f, smooth(f, z0), smooth(f, o0))
            if not noise and "saw" not in refs:
                f0 = 440 * 2 ** ((48 - 69) / 12)
                refs["saw"] = (harmonics(first_file(a.saw_ref), f0),
                               harmonics(render({("PCMT_PTL_1", "CUTOFF"): 1023}, 48, False, {}), f0))
            for v in m["values"]:
                zpath = d / m["files"][str(v)][str(note)]
                opath = render({**fixed, (group, pid): v}, note, noise, {})
                if noise:
                    f, z0, o0 = refs["noise"]
                    z = smooth(f, psd(zpath)[1]) - z0
                    o = smooth(f, psd(opath)[1]) - o0
                    keep = (f >= 25) & (f <= 16000) & (z > z.max() - 55)
                    err = float(np.mean(np.abs(o[keep] - z[keep])))
                else:
                    f0 = 440 * 2 ** ((note - 69) / 12)
                    zs, os_ = refs["saw"]
                    hz = 20 * np.log10(harmonics(zpath, f0) / zs + 1e-12)
                    ho = 20 * np.log10(harmonics(opath, f0) / os_ + 1e-12)
                    n = min(len(hz), len(ho))
                    keep = hz[:n] > hz[:n].max() - 60
                    err = float(np.mean(np.abs(ho[:n][keep] - hz[:n][keep])))
                selfosc = (fixed.get(("PCMT_PTL_1", "RESO")) == 1023
                           or (group, pid, v) == ("PCMT_PTL_1", "RESO", 1023))
                rows.append((str(d.relative_to(ROOT)), v, "noise" if noise else "saw", err, selfosc))
                print(f"{rows[-1][0]:28s} {v:6d}  {rows[-1][2]:5s} {err:6.2f} dB"
                      + ("   (RESO 1023, not summarised)" if selfosc else ""), flush=True)

    for kind in ("noise", "saw"):
        e = np.array([r[3] for r in rows if r[2] == kind and not r[4]])
        if len(e):
            print(f"\n{kind}: {len(e)} settings, mean {e.mean():.2f} dB, median {np.median(e):.2f}, "
                  f"worst {e.max():.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
