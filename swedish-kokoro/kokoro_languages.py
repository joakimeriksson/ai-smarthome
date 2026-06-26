"""One sentence per language with the OFFICIAL base Kokoro-82M (not our Swedish
fine-tune). Demonstrates the languages Kokoro ships with — Swedish notably is NOT
among them, which is the reason swedish-kokoro exists.

  uv --project recipe run python kokoro_languages.py --out-dir output/languages
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "recipe" / "kokoro"))  # the kokoro submodule

import soundfile as sf
import torch
from kokoro import KModel, KPipeline

# (lang_code, language name, voice, sentence)
LANGS = [
    ("a", "American English", "af_heart",   "Hello! This is the Kokoro speech model speaking American English."),
    ("b", "British English",  "bf_emma",    "Good afternoon. This is Kokoro, speaking British English."),
    ("e", "Spanish",          "ef_dora",    "Hola, este es el modelo de voz Kokoro hablando en español."),
    ("f", "French",           "ff_siwis",   "Bonjour, ceci est le modèle vocal Kokoro qui parle français."),
    ("h", "Hindi",            "hf_alpha",   "नमस्ते, यह कोकोरो आवाज़ मॉडल हिंदी में बोल रहा है।"),
    ("i", "Italian",          "if_sara",    "Ciao, questo è il modello vocale Kokoro che parla italiano."),
    ("p", "Brazilian Portuguese", "pf_dora", "Olá, este é o modelo de voz Kokoro falando português."),
    ("j", "Japanese",         "jf_alpha",   "こんにちは、これはココロ音声モデルが日本語を話しています。"),
    ("z", "Mandarin Chinese", "zf_xiaobei", "你好，这是 Kokoro 语音模型在说中文。"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", default="output/languages")
    args = ap.parse_args()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # one shared base model (downloads kokoro-v1_0.pth + config.json from HF if needed)
    kmodel = KModel(repo_id="hexgrad/Kokoro-82M").to(device).eval()

    ok, fail = [], []
    for code, name, voice, text in LANGS:
        try:
            pipe = KPipeline(lang_code=code, repo_id="hexgrad/Kokoro-82M", model=kmodel)
            audio = []
            for _, _, a in pipe(text, voice=voice, speed=1):
                audio.append(a)
            if not audio:
                raise RuntimeError("no audio")
            import numpy as np
            wav = np.concatenate([a.detach().cpu().numpy() if hasattr(a, "detach") else a
                                  for a in audio])
            p = out / f"{code}_{name.split()[0].lower()}.wav"
            sf.write(str(p), wav, 24000)
            ok.append((name, p.name, len(wav) / 24000))
            print(f"  OK  [{code}] {name:<20} {voice:<11} {len(wav)/24000:4.1f}s -> {p.name}")
        except Exception as e:
            fail.append((name, repr(e)[:120]))
            print(f"  FAIL[{code}] {name:<20} {type(e).__name__}: {str(e)[:90]}")

    print(f"\n{len(ok)}/{len(LANGS)} languages rendered -> {out}")
    if fail:
        print("failed:", ", ".join(n for n, _ in fail))


if __name__ == "__main__":
    main()
