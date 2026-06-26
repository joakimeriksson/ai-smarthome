#!/usr/bin/env bash
# =====================================================================
# One-time setup of the Piper Swedish training environment on an NVIDIA
# GPU box (Ubuntu, or WSL2 Ubuntu on Windows). Idempotent — safe to re-run.
#
# After this, run:  bash train_3090.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

echo "==> [1/6] GPU check"
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "ERROR: nvidia-smi not found." >&2
  echo "  On WSL2: install the NVIDIA *Windows* driver (Game Ready/Studio) on the" >&2
  echo "  Windows side — do NOT install a driver inside WSL — then reopen Ubuntu." >&2
  exit 1
fi
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

echo "==> [2/6] system packages"
# Skip the apt step when the toolchain is already present (e.g. sandboxes
# without passwordless sudo). Otherwise install what's missing.
_need_pkgs=""
command -v gcc        >/dev/null 2>&1 || _need_pkgs="$_need_pkgs build-essential"
command -v cmake      >/dev/null 2>&1 || _need_pkgs="$_need_pkgs cmake"
command -v ninja      >/dev/null 2>&1 || _need_pkgs="$_need_pkgs ninja-build"
command -v espeak-ng  >/dev/null 2>&1 || _need_pkgs="$_need_pkgs espeak-ng"
command -v git        >/dev/null 2>&1 || _need_pkgs="$_need_pkgs git"
command -v curl       >/dev/null 2>&1 || _need_pkgs="$_need_pkgs curl"
python3 -c "import venv" >/dev/null 2>&1 || _need_pkgs="$_need_pkgs python3-venv python3-pip"
if [ -n "$_need_pkgs" ]; then
  echo "  installing:$_need_pkgs"
  sudo apt-get update -qq
  sudo apt-get install -y $_need_pkgs
else
  echo "  all system packages already present — skipping apt"
fi

echo "==> [3/6] python venv + deps (CUDA PyTorch)"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip wheel
# cu124 wheels suit a 3090 on a recent driver. If your driver is older,
# switch the index URL to cu121 or cu118 (see https://pytorch.org).
python -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
python -m pip install 'piper-tts[train]' onnxscript onnx huggingface_hub soundfile librosa

echo "==> [4/6] piper training code (build from source — clean on Linux)"
if [ ! -d piper1-gpl ]; then
  git clone --depth 1 https://github.com/OHF-voice/piper1-gpl.git
fi
( cd piper1-gpl && pip install -e '.[train]' && bash build_monotonic_align.sh )
# The editable install above does NOT compile the espeakbridge C extension
# (scikit-build skips it in -e mode), so build it in place. Needs the build
# tools in the venv, then `setup.py build_ext --inplace` produces and copies
# src/piper/espeakbridge.so + espeak-ng-data (espeak-ng is built from source).
python -m pip install 'scikit-build<1' 'cmake>=3.18,<4' ninja cython
( cd piper1-gpl && python script/dev_build )
# Force the legacy ONNX exporter (avoids torch's dynamo exporter tripping an
# assert in piper's spline code). Harmless if already patched.
sed -i 's/        opset_version=OPSET_VERSION,/        dynamo=False,\n        opset_version=OPSET_VERSION,/' \
  piper1-gpl/src/piper/train/export_onnx.py || true

echo "==> [5/6] base checkpoint (KBLab Swedish NST) + phoneme map + sanitize"
mkdir -p basemodel
python - <<'PY'
from huggingface_hub import hf_hub_download
import shutil, json
ck = hf_hub_download("KBLab/piper-tts-nst-swedish", "epoch=4041-step=1753548.ckpt")
shutil.copy(ck, "basemodel/sv_nst_base.ckpt")
cfg = hf_hub_download("KBLab/piper-tts-nst-swedish", "config.json")
m = json.load(open(cfg))["phoneme_id_map"]
json.dump(m, open("basemodel/sv_phoneme_id_map.json", "w"), ensure_ascii=False)
print("downloaded base checkpoint + phoneme map")
PY
python clean_ckpt.py     # -> basemodel/sv_nst_base_resume.ckpt

echo "==> [6/6] verify"
python - <<'PY'
import torch
from piper import espeakbridge
from piper.train.vits.monotonic_align import maximum_path
print("torch", torch.__version__, "| cuda available:", torch.cuda.is_available(),
      "| device:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")
print("piper training stack OK")
PY

echo
echo "DONE. Next:"
echo "  1) make sure the dataset is present at data/swedish_raw (rsync it, or"
echo "     regenerate with the repo's prepare_tts_swedish.py — see README)."
echo "  2) bash train_3090.sh            # 10k-step fine-tune + export"
