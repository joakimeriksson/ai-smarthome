"""Export our fine-tuned Kokoro acoustic model to ONNX (torch-free inference).

Exports KModel.forward_with_tokens (tensor in/out) with disable_complex=True so
the iSTFTNet STFT is ONNX-safe. The duration->alignment expansion is data-dependent
(repeat_interleave on predicted durations) — that's the one tricky op; opset 17 + the
dynamo exporter handle it. G2P + voicepack indexing stay in Python (the model is
language-blind), so this graph just maps (input_ids, ref_s) -> audio.

  uv --project recipe run --no-sync python export_onnx.py
"""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "recipe" / "kokoro")); sys.path.insert(0, str(ROOT))
import json, torch, torch.nn as nn
from kokoro import KModel
from g2p_sv import SwedishG2P

OUT = ROOT / "deploy" / "kokoro_sv.onnx"


class Wrap(nn.Module):
    def __init__(self, km):
        super().__init__(); self.km = km
    def forward(self, input_ids, ref_s):
        audio, pred_dur = self.km.forward_with_tokens(input_ids, ref_s, 1.0)
        return audio, pred_dur


def main():
    km = KModel(repo_id="hexgrad/Kokoro-82M",
                config=str(ROOT/"recipe/training/config.json"),
                model=str(ROOT/"deploy/kokoro_sv.pth"),
                disable_complex=True).eval()
    wrap = Wrap(km).eval()

    vocab = json.load(open(ROOT/"recipe/training/config.json"))["vocab"]
    ipa = SwedishG2P()("Hej, det här är ett test av modellen.").replace("ʏ", "y")
    ids = [j for j in (vocab.get(p) for p in ipa) if j is not None]
    input_ids = torch.LongTensor([[0, *ids, 0]])
    ref_s = torch.load(ROOT/"deploy/sv_female.pt", map_location="cpu",
                       weights_only=True)[len(ids)-1]

    with torch.no_grad():
        ref_audio, _ = wrap(input_ids, ref_s)
    print(f"torch ref audio: {ref_audio.shape[-1]} samples")

    torch.onnx.export(
        wrap, (input_ids, ref_s), str(OUT),
        input_names=["input_ids", "ref_s"], output_names=["audio", "pred_dur"],
        dynamic_axes={"input_ids": {1: "tokens"}, "audio": {0: "samples"},
                      "pred_dur": {0: "tokens"}},
        opset_version=17, do_constant_folding=True,
    )
    print(f"exported -> {OUT} ({OUT.stat().st_size/1e6:.1f} MB)")

    # parity check with onnxruntime
    import numpy as np, onnxruntime as ort
    sess = ort.InferenceSession(str(OUT), providers=["CPUExecutionProvider"])
    onnx_audio = sess.run(None, {"input_ids": input_ids.numpy(),
                                 "ref_s": ref_s.numpy()})[0]
    n = min(len(onnx_audio), ref_audio.shape[-1])
    diff = float(np.abs(onnx_audio[:n] - ref_audio.numpy()[:n]).max())
    print(f"ONNX vs torch: {len(onnx_audio)} samples, maxdiff {diff:.4f}")


if __name__ == "__main__":
    main()
