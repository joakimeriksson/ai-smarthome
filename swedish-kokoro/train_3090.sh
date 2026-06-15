#!/usr/bin/env bash
# Fine-tune Kokoro-82M on Swedish via the kikiri/StyleTTS2 two-stage recipe.
# Run after setup_3090.sh + prepare_data.py. Targets a single RTX 3090 (24 GB).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT/recipe"

CONFIG="${1:-$ROOT/config_sv.yml}"

# Stage 1 — acoustic + duration/prosody on the Swedish data (warm-started from
# base Kokoro weights). Stage 2 — joint adversarial + SLM fine-tune.
# batch_size=4 fits 12 GB; the 3090 (24 GB) can go to 8-16. See config_sv.yml.
echo "==> Stage 1"
uv run python train_first.py  --config_path "$CONFIG"

echo "==> Stage 2 (adversarial / SLM)"
uv run python train_second.py --config_path "$CONFIG"

echo "==> Extract Kokoro voicepack from the trained checkpoint"
uv run python "$ROOT/extract_voicepack.py" \
  --checkpoint "$ROOT/output/sv_kokoro/epoch_2nd_best.pth" \
  --out "$ROOT/output/sv_kokoro.voicepack.pt"

cat <<'DONE'

✅ Training complete.
   Voicepack:  output/sv_kokoro.voicepack.pt
   Test it with KModel/KPipeline (lang_code='sv', your G2P) — see README.
   Copy the voicepack to the Mac/Pi to run inference anywhere.
DONE
