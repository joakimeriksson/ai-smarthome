#!/usr/bin/env bash
# Pull the trained Swedish Kokoro artifacts from the 3090 box back to the Mac for
# testing. Set HOST to your ssh target (e.g. user@3090-box or a WSL2 hostname).
#
#   HOST=joakim@3090 bash fetch_from_3090.sh
#
# Brings back ONLY what inference needs: model weights, voicepack, the neural G2P,
# config/vocab, and a few reference clips. Mirrors into ./voices and ./g2p.
set -euo pipefail

HOST="${HOST:?set HOST=user@host (the 3090 / WSL2 box)}"
REMOTE="${REMOTE:-~/work/swedish-kokoro}"     # project dir on the 3090
LOCAL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$LOCAL/voices" "$LOCAL/g2p" "$LOCAL/data/refs"

echo "==> model weights + voicepack + config"
rsync -avz --progress \
  "$HOST:$REMOTE/output/sv_kokoro.voicepack.pt" \
  "$HOST:$REMOTE/output/sv_kokoro.model.pth" \
  "$HOST:$REMOTE/config_sv.yml" \
  "$LOCAL/voices/"

echo "==> the neural G2P (model + code + lexicon) — MUST match training"
rsync -avz --progress "$HOST:$REMOTE/g2p/" "$LOCAL/g2p/"

echo "==> a few held-out reference clips for A/B"
rsync -avz --progress "$HOST:$REMOTE/data/refs/" "$LOCAL/data/refs/" || true

cat <<'NEXT'

✅ Pulled. Now on the Mac:
   export SV_NEURAL_G2P=g2p.nst_g2p      # point at the fetched module
   pixi run python test_voice.py --text "Hej, det här är min nya svenska röst."
NEXT
