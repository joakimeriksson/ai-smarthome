#!/usr/bin/env python3
"""One interactive patch pick, then a full measurement battery against it.

Zenology's editor DOES drive the audio processor (verified: 17.5 dB change vs a
1.3 dB render noise floor) but `save_state` does NOT capture the change - a
state saved after picking a patch is byte-identical to the default. So the
selection lives only in the running process, which means the right shape is:

    open editor -> pick patch -> close -> N automated renders in the SAME process

That is what this does. One click from you buys an unlimited number of
measurements.

    uv run --with dawdreamer --with numpy --with scipy \
        webui/compare/battery.py --out renders/battery

Each sweep writes an audition WAV (one note per step, in order) so the result
can be heard as well as read.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["dawdreamer", "numpy", "scipy"]
# ///

import argparse
import json
import sys
from pathlib import Path

import dawdreamer as dd
import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
VST = "/Library/Audio/Plug-Ins/VST3/Roland/ZENOLOGY.vst3"

#: (index, label, what it should tell us). Indices from the 301-parameter dump.
SWEEPS = [
    (90,  "CUTOFF",        "SCALE.cutoffHz - filter frequency law"),
    (91,  "RESO",          "SCALE.resoQ - resonance law"),
    (92,  "ATTACK",        "SCALE.envTime - envelope attack law"),
    (93,  "RELEASE",       "SCALE.envTime - envelope release law"),
    (123, "TVF CUTOFF 1",  "absolute per-partial cutoff (did nothing on a pad)"),
]


def rolloff(x, frac=0.85):
    f, pw = welch(x, SR, nperseg=8192, noverlap=4096)
    m = (f >= 30) & (f <= 20000)
    f, pw = f[m], pw[m]
    if pw.sum() <= 0:
        return 0.0, 0.0
    c = np.cumsum(pw) / pw.sum()
    return float(f[np.searchsorted(c, frac)]), float((f * pw).sum() / pw.sum())


def peakiness(x):
    """How far the loudest spectral peak stands above the local trend, in dB.

    Rolloff cannot see resonance - a resonant peak sits AT the corner and does
    not move it, which is why a resonance sweep reported 0.0 octaves. This
    measures the thing that actually changes: the height of the peak.
    """
    f, pw = welch(x, SR, nperseg=8192, noverlap=4096)
    m = (f >= 60) & (f <= 16000)
    f, pw = f[m], pw[m]
    if pw.sum() <= 0:
        return 0.0, 0.0
    db = 10 * np.log10(np.maximum(pw, 1e-16))
    # smooth over ~1/3 octave to get the trend, then look at the excess
    win = max(3, len(db) // 60)
    trend = np.convolve(db, np.ones(win) / win, mode="same")
    excess = db - trend
    i = int(np.argmax(excess))
    return float(excess[i]), float(f[i])


def envelope(x, hop=0.01):
    n = int(hop * SR)
    e = np.array([np.sqrt(np.mean(x[i*n:(i+1)*n] ** 2))
                  for i in range(len(x) // n)])
    return e / max(e.max(), 1e-12)


def timing(e, hop=0.01):
    """attack time to 90% of peak, and decay from peak to 10%."""
    peak = int(np.argmax(e))
    rise = np.where(e[:peak + 1] >= 0.9 * e.max())[0]
    atk = float(rise[0] * hop) if len(rise) else 0.0
    fall = np.where(e[peak:] < 0.1)[0]
    dec = float(fall[0] * hop) if len(fall) else float(len(e) - peak) * hop
    return atk, dec


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="renders/battery")
    ap.add_argument("--note", type=int, default=48)
    ap.add_argument("--steps", type=int, default=7)
    ap.add_argument("--dur", type=float, default=2.2)
    ap.add_argument("--skip-editor", action="store_true",
                    help="measure the default patch, no interaction")
    a = ap.parse_args(argv)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    engine = dd.RenderEngine(SR, 512)
    p = engine.make_plugin_processor("zen", VST)

    if not a.skip_editor:
        # A bare python process has no app bundle, so macOS gives its windows no
        # Dock icon, no activation policy and a default position - the editor
        # opens small, behind everything, and cannot be reached with cmd-tab.
        # Promoting ourselves to a regular app fixes all three.
        try:
            from AppKit import (NSApplication,
                                NSApplicationActivationPolicyRegular)
            app = NSApplication.sharedApplication()
            app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
            app.activateIgnoringOtherApps_(True)
            print("promoted to a foreground app - look for a Dock icon", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"(could not promote to foreground: {exc})", flush=True)
        print("EDITOR_OPEN - pick the patch, then CLOSE the window", flush=True)
        try:
            p.open_editor()
        except Exception as exc:  # noqa: BLE001
            print(f"open_editor failed: {exc}", file=sys.stderr)
            return 1
        print("editor closed - running battery\n", flush=True)

    baseline = {i: p.get_parameter(i) for i, _n, _w in SWEEPS}
    gap = np.zeros((2, int(0.12 * SR)), dtype=np.float32)
    report = {}

    for idx, label, why in SWEEPS:
        for j, _n, _w in SWEEPS:          # restore every other sweep's value
            p.set_parameter(j, baseline[j])
        rows, chunks = [], []
        for v in np.linspace(0.0, 1.0, a.steps):
            p.set_parameter(idx, float(v))
            text = p.get_parameter_text(idx)
            p.clear_midi()
            p.add_midi_note(a.note, 100, 0.15, a.dur * 0.55)
            engine.load_graph([(p, [])])
            engine.render(a.dur)
            audio = engine.get_audio()
            mono = audio.mean(axis=0)
            roll, cen = rolloff(mono)
            atk, dec = timing(envelope(mono))
            pk_db, pk_hz = peakiness(mono)
            rows.append({"value": float(v), "reads": text, "rolloff": roll,
                         "centroid": cen, "attack": atk, "decay": dec,
                         "peak_db": pk_db, "peak_hz": pk_hz,
                         "peak": float(np.abs(mono).max())})
            chunks.extend([audio, gap])
        p.set_parameter(idx, baseline[idx])

        wav = f"{out}-{label.replace(' ', '_').lower()}.wav"
        wavfile.write(wav, SR,
                      (np.clip(np.concatenate(chunks, axis=1).T, -1, 1) * 32767)
                      .astype(np.int16))
        report[label] = {"index": idx, "purpose": why, "wav": wav, "steps": rows}

        print(f"[{idx}] {label}   {why}")
        print(f"  {'val':>5} {'reads':>7} {'rolloff':>9} {'centroid':>9} "
              f"{'atk':>6} {'dec':>6} {'resPk':>7} {'peak':>7}")
        for r in rows:
            print(f"  {r['value']:5.2f} {r['reads']:>7} {r['rolloff']:8.0f}Hz "
                  f"{r['centroid']:8.0f}Hz {r['attack']:6.2f} {r['decay']:6.2f} "
                  f"{r['peak_db']:6.1f}dB {r['peak']:7.4f}")
        span = [r for r in rows if r["peak"] > 0.005]
        if len(span) > 2:
            v = np.array([r["value"] for r in span])
            fr = np.array([r["rolloff"] for r in span])
            if fr.min() > 0:
                k, b = np.polyfit(v, np.log2(fr), 1)
                print(f"  fit: rolloff = 2^({k:.2f}*v + {b:.2f})  "
                      f"= {k:.1f} octaves across the range")
        print(f"  audio: {wav}\n")

    Path(f"{out}-report.json").write_text(json.dumps(report, indent=1))
    print(f"wrote {out}-report.json")
    print("play any of the WAVs to hear the sweep the numbers came from")
    return 0


if __name__ == "__main__":
    sys.exit(main())
