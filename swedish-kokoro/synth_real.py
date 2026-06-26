"""Deployable-path Swedish render: the REAL kokoro KModel (not the StyleTTS2
training-preview reimplementation). Converts a Stage-2 checkpoint to Kokoro
format, loads it into KModel with the patched Swedish config.json, and drives
KModel.forward() directly with g2p_sv phonemes + a length-indexed [510,1,256]
voicepack — i.e. exactly what shipping inference does, minus KPipeline's
(German-only) G2P.

Run from swedish-kokoro/ via the recipe venv:
  uv --project recipe run python synth_real.py \
     --checkpoint output/sv_kokoro/epoch_2nd_00003.pth \
     --voicepack  output/sv_female_real.pt \
     --config     recipe/training/config.json \
     --out-dir    output/listen_real
"""
import argparse
import sys
from pathlib import Path

import soundfile as sf
import torch

ROOT = Path(__file__).resolve().parent
# prefer the recipe's kokoro submodule (matches what training/convert used)
KOKORO = ROOT / "recipe" / "kokoro"
if KOKORO.exists():
    sys.path.insert(0, str(KOKORO))
sys.path.insert(0, str(ROOT))  # for g2p_sv

from g2p_sv import SwedishG2P
from kokoro import KModel

# same 7 sentences the trainer/TB used (kokoro_tb_utils.TEST_SENTENCES)
TEST_SENTENCES = [
    "Hej, jag är CandyTron! Idag delar jag ut godis till alla.",
    "Sju sjösjuka sjömän sköttes av sju sköna sjuksköterskor.",
    "Jordens glödande inre är en fabel.",
    "Kungen och drottningen bjöd på choklad, glass och kanelbullar.",
    "Varför gjorde du det? Det är ju otroligt!",
    "Det kostar exakt etthundratjugotre miljoner kronor.",
    "Vi åkte till Göteborg för att titta på den vackra skärgården.",
]


def convert_checkpoint(ckpt_path, out_path):
    """Extract the 5 inference modules into Kokoro format (module.-prefixed)."""
    ckpt = torch.load(ckpt_path, map_location="cpu", weights_only=False)["net"]
    pre = lambda sd: {(k if k.startswith("module.") else "module." + k): v
                      for k, v in sd.items()}
    weights = {k: pre(ckpt[k]) for k in
               ["bert", "bert_encoder", "predictor", "text_encoder", "decoder"]
               if k in ckpt}
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    torch.save(weights, out_path)
    print(f"converted -> {out_path} ({', '.join(weights)})")
    return out_path


def trim_eos_tail(audio, pred_dur, sr=24000, fade_ms=12, floor_ms=40):
    """Remove the trailing low-frequency hum the decoder generates for the final
    EOS token. pred_dur is per-token frame counts ([BOS, ...phonemes, EOS]); the
    last entry is the EOS tail. We cut the audio span that maps to those EOS
    frames, then trim any remaining <-30dB trailing silence and apply a short
    fade-out so the cut is click-free.
    """
    import numpy as np
    pd = pred_dur.detach().cpu().numpy().astype(np.int64)
    total = int(pd.sum())
    if total <= 0:
        return audio
    spf = len(audio) / total                      # samples per decoder frame
    keep = int(round((total - int(pd[-1])) * spf))  # drop the EOS-token frames
    keep = max(1, min(keep, len(audio)))
    audio = audio[:keep]
    # belt-and-suspenders: trim trailing near-silence below -30 dB of peak
    w = int(0.02 * sr)
    if len(audio) > w:
        env = np.array([np.sqrt(np.mean(audio[i:i + w] ** 2))
                        for i in range(0, len(audio) - w, w)])
        if len(env):
            thr = env.max() * 10 ** (-30 / 20)
            sp = np.where(env > thr)[0]
            if len(sp):
                end = min(len(audio), (sp[-1] + 1) * w + int(floor_ms / 1000 * sr))
                audio = audio[:end]
    # fade-out to avoid a click at the cut
    f = int(fade_ms / 1000 * sr)
    if 0 < f < len(audio):
        audio[-f:] *= np.linspace(1.0, 0.0, f)
    return audio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--voicepack", required=True, help="[510,1,256] .pt")
    ap.add_argument("--config", default=str(ROOT / "recipe/training/config.json"))
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--no-trim", action="store_true",
                    help="disable EOS-tail trimming (keeps the trailing LF hum)")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"

    kokoro_pth = Path(args.out_dir) / "kokoro_sv.pth"
    convert_checkpoint(args.checkpoint, str(kokoro_pth))

    kmodel = KModel(repo_id="hexgrad/Kokoro-82M", config=args.config,
                    model=str(kokoro_pth)).to(device).eval()
    voice = torch.load(args.voicepack, map_location=device, weights_only=True)
    g2p = SwedishG2P()  # espeak 'sv' by default (matches the synth_listen run)

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(TEST_SENTENCES, 1):
        ipa = g2p(text).replace("ʏ", "y")
        # replicate KModel's own tokenization to size the voicepack row
        ids = [j for j in (kmodel.vocab.get(p) for p in ipa) if j is not None]
        n = len(ids)
        ref_s = voice[n - 1]  # KPipeline indexes pack[len(tokens)-1]
        result = kmodel(ipa, ref_s, speed=args.speed, return_output=True)
        audio = result.audio.detach().cpu().numpy()
        full = len(audio)
        if not args.no_trim:
            audio = trim_eos_tail(audio, result.pred_dur)
        sf.write(str(out / f"test_{i:02d}.wav"), audio, 24000)
        cut = (full - len(audio)) / 24000 * 1000
        print(f"  [{i:02d}] {n:3d} tok  {len(audio)/24000:4.1f}s  (-{cut:3.0f}ms tail)  {text[:42]}")
    print(f"\nWrote {len(TEST_SENTENCES)} clips -> {out}")


if __name__ == "__main__":
    main()
