"""Minimal torch-free Swedish Kokoro inference via ONNX Runtime.

The acoustic model runs in onnxruntime (no PyTorch). Only the G2P needs a backend:
espeak ('sv') is fully torch-free; the neural G2P is higher quality but uses torch.

  uv --project recipe run --no-sync python onnx_example.py --text "Hej världen!"
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
import soundfile as sf

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from sv_weights import resolve  # local deploy/ or HF auto-download

ONNX = resolve("kokoro_sv.onnx")
VOICE = resolve("sv_female.pt")
CONFIG = resolve("config.json")


def load_voice(path):
    # voicepack is a torch .pt; load just the tensor without importing torch by
    # reading it via numpy is non-trivial, so use torch only to load the .pt once.
    import torch
    return torch.load(path, map_location="cpu", weights_only=True).numpy()  # [510,1,256]


def g2p_swedish(text):
    """espeak 'sv' -> IPA (torch-free). Falls back through misaki if present."""
    from misaki import espeak
    ph, _ = espeak.EspeakG2P(language="sv")(text)
    return ph


def trim_eos_tail(audio, pred_dur, sr=24000, fade_ms=12):
    pd = np.asarray(pred_dur).astype(np.int64)
    total = int(pd.sum())
    if total <= 0:
        return audio
    spf = len(audio) / total
    keep = max(1, min(int(round((total - int(pd[-1])) * spf)), len(audio)))
    audio = audio[:keep].copy()
    f = int(fade_ms / 1000 * sr)
    if 0 < f < len(audio):
        audio[-f:] *= np.linspace(1.0, 0.0, f).astype(audio.dtype)
    return audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text", default="Hej, det här är Kokoro som kör i ONNX, helt utan PyTorch.")
    ap.add_argument("--out", default=str(ROOT / "output" / "onnx_example.wav"))
    args = ap.parse_args()

    vocab = json.load(open(CONFIG))["vocab"]
    voice = load_voice(VOICE)
    sess = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])

    ipa = g2p_swedish(args.text).replace("ʏ", "y")
    ids = [j for j in (vocab.get(p) for p in ipa) if j is not None]
    input_ids = np.array([[0, *ids, 0]], dtype=np.int64)
    ref_s = voice[len(ids) - 1]

    audio, pred_dur = sess.run(None, {"input_ids": input_ids, "ref_s": ref_s})
    audio = trim_eos_tail(audio, pred_dur)

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    sf.write(args.out, audio, 24000)
    print(f"  IPA: {ipa}")
    print(f"  {len(audio)/24000:.1f}s -> {args.out}  (onnxruntime, no torch in the model path)")


if __name__ == "__main__":
    main()
