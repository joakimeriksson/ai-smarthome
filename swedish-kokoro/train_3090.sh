#!/usr/bin/env bash
# Fine-tune Kokoro-82M on Swedish via the kikiri/StyleTTS2 two-stage recipe.
# Fixed: runs from recipe/StyleTTS2 with `accelerate launch`, absolute config,
# and a --smoke gate that catches the two failure modes that sank the last run.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${CONFIG:-$ROOT/config_sv.yml}"
ST="$ROOT/recipe/StyleTTS2"
RUN() { uv --project "$ROOT/recipe" run accelerate launch "$@"; }

SMOKE=0
[ "${1:-}" = "--smoke" ] && SMOKE=1

for f in \
  "$ST/train_first.py" \
  "$ST/train_second.py" \
  "$ROOT/models/kokoro_base.pth" \
  "$ROOT/data/train_list.txt" \
  "$ROOT/data/val_list.txt" \
  "$ROOT/data/OOD_texts.txt"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required file missing: $f" >&2
    echo "Run setup_3090.sh and prepare_data.py before train_3090.sh." >&2
    exit 1
  fi
done
if grep -q '|' "$ROOT/data/OOD_texts.txt"; then
  echo "ERROR: data/OOD_texts.txt contains filelist separators; it must contain phoneme strings only." >&2
  echo "Regenerate data with the fixed prepare_data.py." >&2
  exit 1
fi

cd "$ST"

if [ "$SMOKE" = "1" ]; then
  echo "==> GATE 2: smoke test (1 epoch on a 50-clip subset)"
  # tiny subset + 1 epoch so a broken symbol map / un-loaded weights fail FAST
  head -n 50 "$ROOT/data/train_list.txt" > "$ROOT/data/_smoke_train.txt"
  head -n 20 "$ROOT/data/val_list.txt"   > "$ROOT/data/_smoke_val.txt"
  SMOKE_CFG="$ROOT/config_sv.smoke.yml"
  sed -e 's#train_list.txt#_smoke_train.txt#' \
      -e 's#val_list.txt#_smoke_val.txt#' \
      -e 's#^epochs_1st:.*#epochs_1st: 1#' \
      -e 's#^batch_size:.*#batch_size: 2#' "$CONFIG" > "$SMOKE_CFG"
  echo "    WATCH the first-step losses. PASS criteria:"
  echo "      Mel 0.8–1.5 | Gen 3–6 | Disc 4–6 | Mono 0.01–0.1 | S2S 1–6  (all FINITE, no NaN)"
  echo "      NaN  -> symbol-map bug (kokoro_symbols.py indices)"
  echo "      Mel >> 2 and not falling -> weights not loaded (re-run convert_weights.py)"
  RUN train_first.py --config_path "$SMOKE_CFG"
  echo "==> smoke finished. If losses were finite & in range, run without --smoke."
  exit 0
fi

echo "==> GATE 3: Stage 1 (acoustic + duration/prosody, warm-started)"
RUN train_first.py  --config_path "$CONFIG"

echo "==> GATE 4: Stage 2 (joint adversarial + SLM)"
echo "    CHECK: Stage-2 mel loss must START ~0.43, NOT ~7.5 (7.5 = weights didn't load)."
RUN train_second.py --config_path "$CONFIG"

echo "==> GATE 5: extract Kokoro voicepack from the Stage-2 checkpoint"
CKPT="$ROOT/output/sv_kokoro/epoch_2nd_best.pth"
if [ ! -f "$CKPT" ]; then
  CKPT="$(find "$ROOT/output/sv_kokoro" -maxdepth 1 -type f \( -name '*2nd*.pth' -o -name '*best*.pth' \) | sort | tail -n 1)"
fi
if [ -z "$CKPT" ] || [ ! -f "$CKPT" ]; then
  echo "ERROR: could not find Stage-2 checkpoint under $ROOT/output/sv_kokoro" >&2
  exit 1
fi
uv --project "$ROOT/recipe" run python "$ROOT/extract_voicepack.py" \
  --checkpoint "$CKPT" \
  --out "$ROOT/output/sv_kokoro.voicepack.pt" \
  --ref-list "$ROOT/data/val_list.txt"

if [ ! -f "$ROOT/output/sv_kokoro.model.pth" ]; then
  echo "NOTE: output/sv_kokoro.model.pth was not produced by this script."
  echo "      Use the kikiri KModel export step before running Mac-side test_voice.py/fetch_from_3090.sh."
fi

cat <<'DONE'

✅ Training complete.
   Voicepack:  output/sv_kokoro.voicepack.pt
   Test:       python test_voice.py --voicepack output/sv_kokoro.voicepack.pt
   Copy the voicepack to the Mac/Pi to run Swedish Kokoro at ~10x realtime.
DONE
