"""Option B test: can the UNTOUCHED base Kokoro-82M already speak Swedish?

The model is language-blind (maps IPA -> audio) and Swedish IPA is within its
178-token vocab. So feed Swedish phonemes from g2p_sv straight to KModel.forward
with a native base voice (af_heart). No fine-tune, no forgetting. If the Swedish
comes out intelligible, multilingual+Swedish is free.

  uv --project recipe run --no-sync python base_swedish.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "recipe" / "kokoro"))
sys.path.insert(0, str(ROOT))

import soundfile as sf
import torch
from huggingface_hub import hf_hub_download
from kokoro import KModel
from g2p_sv import SwedishG2P

SENTENCES = [
    "Hej, jag är CandyTron! Idag delar jag ut godis till alla.",
    "Jordens glödande inre är en fabel.",
    "Jag heter Anna och jag kommer från Göteborg.",
    "Sju sjösjuka sjömän sköttes av sju sköna sjuksköterskor.",
]

def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    out = ROOT / "output" / "base_swedish"; out.mkdir(parents=True, exist_ok=True)

    # BASE model: weights + config straight from HF (no fine-tune)
    kmodel = KModel(repo_id="hexgrad/Kokoro-82M").to(device).eval()
    g2p = SwedishG2P()                       # neural if SV_NEURAL_G2P wired, else espeak
    print(f"G2P backend: {g2p.backend}")

    afpath = hf_hub_download(repo_id="hexgrad/Kokoro-82M", filename="voices/af_heart.pt")
    voices = {
        "afheart": torch.load(afpath, map_location=device, weights_only=True),
        "svfemale": torch.load(ROOT / "output" / "sv_female_00002.pt",
                               map_location=device, weights_only=True),
    }

    for i, text in enumerate(SENTENCES, 1):
        ipa = g2p(text).replace("ʏ", "y")
        ids = [j for j in (kmodel.vocab.get(p) for p in ipa) if j is not None]
        n = len(ids)
        dropped = [p for p in ipa if kmodel.vocab.get(p) is None and not p.isspace()]
        print(f"  [{i}] {n:3d} tok  drop={''.join(sorted(set(dropped))) or '-'}  IPA: {ipa[:72]}")
        for vname, voice in voices.items():
            audio = kmodel(ipa, voice[n - 1], speed=1)
            audio = (audio.audio if hasattr(audio, "audio") else audio).detach().cpu().numpy()
            sf.write(str(out / f"base_{vname}_{i:02d}.wav"), audio, 24000)
    print(f"\n-> {out}  (voices: {', '.join(voices)})")

if __name__ == "__main__":
    main()
