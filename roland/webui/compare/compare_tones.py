#!/usr/bin/env python3
"""Whole-tone A/B: real tones rendered by Zenology and by our synth, scored.

The feature fits (filters, envelopes, oscillators, SuperSAW) each isolate one
parameter on a measurement tone. This is the acceptance test on top of them:
play a real tone in both and see what is still different - which also ranks
the unmeasured features by how much they matter.

Render each tone in Zenology with zen_bank.py --tone, once dry (MFX, chorus and
reverb off - what our synth can match) and once as saved (wet):

    uv run --with dawdreamer --with numpy --with scipy webui/compare/zen_bank.py \\
        --slot 5 --tone "tests/data/ZENOLOGY_User2.svz#2" --notes 36,48,60,72 \\
        --hold 2.0 --dur 4.0 --set MFX.mfxSwitch=0 --set MFX.choSend=0 \\
        --set MFX.revSend=0 --param velocity --values 100 --out renders/tones/laser-dry
    (the same without the three --set into renders/tones/laser-wet)

Then:

    uv run --with numpy --with scipy webui/compare/compare_tones.py
    uv run --with numpy --with scipy webui/compare/compare_tones.py --listen   # + A/B wavs

Per tone and note, ours vs Zenology dry:
  level     rms over the held note, dB
  spectrum  third-octave band levels (Welch, over the held note), level-aligned;
            mean |diff| over bands within 50 dB of the loudest
  envelope  20 ms rms frames in dB, level-aligned, mean |diff| above -50 dB
and wet vs dry: how much Zenology's effects change the tone (a gap our synth
cannot close until effects exist).
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "scipy"]
# ///
import argparse
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
from zencore.container import read_file  # noqa: E402
from zencore.svd import unpack_ext  # noqa: E402
from zencore.tone import Tone  # noqa: E402
from zencore.va import va_patch  # noqa: E402

BANK = Path.home() / "Library/Application Support/Roland Cloud/ZENOLOGY/User.bin"
EDGES = 25 * 2 ** (np.arange(0, 31) / 3)          # third-octave bands, 25 Hz - 25 kHz


def load(path):
    _sr, d = wavfile.read(path)
    x = d.astype(float).mean(axis=1) if d.ndim > 1 else d.astype(float)
    return x / 32768 if np.abs(x).max() > 2 else x


def onset(x, lead):
    i0 = max(0, int((lead - 0.02) * SR))
    a = np.abs(x[i0:i0 + int(1.0 * SR)])
    return (i0 + int(np.argmax(a > 0.02 * a.max()))) / SR


def bands(x, t0, t1):
    f, p = welch(x[int(t0 * SR):int(t1 * SR)], SR, nperseg=8192, noverlap=4096)
    return np.array([10 * np.log10(p[(f >= a) & (f < b)].sum() + 1e-20)
                     for a, b in zip(EDGES[:-1], EDGES[1:])])


def frames(x, t0, t1, hop=0.02):
    n = int(hop * SR)
    seg = x[int(t0 * SR):int(t1 * SR)]
    return np.array([10 * np.log10(np.mean(seg[i:i + n] ** 2) + 1e-20)
                     for i in range(0, len(seg) - n, n)])


def source_tone(spec, schema, bank):
    if spec.startswith("slot:"):
        return Tone(unpack_ext(read_file(str(bank))).image.tone_bytes(int(spec[5:]) - 1), schema)
    path, _, i = spec.partition("#")
    return ToneFile.open(ROOT / path, schema).tones[int(i or 0)]


def ours(tone, note, velocity, m, lead, tmp):
    (tmp / "p.json").write_text(json.dumps(va_patch(tone)))
    subprocess.run(["node", str(ROOT / "webui/compare/render.mjs"), str(tmp / "p.json"),
                    str(tmp / "o.wav"), "--note", str(note), "--velocity", str(velocity),
                    "--hold", str(m["hold"]), "--dur", str(m["dur"]), "--lead", str(lead)],
                   check=True, capture_output=True, cwd=ROOT)
    return load(tmp / "o.wav")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", default="renders/tones")
    ap.add_argument("--bank", default=str(BANK),
                    help="bank the 'slot:N' tones are read from (read-only)")
    ap.add_argument("--listen", action="store_true",
                    help="write <runs>/listen-<tone>.wav: Zenology dry, ours, Zenology wet per note")
    a = ap.parse_args(argv)

    schema = Schema.load()
    runs = ROOT / a.runs
    summary = []
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        for dry in sorted(runs.glob("*-dry")):
            name = dry.name[:-4]
            m = json.loads((dry / "manifest.json").read_text())
            wet_dir = runs / f"{name}-wet"
            wm = json.loads((wet_dir / "manifest.json").read_text()) if (wet_dir / "manifest.json").is_file() else None
            tone = source_tone(m["source"], schema, a.bank)
            for k, v in m["fixed"].items():
                g, _, pid = k.partition(".")
                tone.set(g, pid, v)
            vel = int(m["values"][0]) if m["param"] == "velocity" else (m["velocity"] or 100)
            print(f"\n{m['tone']!r} ({m['source']})")
            print("   note   level ours-zen   spectrum |diff|   envelope |diff|   wet-dry spectrum")
            listen = []
            for note in m["notes"]:
                zp = dry / m["files"][str(m["values"][0])][str(note)]
                z = load(zp)
                t_on = onset(z, m["lead"])
                o = ours(tone, note, vel, m, t_on, tmp)
                t0, t1 = t_on + 0.05, t_on + m["hold"] - 0.05
                rz, ro = np.sqrt(np.mean(z[int(t0 * SR):int(t1 * SR)] ** 2)), \
                    np.sqrt(np.mean(o[int(t0 * SR):int(t1 * SR)] ** 2))
                level = 20 * np.log10(ro / rz)
                bz, bo = bands(z, t0, t1), bands(o, t0, t1)
                keep = bz > bz.max() - 50
                d = (bo - bz)[keep]
                spec = float(np.mean(np.abs(d - np.median(d))))
                e_end = min(len(z), len(o)) / SR - 0.05
                fz, fo = frames(z, t_on, e_end), frames(o, t_on, e_end)
                n = min(len(fz), len(fo))
                fz, fo = fz[:n], fo[:n] - (20 * np.log10(ro / rz))
                ek = (fz > fz.max() - 50) | (fo > fz.max() - 50)
                env = float(np.mean(np.abs(np.maximum(fo[ek], fz.max() - 50) - np.maximum(fz[ek], fz.max() - 50))))
                wetd = ""
                if wm:
                    w = load(wet_dir / wm["files"][str(wm["values"][0])][str(note)])
                    tw = onset(w, wm["lead"])
                    bw = bands(w, tw + 0.05, tw + wm["hold"] - 0.05)
                    dd = (bw - bz)[keep]
                    wetd = f"{float(np.mean(np.abs(dd - np.median(dd)))):6.2f} dB"
                summary.append((name, note, level, spec, env))
                print(f"   {note:4d}   {level:+7.2f} dB      {spec:6.2f} dB         {env:6.2f} dB          {wetd}")
                if a.listen:
                    gap = np.zeros(int(0.4 * SR))
                    zseg = z[int((t_on - 0.02) * SR):]
                    oseg = o[int((t_on - 0.02) * SR):]
                    parts = [zseg, gap, oseg / max(1e-9, ro / rz), gap]
                    if wm:
                        parts += [w[int((tw - 0.02) * SR):], gap]
                    listen.append(np.concatenate(parts + [gap]))
            if a.listen and listen:
                out = runs / f"listen-{name}.wav"
                wavfile.write(out, SR, np.clip(np.concatenate(listen), -1, 1).astype(np.float32))
                print(f"   A/B: {out.relative_to(ROOT)}  (per note: Zenology dry, ours level-matched"
                      + (", Zenology wet)" if wm else ")"))

    print("\ntone              level |diff|   spectrum   envelope   (mean over notes, dB)")
    for name in dict.fromkeys(r[0] for r in summary):
        r = [x for x in summary if x[0] == name]
        print(f"  {name:14s}  {np.mean([abs(x[2]) for x in r]):8.2f}   {np.mean([x[3] for x in r]):8.2f}   {np.mean([x[4] for x in r]):8.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
