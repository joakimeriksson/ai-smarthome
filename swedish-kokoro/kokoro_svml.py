"""Kokoro-SV-Multilingual — one model, the normal Kokoro languages + Swedish.

Drop-in for our projects. Wraps the fine-tuned Kokoro weights (epoch_2nd_00002,
which kept English/etc. and learned Swedish) with per-language routing:

  - Swedish ('sv'): g2p_sv (neural/espeak) -> KModel.forward -> EOS-tail trim,
    with our trained `sv_female` voicepack.
  - Every other language: the normal KPipeline lang_code + a default voice.

Because Kokoro's KModel is language-blind (IPA -> audio), the SAME weights serve
all languages. Usage:

    from kokoro_svml import KokoroSVML
    tts = KokoroSVML()
    sv = tts.generate("Hej, jag är CandyTron!", lang="sv")
    en = tts.generate("Hello, this is the same model.", lang="en")
    import soundfile as sf; sf.write("out.wav", sv, 24000)
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "recipe" / "kokoro"))
sys.path.insert(0, str(ROOT))

import numpy as np
import torch
from kokoro import KModel, KPipeline
from g2p_sv import SwedishG2P
from synth_real import trim_eos_tail  # reuse the tail-trim we built
from sv_weights import resolve  # local deploy/ or HF auto-download

# lang -> (KPipeline lang_code, default voice). Swedish handled separately.
LANGS = {
    "en": ("a", "af_heart"), "en-us": ("a", "af_heart"), "en-gb": ("b", "bf_emma"),
    "es": ("e", "ef_dora"), "fr": ("f", "ff_siwis"), "hi": ("h", "hf_alpha"),
    "it": ("i", "if_sara"), "pt": ("p", "pf_dora"), "zh": ("z", "zf_xiaobei"),
    "ja": ("j", "jf_alpha"),
}
class KokoroSVML:
    def __init__(self, weights=None, config=None, sv_voice=None, device=None,
                 repo_id="hexgrad/Kokoro-82M"):
        # each falls back to HF auto-download if not passed / not in deploy/
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.repo_id = repo_id
        self.kmodel = KModel(
            repo_id=repo_id,
            config=str(config or resolve("config.json")),
            model=str(weights or resolve("kokoro_sv.pth")),
        ).to(self.device).eval()
        self.g2p_sv = SwedishG2P()
        self.sv_voice = torch.load(sv_voice or resolve("sv_female.pt"),
                                   map_location=self.device, weights_only=True)
        self._pipes: dict[str, KPipeline] = {}

    def _pipe(self, code: str) -> KPipeline:
        if code not in self._pipes:
            self._pipes[code] = KPipeline(lang_code=code, repo_id=self.repo_id,
                                          model=self.kmodel)
        return self._pipes[code]

    def generate(self, text: str, lang: str = "sv", voice: str | None = None,
                 speed: float = 1.0, trim: bool = True) -> np.ndarray:
        """Return 24 kHz float32 mono audio for `text` in `lang`."""
        lang = lang.lower()
        if lang in ("sv", "swedish", "se"):
            ipa = self.g2p_sv(text).replace("ʏ", "y")
            ids = [j for j in (self.kmodel.vocab.get(p) for p in ipa) if j is not None]
            if not ids:
                return np.zeros(1, dtype=np.float32)
            ref_s = self.sv_voice[len(ids) - 1]
            out = self.kmodel(ipa, ref_s, speed=speed, return_output=True)
            audio = out.audio.detach().cpu().numpy()
            return trim_eos_tail(audio, out.pred_dur) if trim else audio
        if lang not in LANGS:
            raise ValueError(f"unsupported lang {lang!r}; known: sv, {', '.join(LANGS)}")
        code, default_voice = LANGS[lang]
        pipe = self._pipe(code)
        chunks = [a.detach().cpu().numpy() if hasattr(a, "detach") else a
                  for _, _, a in pipe(text, voice=voice or default_voice, speed=speed)]
        return np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)


if __name__ == "__main__":
    import soundfile as sf
    tts = KokoroSVML()
    out = ROOT / "output" / "svml_demo"; out.mkdir(parents=True, exist_ok=True)
    demo = [
        ("sv", "Hej, jag är CandyTron! Jag pratar svenska."),
        ("en", "Hello, this is the very same model speaking English."),
        ("es", "Hola, este es el mismo modelo hablando español."),
    ]
    for lang, text in demo:
        wav = tts.generate(text, lang=lang)
        p = out / f"demo_{lang}.wav"
        sf.write(str(p), wav, 24000)
        print(f"  {lang}: {len(wav)/24000:4.1f}s -> {p.name}")
    print(f"-> {out}")
