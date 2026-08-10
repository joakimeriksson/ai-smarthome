#!/usr/bin/env python3
"""Guided feature capture — walks through DSP tests one by one.

For each test, tells you what to set on Cherry Audio Elka-X,
waits for you to press Enter, then sends a MIDI note and records.
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

TESTS = [
    # --- Raw oscillators (filter wide open, no modulation) ---
    {
        "id": "osc-saw-A3",
        "setup": [
            "OSC1: Saw, 8', Volume 10",
            "OSC2: Off (Volume 0)",
            "Filter: LP1, Frequency 10 (wide open), Resonance 0",
            "Amp Env: A=0 D=0 S=10 R=0",
            "All modulation OFF",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    {
        "id": "osc-square-50pct",
        "setup": [
            "OSC1: Pulse, 8', PW=5 (center/50%), Volume 10",
            "OSC2: Off (Volume 0)",
            "Filter: wide open, no resonance",
            "Amp Env: A=0 D=0 S=10 R=0",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    {
        "id": "osc-square-25pct",
        "setup": [
            "OSC1: Pulse, 8', PW=2.5 (25%), Volume 10",
            "OSC2: Off (Volume 0)",
            "Filter: wide open",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    {
        "id": "osc-tri-A3",
        "setup": [
            "OSC1: Triangle, 8', Volume 10",
            "OSC2: Off (Volume 0)",
            "Filter: wide open",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    {
        "id": "osc-sine-A3",
        "setup": [
            "OSC1: Sine, 8', Volume 10",
            "OSC2: Off (Volume 0)",
            "Filter: wide open",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    # --- Filter ---
    {
        "id": "filter-lp24-resonance",
        "setup": [
            "OSC1: Saw, 8', Volume 10",
            "OSC2: Off",
            "Filter: LP1, Frequency 5, Resonance sweep 0→10 over 3 sec",
            "  (or just set Resonance to 7 for a static test)",
            "Amp Env: full sustain",
        ],
        "note": 57, "dur": 3.0, "total": 5.0,
    },
    {
        "id": "filter-bp12",
        "setup": [
            "OSC1: Saw, 8', Volume 10",
            "Filter: BP1, Frequency 5, Resonance 4",
            "Amp Env: full sustain",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    # --- Sync ---
    {
        "id": "sync-osc2-sweep",
        "setup": [
            "OSC1: Saw, 8', Volume 3",
            "OSC2: Saw, 8', Volume 7, OSC2 SYNC ON",
            "OSC2 Transpose: slowly turn from 0 to 12 during the note",
            "Filter: wide open",
        ],
        "note": 57, "dur": 4.0, "total": 6.0,
    },
    # --- Ring mod ---
    {
        "id": "ring-mod-fifth",
        "setup": [
            "OSC1: Sine, 8', Volume 0",
            "OSC2: Sine, 8', Transpose 7 (perfect 5th), Volume 10",
            "Ring Mod: ON",
            "Filter: wide open",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    # --- Cross mod ---
    {
        "id": "cross-mod-pwm",
        "setup": [
            "OSC1: Saw, 16' (one octave below), Volume 0",
            "OSC2: Pulse, 8', PW=5, Volume 10",
            "OSC2 PWM Mod: ON (cross-mod amount ~7)",
            "Filter: wide open",
        ],
        "note": 57, "dur": 2.0, "total": 4.0,
    },
    # --- ADSR ---
    {
        "id": "adsr-amp",
        "setup": [
            "OSC1: Saw, 8', Volume 7",
            "Filter: wide open",
            "Amp Env: A=1 D=3 S=5 R=5",
            "Hold note for 2 sec, then release — capture the full decay",
        ],
        "note": 57, "dur": 2.0, "total": 6.0,
    },
    # --- Full patches ---
    {
        "id": "patch-laser-harp",
        "setup": [
            "Load preset: Ring mod. (slot 4-6 / Laser Harp)",
            "Or set manually per the Wiffen spec",
        ],
        "note": 50, "dur": 10.0, "total": 15.0,
    },
    {
        "id": "patch-brass-1",
        "setup": [
            "Load a brass preset (detuned saws + filter env)",
            "Or: OSC1 Saw 8', OSC2 Saw 8' Detune=3ct",
            "Filter: LP1, Freq=4, Reso=2, Env=5.5",
            "Env: A=0.5 D=3 S=5 R=3",
        ],
        "note": 60, "dur": 2.0, "total": 4.0,
    },
]


def find_blackhole():
    devs = sd.query_devices()
    for i, d in enumerate(devs):
        if d["max_input_channels"] > 0 and "blackhole" in d["name"].lower():
            return i
    return None


def capture(test, midi_port=0, audio_device=0):
    lead_in = 1.5
    tail = test["total"] - test["dur"] - lead_in
    total = test["total"]
    out_path = os.path.join(REFS_DIR, f"{test['id']}.wav")

    # Record
    audio = {"buf": None}
    def rec():
        audio["buf"] = sd.rec(int(total * SR), samplerate=SR, channels=1,
                              device=audio_device, dtype="float32")
        sd.wait()
    t = threading.Thread(target=rec)
    t.start()
    time.sleep(lead_in)

    # Send note
    out = rtmidi.MidiOut()
    out.open_port(midi_port)
    print(f"  → Note ON {test['note']}")
    out.send_message([0x90, test["note"], 127])
    time.sleep(test["dur"])
    out.send_message([0x80, test["note"], 0])
    print(f"  → Note OFF")
    del out

    t.join()
    wavfile.write(out_path, SR, audio["buf"])
    peak = np.max(np.abs(audio["buf"]))
    print(f"  ✓ Saved: refs/{test['id']}.wav  (peak: {peak:.3f})")


def main():
    if "--list" in sys.argv:
        for t in TESTS:
            print(f"  {t['id']:24s} note={t['note']} dur={t['dur']}s")
        return

    audio_device = find_blackhole()
    if audio_device is None:
        print("BlackHole not found!")
        return
    print(f"Audio: BlackHole (device {audio_device})")
    print(f"MIDI: IAC Driver Bus 1 (port 0)\n")

    # Filter tests
    ids = [a for a in sys.argv[1:] if not a.startswith("-")]
    tests = [t for t in TESTS if t["id"] in ids] if ids else TESTS

    # All notes off
    out = rtmidi.MidiOut()
    out.open_port(0)
    for n in range(128):
        out.send_message([0x80, n, 0])
    del out
    time.sleep(0.3)

    for i, test in enumerate(tests):
        print(f"\n{'═'*60}")
        print(f"  TEST {i+1}/{len(tests)}: {test['id']}")
        print(f"{'═'*60}")
        print(f"\n  Set Cherry Audio Elka-X to:\n")
        for line in test["setup"]:
            print(f"    • {line}")
        print()
        input("  Press ENTER when ready (or Ctrl+C to quit)...")
        print(f"\n  Recording {test['total']:.0f}s...")
        capture(test, audio_device=audio_device)
        time.sleep(0.5)

    print(f"\n{'═'*60}")
    print(f"Done! {len(tests)} references captured.")
    print(f"Run: npm run compare")
    print(f"{'═'*60}")


if __name__ == "__main__":
    main()
