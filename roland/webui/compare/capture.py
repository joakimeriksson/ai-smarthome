#!/usr/bin/env python3
"""Record Zenology playing a phrase, for spectral comparison against our synth.

Sends MIDI to the plugin while recording its audio back through BlackHole, so
the reference and our render cover the same notes at the same times.

    uv run --with python-rtmidi --with sounddevice --with numpy --with scipy \
        webui/compare/capture.py --out refs/laser-sync-harp.wav

One setup step, on your side, because it changes an app setting:

  1. Audio MIDI Setup: a Multi-Output Device containing BlackHole 2ch AND your
     speakers (you already have one) - so you can hear it while it records.
  2. Logic: Settings > Audio > Output Device -> that Multi-Output Device.
  3. Load the patch under test into Zenology, track record-enabled, input All.

Then the compare loop is:

    uv run ... capture.py --out refs/laser.wav          # Zenology
    node webui/compare/render.mjs patch.json ours.wav --seq ...   # us
    uv run ... alias.py / spectral compare              # the difference
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-rtmidi", "sounddevice", "numpy", "scipy"]
# ///

import argparse
import sys
import threading
import time
from pathlib import Path

import numpy as np
import rtmidi
import sounddevice as sd
from scipy.io import wavfile

SR = 44100


def find_input(name_fragment="blackhole"):
    for i, d in enumerate(sd.query_devices()):
        if d["max_input_channels"] > 0 and name_fragment in d["name"].lower():
            return i, d["name"]
    return None, None


def open_midi(port_fragment):
    out = rtmidi.MidiOut()
    ports = out.get_ports()
    matches = [i for i, n in enumerate(ports) if port_fragment.lower() in n.lower()]
    if not matches:
        print(f"no MIDI port matching {port_fragment!r}; have: {ports}", file=sys.stderr)
        sys.exit(1)
    out.open_port(matches[0])
    return out, ports[matches[0]]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", required=True, help="WAV to write")
    ap.add_argument("--seq", default="62,65,69,74,69,65")
    ap.add_argument("--gap", type=float, default=0.5)
    ap.add_argument("--legato", type=float, default=0.85)
    ap.add_argument("--velocity", type=int, default=100)
    ap.add_argument("--channel", type=int, default=1)
    ap.add_argument("--tail", type=float, default=1.5, help="seconds to keep recording after the last note")
    ap.add_argument("--lead", type=float, default=0.3, help="seconds of silence before the first note")
    ap.add_argument("--port", default="Logic Pro Virtual In")
    ap.add_argument("--device", default="blackhole")
    args = ap.parse_args(argv)

    dev, dev_name = find_input(args.device)
    if dev is None:
        print(f"no input device matching {args.device!r}. Install BlackHole, or "
              f"pass --device with part of the name.", file=sys.stderr)
        return 1

    notes = [int(n) for n in args.seq.split(",")]
    dur = args.lead + len(notes) * args.gap + args.tail
    frames = int(dur * SR)

    midi, port_name = open_midi(args.port)
    on = 0x90 | (args.channel - 1)
    off = 0x80 | (args.channel - 1)

    print(f"recording {dev_name} for {dur:.1f}s while sending {notes} to {port_name}")
    buf = np.zeros((frames, 2), dtype=np.float32)
    done = threading.Event()

    def play():
        time.sleep(args.lead)
        for n in notes:
            midi.send_message([on, n, args.velocity])
            time.sleep(args.gap * args.legato)
            midi.send_message([off, n, 0])
            time.sleep(args.gap * (1 - args.legato))
        done.set()

    t = threading.Thread(target=play, daemon=True)
    with sd.InputStream(samplerate=SR, channels=2, device=dev) as stream:
        t.start()
        got = 0
        while got < frames:
            block, overflowed = stream.read(min(2048, frames - got))
            if overflowed:
                print("  (input overflow)", file=sys.stderr)
            buf[got:got + len(block)] = block
            got += len(block)

    for n in notes:
        midi.send_message([off, n, 0])
    midi.send_message([0xB0 | (args.channel - 1), 123, 0])
    del midi

    peak = float(np.abs(buf).max())
    rms = float(np.sqrt((buf ** 2).mean()))
    print(f"  peak {peak:.4f}  rms {rms:.4f}")
    if peak < 1e-4:
        print("  SILENT - is Logic's output set to the Multi-Output Device "
              "containing BlackHole, and the track record-enabled?", file=sys.stderr)

    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(path, SR, (np.clip(buf, -1, 1) * 32767).astype(np.int16))
    print(f"  wrote {path} ({dur:.2f}s @ {SR})")
    return 0 if peak >= 1e-4 else 2


if __name__ == "__main__":
    sys.exit(main())
