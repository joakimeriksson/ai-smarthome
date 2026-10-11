#!/usr/bin/env python3
"""Fit Zenology's TVF (filter mode TVF) to a Chamberlin state-variable filter.

The TVF is a Chamberlin SVF - the classic digital state-variable filter - on
the same cutoff law as VCF1. That structure fits Zenology to ~0.01 dB where a
bilinear one misses by up to 11 dB: its slope flattens toward Nyquist, and its
frequency coefficient F = 2 sin(pi fc / fs) clamps at exactly 1.0 (fs/6).

Probe and renders: white noise, as for fit_vcf.py (slot 5, every host quit):

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
       --slot 5 --notes 60 --hold 3.0 --dur 3.4 --set PCMS_PTL_1.OSC_TYPE=4 \\
       --set PCMS_PTL_1.FILTER_TYPE=0"
    for t in 1 2 3 4 5 6; do for sl in 0 2; do         # TVF type x slope -12/-24
      $Z --set PCMT_PTL_1.FILTER_TYPE=$t --set PCMS_PTL_1.FILTER_SLOPE=$sl --set PCMT_PTL_1.RESO=0 \\
         --param PCMT_PTL_1.CUTOFF --values 128,256,384,512,640,768,896,1023 --out renders/tvf/cut-t$t-s$sl
      $Z --set PCMT_PTL_1.FILTER_TYPE=$t --set PCMS_PTL_1.FILTER_SLOPE=$sl --set PCMT_PTL_1.CUTOFF=512 \\
         --param PCMT_PTL_1.RESO --values 0,128,256,384,512,640,768,896,1023 --out renders/tvf/res-t$t-s$sl
    done; done
    for r in 384 768; do                               # damping at high cutoff, with resonance
      $Z --set PCMT_PTL_1.FILTER_TYPE=1 --set PCMS_PTL_1.FILTER_SLOPE=0 --set PCMT_PTL_1.RESO=$r \\
         --param PCMT_PTL_1.CUTOFF --values 640,704,768,832,896 --out renders/tvf/hi-r$r
    done

    uv run --with numpy --with scipy webui/compare/fit_tvf.py            # report
    uv run --with numpy --with scipy webui/compare/fit_tvf.py --write    # update va-dsp.js

What is fitted, each from the runs that isolate it:
  q(RESO)       damping per RESO, LPF -12 at CUTOFF 512 (F ~ 0.05, so no F effect)
  m(F)          how the damping eases toward the clamp, LPF/BPF/HPF -12 at RESO 0
  lpf3 q(CUT)   LPF3's cutoff-dependent damping
  pkg           PKG = low + high + w * band, w fitted once over every PKG run
  gain          the TVF path's level relative to the VCF path (+1.1 dB)
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
from scipy.signal import freqz, welch

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
DSP = ROOT / "webui/static/va-dsp.js"
TYPES = {1: "LPF", 2: "BPF", 3: "HPF", 4: "PKG", 5: "LPF2", 6: "LPF3"}
F_MAX = 1.0                                   # fitting bound for the resonance-0 runs, see below


def psd(path, t0=0.4, t1=3.0):
    _sr, d = wavfile.read(path)
    x = d.mean(axis=1) if d.ndim > 1 else d
    f, p = welch(x[int(t0 * SR):int(t1 * SR)], SR, nperseg=8192, noverlap=6144)
    return f, 10 * np.log10(p + 1e-24)


def smooth(f, db, frac=1 / 6):
    out = np.empty_like(db)
    for i, fc in enumerate(f):
        m = (f >= fc * 2 ** (-frac / 2)) & (f <= fc * 2 ** (frac / 2))
        out[i] = db[m].mean()
    return out


def f_coef(fc):
    return min(F_MAX, 2 * np.sin(np.pi * min(fc, SR / 2) / SR))


def svf(kind, F, q, freq, w=2.12):
    """Chamberlin SVF: low += F band; high = x - low - q band; band += F high."""
    a = [1, F * F + F * q - 2, 1 - F * q]
    H = lambda b: freqz(b, a, worN=freq, fs=SR)[1]
    lp, bp, hp = H([0, F * F]), H([F, -F]), H([1, -2, 1])
    return {"LPF": lp, "LPF2": lp, "LPF3": lp, "BPF": bp, "HPF": hp,
            "PKG": lp + hp + w * bp}[kind]


def vcf1_hz(cutoff):
    return 4.94 * 2 ** (12.121 * cutoff / 1023)          # VCF1's law, shared


class Data:
    def __init__(self, root, ref):
        rm = json.loads((ref / "manifest.json").read_text())
        self.f, r = psd(ref / next(iter(next(iter(rm["files"].values())).values())))
        self.ref = smooth(self.f, r)
        self.root = root

    def run(self, name):
        d = self.root / name
        man = json.loads((d / "manifest.json").read_text())
        note = str(man["notes"][0])
        return {v: smooth(self.f, psd(d / man["files"][str(v)][note])[1]) - self.ref
                for v in man["values"]}

    def region(self, r):
        m = (self.f >= 25) & (self.f <= 18000)
        ff, rr = self.f[m], r[m]
        keep = rr > rr.max() - 55
        return ff[keep], rr[keep]


def fit_point(data, kind, r, F0, q0, fit_F=True, w=2.12):
    ff, rr = data.region(r)
    def unpack(p):
        F = min(F_MAX, np.exp(p[0])) if fit_F else F0
        return F, np.exp(p[1]), p[2]
    fun = lambda p: 20 * np.log10(np.abs(svf(kind, *unpack(p)[:2], ff, w)) + 1e-12) + unpack(p)[2] - rr
    x0 = [np.log(max(F0, 1e-4)), np.log(q0), 1.1]
    sol = least_squares(fun, x0, bounds=([np.log(1e-4), np.log(1e-3), -6], [np.log(2.0), np.log(3), 6]))
    F, q, g = unpack(sol.x)
    return F, q, g, float(np.abs(fun(sol.x)).mean())


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", default="renders/tvf")
    ap.add_argument("--ref", default="renders/noise-open")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)
    data = Data(ROOT / a.runs, ROOT / a.ref)

    # 1. q per RESO: LPF -12 at CUTOFF 512. RESO 1023 self-oscillates - its
    #    noise response is not a filter response - so q there is set to 0.
    res = data.run("res-t1-s0")
    qtab = []
    print("q(RESO), LPF -12 at CUTOFF 512")
    for rv, r in res.items():
        if rv == 1023:
            qtab.append((rv, 0.0))
            print(f"  RESO {rv:5d}  q 0 (self-oscillation, not fitted)")
            continue
        F, q, g, e = fit_point(data, "LPF", r, f_coef(vcf1_hz(512)), 1.1, fit_F=False)
        qtab.append((rv, q))
        print(f"  RESO {rv:5d}  q {q:.4f}  (Q {1 / q:6.2f})  gain {g:+.2f}  resid {e:.3f}")
    q_ref = qtab[0][1]

    # 2. m(F): damping at RESO 0 across cutoffs, LPF/BPF/HPF -12, as a ratio to q_ref
    print("\nm(F) = q / q(512) at RESO 0, averaged over LPF, BPF, HPF -12")
    pts = {}
    for t, kind in ((1, "LPF"), (2, "BPF"), (3, "HPF")):
        for c, r in data.run(f"cut-t{t}-s0").items():
            if c < 384:
                continue                           # corner below the noise estimate's reach
            F, q, g, e = fit_point(data, kind, r, f_coef(vcf1_hz(c)), q_ref)
            pts.setdefault(c, []).append((F, q, g, e))
    # normalise to this sweep's own CUTOFF 512 value (F ~ 0.05), so m(0) = 1
    q512 = float(np.mean([p[1] for p in pts[512]]))
    mtab = [(0.0, 1.0)]
    for c in sorted(pts):
        F = float(np.mean([p[0] for p in pts[c]])); q = float(np.mean([p[1] for p in pts[c]]))
        law = f_coef(vcf1_hz(c))
        print(f"  CUTOFF {c:5d}  F {F:.4f} (law {law:.4f})  q {q:.4f}  m {q / q512:.4f}  "
              f"gain {np.mean([p[2] for p in pts[c]]):+.2f}  resid {np.mean([p[3] for p in pts[c]]):.3f}")
        if c > 512 and F > mtab[-1][0] + 1e-3:
            mtab.append((round(F, 4), q / q512))
    gain = float(np.mean([p[2] for c in pts for p in pts[c]]))

    # 3. LPF3: its damping depends on cutoff (Parameter Guide), resonance ignored
    print("\nLPF3 q(CUTOFF), RESO ignored")
    lpf3 = []
    for c, r in data.run("cut-t6-s0").items():
        if c < 256:
            continue
        F, q, g, e = fit_point(data, "LPF3", r, f_coef(vcf1_hz(c)), q_ref, fit_F=False)
        lpf3.append((c, q))
        print(f"  CUTOFF {c:5d}  q {q:.4f}  (Q {1 / q:5.2f})  gain {g:+.2f}  resid {e:.3f}")

    # 4. PKG = pkggain * (low + high + w * band): w and the gain fitted once over
    #    every -12 PKG run below the clamp, each point at its own F and q
    q_of = dict(qtab)
    pk = [(r, f_coef(vcf1_hz(512)), q_of[rv]) for rv, r in data.run("res-t4-s0").items() if rv < 1023]
    # cutoff points use the eased RESO-0 damping; 768 is left out - no single
    # w fits the band form that close to the clamp (see va-dsp.js TvfFilter)
    m_of = lambda F: float(np.interp(F, [x for x, _ in mtab], [y for _, y in mtab]))
    pk += [(r, f_coef(vcf1_hz(c)), q_ref * m_of(f_coef(vcf1_hz(c))))
           for c, r in data.run("cut-t4-s0").items() if 384 <= c <= 640]
    def pkg_res(p):
        w, g = p
        out = []
        for r, F, q in pk:
            ff, rr = data.region(r)
            out.append(20 * np.log10(np.abs(svf("PKG", F, q, ff, w)) + 1e-12) + g - rr)
        return np.concatenate(out)
    sol = least_squares(pkg_res, [2.1, 0.7])
    w, pkg_db = map(float, sol.x)
    print(f"\nPKG = {pkg_db:+.2f} dB x (low + high + {w:.3f} x band)   "
          f"(mean resid {np.abs(pkg_res(sol.x)).mean():.3f} dB over {len(pk)} runs)")

    # Above F = 1 two regimes were measured (renders/tvf/hi-r*): with resonance
    # F follows the law up to CUTOFF 896's value and the resonance table holds;
    # at RESO 0 the filter sits at F = 1, q = 1 - a one-sample delay for the
    # lowpass, i.e. fully open. CUTOFF 896 and 1023 render identically.
    fclamp = float(2 * np.sin(np.pi * vcf1_hz(896) / SR))
    tables = {"q": [[int(r), round(float(q), 5)] for r, q in qtab],
              "m": [[round(float(F), 4), round(float(m), 4)] for F, m in mtab],
              "lpf3q": round(float(np.mean([q for c, q in lpf3 if c <= 768])), 4),
              "pkg": round(w, 3), "pkggain": round(10 ** (pkg_db / 20), 4),
              "gain": round(10 ** (gain / 20), 4),
              "fclamp": round(fclamp, 4)}
    print(f"\nTVF gain {gain:+.2f} dB (x{tables['gain']})")
    if a.write:
        src = DSP.read_text()
        body = json.dumps(tables, separators=(", ", ": "))
        new, n = re.subn(r"/\*TVF_TABLES\*/.*?/\*END_TVF_TABLES\*/",
                         lambda _m: f"/*TVF_TABLES*/{body}/*END_TVF_TABLES*/", src, flags=re.S)
        if n != 1:
            raise SystemExit("TVF_TABLES markers not found exactly once in va-dsp.js")
        DSP.write_text(new)
        print(f"wrote TVF tables into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
