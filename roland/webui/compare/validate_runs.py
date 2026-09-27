#!/usr/bin/env python3
"""Score our synth against any zen_bank.py runs, render by render.

For every value and note in each run it rebuilds the exact tone Zenology played
(the run's --tone source or the slot's own tone, plus its --set changes and the
swept parameter), renders it through our synth with the same timing, and
reports:

  level     rms over the held note, ours - Zenology, dB
  spectrum  sixth-octave band levels (Welch), level-aligned, mean |diff| over
            bands within 50 dB of the loudest
  corr      waveform correlation over the held note - phase-sensitive, so it
            is only meaningful for deterministic, phase-locked settings

    uv run --with numpy --with scipy webui/compare/validate_runs.py renders/struct/sync-*

Runs sweeping a parameter the synth ignores show it at once (a flat Zenology
change our render does not follow). Filter and envelope runs have their own
validators (validate_filters.py, fit_env.py); this one is for everything else.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
import glob
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
from zencore import Schema, ToneFile  # noqa: E402
from zencore.container import parse  # noqa: E402
from zencore.svd import unpack_ext  # noqa: E402
from zencore.tone import Tone  # noqa: E402
from zencore.va import va_patch  # noqa: E402

EDGES = 25 * 2 ** (np.arange(0, 61) / 6)          # sixth-octave bands, 25 Hz - 25 kHz


def load(path):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    return x / 32768 if np.abs(x).max() > 2 else x


def onset(x, lead):
    i0 = max(0, int((lead - 0.02) * SR))
    a = np.abs(x[i0:i0 + int(1.5 * SR)])
    if a.max() == 0:
        return lead
    return (i0 + int(np.argmax(a > 0.02 * a.max()))) / SR


def bands(x):
    f, p = welch(x, SR, nperseg=min(8192, len(x)), noverlap=min(4096, len(x) // 2))
    return np.array([10 * np.log10(p[(f >= a) & (f < b)].sum() + 1e-20)
                     for a, b in zip(EDGES[:-1], EDGES[1:])])


def base_tone(run, m, schema):
    """The tone Zenology played before the swept parameter was applied."""
    src = m.get("source")
    if src:
        if src.startswith("slot:"):
            bank = (run / "User.bin.orig").read_bytes()
            t = Tone(unpack_ext(parse(bank)).image.tone_bytes(int(src[5:]) - 1), schema)
        else:
            path, _, i = src.partition("#")
            t = ToneFile.open(ROOT / path, schema).tones[int(i or 0)]
    else:
        bank = (run / "User.bin.orig").read_bytes()
        t = Tone(unpack_ext(parse(bank)).image.tone_bytes(m["slot"] - 1), schema)
    for k, v in m["fixed"].items():
        g, _, pid = k.partition(".")
        t.set(g, pid, v)
    return t


def render(tone, note, velocity, m, lead, tmp, scale=None, ctl=None):
    """Our synth's render; scale is passed as __ZC_SCALE (fitting overrides),
    ctl as --ctl controllers (default: the run's own, zen_bank.py --ctl)."""
    import os
    env = dict(os.environ)
    if scale is not None:
        env["ZC_SCALE"] = json.dumps(scale)
    (tmp / "p.json").write_text(json.dumps(va_patch(tone)))
    subprocess.run(["node", str(ROOT / "webui/compare/render.mjs"), str(tmp / "p.json"),
                    str(tmp / "o.wav"), "--note", str(note), "--velocity", str(velocity),
                    "--hold", str(m["hold"]), "--dur", str(m["dur"]), "--lead", str(lead)]
                   + [x for k, v in (m.get("ctl") or {} if ctl is None else ctl).items()
                      for x in ("--ctl", f"{k}={v}")],
                   check=True, capture_output=True, cwd=ROOT, env=env)
    return load(tmp / "o.wav")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("runs", nargs="+", help="run directories (globs allowed)")
    a = ap.parse_args(argv)

    schema = Schema.load()
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for pat in a.runs:
            for d in sorted(glob.glob(str(ROOT / pat) if not Path(pat).is_absolute() else pat)):
                run = Path(d)
                if not (run / "manifest.json").is_file():
                    continue
                m = json.loads((run / "manifest.json").read_text())
                base = base_tone(run, m, schema)
                by_vel = m["param"] == "velocity"
                by_ctl = m["param"].startswith("ctl:")
                g, _, pid = m["param"].partition(".")
                print(f"\n{run.relative_to(ROOT)}  ({m['tone']!r}, sweeping {m['param']})")
                print(f"  {'value':>6} {'note':>4}   level      spectrum   corr")
                for v in m["values"]:
                    tone = Tone(base.data, schema)
                    if not (by_vel or by_ctl):
                        tone.set(g, pid, v)
                    ctl = {**(m.get("ctl") or {}), m["param"][4:]: v} if by_ctl else None
                    vel = v if by_vel else (m["velocity"] or 100)
                    for note in m["notes"]:
                        z = load(run / m["files"][str(v)][str(note)])
                        t_on = onset(z, m["lead"])
                        o = render(tone, note, vel, m, t_on, tmp, ctl=ctl)
                        t0, t1 = int((t_on + 0.1) * SR), int((t_on + m["hold"] - 0.05) * SR)
                        zs, os_ = z[t0:t1], o[t0:t1]
                        rz, ro = np.sqrt(np.mean(zs ** 2)), np.sqrt(np.mean(os_ ** 2))
                        if rz < 1e-6 or ro < 1e-6:
                            state = "both silent" if rz < 1e-6 and ro < 1e-6 else \
                                ("Zenology silent" if rz < 1e-6 else "ours silent")
                            print(f"  {v:>6} {note:>4}   {state}")
                            rows.append((str(run), v, note, None, None, None))
                            continue
                        level = 20 * np.log10(ro / rz)
                        bz, bo = bands(zs), bands(os_)
                        keep = bz > bz.max() - 50
                        dd = (bo - bz)[keep]
                        spec = float(np.mean(np.abs(dd - np.median(dd))))
                        corr = float(np.dot(zs, os_) / np.sqrt(np.dot(zs, zs) * np.dot(os_, os_)))
                        rows.append((str(run), v, note, level, spec, corr))
                        print(f"  {v:>6} {note:>4}   {level:+6.2f} dB   {spec:5.2f} dB   {corr:+.3f}")
    ok = [r for r in rows if r[3] is not None]
    if ok:
        print(f"\n{len(ok)} renders: level |diff| mean {np.mean([abs(r[3]) for r in ok]):.2f} dB "
              f"(worst {max(abs(r[3]) for r in ok):.2f}); spectrum mean {np.mean([r[4] for r in ok]):.2f} dB "
              f"(worst {max(r[4] for r in ok):.2f})")
    silent = [r for r in rows if r[3] is None]
    if silent:
        print(f"{len(silent)} renders silent in one or both synths (listed above)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
