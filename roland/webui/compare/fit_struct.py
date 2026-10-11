#!/usr/bin/env python3
"""Fit the partial-structure constants (STRUCT in va-dsp.js) to Zenology.

The routing is measured and implemented by hand (see the STRUCT and VAVoice
comments in va-dsp.js); this fits the numbers it needs, each on the runs that
isolate it, by rendering our synth with __ZC_SCALE.struct overrides:

  ring      ring-product gain          renders/struct/ring-lvl  (level)
  ringOsc2  RING OSC 2 mix gain        renders/struct/ring-o2lv (level)
  xmodOsc2  XMOD OSC 2 mix gain        renders/struct/xmod-o2cut (level)
  xmod      XMOD cents per unit/cent   renders/struct/xmod-dep*  (spectrum)
  xmod2     XMOD2 phase-mod index      renders/struct/xmod2-dep* (spectrum),
            one value per depth step

The runs come from a two-partial test tone - MEAS SAW (user slot 5) with
partial 1 copied to partial 2, filter open, velocity sensitivity and matrix
routes off:

    uv run --with numpy --with scipy webui/compare/fit_struct.py --make-test-tone

writes renders/struct/test.svz. Then render (every host quit), e.g.

    Z="uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \
       --slot 5 --tone renders/struct/test.svz#0 --notes 48 --hold 1.3 --dur 1.6"
    $Z --set PCMS_PMT.STRUCT12=2 --set PCMT_PTL_1.PIT_CRS=7 \
       --param PCMS_PMT.RING12_LEVEL --values 0,32,64,96,127 --out renders/struct/ring-lvl
    $Z --set PCMS_PMT.STRUCT12=2 --set PCMT_PTL_1.PIT_CRS=7 --set PCMS_PMT.RING_OSC2_LEVEL=127 \
       --set PCMS_PMT.RING12_LEVEL=0 --param PCMT_PTL_2.LEVEL --values 0,64,127 --out renders/struct/ring-o2lv
    X="--set PCMS_PMT.STRUCT12=3 --set PCMS_PTL_1.VA_FORM=3 --set PCMS_PTL_2.VA_FORM=3"
    $Z $X --param PCMS_PMT.XMOD12_DEPTH --values 0,100,300,600,1200,2400,4800,9600 --out renders/struct/xmod-dep
    $Z $X --set PCMT_PTL_2.PIT_CRS=12 --param PCMS_PMT.XMOD12_DEPTH --values 0,600,1200,2400,4800,9600 \
       --out renders/struct/xmod-dep12
    $Z $X --set PCMT_PTL_2.PIT_CRS=12 --set PCMS_PMT.XMOD_OSC2_LEVEL=127 --set PCMS_PMT.XMOD_OSC1_LEVEL=0 \
       --param PCMT_PTL_2.CUTOFF --values 256,1023 --out renders/struct/xmod-o2cut
    (XMOD2: STRUCT12=4, --param PCMS_PMT.XMOD2_12_DEPTH --values 0,16,32,64,96,127
     into xmod2-dep, and with PIT_CRS=12 on partial 2 into xmod2-dep12)

    uv run --with numpy --with scipy webui/compare/fit_struct.py            # report
    uv run --with numpy --with scipy webui/compare/fit_struct.py --write    # update va-dsp.js
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

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_runs as vr  # noqa: E402

SR = vr.SR
DSP = ROOT / "webui/static/va-dsp.js"
STRUCT_RUNS = ROOT / "renders/struct"


def current():
    return json.loads(re.search(r"/\*STRUCT_TABLES\*/(.*?)/\*END_STRUCT_TABLES\*/",
                                DSP.read_text(), re.S).group(1))


class Scorer:
    """Renders one run's values through our synth under given overrides."""

    def __init__(self, name, tmp):
        self.run = STRUCT_RUNS / name
        self.m = json.loads((self.run / "manifest.json").read_text())
        self.base = vr.base_tone(self.run, self.m, vr.Schema.load())
        self.tmp = tmp
        g, _, pid = self.m["param"].partition(".")
        self.g, self.pid = g, pid
        self.z = {}
        for v in self.m["values"]:
            for note in self.m["notes"]:
                x = vr.load(self.run / self.m["files"][str(v)][str(note)])
                self.z[(v, note)] = (x, vr.onset(x, self.m["lead"]))

    def score(self, struct, values=None, what="level"):
        errs = []
        for v in (values or self.m["values"]):
            tone = vr.Tone(self.base.data, self.base.schema)
            tone.set(self.g, self.pid, v)
            for note in self.m["notes"]:
                z, t_on = self.z[(v, note)]
                o = vr.render(tone, note, self.m["velocity"] or 100, self.m, t_on, self.tmp,
                              scale={"struct": struct})
                a, b = int((t_on + 0.1) * SR), int((t_on + self.m["hold"] - 0.05) * SR)
                zs, os_ = z[a:b], o[a:b]
                rz, ro = np.sqrt(np.mean(zs ** 2)), np.sqrt(np.mean(os_ ** 2))
                if rz < 1e-6 or ro < 1e-6:
                    continue
                if what == "level":
                    errs.append(abs(20 * np.log10(ro / rz)))
                else:
                    bz, bo = vr.bands(zs), vr.bands(os_)
                    keep = bz > bz.max() - 50
                    d = (bo - bz)[keep]
                    errs.append(float(np.mean(np.abs(d - np.median(d)))))
        return float(np.mean(errs)) if errs else float("inf")


def golden(f, lo, hi, iters=18):
    """Minimise f on [lo, hi] (log-spaced search for positive gains)."""
    a, b = np.log(lo), np.log(hi)
    phi = (np.sqrt(5) - 1) / 2
    c, d = b - phi * (b - a), a + phi * (b - a)
    fc, fd = f(np.exp(c)), f(np.exp(d))
    for _ in range(iters):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - phi * (b - a)
            fc = f(np.exp(c))
        else:
            a, c, fc = c, d, fd
            d = a + phi * (b - a)
            fd = f(np.exp(d))
    x = np.exp((a + b) / 2)
    return float(x), float(f(x))


def make_test_tone(bank, out):
    """MEAS SAW with partial 1 copied byte for byte into partial 2."""
    from zencore import Schema, ToneFile
    from zencore.container import read_file
    from zencore.svd import unpack_ext
    from zencore.tone import Tone
    schema = Schema.load()
    raw = json.loads((ROOT / "zcformat.json").read_text())
    ents = lambda g: {e["id"]: e for e in raw[g] if isinstance(e, dict) and "id" in e}
    rec = bytearray(unpack_ext(read_file(str(bank))).image.tone_bytes(4))
    for g1 in [g for g in raw if g.endswith("_1")]:
        a, b = ents(g1), ents(g1[:-1] + "2")
        for pid, e in a.items():
            f = b[pid]
            rec[f["pos"]:f["pos"] + f["size"]] = rec[e["pos"]:e["pos"] + e["size"]]
    pmt = ents("PCMT_PMT")
    for pid, e in pmt.items():
        if pid.startswith("PMT_1_"):
            f = pmt["PMT_2_" + pid[6:]]
            rec[f["pos"]:f["pos"] + f["size"]] = rec[e["pos"]:e["pos"] + e["size"]]
    t = Tone(bytes(rec), schema)
    if t.name != "MEAS SAW":
        raise SystemExit(f"slot 5 is {t.name!r}, not 'MEAS SAW'")
    t.name = "STRUCT TEST"
    for n in (1, 2):
        for pid, v in (("CUTOFF", 1023), ("MCTL_1_SENS1", 0), ("MCTL_2_SENS1", 0), ("LEVEL_VSENS", 0)):
            t.set(f"PCMT_PTL_{n}", pid, v)
    tf = ToneFile.open(ROOT / "tests/data/ZENOLOGY_Test1.svz", schema)
    tf.tones[0] = t
    out.parent.mkdir(parents=True, exist_ok=True)
    tf.save(out)
    print(f"wrote {out.relative_to(ROOT)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--make-test-tone", action="store_true",
                    help="write renders/struct/test.svz from the bank's slot 5 and exit")
    ap.add_argument("--bank", default=str(Path.home() / "Library/Application Support/Roland Cloud/ZENOLOGY/User.bin"))
    a = ap.parse_args(argv)
    if a.make_test_tone:
        make_test_tone(Path(a.bank), STRUCT_RUNS / "test.svz")
        return 0

    st = current()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        s = Scorer("ring-lvl", tmp)
        st["ring"], e = golden(lambda x: s.score({**st, "ring": x}, [64, 127]), 0.05, 20)
        print(f"ring      {st['ring']:.4f}   level error {e:.2f} dB")
        s = Scorer("ring-o2lv", tmp)
        st["ringOsc2"], e = golden(lambda x: s.score({**st, "ringOsc2": x}, [64, 127]), 0.02, 4)
        print(f"ringOsc2  {st['ringOsc2']:.4f}   level error {e:.2f} dB")
        s = Scorer("xmod-o2cut", tmp)
        st["xmodOsc2"], e = golden(lambda x: s.score({**st, "xmodOsc2": x}), 0.02, 4)
        print(f"xmodOsc2  {st['xmodOsc2']:.4f}   level error {e:.2f} dB")
        s1, s2 = Scorer("xmod-dep", tmp), Scorer("xmod-dep12", tmp)
        deep = [2400, 4800, 9600]
        st["xmod"], e = golden(lambda x: (s1.score({**st, "xmod": x}, deep, "spectrum")
                                          + s2.score({**st, "xmod": x}, deep, "spectrum")) / 2,
                               0.02, 3)
        print(f"xmod      {st['xmod']:.4f}   spectrum error {e:.2f} dB (depth 2400-9600)")
        s1, s2 = Scorer("xmod2-dep", tmp), Scorer("xmod2-dep12", tmp)
        tab = [[0, 0.0]]
        for d in (16, 32, 64, 96, 127):
            def err(x, d=d):
                t = sorted([p for p in tab if p[0] != d] + [[d, x], [128, x * 1.2]])
                return (s1.score({**st, "xmod2": t}, [d], "spectrum")
                        + s2.score({**st, "xmod2": t}, [d], "spectrum")) / 2
            x, e = golden(err, 0.002, 2)
            tab.append([d, round(x, 5)])
            print(f"xmod2     depth {d:3d}: index {x:.4f}   spectrum error {e:.2f} dB")
        st["xmod2"] = tab
    print(json.dumps(st))
    if a.write:
        src = DSP.read_text()
        m = re.search(r"/\*STRUCT_TABLES\*/(.*?)/\*END_STRUCT_TABLES\*/", src, re.S)
        DSP.write_text(src[:m.start(1)] + json.dumps({k: (round(v, 5) if isinstance(v, float) else v)
                                                      for k, v in st.items()}) + src[m.end(1):])
        print(f"wrote STRUCT into {DSP.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
