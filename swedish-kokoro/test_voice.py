"""Test the fine-tuned Swedish Kokoro voice on the Mac (CPU).

Loads the trained KModel weights + the Swedish voicepack, phonemizes with the
SAME G2P used in training (g2p_sv -> neural if SV_NEURAL_G2P is set), and
synthesizes a wav. Kokoro is 82M params, so this runs comfortably realtime on
CPU.

    pixi run python test_voice.py --text "Hej, det här är min nya svenska röst."

NOTE: the exact KModel construction depends on the kikiri recipe's output format.
The integration point below is marked; align it with the recipe's "KModel
inference" example once the artifacts are in ./voices.
"""
from __future__ import annotations

import argparse
import wave
from pathlib import Path

import numpy as np

from g2p_sv import SwedishG2P, validate_against_kokoro, kokoro_vocab

DEFAULT_TEXT = "Hej, det här är min nya svenska röst tränad med Kokoro."


def synth(model_pth: str, voicepack: str, phonemes: str):
    """Return (audio_int16, sample_rate). Uses the kokoro PyTorch package."""
    import torch
    from kokoro import KModel  # pip install kokoro (pytorch)

    # --- recipe-specific integration point ----------------------------------
    # The kikiri recipe exports a KModel-compatible .pth + a voicepack tensor.
    model = KModel(model=model_pth).eval()
    voice = torch.load(voicepack, map_location="cpu")
    # KModel synth from phoneme string + style vector (voicepack). The recipe's
    # inference example shows the precise call; this is the canonical shape:
    style = voice[len(phonemes) - 1] if voice.ndim == 3 else voice
    with torch.no_grad():
        audio = model(phonemes, style)
    # ------------------------------------------------------------------------
    audio = np.asarray(audio, dtype=np.float32).squeeze()
    pcm = np.clip(audio, -1, 1)
    return (pcm * 32767).astype(np.int16), 24000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default=DEFAULT_TEXT)
    ap.add_argument("--model", default="voices/sv_kokoro.model.pth")
    ap.add_argument("--voicepack", default="voices/sv_kokoro.voicepack.pt")
    ap.add_argument("--out", default="output/sv_kokoro_test.wav")
    args = ap.parse_args()

    g2p = SwedishG2P()  # neural if SV_NEURAL_G2P is set, else espeak
    ph = g2p(args.text)
    print(f"G2P backend : {g2p.backend}")
    print(f"phonemes    : {ph}")

    misses = validate_against_kokoro([ph], kokoro_vocab())
    if misses:
        print(f"⚠️  out-of-vocab symbols (fix KOKORO_REMAP): {misses}")

    audio, sr = synth(args.model, args.voicepack, ph)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(out.as_posix(), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(audio.tobytes())
    print(f"wrote {out}  ({len(audio)/sr:.2f}s @ {sr} Hz)")
    print("play it:  afplay", out)


if __name__ == "__main__":
    main()
