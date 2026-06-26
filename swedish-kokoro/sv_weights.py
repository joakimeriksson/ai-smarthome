"""Resolve swedish-kokoro weight files: prefer the local deploy/ copy, else
auto-download from HuggingFace (cached) — same pattern KModel uses for base Kokoro.

Set the repo with env KOKORO_SV_REPO (default below). Files expected in the repo:
  kokoro_sv.pth   sv_female.pt   config.json   kokoro_sv.onnx
"""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEPLOY = ROOT / "deploy"
# EDIT this default (or set $KOKORO_SV_REPO) to your uploaded repo:
HF_REPO = os.environ.get("KOKORO_SV_REPO", "Joakim/swedish-kokoro")


def resolve(filename: str) -> str:
    """Local deploy/<filename> if it exists, else hf_hub_download from HF_REPO."""
    local = DEPLOY / filename
    if local.exists():
        return str(local)
    from huggingface_hub import hf_hub_download
    return hf_hub_download(repo_id=HF_REPO, filename=filename)
