"""Extract a Kokoro voicepack (style-vector tensor) from a trained checkpoint.

Kokoro inference doesn't load the full StyleTTS2 checkpoint; it uses the KModel
weights plus a small per-voice "voicepack" tensor of reference style vectors.
After Stage 2 finishes, we run the trained model over reference clips of the
target speaker and save the averaged/per-length style vectors as the voicepack.

This mirrors the kikiri recipe's "Voicepack extraction" stage; adjust the import
path to the recipe's extractor if its API differs.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, help="Stage-2 best .pth")
    ap.add_argument("--out", required=True, help="output voicepack .pt")
    ap.add_argument("--ref-list", default="data/val_list.txt",
                    help="reference clips to derive style vectors from")
    args = ap.parse_args()

    # The patched StyleTTS2 in recipe/ exposes the style encoder + voicepack
    # builder. Import from there so we use the exact trained architecture.
    try:
        from recipe.tools.voicepack import build_voicepack  # type: ignore
    except Exception as e:
        raise SystemExit(
            "Could not import the recipe's voicepack builder.\n"
            f"  ({e})\n"
            "Run this on the GPU box after setup_3090.sh, or point the import at\n"
            "the recipe's extraction script (see docs/TRAINING_GUIDE.md)."
        )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    build_voicepack(checkpoint=args.checkpoint, ref_list=args.ref_list, out=out.as_posix())
    print(f"✅ wrote voicepack: {out}")


if __name__ == "__main__":
    main()
