"""Adapter: expose the (now vendored) Swedish neural G2P as `phonemize(text) -> str`.

The G2P inference CODE lives in `swedish-kokoro/g2p/` (g2p_infer.py + model.py).
The large runtime artifacts — `g2p_model.pt` (22 MB) and `lexicon.tsv` (37 MB) —
are NOT in git; they auto-download from HuggingFace (`Joakim/swedish-kokoro` under
`g2p/`) and are cached, unless present locally in `g2p/`.

The neural `SwedishG2P` is hybrid NST-lexicon + neural fallback and returns
`list[list[str]]` (sentences -> IPA token lists), targeting the Piper voice's
phone inventory; its output still goes through `g2p_sv.SwedishG2P`'s KOKORO_REMAP +
vocab check before reaching Kokoro.

Overrides:
    SV_G2P_DIR        code dir (default: <this dir>/g2p)
    KOKORO_SV_REPO    HF repo hosting g2p/g2p_model.pt + g2p/lexicon.tsv
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
G2P_DIR = Path(os.environ.get("SV_G2P_DIR", ROOT / "g2p"))
sys.path.insert(0, str(G2P_DIR))

HF_REPO = os.environ.get("KOKORO_SV_REPO", "Joakim/swedish-kokoro")

_inst = None


def _resolve(local: Path, hf_name: str) -> str:
    """Local file if present, else download from HF (cached)."""
    if local.exists():
        return str(local)
    from huggingface_hub import hf_hub_download
    return hf_hub_download(repo_id=HF_REPO, filename=hf_name)


def _get():
    global _inst
    if _inst is None:
        from g2p_infer import SwedishG2P  # needs G2P_DIR on sys.path (imports model)
        model_path = _resolve(G2P_DIR / "g2p_model.pt", "g2p/g2p_model.pt")
        lexicon_path = _resolve(G2P_DIR / "lexicon.tsv", "g2p/lexicon.tsv")
        custom_path = G2P_DIR / "custom_lexicon.tsv"   # small, ships in git
        _inst = SwedishG2P(model_path=Path(model_path),
                           lexicon_path=Path(lexicon_path),
                           custom_path=custom_path)
    return _inst


def phonemize(text: str) -> str:
    """Flatten the neural G2P's nested token lists into one IPA string.

    Tokens already include ' ' between words within a sentence, so "".join keeps
    word spacing; sentences are re-joined with a space.
    """
    sents = _get().phonemize(text)
    return " ".join("".join(sent) for sent in sents)
