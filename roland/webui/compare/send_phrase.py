#!/usr/bin/env python3
"""Play a phrase into an external synth over MIDI - the reference side of an A/B.

Sends the same notes `webui/compare/render.mjs --seq` renders, so what you hear
from Zenology and what our VA synth produced are directly comparable.

    uv run --with python-rtmidi webui/compare/send_phrase.py --list
    uv run --with python-rtmidi webui/compare/send_phrase.py --seq 62,65,69,74,69,65

Defaults to Logic Pro Virtual In, MIDI channel 1. The receiving synth must be
loaded and listening (in Logic: a track with Zenology, record-enabled).
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-rtmidi"]
# ///

import argparse
import sys
import time

import rtmidi

DEFAULT_SEQ = "62,65,69,74,69,65"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true", help="list output ports and exit")
    ap.add_argument("--seq", default=DEFAULT_SEQ, help="comma-separated MIDI notes")
    ap.add_argument("--gap", type=float, default=0.5, help="seconds between note starts")
    ap.add_argument("--legato", type=float, default=0.85, help="note length as a fraction of gap")
    ap.add_argument("--velocity", type=int, default=100)
    ap.add_argument("--channel", type=int, default=1, help="MIDI channel, 1-16")
    ap.add_argument("--verbose", action="store_true", help="print every MIDI message")
    ap.add_argument("--sweep", action="store_true",
                    help="send one note per channel 1-16 to find which one gets through")
    ap.add_argument("--sweep-base", type=int, default=48,
                    help="channel N plays note base+N during a sweep")
    # Logic is the host we drive interactively. capture_ref.py uses IAC Bus 1
    # for recorded references - pass --port "IAC" for that route.
    ap.add_argument("--port", default="Logic Pro Virtual In",
                    help="output port name or index")
    args = ap.parse_args(argv)

    out = rtmidi.MidiOut()
    ports = out.get_ports()
    if args.list or not ports:
        for i, name in enumerate(ports):
            print(f"  {i}: {name}")
        if not ports:
            print("  (none - enable IAC Driver in Audio MIDI Setup)")
        return 0

    try:
        index = int(args.port)
    except ValueError:
        matches = [i for i, n in enumerate(ports) if args.port.lower() in n.lower()]
        if not matches:
            print(f"no port matching {args.port!r}; available: {ports}", file=sys.stderr)
            return 1
        index = matches[0]

    status_on = 0x90 | (args.channel - 1)
    status_off = 0x80 | (args.channel - 1)
    notes = [int(n) for n in args.seq.split(",")]

    if args.sweep:
        # One note per channel, a different pitch on each, so whichever channel
        # the receiving track actually listens on identifies itself by pitch.
        # If the track is set to All, you hear a rising run of 16.
        out.open_port(index)
        print(f"{ports[index]}: sweeping channels 1-16, "
              f"channel N plays note {args.sweep_base}+N")
        try:
            for ch in range(1, 17):
                note = args.sweep_base + ch
                on, off = 0x90 | (ch - 1), 0x80 | (ch - 1)
                print(f"  ch {ch:2}  status 0x{on:02X}  note {note}")
                out.send_message([on, note, args.velocity])
                time.sleep(0.45)
                out.send_message([off, note, 0])
                time.sleep(0.15)
        finally:
            for ch in range(1, 17):
                out.send_message([0xB0 | (ch - 1), 123, 0])
            del out
        print("done - the pitch you heard tells you which channel got through")
        return 0

    out.open_port(index)
    print(f"{ports[index]}, channel {args.channel}: {notes} "
          f"(gap {args.gap}s, vel {args.velocity})")
    # Show the wire bytes: the low nibble of the status byte IS the channel,
    # zero-based, so channel 1 must send 0x90 / 0x80.
    print(f"  note-on status 0x{status_on:02X}  note-off status 0x{status_off:02X}"
          f"  -> channel {(status_on & 0x0F) + 1}")
    try:
        for n in notes:
            out.send_message([status_on, n, args.velocity])
            if args.verbose:
                print(f"    [0x{status_on:02X} {n} {args.velocity}] note on  {n}")
            time.sleep(args.gap * args.legato)
            out.send_message([status_off, n, 0])
            if args.verbose:
                print(f"    [0x{status_off:02X} {n} 0] note off {n}")
            time.sleep(args.gap * (1 - args.legato))
    finally:
        for n in notes:                       # never leave a note stuck on
            out.send_message([status_off, n, 0])
        out.send_message([0xB0 | (args.channel - 1), 123, 0])   # all notes off
        del out
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
