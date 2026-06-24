#!/usr/bin/env bash
# One-time setup for Swedish Kokoro fine-tuning on the RTX 3090 (WSL2 Ubuntu).
# Fixed version: now also does the steps the previous attempt skipped — weight
# conversion, symbol-map wiring, monotonic_align build, and utils checks.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "==> [1/7] System deps"
sudo apt-get update -y
sudo apt-get install -y espeak-ng libsndfile1 ffmpeg git git-lfs build-essential

echo "==> [2/7] Clone the kikiri Kokoro new-language recipe (patched StyleTTS2 submodule)"
if [ ! -d recipe ]; then
  git clone --recurse-submodules https://github.com/semidark/kikiri-tts recipe
else
  git -C recipe submodule update --init --recursive
fi

echo "==> [3/7] Python env (CUDA torch + recipe deps via uv)"
cd recipe
curl -LsSf https://astral.sh/uv/install.sh | sh || true
export PATH="$HOME/.local/bin:$PATH"
command -v uv >/dev/null || { echo "ERROR: uv not found after installer; add ~/.local/bin to PATH." >&2; exit 1; }
uv sync
cd "$ROOT"

echo "==> [4/7] Download base Kokoro-82M weights"
# NOTE: we deliberately do NOT use a foreign multilingual PL-BERT. Kokoro's own
# PL-BERT (inside kokoro-v1_0.pth -> kokoro_base.pth net.bert) already speaks the
# shared IPA phoneme vocab (Swedish included); the bundled Utils/PLBERT config
# matches its dims. A foreign PL-BERT would mismatch the tokenizer and silently
# feed garbage context. See config_sv.yml PLBERT_dir.
git lfs install
[ -d models/Kokoro-82M ] || git clone https://huggingface.co/hexgrad/Kokoro-82M models/Kokoro-82M

echo "==> [5/7] Convert base Kokoro weights -> kokoro_base.pth (the step that was missing)"
# Warm-start checkpoint in the {'net': {...}} shape the recipe expects.
"$ROOT/recipe/.venv/bin/python" convert_weights.py \
  --in  models/Kokoro-82M/kokoro-v1_0.pth \
  --out models/kokoro_base.pth 2>/dev/null \
  || uv --project recipe run python convert_weights.py \
       --in models/Kokoro-82M/kokoro-v1_0.pth --out models/kokoro_base.pth

echo "==> [6/7] Wire the authoritative symbol map into StyleTTS2 + build monotonic_align"
# The recipe's StyleTTS2/text_utils.py must use OUR kokoro_symbols.py (sparse 178-slot
# ids) instead of StyleTTS2's dense default — this is what NaN'd the last run.
cp -f kokoro_symbols.py recipe/StyleTTS2/kokoro_symbols.py
cd recipe/StyleTTS2
if ! grep -q "kokoro_symbols" text_utils.py; then
  echo "    !! text_utils.py does not import kokoro_symbols — APPENDING override"
  cp -f text_utils.py text_utils.py.bak
  # Append (not overwrite): keep any other helpers the training code imports from
  # text_utils, while the trailing import overrides symbols/dicts/TextCleaner.
  cat >> text_utils.py <<'EOF'

# --- Patched by swedish-kokoro/setup_3090.sh: use Kokoro's authoritative sparse vocab ---
from kokoro_symbols import symbols, dicts, TextCleaner  # noqa: F401,E402
EOF
fi
# monotonic alignment extension (required, was never built before)
if [ ! -d monotonic_align ]; then
  git clone https://github.com/resemble-ai/monotonic_align.git
fi
( cd monotonic_align && uv --project "$ROOT/recipe" run python setup.py build_ext --inplace )
cd "$ROOT"

echo "==> [7/7] Verify utilities are present + symbol map is correct"
ST="recipe/StyleTTS2"
missing=0
for f in "Utils/JDC/bst.t7" "Utils/ASR/config.yml" "Utils/ASR/epoch_00080.pth"; do
  if [ ! -f "$ST/$f" ]; then
    echo "    !! MISSING $ST/$f — fetch it from the StyleTTS2 repo before training"
    missing=1
  fi
done
# config_sv.yml points PLBERT_dir at the bundled Utils/PLBERT — make sure it exists.
if [ ! -d "$ST/Utils/PLBERT" ]; then
  echo "    !! MISSING $ST/Utils/PLBERT — bundled PL-BERT (config_sv.yml PLBERT_dir) not found"
  missing=1
fi
if [ "$missing" = "1" ]; then
  echo "ERROR: required StyleTTS2 utility weights/configs are missing." >&2
  exit 1
fi
uv --project recipe run python - <<'PY'
import sys; sys.path.insert(0, "recipe/StyleTTS2")
from kokoro_symbols import symbols, dicts, TextCleaner
assert len(symbols) == 178, len(symbols)
assert dicts["ː"] == 158 and dicts["ç"] == 78 and dicts["ʦ"] == 20
print("    symbol map OK: 178 slots, sparse ids match Kokoro (ː=158, ç=78, ʦ=20)")
PY

cat <<'NEXT'

✅ Setup done. Gates remaining:
  GATE 1 (data):  put TTS-Swedish wavs+speakers.csv in data/swedish_raw/, then
                  python prepare_data.py --raw data/swedish_raw --speaker auto --g2p neural
                  (export SV_NEURAL_G2P=nst_g2p first to use the neural G2P)
  GATE 2 (smoke): bash train_3090.sh --smoke      # 2 steps, must give finite losses
  GATE 3/4:       bash train_3090.sh              # Stage 1 -> Stage 2 -> voicepack
NEXT
