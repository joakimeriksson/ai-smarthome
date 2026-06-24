"""Convert base Kokoro-82M weights into the StyleTTS2/kikiri fine-tune format.

The kikiri recipe loads `pretrained_model` as a checkpoint shaped like
`{'net': {'bert':..., 'bert_encoder':..., 'predictor':..., 'text_encoder':...,
'decoder':...}}` with the `module.` DataParallel prefixes stripped.

The raw HuggingFace `kokoro-v1_0.pth` is NOT in that shape — loading it directly
(what the previous attempt's config did) means the warm start silently fails and
Stage 2 mel loss starts at ~7.5 instead of ~0.43. This script produces the
correct `kokoro_base.pth`.

Usage:
    python convert_weights.py \
        --in  models/Kokoro-82M/kokoro-v1_0.pth \
        --out models/kokoro_base.pth
"""
from __future__ import annotations

import argparse
from pathlib import Path

import torch

COMPONENTS = ["bert", "bert_encoder", "predictor", "text_encoder", "decoder"]


def strip_prefix(state_dict: dict) -> dict:
    return {k.replace("module.", ""): v for k, v in state_dict.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True, help="raw kokoro-v1_0.pth")
    ap.add_argument("--out", required=True, help="converted kokoro_base.pth")
    args = ap.parse_args()

    raw = torch.load(args.inp, map_location="cpu", weights_only=False)

    # Some Kokoro checkpoints are already wrapped as {'net': {...}} — unwrap so we
    # always look for the component dicts at the right level.
    if "net" in raw and all(c in raw["net"] for c in COMPONENTS):
        print("  (input already wrapped in 'net' — unwrapping)")
        raw = raw["net"]

    missing = [c for c in COMPONENTS if c not in raw]
    if missing:
        raise SystemExit(
            f"Checkpoint {args.inp} is missing expected components: {missing}\n"
            f"Found keys: {list(raw.keys())}\n"
            "Make sure this is the Kokoro-82M training checkpoint (kokoro-v1_0.pth)."
        )

    net = {c: strip_prefix(raw[c]) for c in COMPONENTS}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"net": net}, out.as_posix())

    # report param counts so the GPU box can sanity-check before training
    for c in COMPONENTS:
        n = sum(v.numel() for v in net[c].values())
        print(f"  {c:14} {n/1e6:6.2f}M params")
    print(f"\n✅ wrote {out}  (load with load_only_params: true / strict=False)")


if __name__ == "__main__":
    main()
