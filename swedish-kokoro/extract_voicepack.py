"""Extract a Kokoro voicepack by delegating to the cloned kikiri recipe.

The previous version guessed an import (`recipe.tools.voicepack.build_voicepack`)
that does not exist — it would only fail AFTER a full (hours-long) training run.
The recipe ships its own extractor; per its TRAINING_GUIDE the interface is:

    python scripts/extract_voicepack.py --model <ckpt> --audio-dir <dir> --output <pt>

This wrapper finds that script and runs it with the recipe's own venv, mapping
our flags onto it. Reference audio defaults to data/refs (populated by
prepare_data.py). If the recipe's flag names differ in your clone, it prints the
recipe script's --help so you can adjust, instead of silently doing nothing.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def find_recipe_extractor() -> Path | None:
    for cand in (
        ROOT / "recipe" / "scripts" / "extract_voicepack.py",
        ROOT / "recipe" / "StyleTTS2" / "scripts" / "extract_voicepack.py",
        ROOT / "recipe" / "extract_voicepack.py",
    ):
        if cand.exists():
            return cand
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", required=True, help="Stage-2 best .pth")
    ap.add_argument("--out", required=True, help="output voicepack .pt")
    ap.add_argument("--audio-dir", default=str(ROOT / "data" / "refs"),
                    help="reference clips for the target speaker (default: data/refs)")
    ap.add_argument("--ref-list", default=None, help="(unused by recipe; kept for compat)")
    args = ap.parse_args()

    script = find_recipe_extractor()
    if script is None:
        raise SystemExit(
            "Could not find the recipe's scripts/extract_voicepack.py.\n"
            "Run setup_3090.sh first (it clones recipe/). If the recipe moved the\n"
            "extractor, point this wrapper at it."
        )

    audio_dir = Path(args.audio_dir)
    if not audio_dir.exists() or not any(audio_dir.glob("*.wav")):
        raise SystemExit(
            f"No reference wavs in {audio_dir}. prepare_data.py copies a few to data/refs;\n"
            "pass --audio-dir at a folder of the target speaker's 24 kHz clips."
        )

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "uv", "--project", str(ROOT / "recipe"), "run", "python", str(script),
        "--model", args.checkpoint,
        "--audio-dir", str(audio_dir),
        "--output", args.out,
    ]
    print("running recipe extractor:\n  " + " ".join(cmd))
    r = subprocess.run(cmd)
    if r.returncode != 0:
        print("\nRecipe extractor failed. Its argument names may differ in your clone — check:")
        subprocess.run(["uv", "--project", str(ROOT / "recipe"), "run", "python", str(script), "--help"])
        sys.exit(r.returncode)
    print(f"✅ voicepack: {args.out}")


if __name__ == "__main__":
    main()
