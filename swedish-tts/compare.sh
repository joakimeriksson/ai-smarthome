#!/usr/bin/env bash
# A/B the stock sv_SE-nst-medium baseline against the fine-tuned voice on the
# same Swedish sentence, reporting realtime factor for each.
set -euo pipefail
cd "$(dirname "$0")"
export KMP_DUPLICATE_LIB_OK=TRUE

TEXT="${1:-Det här är en svensk röst som läser en mening för att jämföra kvaliteten.}"
FT="output/sv_nyckfull.onnx"

echo "================ BASELINE (sv_SE-nst-medium) ================"
python synth.py --model voices/sv_SE-nst-medium.onnx --label cmp_baseline --text "$TEXT" 2>/dev/null | grep -E "label|realtime_factor|time_to_first|audio_seconds|output"

if [ -f "$FT" ]; then
  echo "================ FINE-TUNED (sv_nyckfull) ================"
  python synth.py --model "$FT" --label cmp_finetuned --text "$TEXT" 2>/dev/null | grep -E "label|realtime_factor|time_to_first|audio_seconds|output"
else
  echo "(fine-tuned voice $FT not found yet — run 'pixi run export' after training)"
fi
echo "=========================================================="
echo "Listen: output/cmp_baseline.wav  vs  output/cmp_finetuned.wav"
