#!/usr/bin/env python3
"""Send a test MIDI note via IAC Driver to verify routing to external synth."""
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-rtmidi"]
# ///

import time
import sys
import rtmidi

def list_ports():
    out = rtmidi.MidiOut()
    ports = out.get_ports()
    print("MIDI output ports:")
    for i, name in enumerate(ports):
        print(f"  {i}: {name}")
    if not ports:
        print("  (none found — enable IAC Driver in Audio MIDI Setup)")
    del out

def send_note(port_index=0, note=60, velocity=100, duration=1.0):
    out = rtmidi.MidiOut()
    ports = out.get_ports()
    if port_index >= len(ports):
        print(f"Port {port_index} not found. Available: {ports}")
        sys.exit(1)
    out.open_port(port_index)
    print(f"Sending note {note} vel={velocity} on '{ports[port_index]}' for {duration}s...")
    out.send_message([0x90, note, velocity])  # note on
    time.sleep(duration)
    out.send_message([0x80, note, 0])          # note off
    print("Done.")
    del out

if __name__ == "__main__":
    if "--list" in sys.argv:
        list_ports()
    else:
        note = int(sys.argv[1]) if len(sys.argv) > 1 else 60
        dur = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
        port = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        send_note(port, note, 100, dur)
