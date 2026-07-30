#!/usr/bin/env python3
"""Sweep a plugin parameter, render each step, and stitch it into one WAV.

Measurement you cannot hear is hard to trust, so every sweep produces audio as
well as numbers: one note per step, in order, with a short gap between. Play it
and you hear the parameter move.

    uv run --with dawdreamer --with numpy --with scipy \
        webui/compare/audition.py --param 90 --steps 8 --play

    # once a patch state exists, use it instead of the plugin default
    ... --state states/laser.state

Prints the measured rolloff per step, so the audio and the numbers come from
exactly the same renders.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["dawdreamer", "numpy", "scipy"]
# ///

import argparse
import subprocess
import sys
from pathlib import Path

import dawdreamer as dd
import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
VST = "/Library/Audio/Plug-Ins/VST3/Roland/ZENOLOGY.vst3"


def render(param, value, note, dur, state, tag):
    engine = dd.RenderEngine(SR, 512)
    p = engine.make_plugin_processor(f"z{tag}", VST)
    if state:
        p.load_state(state)
    if param is not None:
        p.set_parameter(param, value)
    text = p.get_parameter_text(param) if param is not None else ""
    p.add_midi_note(note, 100, 0.15, dur * 0.7)
    engine.load_graph([(p, [])])
    engine.render(dur)
    return engine.get_audio(), text


def rolloff(x, frac=0.85):
    f, pw = welch(x, SR, nperseg=8192, noverlap=4096)
    m = (f >= 30) & (f <= 20000)
    f, pw = f[m], pw[m]
    if pw.sum() <= 0:
        return 0.0
    return float(f[np.searchsorted(np.cumsum(pw) / pw.sum(), frac)])


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--param", type=int, help="plugin parameter index to sweep")
    ap.add_argument("--steps", type=int, default=8)
    ap.add_argument("--lo", type=float, default=0.0)
    ap.add_argument("--hi", type=float, default=1.0)
    ap.add_argument("--note", type=int, default=48)
    ap.add_argument("--dur", type=float, default=1.6)
    ap.add_argument("--gap", type=float, default=0.15)
    ap.add_argument("--state", help="plugin state file from grab_state.py")
    ap.add_argument("--out", default="renders/audition.wav")
    ap.add_argument("--play", action="store_true", help="play it when done (macOS afplay)")
    a = ap.parse_args(argv)

    values = ([0.0] if a.param is None
              else list(np.linspace(a.lo, a.hi, a.steps)))
    gap = np.zeros((2, int(a.gap * SR)), dtype=np.float32)

    chunks, rows = [], []
    name = None
    for i, v in enumerate(values):
        audio, text = render(a.param, float(v), a.note, a.dur, a.state, i)
        if name is None and a.param is not None:
            e = dd.RenderEngine(SR, 512)
            name = e.make_plugin_processor("n", VST).get_parameter_name(a.param)
        mono = audio.mean(axis=0)
        rows.append((v, text, rolloff(mono), float(np.abs(mono).max())))
        chunks.extend([audio, gap])

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    full = np.concatenate(chunks, axis=1)
    wavfile.write(out, SR, (np.clip(full.T, -1, 1) * 32767).astype(np.int16))

    if a.param is not None:
        print(f"parameter [{a.param}] {name}\n")
        print(f"  {'value':>6} {'reads':>7} {'rolloff':>10} {'peak':>8}")
        for v, text, roll, pk in rows:
            print(f"  {v:6.2f} {text:>7} {roll:9.0f}Hz {pk:8.4f}")
    print(f"\nwrote {out}  ({full.shape[1]/SR:.1f}s, {len(values)} steps)")

    if a.play:
        if sys.platform != "darwin":
            print("--play is macOS only", file=sys.stderr)
        else:
            subprocess.run(["afplay", str(out)])
            print("played")
    return 0


if __name__ == "__main__":
    sys.exit(main())
