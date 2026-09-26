#!/usr/bin/env python3
"""Render variants of a user-bank tone in Zenology, one parameter at a time.

Zenology loads the tones in its user bank (User.bin) when a fresh plugin
instance starts, and a tone written there by zencore IS what it plays (verified
2026-09-22). So instead of steering the plugin, this writes copies of one slot
that differ only in the swept parameter and renders each in a new DawDreamer
process:

    uv run --with dawdreamer --with numpy --with scipy \
        webui/compare/zen_bank.py --slot 5 --param PCMT_PTL_1.CUTOFF \
        --values 192,256,320,384,448,512,576,640,704,768,832,896 \
        --out renders/cutoff

Before running:
  * Quit every host (Logic, etc). A running Zenology rewrites User.bin under
    us - see CLAUDE.md. The script refuses to start if it finds one.
  * The slot must be the tone Zenology has selected: a fresh instance opens on
    the last tone selected in any host, so select it once, then quit the host.

The original bank is restored byte for byte afterwards, also on error or
Ctrl-C, and a copy is kept as <out>/User.bin.orig in case the process is
killed outright. Writes one WAV per (value, note) plus patch.json (the VA view
of the unedited tone, for our renderer) and manifest.json describing the run -
the input fit_cutoff.py expects.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["dawdreamer", "numpy", "scipy"]
# ///
import argparse
import hashlib
import json
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))
from zencore import Schema  # noqa: E402
from zencore.container import build, parse  # noqa: E402
from zencore.svd import pack_ext, refresh_meta, unpack_ext  # noqa: E402
from zencore.tone import Tone  # noqa: E402
from zencore.va import va_patch  # noqa: E402

SR = 44100
VST = "/Library/Audio/Plug-Ins/VST3/Roland/ZENOLOGY.vst3"
BANK = Path.home() / "Library/Application Support/Roland Cloud/ZENOLOGY/User.bin"
HOSTS = "logic pro|mainstage|ableton|live$|reaper|bitwig|cubase|studio one|zenology"


def sha(data):
    return hashlib.sha1(data).hexdigest()[:12]


def running_hosts():
    r = subprocess.run(["pgrep", "-il", HOSTS], capture_output=True, text=True)
    return r.stdout.strip()


def variant(bank, index, changes, schema):
    """The bank with parameters of one slot changed, verified by re-reading.

    changes: {(group, id): value}. Returns (bank bytes, the edited Tone).
    """
    svz = parse(bank)
    ext = unpack_ext(svz)
    tone = Tone(ext.image.tone_bytes(index), schema)
    name = tone.name
    for (group, pid), value in changes.items():
        tone.set(group, pid, value)
    ext.image.set_tone_bytes(index, tone.data)
    pack_ext(svz, ext)
    refresh_meta(svz)
    data = build(svz)
    back = Tone(unpack_ext(parse(data)).image.tone_bytes(index), schema)
    for (group, pid), value in changes.items():
        if back.get(group, pid) != value:
            raise SystemExit(f"{group}.{pid}={value} did not survive a re-read")
    if back.name != name:
        raise SystemExit("tone name changed on re-read")
    return data, tone


def checked(schema, spec, values, ap):
    """Resolve GROUP.ID and range-check values, as a usage error on failure."""
    group, _, pid = spec.partition(".")
    try:
        param = schema.param(group, pid)
    except KeyError as exc:
        ap.error(str(exc).strip("'\""))
    lo, hi = param.get("min"), param.get("max")
    bad = [v for v in values if lo is not None and not lo <= v <= hi]
    if bad:
        ap.error(f"{spec} range is {lo}..{hi}, got {bad}")
    return group, pid


def render_child(a):
    """Runs in its own process: a fresh plugin instance reads the bank as it is."""
    import dawdreamer as dd
    import numpy as np
    from scipy.io import wavfile

    engine = dd.RenderEngine(SR, 512)
    p = engine.make_plugin_processor("zen", a.plugin)
    for note in a.notes:
        # --repeat plays the note again in the SAME plugin instance, to see
        # whether state (oscillator phases, drift) carries over between notes
        for r in range(a.repeat):
            p.clear_midi()
            p.add_midi_note(note, a.velocity, a.lead, a.hold)
            engine.load_graph([(p, [])])
            engine.render(a.dur)
            audio = engine.get_audio()
            if float(np.abs(audio).max()) == 0.0:
                raise SystemExit("silent render - is the plugin in Demo Mode? "
                                 "Log in via Roland Cloud Manager")
            suffix = "" if r == 0 else f"_r{r}"
            wavfile.write(f"{a.child}_n{note}{suffix}.wav", SR, audio.T.astype(np.float32))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--slot", type=int, help="user tone number, 1-based as Zenology shows it")
    ap.add_argument("--param", help="GROUP.ID, e.g. PCMT_PTL_1.CUTOFF - or 'velocity' "
                                    "to sweep the note velocity of one fixed tone")
    ap.add_argument("--values", help="comma-separated raw values")
    ap.add_argument("--set", action="append", default=[], metavar="GROUP.ID=VALUE",
                    help="hold another parameter at a value for the whole run "
                         "(repeatable), e.g. PCMT_PTL_1.CUTOFF=1023")
    ap.add_argument("--out", help="output directory")
    ap.add_argument("--notes", default="36,48,60", help="MIDI notes to render per value")
    ap.add_argument("--velocity", type=int, default=1,
                    help="1 by default: INIT-derived tones route velocity to PW, "
                         "so only velocity 1 plays a clean waveform")
    ap.add_argument("--lead", type=float, default=0.1, help="seconds before note-on")
    ap.add_argument("--hold", type=float, default=1.3, help="note length, seconds")
    ap.add_argument("--dur", type=float, default=1.6, help="render length, seconds")
    ap.add_argument("--repeat", type=int, default=1,
                    help="render each note this many times in one plugin instance "
                         "(extra takes are saved as ..._n<note>_r<i>.wav)")
    ap.add_argument("--plugin", default=VST)
    ap.add_argument("--child", help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    a.notes = [int(n) for n in str(a.notes).split(",")]

    if a.child:
        return render_child(a)
    if not (a.slot and a.param and a.values and a.out):
        ap.error("--slot, --param, --values and --out are required")

    values = [int(v) for v in a.values.split(",")]
    index = a.slot - 1
    schema = Schema.load()
    fixed = {}
    for spec in a.set:
        key, _, val = spec.partition("=")
        fixed[checked(schema, key, [int(val)], ap)] = int(val)
    by_velocity = a.param == "velocity"
    if by_velocity:
        if [v for v in values if not 1 <= v <= 127]:
            ap.error("velocity values must be 1..127")
        pid = "velocity"
    else:
        group, pid = checked(schema, a.param, values, ap)

    hosts = running_hosts()
    if hosts:
        raise SystemExit(f"quit these first, they would overwrite the bank:\n{hosts}")

    orig = BANK.read_bytes()
    _data, base = variant(orig, index, fixed, schema)     # the tone as rendered
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    # If this process is killed outright, the finally below never runs - this
    # copy is how to put the bank back by hand.
    (out / "User.bin.orig").write_bytes(orig)
    (out / "patch.json").write_text(json.dumps(va_patch(base), indent=1))
    manifest = {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        "slot": a.slot, "tone": base.name, "param": a.param,
        "base_value": a.velocity if by_velocity else base.get(group, pid),
        "values": values, "fixed": {f"{g}.{i}": v for (g, i), v in fixed.items()},
        "notes": a.notes, "velocity": None if by_velocity else a.velocity,
        "repeat": a.repeat,
        "lead": a.lead, "hold": a.hold, "dur": a.dur,
        "bank_sha1": sha(orig), "files": {},
    }
    print(f"slot {a.slot:03d} {base.name!r}: {a.param} is {manifest['base_value']}, "
          f"rendering {len(values)} values x notes {a.notes}")

    # Ctrl-C and SIGTERM both unwind through the finally below.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    expected = orig
    try:
        for v in values:
            if BANK.read_bytes() != expected:
                raise SystemExit("User.bin changed underneath us - is a host running?")
            changes = dict(fixed) if by_velocity else {**fixed, (group, pid): v}
            data, _tone = variant(orig, index, changes, schema)
            BANK.write_bytes(data)
            expected = data
            prefix = out / f"{pid}-{v}"
            r = subprocess.run(
                [sys.executable, __file__, "--child", str(prefix),
                 "--notes", ",".join(map(str, a.notes)),
                 "--velocity", str(v if by_velocity else a.velocity),
                 "--lead", str(a.lead), "--hold", str(a.hold), "--dur", str(a.dur),
                 "--repeat", str(a.repeat), "--plugin", a.plugin],
                capture_output=True, text=True)
            if r.returncode != 0:
                raise SystemExit(f"render of {pid}={v} failed:\n{r.stderr[-800:]}")
            manifest["files"][str(v)] = {str(n): f"{prefix.name}_n{n}.wav" for n in a.notes}
            print(f"  {pid}={v:5d}  ok", flush=True)
    finally:
        BANK.write_bytes(orig)
        ok = BANK.read_bytes() == orig
        print(f"bank restored: {'byte-identical' if ok else 'MISMATCH'} ({sha(orig)})")
        if not ok:
            raise SystemExit(f"restore FAILED - original bank sha1 {sha(orig)}")

    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"wrote {out}/manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
