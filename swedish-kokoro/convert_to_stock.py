"""Rewrite a Kokoro checkpoint so it loads in the STOCK `kokoro` package (PyPI).

Bug it fixes: our training checkpoint stores the decoder's weight-norm convs in the
NEW torch API (`*.parametrizations.weight.original0/1`) with a DataParallel `module.`
prefix. Stock `kokoro` (>=0.9.x) builds those layers with the OLD weight_norm API and
expects `*.weight_g` / `*.weight_v`, so `load_state_dict(strict=False)` silently drops
~140 decoder tensors -> the vocoder is random -> pure noise (audio peak ~0.16).

This converter strips `module.` and maps original0->weight_g, original1->weight_v, so
stock `KModel(model=...)` loads with 0 missing decoder weights (clean audio, peak ~0.7).
The ONNX export is unaffected (it bakes materialized weights).

  uv --project recipe run --no-sync python convert_to_stock.py \
      --in deploy/kokoro_sv.pth --out deploy/kokoro_sv.pth
"""
import argparse
from pathlib import Path

import torch


def to_stock(raw: dict) -> dict:
    """Nested {module: state_dict} new-API -> old-API (module. stripped)."""
    out = {}
    for sub, sd in raw.items():
        nd = {}
        for k, v in sd.items():
            if k.startswith("module."):
                k = k[len("module."):]
            k = (k.replace(".parametrizations.weight.original0", ".weight_g")
                  .replace(".parametrizations.weight.original1", ".weight_v"))
            nd[k] = v
        out[sub] = nd
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", default="deploy/kokoro_sv.pth")
    ap.add_argument("--out", dest="dst", default="deploy/kokoro_sv.pth")
    args = ap.parse_args()

    raw = torch.load(args.src, map_location="cpu", weights_only=True)
    n_param = sum(1 for sd in raw.values() for k in sd
                  if ".parametrizations.weight.original" in k)
    fixed = to_stock(raw)
    Path(args.dst).parent.mkdir(parents=True, exist_ok=True)
    torch.save(fixed, args.dst)
    n_wn = sum(1 for sd in fixed.values() for k in sd
               if k.endswith("weight_g") or k.endswith("weight_v"))
    print(f"{args.src} -> {args.dst}: converted {n_param} new-API keys; "
          f"{n_wn} weight_g/_v keys now present (stock-kokoro compatible)")


if __name__ == "__main__":
    main()
