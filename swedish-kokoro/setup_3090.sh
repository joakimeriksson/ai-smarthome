#!/usr/bin/env bash
# One-time setup for Swedish Kokoro fine-tuning on the RTX 3090 (WSL2 Ubuntu).
# Mirrors swedish-tts/setup_3090.sh but targets the Kokoro/StyleTTS2 recipe.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> System deps (espeak-ng for the fallback G2P, libsndfile, ffmpeg)"
sudo apt-get update -y
sudo apt-get install -y espeak-ng libsndfile1 ffmpeg git git-lfs

echo "==> Clone the community Kokoro new-language recipe (patched StyleTTS2)"
# kikiri-tts / kokoro-deutsch: first public end-to-end Kokoro training recipe.
if [ ! -d recipe ]; then
  git clone --recurse-submodules https://github.com/semidark/kikiri-tts recipe
fi

echo "==> Python env (CUDA torch + recipe deps via uv)"
cd recipe
curl -LsSf https://astral.sh/uv/install.sh | sh || true
uv sync                       # installs torch (CUDA), styletts2 deps, misaki, etc.
cd "$ROOT"

echo "==> Download Swedish PL-BERT (multilingual; Swedish IS in its 15-lang set)"
git lfs install
if [ ! -d models/multilingual-pl-bert ]; then
  git clone https://huggingface.co/papercup-ai/multilingual-pl-bert models/multilingual-pl-bert
fi

echo "==> Download base Kokoro-82M weights (Apache-2.0) to warm-start"
if [ ! -d models/Kokoro-82M ]; then
  git clone https://huggingface.co/hexgrad/Kokoro-82M models/Kokoro-82M
fi

cat <<'NEXT'

✅ Setup done. Next:
  1. Put the Swedish NST data in  data/swedish_raw/  (wavs/ + metadata.csv),
     and make your neural G2P importable (export SV_NEURAL_G2P=nst_g2p).
  2. Build filelists:   python prepare_data.py --raw data/swedish_raw --speaker sv0
  3. Train:             bash train_3090.sh
NEXT
