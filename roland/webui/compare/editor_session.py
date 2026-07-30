#!/usr/bin/env python3
"""Render, let a patch be chosen in the editor, render again - same processor.

save_state() proved not to capture an editor patch change (the file was byte
identical to a fresh default). That left an untested question: does the change
reach the AUDIO PROCESSOR at all, or only the view?

This answers it without involving state at all. One processor object:

    render A  ->  open editor, change patch, close  ->  render B

If B differs from A by more than the ~1.3 dB render noise floor, the editor
does drive the processor and we can work interactively. If not, the view is
decorative in this host and headless patch selection is impossible.

    uv run --with dawdreamer --with numpy --with scipy \
        webui/compare/editor_session.py --out renders/editor-test
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["dawdreamer", "numpy", "scipy"]
# ///

import argparse
import sys
from pathlib import Path

import dawdreamer as dd
import numpy as np
from scipy.io import wavfile
from scipy.signal import welch

SR = 44100
VST = "/Library/Audio/Plug-Ins/VST3/Roland/ZENOLOGY.vst3"


def spec(x):
    f, pw = welch(x, SR, nperseg=8192, noverlap=4096)
    m = (f >= 30) & (f <= 20000)
    db = 10 * np.log10(np.maximum(pw[m], 1e-16))
    return f[m], db - db.max()


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default="renders/editor-test")
    ap.add_argument("--note", type=int, default=48)
    ap.add_argument("--dur", type=float, default=3.0)
    a = ap.parse_args(argv)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    engine = dd.RenderEngine(SR, 512)
    p = engine.make_plugin_processor("zen", VST)

    def render(tag):
        p.clear_midi()
        p.add_midi_note(a.note, 100, 0.2, a.dur * 0.6)
        engine.load_graph([(p, [])])
        engine.render(a.dur)
        x = engine.get_audio()
        wavfile.write(f"{out}-{tag}.wav", SR,
                      (np.clip(x.T, -1, 1) * 32767).astype(np.int16))
        return x.mean(axis=0)

    before = render("before")
    print(f"BEFORE peak {np.abs(before).max():.4f}", flush=True)
    print("EDITOR_OPEN", flush=True)

    try:
        p.open_editor()
    except Exception as exc:  # noqa: BLE001
        print(f"open_editor failed: {exc}", file=sys.stderr)
        return 1

    print("editor closed, rendering again", flush=True)
    after = render("after")
    print(f"AFTER  peak {np.abs(after).max():.4f}", flush=True)

    _f, da = spec(before)
    _f, db = spec(after)
    n = min(len(da), len(db))
    diff = float(np.abs(da[:n] - db[:n]).mean())
    print(f"\nspectral difference before vs after: {diff:.2f} dB "
          f"(render noise floor ~1.3 dB)")
    print("VERDICT:", "EDITOR DRIVES THE PROCESSOR" if diff > 3.0
          else "editor does NOT reach the processor")
    p.save_state(f"{out}-after.state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
