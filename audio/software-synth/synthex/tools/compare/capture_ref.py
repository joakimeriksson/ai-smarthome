#!/usr/bin/env python3
"""Capture reference audio from an external synth via MIDI + BlackHole.

Sends MIDI notes via IAC Driver while recording audio via sounddevice/CoreAudio.
Saves WAV files to tools/compare/refs/ for spectral comparison.
"""
# /// script
# requires-python = ">=3.10"
# dependencies = ["python-rtmidi", "sounddevice", "numpy", "scipy"]
# ///

import threading
import time
import sys
import os
import numpy as np
import sounddevice as sd
from scipy.io import wavfile
import rtmidi

REFS_DIR = os.path.join(os.path.dirname(__file__), "refs")
os.makedirs(REFS_DIR, exist_ok=True)

SR = 44100

SCENARIOS = {
    "osc-saw-A3": {"notes": [(57, 2.0)], "dur": 3.5, "desc": "Saw A3 — set synth to raw saw, filter open"},
    "osc-square-50pct": {"notes": [(57, 2.0)], "dur": 3.5, "desc": "Square 50% A3"},
    "osc-tri-A3": {"notes": [(57, 2.0)], "dur": 3.5, "desc": "Triangle A3"},
    "osc-sine-A3": {"notes": [(57, 2.0)], "dur": 3.5, "desc": "Sine A3"},
    "patch-laser-harp": {"notes": [(50, 10.0)], "dur": 13.0, "desc": "Ring mod / Laser Harp (slot 46) — D3, 10s hold"},
    "patch-brass-1": {"notes": [(60, 2.0)], "dur": 3.5, "desc": "Brass I (slot 17) — C4"},
    "ring-mod-fifth": {"notes": [(57, 2.0)], "dur": 3.5, "desc": "Ring mod — A3 (set osc2 +7 semis)"},
    "sync-osc2-sweep": {"notes": [(57, 3.0)], "dur": 4.5, "desc": "Hard sync sweep — A3"},
}


def find_blackhole_device():
    """Find BlackHole device index."""
    devs = sd.query_devices()
    for i, d in enumerate(devs):
        if d["max_input_channels"] > 0 and "blackhole" in d["name"].lower():
            return i, d["name"]
    return None, None


def record_and_send(scenario_id, midi_port=0, audio_device=0):
    sc = SCENARIOS[scenario_id]
    lead_in = 1.5
    tail = 1.5
    total = lead_in + sc["dur"] + tail

    out_path = os.path.join(REFS_DIR, f"{scenario_id}.wav")

    print(f"\n{'─'*60}")
    print(f"  {scenario_id}: {sc['desc']}")
    print(f"  Recording {total:.1f}s from device {audio_device}")
    print(f"{'─'*60}")

    # Start recording in a thread
    audio_data = {"buf": None}

    def record():
        audio_data["buf"] = sd.rec(
            int(total * SR), samplerate=SR, channels=1,
            device=audio_device, dtype="float32",
        )
        sd.wait()

    rec_thread = threading.Thread(target=record)
    rec_thread.start()

    # Wait for lead-in
    time.sleep(lead_in)

    # Send MIDI notes
    out = rtmidi.MidiOut()
    out.open_port(midi_port)
    for note, dur in sc["notes"]:
        print(f"  → Note ON  {note} vel=127")
        out.send_message([0x90, note, 127])
        time.sleep(dur)
        out.send_message([0x80, note, 0])
        print(f"  → Note OFF {note}")
        time.sleep(0.1)
    del out

    # Wait for recording to finish
    rec_thread.join()
    buf = audio_data["buf"]

    # Save
    wavfile.write(out_path, SR, buf)
    peak = np.max(np.abs(buf))
    print(f"  ✓ Saved: refs/{scenario_id}.wav  (peak: {peak:.3f} / {20*np.log10(peak+1e-10):.1f} dBFS)")


def main():
    midi_port = 0
    audio_device = None

    if "--help" in sys.argv or "-h" in sys.argv:
        print("Usage: capture_ref.py [scenario ...] [--port N] [--audio N] [--list]")
        print("\nCaptures audio from external synth while sending MIDI notes.")
        print("Set the target synth to the matching preset before capturing.")
        sys.exit(0)

    if "--list" in sys.argv:
        print("Available scenarios:")
        for sid, sc in SCENARIOS.items():
            print(f"  {sid:24s} {sc['desc']}")

        bh_idx, bh_name = find_blackhole_device()
        if bh_idx is not None:
            print(f"\nBlackHole: [{bh_idx}] {bh_name}")
        else:
            print("\nBlackHole not found!")

        out = rtmidi.MidiOut()
        print(f"MIDI ports: {out.get_ports()}")
        del out
        sys.exit(0)

    if "--port" in sys.argv:
        midi_port = int(sys.argv[sys.argv.index("--port") + 1])
    if "--audio" in sys.argv:
        audio_device = int(sys.argv[sys.argv.index("--audio") + 1])
    else:
        bh_idx, bh_name = find_blackhole_device()
        if bh_idx is not None:
            audio_device = bh_idx
            print(f"Using {bh_name} (device {bh_idx})")
        else:
            print("BlackHole not found! Specify --audio <device>")
            sys.exit(1)

    # Which scenarios to run
    scenario_ids = [a for a in sys.argv[1:] if not a.startswith("-") and a in SCENARIOS]
    if not scenario_ids:
        scenario_ids = ["patch-laser-harp"]

    # All notes off first
    out = rtmidi.MidiOut()
    out.open_port(midi_port)
    for n in range(128):
        out.send_message([0x80, n, 0])
    del out
    time.sleep(0.3)

    for sid in scenario_ids:
        record_and_send(sid, midi_port, audio_device)
        time.sleep(0.5)

    print(f"\nDone! Run: npm run compare")


if __name__ == "__main__":
    main()
