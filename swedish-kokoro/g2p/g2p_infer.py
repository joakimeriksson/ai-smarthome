"""SwedishG2P — drop-in phoneme front-end for the Piper voice.

Hybrid: exact NST-lexicon lookup for known words, neural Transformer fallback
for OOV words/names. Emits IPA token lists in the voice's inventory, so it
replaces espeak at step 1 of synthesis with no downstream changes.

`SwedishG2P.phonemize(text)` mirrors espeak's output shape: a list of sentences,
each a flat list of IPA tokens with ' ' between words and punctuation kept.

CLI: python g2p/g2p_infer.py [--text "..."] [--model ../output/sv_nyckfull.onnx]
     A/Bs the G2P front-end against espeak and writes a wav via the G2P path.
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import numpy as np
import torch

from model import BOS, EOS, PAD, G2PConfig, G2PTransformer

ROOT = Path(__file__).resolve().parent
PUNCT = set(",.!?;:-")                      # kept if present in the voice map
_SENT = re.compile(r"[^.!?]+[.!?]?")
_TOK = re.compile(r"[a-zåäöéèüáàâäëïöüA-ZÅÄÖ]+|[,.!?;:\-]")


class SwedishG2P:
    def __init__(self, model_path: Path = ROOT / "g2p_model.pt",
                 lexicon_path: Path = ROOT / "data/lexicon.tsv",
                 custom_path: Path = ROOT / "custom_lexicon.tsv",
                 device: str = "cpu"):
        self.device = device
        self.lex = {}
        for line in open(lexicon_path):
            w, ipa = line.rstrip("\n").split("\t")
            self.lex[w] = ipa.split(" ")
        # custom overrides (brand/place/personal names) win over the NST lexicon
        if Path(custom_path).exists():
            for line in open(custom_path):
                line = line.rstrip("\n")
                if not line or line.startswith("#"):
                    continue
                w, ipa = line.split("\t")
                self.lex[w.lower()] = ipa.split(" ")
        ckpt = torch.load(model_path, map_location=device, weights_only=False)
        self.char2id = ckpt["vocab"]["char2id"]
        self.id2phon = {i: p for p, i in ckpt["vocab"]["phon2id"].items()}
        self.model = G2PTransformer(G2PConfig(**ckpt["cfg"])).to(device)
        self.model.load_state_dict(ckpt["state_dict"])
        self.model.eval()
        self.oov_count = 0

    def _neural(self, words: list[str]) -> dict[str, list[str]]:
        if not words:
            return {}
        seqs = [[BOS] + [self.char2id[c] for c in w if c in self.char2id] + [EOS]
                for w in words]
        m = max(len(s) for s in seqs)
        src = torch.full((len(seqs), m), PAD, dtype=torch.long)
        for i, s in enumerate(seqs):
            src[i, : len(s)] = torch.tensor(s)
        preds = self.model.greedy_decode(src.to(self.device))
        return {w: [self.id2phon[t] for t in p] for w, p in zip(words, preds)}

    def phonemize(self, text: str) -> list[list[str]]:
        sentences = [s.strip() for s in _SENT.findall(text) if s.strip()]
        # batch all OOV words across the text through the neural model once
        oov = sorted({t.lower() for s in sentences for t in _TOK.findall(s)
                      if t.isalpha() and t.lower() not in self.lex})
        neural = self._neural(oov)
        self.oov_count += len(oov)

        out: list[list[str]] = []
        for sent in sentences:
            toks = _TOK.findall(sent)
            phon: list[str] = []
            prev_word = False
            for t in toks:
                if t.isalpha():
                    w = t.lower()
                    ipa = self.lex.get(w) or neural.get(w, [])
                    if prev_word:
                        phon.append(" ")
                    phon.extend(ipa)
                    prev_word = True
                elif t in PUNCT:
                    phon.append(t)
                    prev_word = False
            if phon:
                out.append(phon)
        return out


def synth_with_g2p(voice, text: str, g2p: SwedishG2P, out_path: Path):
    """Synthesize using the G2P front-end instead of espeak; returns audio_seconds."""
    import wave
    from piper.phoneme_ids import phonemes_to_ids
    from piper.voice import _DEFAULT_SYNTHESIS_CONFIG

    idmap = voice.config.phoneme_id_map
    chunks = []
    sr = voice.config.sample_rate
    for phonemes in g2p.phonemize(text):
        ids = phonemes_to_ids(phonemes, idmap)
        audio = voice.phoneme_ids_to_audio(ids, _DEFAULT_SYNTHESIS_CONFIG)
        chunks.append(np.clip(audio, -1, 1))
    audio = np.concatenate(chunks) if chunks else np.zeros(1, np.float32)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
        wf.writeframes((audio * 32767).astype(np.int16).tobytes())
    return len(audio) / sr


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="Hej, jag är CandyTron! Idag delar jag ut "
                    "godis till alla. Kom fram och sträck ut handen, så får du en godbit.")
    ap.add_argument("--model", default=str(ROOT / "../output/sv_nyckfull.onnx"))
    ap.add_argument("--out", default=str(ROOT / "../output/candytron_g2p.wav"))
    args = ap.parse_args()

    g2p = SwedishG2P()
    from piper import PiperVoice
    from piper.phonemize_espeak import EspeakPhonemizer

    print("=== G2P vs espeak (per word) ===")
    esp = EspeakPhonemizer()
    for w in ["hej", "jag", "är", "candytron", "godis", "sträck", "handen", "godbit"]:
        g = g2p.lex.get(w)
        src = "dict" if g else "neural"
        if not g:
            g = g2p._neural([w])[w]
        e = esp.phonemize("sv", w)
        e = e[0] if e else []
        print(f"  {w:11} G2P[{src:6}]: {' '.join(g):22}  espeak: {' '.join(e)}")

    voice = PiperVoice.load(args.model)
    secs = synth_with_g2p(voice, args.text, g2p, Path(args.out))
    print(f"\nG2P phonemes: {g2p.phonemize(args.text)}")
    print(f"OOV words sent to neural model: {g2p.oov_count}")
    print(f"wrote {args.out}  ({secs:.2f}s audio)")
