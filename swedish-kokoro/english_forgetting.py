"""How much English did our Swedish-only fine-tune forget?

Render the SAME English sentences with (a) base Kokoro-82M and (b) our fine-tuned
model (epoch_2nd_00002), both using the English G2P (KPipeline lang_code='a') and
the same English voice (af_heart). Only the model weights differ -> the gap is the
catastrophic forgetting from fine-tuning on Swedish only.

  uv --project recipe run --no-sync python english_forgetting.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "recipe" / "kokoro"))

import numpy as np
import soundfile as sf
import torch
from scipy.signal import get_window
from kokoro import KModel, KPipeline

SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Hello, my name is Anna and I come from Gothenburg.",
    "This is a test of English after the Swedish fine-tuning.",
]

def echo_ratio(d, sr=24000):
    w = int(0.25 * sr); e = np.convolve(d ** 2, np.ones(w), "valid")
    x = d[int(np.argmax(e)):int(np.argmax(e)) + w]
    n = 1 << int(np.ceil(np.log2(len(x))))
    X = np.fft.rfft(x * get_window("hann", len(x)), n=n)
    c = np.fft.irfft(np.log(np.abs(X) + 1e-9)); q = np.arange(len(c)) / sr * 1000
    ps = c[np.where((q > 2) & (q < 12.5))[0][np.argmax(c[(q > 2) & (q < 12.5)])]]
    es = c[np.where((q > 18) & (q < 120))[0][np.argmax(c[(q > 18) & (q < 120)])]]
    return es / ps

def main():
    device = "cuda" if torch.cuda.is_available() else "cpu"
    out = ROOT / "output" / "english_forget"; out.mkdir(parents=True, exist_ok=True)

    base = KModel(repo_id="hexgrad/Kokoro-82M").to(device).eval()
    ours = KModel(repo_id="hexgrad/Kokoro-82M",
                  config=str(ROOT / "recipe/training/config.json"),
                  model=str(ROOT / "output/listen_final/kokoro_sv.pth")).to(device).eval()

    models = {"base": base, "ours": ours}
    pipes = {k: KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M", model=m)
             for k, m in models.items()}

    print(f"{'sentence':<10}{'base echo':>11}{'ours echo':>11}")
    for i, text in enumerate(SENTENCES, 1):
        row = {}
        for k, pipe in pipes.items():
            audio = np.concatenate([a.detach().cpu().numpy() if hasattr(a, "detach") else a
                                    for _, _, a in pipe(text, voice="af_heart", speed=1)])
            sf.write(str(out / f"en_{k}_{i:02d}.wav"), audio, 24000)
            row[k] = echo_ratio(audio)
        print(f"test_{i:02d} {row['base']:>11.2f}{row['ours']:>11.2f}")
    print(f"\n-> {out}")

if __name__ == "__main__":
    main()
