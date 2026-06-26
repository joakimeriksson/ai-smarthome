"""Upload the swedish-kokoro weights to a HuggingFace model repo, so the loaders
(kokoro_svml.py / onnx_example.py via sv_weights.resolve) can auto-download them.

Prereq: be logged in — `huggingface-cli login` (or set $HF_TOKEN). Then:
  uv --project recipe run --no-sync python upload_to_hf.py --repo <user>/swedish-kokoro

Uploads: kokoro_sv.pth, kokoro_sv.onnx, sv_female.pt, config.json, deploy/README.md
Afterwards set the same repo in the loaders:  export KOKORO_SV_REPO=<user>/swedish-kokoro
"""
import argparse
from pathlib import Path

from huggingface_hub import HfApi, create_repo

ROOT = Path(__file__).resolve().parent
DEPLOY = ROOT / "deploy"

# (local path, repo path)
FILES = [
    (DEPLOY / "kokoro_sv.pth", "kokoro_sv.pth"),
    (DEPLOY / "kokoro_sv.onnx", "kokoro_sv.onnx"),
    (DEPLOY / "sv_female.pt", "sv_female.pt"),
    (DEPLOY / "config.json", "config.json"),
    (DEPLOY / "README.md", "README.md"),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="e.g. joakim-eriksson/swedish-kokoro")
    ap.add_argument("--private", action="store_true")
    args = ap.parse_args()

    api = HfApi()
    create_repo(args.repo, repo_type="model", private=args.private, exist_ok=True)
    for local, remote in FILES:
        if not local.exists():
            print(f"  SKIP (missing): {local.name}")
            continue
        print(f"  uploading {local.name} ({local.stat().st_size/1e6:.0f} MB) ...")
        api.upload_file(path_or_fileobj=str(local), path_in_repo=remote,
                        repo_id=args.repo, repo_type="model")
    print(f"\nDone -> https://huggingface.co/{args.repo}")
    print(f"Now set:  export KOKORO_SV_REPO={args.repo}")


if __name__ == "__main__":
    main()
