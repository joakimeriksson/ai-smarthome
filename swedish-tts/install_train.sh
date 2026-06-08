#!/usr/bin/env bash
# Reproducible Piper training setup on Apple Silicon (osx-arm64), run inside the
# pixi env (`pixi run install-train`).
#
# Why this dance: building piper1-gpl from source needs CMake to compile espeak-ng
# (espeakbridge), which fails on macOS here. But the published `piper-tts` wheel
# already ships a prebuilt espeakbridge — it just lacks the training code. So we:
#   1. install the wheel (gives espeakbridge + inference) + [train] deps + onnx export deps
#   2. clone piper1-gpl only to build the cython monotonic_align extension + grab train/
#   3. merge the train/ subpackage (with monotonic_align.so) into the wheel's piper/
#   4. patch the ONNX exporter to use the legacy TorchScript path (torch 2.12's
#      dynamo exporter trips an assert in piper's spline code)
set -euo pipefail
cd "$(dirname "$0")"

# 1. Inference wheel (prebuilt espeakbridge) + training extras + onnx export deps
python -m pip install 'piper-tts[train]' onnxscript onnx

# 2. Clone source + build the cython monotonic_align extension
if [ ! -d piper1-gpl ]; then
  git clone --depth 1 https://github.com/OHF-Voice/piper1-gpl.git
fi
( cd piper1-gpl && bash build_monotonic_align.sh )

# 3. Merge the training subpackage into the installed (wheel) piper package
SP="$(python -c 'import piper, os; print(os.path.dirname(piper.__file__))')"
rm -rf "$SP/train"
cp -R piper1-gpl/src/piper/train "$SP/"

# 4. Force the legacy ONNX exporter (dynamo=False)
python - "$SP/train/export_onnx.py" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
if "dynamo=False" not in s:
    s = s.replace("        verbose=False,\n        opset_version=OPSET_VERSION,",
                  "        verbose=False,\n        dynamo=False,\n        opset_version=OPSET_VERSION,")
    open(p, "w").write(s)
    print("patched export_onnx.py dynamo=False")
else:
    print("export_onnx.py already patched")
PY

echo "=== train setup done ==="
KMP_DUPLICATE_LIB_OK=TRUE python -c "import torch, lightning; from piper import espeakbridge; from piper.train.vits.monotonic_align import maximum_path; print('torch', torch.__version__, '| lightning', lightning.__version__, '| espeakbridge + monotonic_align OK')"
