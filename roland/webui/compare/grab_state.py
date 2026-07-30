#!/usr/bin/env python3
"""Open Zenology's editor once, so a patch can be chosen, then save the state.

The plugin state is Roland's own opaque format (magic VC2!, ~218 kB) - we can
save and reload it, but we cannot synthesise one from a .svz. So selecting a
patch for headless work needs exactly one interactive session:

    uv run --with dawdreamer webui/compare/grab_state.py --out states/laser.state

Choose the patch in the window, then CLOSE the window. The state is written on
close, and every later run is fully automated:

    p.load_state("states/laser.state")      # no GUI, no Logic, no BlackHole
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["dawdreamer", "numpy"]
# ///

import argparse
import sys
from pathlib import Path

import dawdreamer as dd

VST = "/Library/Audio/Plug-Ins/VST3/Roland/ZENOLOGY.vst3"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True, help="state file to write on close")
    ap.add_argument("--plugin", default=VST)
    a = ap.parse_args(argv)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)

    engine = dd.RenderEngine(44100, 512)
    p = engine.make_plugin_processor("zen", a.plugin)
    print("plugin loaded; opening editor", flush=True)
    print("EDITOR_OPEN", flush=True)

    try:
        p.open_editor()          # blocks until the window is closed
    except Exception as exc:     # noqa: BLE001
        print(f"open_editor failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print("editor closed; saving state", flush=True)
    p.save_state(str(out))
    size = out.stat().st_size if out.exists() else 0
    print(f"wrote {out} ({size} bytes)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
