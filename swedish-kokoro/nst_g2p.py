"""Adapter: expose the swedish-tts neural G2P as `phonemize(text) -> str`.

The neural `SwedishG2P` (swedish-tts/g2p/g2p_infer.py) is hybrid NST-lexicon +
neural fallback and returns `list[list[str]]` (sentences -> IPA token lists). It
targets the Piper voice's 116-phone inventory, NOT Kokoro's 114-symbol vocab, so
its output still goes through `g2p_sv.SwedishG2P`'s KOKORO_REMAP + vocab check.

Wire it for the recipe with:
    export SV_NEURAL_G2P=nst_g2p
    export SV_G2P_DIR=/home/ubuntu/work/ai-smarthome/swedish-tts/g2p   # default below
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

G2P_DIR = Path(os.environ.get(
    "SV_G2P_DIR", "/home/ubuntu/work/ai-smarthome/swedish-tts/g2p"))
sys.path.insert(0, str(G2P_DIR))

_inst = None


def _get():
    global _inst
    if _inst is None:
        from g2p_infer import SwedishG2P  # needs G2P_DIR on sys.path (imports model)
        _inst = SwedishG2P()
    return _inst


def phonemize(text: str) -> str:
    """Flatten the neural G2P's nested token lists into one IPA string.

    Tokens already include ' ' between words within a sentence, so "".join keeps
    word spacing; sentences are re-joined with a space.
    """
    sents = _get().phonemize(text)
    return " ".join("".join(sent) for sent in sents)
