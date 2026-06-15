"""Swedish grapheme-to-phoneme for Kokoro training.

Kokoro/StyleTTS2 consume an IPA phoneme STRING per utterance. Quality of that
string dominates final voice quality, so we prefer the **neural G2P** trained on
the NST lexicon (the one that beat espeak for the Piper voice) and fall back to
espeak-ng only when it is unavailable.

Whatever the source, the phoneme string MUST stay inside Kokoro's fixed symbol
vocabulary (114 symbols). `validate_against_kokoro()` checks this and an optional
remap table fixes the few symbols a richer Swedish G2P might emit that Kokoro
lacks (e.g. ʏ -> y, as the German recipe had to do).

Usage:
    from g2p_sv import SwedishG2P
    g2p = SwedishG2P()                 # auto: neural if importable, else espeak
    phonemes = g2p("Paris är huvudstaden i Frankrike.")
"""
from __future__ import annotations

import os
import re
from typing import Callable

# Symbols a Swedish neural G2P may emit that are NOT in Kokoro's vocab, mapped to
# the closest in-vocab symbol. Extend this as `validate_against_kokoro` reports
# misses on your data. (espeak's Swedish output already stays in-vocab.)
KOKORO_REMAP = {
    "ʏ": "y",   # close front rounded — same fix the German (kikiri) recipe used
    "ɵ": "ʉ",   # close-mid central rounded -> close central rounded
    "ɧ": "ʃ",   # sj-sound -> postalveolar fricative
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
            mod = __import__(mod_name)
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
    """Return Kokoro's phoneme symbol set, across kokoro-onnx versions."""
    from kokoro_onnx.tokenizer import Tokenizer

    t = Tokenizer()
    vocab = getattr(t, "vocab", None)
    if vocab is None:
        from kokoro_onnx.tokenizer import DEFAULT_VOCAB as vocab  # type: ignore
    return set(vocab.keys()) if isinstance(vocab, dict) else set(vocab)


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
