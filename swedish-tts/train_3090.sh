#!/usr/bin/env bash
# =====================================================================
# Fine-tune the Swedish Piper voice on the GPU, then export to ONNX.
# Repeatable — run after setup_3090.sh. Usage:
#   bash train_3090.sh [STEPS] [BATCH]
#   e.g. bash train_3090.sh 10000 32
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
source .venv/bin/activate

STEPS="${1:-10000}"   # 10k steps ≈ a solid voice; bump to 15-20k for tighter
BATCH="${2:-32}"      # a 24GB 3090 handles 32 comfortably (try 48 for speed)

if [ ! -d data/swedish_raw/wavs ]; then
  echo "ERROR: dataset not found at data/swedish_raw/wavs" >&2
  echo "  rsync it from your Mac, or regenerate with prepare_tts_swedish.py." >&2
  exit 1
fi

# (re)build the single-speaker manifest if missing
[ -f train_sv.csv ] || python prepare_data.py --min-dnsmos 3.5 --single-speaker auto

echo "==> training: steps=$STEPS batch=$BATCH on $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
python -m piper.train fit \
  --data.voice_name sv_nyckfull \
  --data.csv_path train_sv.csv \
  --data.audio_dir data/swedish_raw/wavs \
  --model.sample_rate 22050 \
  --data.espeak_voice sv \
  --data.num_symbols 130 \
  --data.phonemes_path basemodel/sv_phoneme_id_map.json \
  --data.cache_dir cache \
  --data.config_path output/sv_nyckfull.config.json \
  --data.batch_size "$BATCH" \
  --ckpt_path basemodel/sv_nst_base_resume.ckpt \
  --trainer.max_steps "$STEPS" \
  --trainer.accelerator cuda \
  --trainer.precision 16-mixed

echo "==> exporting to ONNX"
bash finetune_export.sh sv_nyckfull
echo
echo "Voice ready: output/sv_nyckfull.onnx (+ .onnx.json)"
echo "Copy both files back to your Mac/smart-home box and run them with piper-tts."
