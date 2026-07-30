#!/usr/bin/env python3
"""Select a Zenology tone by Bank Select + Program Change.

ZEN-Core addresses user tones with MSB 71 / LSB 3..6 (four banks of 128 = the
512 user tones the schema declares) - from JUPITERprmdb/productSettings.xml:

    <MidiBankSlot name="User Tone" group="0" firstMsb="71" firstLsb="3" banks="4"/>

This is what makes automated parameter sweeps possible without SysEx: write a
bank whose tones differ in one parameter, import it once, then step through
them with plain Program Change while capturing.

    uv run --with python-rtmidi webui/compare/send_program.py --slot 1
    uv run --with python-rtmidi webui/compare/send_program.py --slot 3 --note 62
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-rtmidi"]
# ///

import argparse
import sys
import time

import rtmidi

USER_MSB = 71
USER_LSB = 3


def open_port(fragment):
    out = rtmidi.MidiOut()
    ports = out.get_ports()
    matches = [i for i, n in enumerate(ports) if fragment.lower() in n.lower()]
    if not matches:
        print(f"no port matching {fragment!r}; have: {ports}", file=sys.stderr)
        sys.exit(1)
    out.open_port(matches[0])
    return out, ports[matches[0]]


def select(out, slot, channel=1, msb=USER_MSB, lsb=USER_LSB):
    """slot is 1-based across the whole user area."""
    index = slot - 1
    bank, program = divmod(index, 128)
    ch = channel - 1
    out.send_message([0xB0 | ch, 0, msb])            # CC0  bank select MSB
    out.send_message([0xB0 | ch, 32, lsb + bank])    # CC32 bank select LSB
    out.send_message([0xC0 | ch, program])           # program change
    return msb, lsb + bank, program


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--slot", type=int, required=True, help="1-based user tone slot")
    ap.add_argument("--channel", type=int, default=1)
    ap.add_argument("--msb", type=int, default=USER_MSB)
    ap.add_argument("--lsb", type=int, default=USER_LSB)
    ap.add_argument("--note", type=int, help="play this note after selecting")
    ap.add_argument("--hold", type=float, default=1.0)
    ap.add_argument("--port", default="Logic Pro Virtual In")
    a = ap.parse_args(argv)

    out, name = open_port(a.port)
    msb, lsb, program = select(out, a.slot, a.channel, a.msb, a.lsb)
    print(f"{name} ch{a.channel}: slot {a.slot} -> "
          f"CC0={msb} CC32={lsb} PC={program}")
    if a.note is not None:
        time.sleep(0.25)                       # let the tone load
        out.send_message([0x90 | (a.channel - 1), a.note, 100])
        time.sleep(a.hold)
        out.send_message([0x80 | (a.channel - 1), a.note, 0])
        print(f"  played note {a.note} for {a.hold}s")
    del out
    return 0


if __name__ == "__main__":
    sys.exit(main())
