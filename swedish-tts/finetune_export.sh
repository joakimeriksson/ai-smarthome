#!/usr/bin/env bash
# Export the newest trained Lightning checkpoint to a Piper ONNX voice.
# Usage: bash finetune_export.sh <voice_name>   (default: sv_nyckfull)
set -euo pipefail
cd "$(dirname "$0")"
export KMP_DUPLICATE_LIB_OK=TRUE

VOICE="${1:-sv_nyckfull}"
CKPT="$(find lightning_logs -name '*.ckpt' | sort | tail -1)"
if [ -z "$CKPT" ]; then echo "No checkpoint found under lightning_logs/"; exit 1; fi
echo "exporting checkpoint: $CKPT"

python -m piper.train.export_onnx --checkpoint "$CKPT" --output-file "output/${VOICE}.onnx"

# Piper inference needs <voice>.onnx + <voice>.onnx.json (the config written during training).
cp "output/${VOICE}.config.json" "output/${VOICE}.onnx.json"
echo "voice ready: output/${VOICE}.onnx (+ .onnx.json)"
