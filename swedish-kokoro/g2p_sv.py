"""Swedish grapheme-to-phoneme for Kokoro training.

Kokoro/StyleTTS2 consume an IPA phoneme STRING per utterance. Quality of that
string dominates final voice quality, so we prefer the **neural G2P** trained on
the NST lexicon (the one that beat espeak for the Piper voice) and fall back to
espeak-ng only when it is unavailable.

Whatever the source, the phoneme string MUST stay inside Kokoro's fixed symbol
vocabulary (114 symbols mapped onto sparse ids in a 178-slot space — see
kokoro_symbols.py). `validate_against_kokoro()` checks this against the AUTHORITATIVE
vocab from Kokoro's config.json (NOT kokoro-onnx, which differs), and the remap table
fixes the symbols a Swedish G2P emits that Kokoro lacks. Verified empirically (June
2026): espeak-ng `sv` emits exactly two out-of-vocab symbols, ɵ and ʉ, both remapped
below to in-vocab central vowels that Swedish does not otherwise use (no contrast
collapse).

Usage:
    from g2p_sv import SwedishG2P
    g2p = SwedishG2P()                 # auto: neural if importable, else espeak
    phonemes = g2p("Paris är huvudstaden i Frankrike.")
"""
from __future__ import annotations

import os
import re
import importlib
from typing import Callable

# Symbols a Swedish neural G2P may emit that are NOT in Kokoro's vocab, mapped to
# the closest in-vocab symbol. Extend this as `validate_against_kokoro` reports
# misses on your data. (espeak's Swedish output already stays in-vocab.)
# All targets are verified IN Kokoro's vocab; sources are the only OOV symbols
# espeak-sv produces. ɨ(101)/ɜ(87) are unused by Swedish so they don't collapse a
# real contrast. NOTE the previous version's `ɵ -> ʉ` was a bug: ʉ is ALSO missing.
KOKORO_REMAP = {
    "ʏ": "y",   # close front rounded -> y (id 67); same fix the German recipe used
    "ʉ": "ɨ",   # close central rounded -> close central unrounded (id 101, unused by sv)
    "ɵ": "ɜ",   # close-mid central rounded -> open-mid central unrounded (id 87, unused by sv)
    "ɧ": "ʂ",   # sj-sound -> retroflex (id 130); espeak-sv already emits ʂ/x for it anyway
    "̃": "",     # stray combining tilde
}


def _apply_remap(phonemes: str, remap: dict[str, str]) -> str:
    for src, dst in remap.items():
        phonemes = phonemes.replace(src, dst)
    return phonemes


class SwedishG2P:
    """Pluggable Swedish G2P. Prefers the NST neural G2P, falls back to espeak."""

    def __init__(self, backend: str = "auto", remap: dict[str, str] | None = None):
        self.remap = KOKORO_REMAP if remap is None else remap
        self._fn: Callable[[str], str]
        self.backend = backend
        if backend in ("auto", "neural"):
            fn = self._try_neural()
            if fn is not None:
                self._fn = fn
                self.backend = "neural"
                return
            if backend == "neural":
                raise RuntimeError(
                    "Neural G2P requested but not importable. Set SV_NEURAL_G2P "
                    "to the module path of your NST G2P, or use backend='espeak'."
                )
        self._fn = self._build_espeak()
        self.backend = "espeak"

    # --- backends ---------------------------------------------------------
    def _try_neural(self):
        """Import the user's NST-trained neural G2P if present.

        Looks for a module named by $SV_NEURAL_G2P (default 'nst_g2p') exposing
        either `phonemize(text) -> ipa` or a `G2P` class with `.phonemize`.
        This is the model that lives on the 3090 box and beat espeak for Piper.
        """
        mod_name = os.environ.get("SV_NEURAL_G2P", "nst_g2p")
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            return None
        if hasattr(mod, "phonemize"):
            return lambda text: mod.phonemize(text)
        if hasattr(mod, "G2P"):
            inst = mod.G2P()
            return lambda text: inst.phonemize(text)
        return None

    def _build_espeak(self):
        """espeak-ng Swedish. Uses misaki (the kikiri/Kokoro recipe's G2P) when
        present; falls back to kokoro-onnx's tokenizer so it also runs on the Mac.
        """
        try:
            from misaki import espeak

            ek = espeak.EspeakG2P(language="sv")

            def fn(text: str) -> str:
                ph, _ = ek(text)
                return ph

            return fn
        except ModuleNotFoundError:
            from kokoro_onnx.tokenizer import Tokenizer

            tok = Tokenizer()
            return lambda text: tok.phonemize(text, lang="sv")

    # --- public API -------------------------------------------------------
    def __call__(self, text: str) -> str:
        ph = self._fn(text)
        ph = _apply_remap(ph, self.remap)
        # collapse whitespace; Kokoro expects single spaces between tokens
        ph = re.sub(r"\s+", " ", ph).strip()
        return ph


def kokoro_vocab() -> set[str]:
    """Return Kokoro's AUTHORITATIVE phoneme symbol set.

    Source of truth is kokoro_symbols.py (generated from hexgrad/Kokoro-82M
    config.json), NOT kokoro-onnx — the two differ, and the model's pretrained
    weights expect exactly these ids. This is the set the corpus must stay inside.
    """
    from kokoro_symbols import dicts

    return set(dicts.keys())


def validate_against_kokoro(phoneme_strings, kokoro_vocab: set[str]) -> dict:
    """Return {symbol: count} for any phoneme symbols NOT in Kokoro's vocab.

    Run this over your whole corpus before training: an empty result means every
    utterance is representable; anything else needs a KOKORO_REMAP entry.
    """
    from collections import Counter

    misses: Counter = Counter()
    for s in phoneme_strings:
        for ch in s:
            if ch != " " and ch not in kokoro_vocab:
                misses[ch] += 1
    return dict(misses)


if __name__ == "__main__":
    # Smoke test on the Mac: phonemize a battery and validate against Kokoro vocab.
    vocab = kokoro_vocab()
    g2p = SwedishG2P(backend="espeak")  # neural lives on the GPU box
    samples = [
        "Paris är huvudstaden i Frankrike.",
        "Sjörövaren åt kött och godis i Göteborg.",
        "Nyckeln till hjärtat är förälder och tjugo ängar.",
    ]
    phs = [g2p(s) for s in samples]
    for s, p in zip(samples, phs):
        print(f"{s}\n  -> {p}")
    misses = validate_against_kokoro(phs, vocab)
    print("\nbackend:", g2p.backend)
    print("out-of-vocab symbols:", misses or "NONE — all representable ✓")
