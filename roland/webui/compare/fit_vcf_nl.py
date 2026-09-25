#!/usr/bin/env python3
"""Refit a VCF model's resonance feedback k where the ladder is nonlinear.

fit_vcf.py fits k with a linear ladder. Near self-oscillation Zenology's
ladder saturates, and a linear fit then reads k too low - P5's plateaued at
3.7-3.8 from RESO 640, MG's from 768. This tool fits k by rendering OUR
nonlinear filter (render.mjs, with the __ZC_SCALE.vcfK override) and scoring it
against Zenology's noise run (renders/fd/res-v*, CUTOFF 512) and, where a saw
run covers that resonance, the saw (renders/ab/v*-r800 for RESO 768/896,
renders/selfosc/vcf-v* for 1023). Render those with zen_bank.py first (slot 5,
every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py --slot 5 --notes 48"
    for v in 0 1 2 3; do
      $Z --set PCMS_PTL_1.VCF_TYPE=$v --set PCMS_PTL_1.FILTER_SLOPE=2 --set PCMT_PTL_1.RESO=800 \\
         --param PCMT_PTL_1.CUTOFF --values 256,384,512,640,768 --out renders/ab/v$v-r800
      $Z --set PCMS_PTL_1.FILTER_TYPE=1 --set PCMS_PTL_1.VCF_TYPE=$v --set PCMS_PTL_1.FILTER_SLOPE=2 \\
         --set PCMT_PTL_1.RESO=1023 --param PCMT_PTL_1.CUTOFF --values 384,512,640,768 \\
         --out renders/selfosc/vcf-v$v
    done

    uv run --with numpy --with scipy webui/compare/fit_vcf_nl.py --model MG --reso 768,896,1023
    uv run --with numpy --with scipy webui/compare/fit_vcf_nl.py --model MG --reso 768,896,1023 --write

A second mode fits the ladder's INPUT saturation level per model (u = L tanh(u/L))
on the saw alone - RESO 0 and 800 (renders/ab) and 1023 (renders/selfosc) -
and --write stores it in VCF_EXTRA.insat (0 = none):

    uv run --with numpy --with scipy webui/compare/fit_vcf_nl.py --model JP --insat 0,4,2.5,1.5

2026-09-26: VCF1 4, JP 2.5, P5 2.5 improved the resonant saw by 0.3-0.9 dB
summed; MG was best without. Noise was unchanged within run-to-run spread
(two runs each way: 0.59-0.60 vs 0.55-0.58 dB mean).

--write stores the result in VCF_EXTRA.knl, which replaces the linear k at
those RESO points. Only write a model after checking it improves BOTH the noise
validation and the saw: on 2026-09-26 MG improved on both (saw 2.48 -> 2.27 dB,
noise 0.65 -> 0.59) and was kept; P5's refit (k 3.9-4.2) left the saw unchanged
and made noise worse (0.73 -> 0.93), so P5 keeps its linear table.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fit_vcf import psd, smooth  # noqa: E402
from zencore import Schema  # noqa: E402
from zencore.container import read_file  # noqa: E402
from zencore.svd import unpack_ext  # noqa: E402
from zencore.tone import Tone  # noqa: E402
from zencore.va import va_patch  # noqa: E402

SR = 44100
DSP = ROOT / "webui/static/va-dsp.js"
MODELS = ["VCF1", "JP", "MG", "P5"]
BANK = Path.home() / "Library/Application Support/Roland Cloud/ZENOLOGY/User.bin"


class Renderer:
    """Renders slot-5 variants through our synth, with __ZC_SCALE overrides."""

    def __init__(self, bank, tmp):
        self.schema = Schema.load()
        self.base = unpack_ext(read_file(str(bank))).image.tone_bytes(4)
        self.tmp = Path(tmp)

    def __call__(self, changes, note, noise, scale):
        tone = Tone(self.base, self.schema)
        for (g, pid), v in changes.items():
            tone.set(g, pid, v)
        patch, wav = self.tmp / "p.json", self.tmp / "o.wav"
        patch.write_text(json.dumps(va_patch(tone)))
        hold, dur = ("3.0", "3.4") if noise else ("1.3", "1.6")
        subprocess.run(["node", str(ROOT / "webui/compare/render.mjs"), str(patch), str(wav),
                        "--note", str(note), "--velocity", "1", "--hold", hold, "--dur", dur,
                        "--lead", "0.1"], check=True, capture_output=True,
                       env=dict(os.environ, ZC_SCALE=json.dumps(scale)))
        return wav


def bands(path):
    """Third-octave band levels of the sustained part - harmonics and a ring alike."""
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1)
    if np.abs(x).max() > 2:
        x /= 32768
    seg = x[int(0.4 * SR):int(1.2 * SR)]
    w = np.hanning(len(seg))
    sp = np.abs(np.fft.rfft(seg * w)) * 2 / w.sum()
    fr = np.fft.rfftfreq(len(seg), 1 / SR)
    e = 30 * 2 ** (np.arange(0, 31) / 3)
    return np.array([np.sqrt((sp[(fr >= a) & (fr < b)] ** 2).sum()) for a, b in zip(e[:-1], e[1:])])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--model", required=True, choices=MODELS)
    ap.add_argument("--reso", help="RESO points to refit, e.g. 768,896,1023")
    ap.add_argument("--insat", help="fit input saturation instead: levels to try, 0 = none")
    ap.add_argument("--k", default="3.6,3.7,3.8,3.9,3.95,4.0,4.05,4.1,4.2,4.3,4.45")
    ap.add_argument("--bank", default=str(BANK), help="bank holding slot 5 (MEAS SAW)")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    v = MODELS.index(a.model)
    if a.insat:
        return fit_insat(a, v)
    if not a.reso:
        ap.error("--reso or --insat is required")
    points = [int(r) for r in a.reso.split(",")]
    grid = [float(k) for k in a.k.split(",")]

    with tempfile.TemporaryDirectory() as tmp:
        render = Renderer(a.bank, tmp)
        noise = {("PCMS_PTL_1", "OSC_TYPE"): 4, ("PCMS_PTL_1", "FILTER_TYPE"): 1,
                 ("PCMS_PTL_1", "FILTER_SLOPE"): 2}
        f, oref = psd(render({**noise, ("PCMT_PTL_1", "CUTOFF"): 1023}, 60, True, {}))
        oref = smooth(f, oref)
        zref_f, zref = psd(ROOT / "renders/noise-open" / "CUTOFF-1023_n60.wav")
        zref = smooth(zref_f, zref)
        man = json.loads((ROOT / f"renders/fd/res-v{v}/manifest.json").read_text())

        result = []
        for rv in points:
            _f, z = psd(ROOT / f"renders/fd/res-v{v}" / man["files"][str(rv)]["60"])
            z = smooth(f, z) - zref
            saw = ([(f"renders/selfosc/vcf-v{v}", 1023)] if rv == 1023
                   else [(f"renders/ab/v{v}-r800", 800)] if rv in (768, 896) else [])
            best = None
            for k in grid:
                scale = {"vcfK": k}
                _f, o = psd(render({**noise, ("PCMS_PTL_1", "VCF_TYPE"): v,
                                    ("PCMT_PTL_1", "CUTOFF"): 512, ("PCMT_PTL_1", "RESO"): rv},
                                   60, True, scale))
                o = smooth(f, o) - oref
                m = (f >= 25) & (f <= 16000) & (z > z.max() - 55)
                errs = [float(np.mean(np.abs(o[m] - z[m])))]
                for d, r in saw:
                    sm = json.loads((ROOT / d / "manifest.json").read_text())
                    for c in sm["values"]:
                        zb = bands(ROOT / d / sm["files"][str(c)]["48"])
                        ob = bands(render({("PCMS_PTL_1", "FILTER_TYPE"): 1, ("PCMS_PTL_1", "VCF_TYPE"): v,
                                           ("PCMS_PTL_1", "FILTER_SLOPE"): 2, ("PCMT_PTL_1", "RESO"): r,
                                           ("PCMT_PTL_1", "CUTOFF"): c}, 48, False, scale))
                        keep = zb > zb.max() * 10 ** (-40 / 20)
                        errs.append(float(np.mean(np.abs(20 * np.log10(ob[keep] + 1e-12)
                                                          - 20 * np.log10(zb[keep] + 1e-12)))))
                e = float(np.mean(errs))
                if best is None or e < best[0]:
                    best = (e, k, errs)
            print(f"{a.model} RESO {rv:4d}: k {best[1]:.2f}  error {best[0]:.2f} dB  "
                  f"(noise {best[2][0]:.2f}; saw {' '.join(f'{x:.1f}' for x in best[2][1:]) or '-'})",
                  flush=True)
            result.append([rv, best[1]])

    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*VCF_EXTRA\*/(.*?)/\*END_VCF_EXTRA\*/", src, re.S)
        extra = json.loads(m.group(1))
        extra.setdefault("knl", {})[a.model] = result
        DSP.write_text(src[:m.start(1)] + json.dumps(extra, separators=(", ", ": ")) + src[m.end(1):])
        print(f"wrote knl[{a.model}] into {DSP.relative_to(ROOT)}")
    return 0


def fit_insat(a, v):
    from validate_filters import harmonics
    f0 = 440 * 2 ** ((48 - 69) / 12)
    runs = [f"renders/ab/v{v}-r0", f"renders/ab/v{v}-r800", f"renders/selfosc/vcf-v{v}"]
    best = None
    with tempfile.TemporaryDirectory() as tmp:
        render = Renderer(a.bank, tmp)
        zs = harmonics(ROOT / "renders/saw-open/PW-64_n48.wav", f0)
        for level in (float(x) for x in a.insat.split(",")):
            scale = {"vcfInSat": level}
            os_ = harmonics(render({("PCMT_PTL_1", "CUTOFF"): 1023}, 48, False, scale), f0)
            parts = []
            for d in runs:
                m = json.loads((ROOT / d / "manifest.json").read_text())
                fixed = {tuple(k.split(".")): x for k, x in m["fixed"].items()}
                errs = []
                for c in m["values"]:
                    op = render({**fixed, ("PCMT_PTL_1", "CUTOFF"): c}, 48, False, scale)
                    zp = ROOT / d / m["files"][str(c)]["48"]
                    if "selfosc" in d:
                        zb, ob = bands(zp), bands(op)
                        keep = zb > zb.max() * 10 ** (-40 / 20)
                        errs.append(np.mean(np.abs(20 * np.log10(ob[keep] + 1e-12) - 20 * np.log10(zb[keep] + 1e-12))))
                    else:
                        hz = 20 * np.log10(harmonics(zp, f0) / zs + 1e-12)
                        ho = 20 * np.log10(harmonics(op, f0) / os_ + 1e-12)
                        n = min(len(hz), len(ho))
                        keep = hz[:n] > hz[:n].max() - 60
                        errs.append(np.mean(np.abs(ho[:n][keep] - hz[:n][keep])))
                parts.append(float(np.mean(errs)))
            total = sum(parts)
            print(f"{a.model} input saturation {level:4.1f}: RESO 0 {parts[0]:.2f}  800 {parts[1]:.2f}  "
                  f"1023 {parts[2]:.2f}   sum {total:.2f}", flush=True)
            if best is None or total < best[0]:
                best = (total, level)
    print(f"best: {best[1]}")
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*VCF_EXTRA\*/(.*?)/\*END_VCF_EXTRA\*/", src, re.S)
        extra = json.loads(m.group(1))
        extra.setdefault("insat", {})
        if best[1]:
            extra["insat"][a.model] = best[1]
        else:
            extra["insat"].pop(a.model, None)
        DSP.write_text(src[:m.start(1)] + json.dumps(extra, separators=(", ", ": ")) + src[m.end(1):])
        print(f"wrote insat[{a.model}] = {best[1]} into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
