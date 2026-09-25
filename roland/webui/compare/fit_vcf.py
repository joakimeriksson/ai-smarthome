#!/usr/bin/env python3
"""Fit Zenology's VA filter models (VCF_TYPE) to a bilinear 4-stage ladder.

The probe is Zenology's own Noise oscillator, which is white to 0.3 dB, so one
render divided by an open-filter render IS the filter's response. Render the
reference and, per model, a CUTOFF sweep at RESO 0 and a RESO sweep at CUTOFF
512 with zen_bank.py (slot 5 = "MEAS SAW"; quit every host first):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
       --slot 5 --notes 60 --hold 3.0 --dur 3.4 --set PCMS_PTL_1.OSC_TYPE=4"
    $Z --param PCMT_PTL_1.CUTOFF --values 1023 --out renders/noise-open
    for v in 0 1 2 3; do
      $Z --set PCMS_PTL_1.FILTER_SLOPE=2 --set PCMS_PTL_1.VCF_TYPE=$v --set PCMT_PTL_1.RESO=0 \\
         --param PCMT_PTL_1.CUTOFF --values 128,256,384,512,640,768,896,1023 --out renders/fd/cut-v$v
      $Z --set PCMS_PTL_1.FILTER_SLOPE=2 --set PCMS_PTL_1.VCF_TYPE=$v --set PCMT_PTL_1.CUTOFF=512 \\
         --param PCMT_PTL_1.RESO --values 0,128,256,384,512,640,768,896,1023 --out renders/fd/res-v$v
    done

The VCF-mode highpass (HPF_CUTOFF) and gain correction (VCF_GC), same probe:

    $Z --set PCMS_PTL_1.FILTER_TYPE=1 --set PCMT_PTL_1.CUTOFF=1023 --set PCMT_PTL_1.RESO=0 \
       --param PCMS_PTL_1.HPF_CUTOFF --values 0,128,256,384,512,640,768,896,1023 --out renders/vcf-hpf
    for v in 0 2; do for r in 0 900; do
      $Z --set PCMS_PTL_1.FILTER_TYPE=1 --set PCMS_PTL_1.VCF_TYPE=$v --set PCMS_PTL_1.FILTER_SLOPE=2 \
         --set PCMT_PTL_1.CUTOFF=512 --set PCMT_PTL_1.RESO=$r \
         --param PCMS_PTL_1.VCF_GC --values 0,32,64,96,127 --out renders/vcf-gc/v$v-r$r
    done; done

Then:

    uv run --with numpy --with scipy webui/compare/fit_vcf.py            # report
    uv run --with numpy --with scipy webui/compare/fit_vcf.py --write    # update va-dsp.js

Each point is a least-squares fit of |G^4 / (1 + k G^4)|, G the bilinear
one-pole prewarped at fc, over the response from 25 Hz down to 55 dB below its
peak. Cutoff points fix k = 0; resonance points fit fc and k together.
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
from scipy.signal import welch

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
DSP = ROOT / "webui/static/va-dsp.js"
MODELS = ["VCF1", "JP", "MG", "P5"]          # VCF_TYPE 0..3, labels from the schema


def psd(path, t0=0.4, t1=3.0):
    _sr, d = wavfile.read(path)
    x = d.mean(axis=1) if d.ndim > 1 else d
    f, p = welch(x[int(t0 * SR):int(t1 * SR)], SR, nperseg=8192, noverlap=6144)
    return f, 10 * np.log10(p + 1e-24)


def smooth(f, db, frac=1 / 6):
    """Average over a sliding 1/6 octave - noise spectra are ragged."""
    out = np.empty_like(db)
    for i, fc in enumerate(f):
        m = (f >= fc * 2 ** (-frac / 2)) & (f <= fc * 2 ** (frac / 2))
        out[i] = db[m].mean()
    return out


def ladder_db(freq, fc, k):
    fc = min(fc, SR * 0.4999)
    w = np.tan(np.pi * freq / SR) / np.tan(np.pi * fc / SR)
    G = 1 / (1 + 1j * w)
    return 20 * np.log10(np.abs(G ** 4 / (1 + k * G ** 4)) + 1e-12)


def fit(f, r, fc0, k0=0.0, fix_k=None):
    m = (f >= 25) & (f <= 18000)
    ff, rr = f[m], r[m]
    keep = rr > rr.max() - 55
    ff, rr = ff[keep], rr[keep]
    top = np.log2(SR * 0.4999)
    if fix_k is None:
        sol = least_squares(lambda p: ladder_db(ff, 2 ** p[0], p[1]) - rr,
                            [np.log2(fc0), k0], bounds=([3, -0.5], [top, 6]))
        fc, k = 2 ** sol.x[0], sol.x[1]
    else:
        sol = least_squares(lambda p: ladder_db(ff, 2 ** p[0], fix_k) - rr,
                            [np.log2(fc0)], bounds=([3], [top]))
        fc, k = 2 ** sol.x[0], fix_k
    res = np.abs(ladder_db(ff, fc, k) - rr)
    return fc, k, float(res.mean()), float(res.max())


def sweep(run, ref):
    man = json.loads((run / "manifest.json").read_text())
    note = str(man["notes"][0])
    f = None
    out = {}
    for v in man["values"]:
        f, db = psd(run / man["files"][str(v)][note])
        out[v] = smooth(f, db) - ref
    return f, out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ref", default="renders/noise-open", help="open-filter noise run")
    ap.add_argument("--runs", default="renders/fd", help="directory of cut-v*/res-v* runs")
    ap.add_argument("--write", action="store_true", help="update VCF_MODELS in va-dsp.js")
    a = ap.parse_args(argv)

    ref_run = ROOT / a.ref
    rm = json.loads((ref_run / "manifest.json").read_text())
    f, ref = psd(ref_run / next(iter(next(iter(rm["files"].values())).values())))
    ref = smooth(f, ref)
    runs = ROOT / a.runs

    tables = {}
    for i, name in enumerate(MODELS):
        if not (runs / f"res-v{i}" / "manifest.json").is_file():
            print(f"{name}: no runs in {runs}, skipped")
            continue
        _f, cut = sweep(runs / f"cut-v{i}", ref)
        print(f"\n{name}   cutoff law (RESO 0)")
        law = []
        for c, r in cut.items():
            fc, _k, mean, mx = fit(f, r, 5 * 2 ** (c / 1023 * 12), fix_k=0.0)
            law.append((c, fc))
            print(f"  CUTOFF {c:5d}  fc {fc:8.1f} Hz   residual {mean:4.2f} mean / {mx:4.1f} max dB")
        _f, res = sweep(runs / f"res-v{i}", ref)
        fc512 = dict(law).get(512, law[len(law) // 2][1])
        print(f"{name}   resonance (CUTOFF 512)")
        kt = []
        for rv, r in res.items():
            fc, k, mean, mx = fit(f, r, fc512, k0=4 * rv / 1023)
            kt.append((rv, k))
            print(f"  RESO {rv:5d}  k {k:5.2f}   fc {1200 * np.log2(fc / fc512):+4.0f} ct   "
                  f"residual {mean:4.2f} mean / {mx:4.1f} max dB")
        tables[name] = {"cut": [[int(c), round(float(h), 2)] for c, h in law],
                        "k": [[int(r), round(max(0.0, float(k)), 3)] for r, k in kt]}

    # HPF_CUTOFF: a one-pole bilinear highpass plus a small dry leak, per value
    hpf = []
    hrun = ROOT / "renders/vcf-hpf"
    if (hrun / "manifest.json").is_file():
        _f, hr = sweep(hrun, ref)
        print("\nHPF_CUTOFF (VCF mode): one-pole highpass + leak x dry")
        for v, r in hr.items():
            if v == 0:
                continue
            m = (f >= 25) & (f <= 18000); ff, rr = f[m], r[m]
            def hp(p, ff=ff):
                fc = min(2 ** p[0], SR * 0.4999)
                w = np.tan(np.pi * ff / SR) / np.tan(np.pi * fc / SR)
                return 20 * np.log10(np.abs(1j * w / (1 + 1j * w) + 10 ** (p[1] / 20)) + 1e-12) + p[2]
            sol = min((least_squares(lambda p: hp(p) - rr, [np.log2(4.94 * 2 ** (12.121 * v / 1023)), L, 0],
                                     bounds=([1, -120, -12], [14.43, 0, 12])) for L in (-90, -40, -25)),
                      key=lambda s: s.cost)
            fc, leak, g = 2 ** sol.x[0], sol.x[1], sol.x[2]
            print(f"  HPF_CUTOFF {v:5d}  fc {fc:8.1f} Hz  leak {leak:6.1f} dB  gain {g:+.2f}  "
                  f"resid {np.abs(hp(sol.x) - rr).mean():.3f}")
            hpf.append([int(v), round(float(fc), 2), round(float(leak), 1), round(float(g), 2)])
        # where the leak sits below the response it cannot be seen - carry the
        # first visible value down, with the passband it implies (see va-dsp.js)
        vis = next(h for h in hpf if h[2] > -80)
        for h in hpf:
            if h[2] <= -80:
                h[2], h[3] = vis[2], vis[3]
    # VCF_GC: a flat make-up gain, 1 + c * (GC/127) * k, k the resonance feedback
    # implied by each run's passband loss (so c is independent of the k table)
    gc_c = None
    gruns = sorted((ROOT / "renders/vcf-gc").glob("v*-r*"))
    if gruns:
        cs = []
        print("\nVCF_GC: make-up gain vs GC")
        for d in gruns:
            _f, gr = sweep(d, ref)
            pb = {v: float(np.median(r[(f >= 25) & (f <= 60)])) for v, r in gr.items()}
            if pb[0] > -1:
                print(f"  {d.name}: no passband loss at this resonance - GC has no effect "
                      f"({max(abs(p - pb[0]) for p in pb.values()):.2f} dB spread)")
                continue
            k = 10 ** (-pb[0] / 20) - 1
            for v, p in pb.items():
                if v:
                    c = (10 ** ((p - pb[0]) / 20) - 1) / (k * v / 127)
                    cs.append(c)
                    print(f"  {d.name}: GC {v:4d}  +{p - pb[0]:5.2f} dB  -> c {c:.3f}")
        gc_c = round(float(np.median(cs)), 3)
        print(f"  c = {gc_c}")

    if a.write:
        if set(tables) != set(MODELS):
            raise SystemExit(f"refusing to write a partial table: have {sorted(tables)}")
        body = "{\n" + ",\n".join(
            f'  {name}: {{\n    cut: {json.dumps(t["cut"])},\n    k: {json.dumps(t["k"])},\n  }}'
            for name, t in tables.items()) + ",\n}"
        src = DSP.read_text()
        new, n = re.subn(r"/\*VCF_TABLES\*/.*?/\*END_VCF_TABLES\*/",
                         lambda _m: f"/*VCF_TABLES*/{body}/*END_VCF_TABLES*/", src, flags=re.S)
        if n != 1:
            raise SystemExit("VCF_TABLES markers not found exactly once in va-dsp.js")
        if hpf and gc_c is not None:
            m = re.search(r"/\*VCF_EXTRA\*/(.*?)/\*END_VCF_EXTRA\*/", new, re.S)
            if not m:
                raise SystemExit("VCF_EXTRA markers not found in va-dsp.js")
            # keep what other tools own there (knl, from fit_vcf_nl.py)
            extra = {**json.loads(m.group(1) or "{}"), "hpf": hpf, "gc": gc_c}
            new = new[:m.start(1)] + json.dumps(extra, separators=(", ", ": ")) + new[m.end(1):]
        DSP.write_text(new)
        print(f"\nwrote VCF_MODELS for {', '.join(tables)}, HPF and GC into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
