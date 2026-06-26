# Mac quickstart — running the Swedish + multilingual Kokoro voice

Handoff note (the repo travels between machines; the agent memory does not). Goal:
run `deploy/`'s voice on a Mac. Weights auto-download from HuggingFace
**`Joakim/swedish-kokoro`** (public). `config.json` + `sv_female.pt` are already in
`deploy/` in this repo; only the big `.pth`/`.onnx` come from HF.

## Setup
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install kokoro torch soundfile huggingface_hub numpy onnxruntime misaki
brew install espeak-ng         # Swedish + several languages' G2P
```
Note: `recipe/` is NOT checked out on the Mac (gitignored) — that's fine, the code
falls back to the pip-installed `kokoro` package.

## Run (PyTorch — best on Apple Silicon)
```python
from kokoro_svml import KokoroSVML
import soundfile as sf
tts = KokoroSVML()                                  # first run downloads weights from HF
sf.write("sv.wav", tts.generate("Hej, jag pratar svenska!", lang="sv"), 24000)
sf.write("en.wav", tts.generate("And English too.",          lang="en"), 24000)
```

## Run (ONNX — torch-free / CPU)
```bash
python onnx_example.py --text "Hej från ONNX på Mac."
```

## Gotchas
- **G2P = espeak by default.** The higher-quality neural G2P model (`g2p_model.pt`)
  is NOT published — leave `SV_NEURAL_G2P` unset (uses espeak `sv`), or copy
  `../swedish-tts/g2p/` over and set `SV_NEURAL_G2P=nst_g2p SV_G2P_DIR=…/g2p`.
- **Text normalization is the caller's job** — numbers/Roman numerals aren't
  normalized (e.g. capitalized "Vi" → "VI" = 6 = "sex" in espeak). Lowercase or
  pre-normalize if you hit it.
- **No MLX port** of this model — use PyTorch (CPU/MPS) or the ONNX path. Apple
  Silicon: torch with MPS is the simplest fast option.
- Quality: Swedish is TTS-distilled with a faint residual decoder comb; English/etc.
  inherited from base Kokoro. See `RUN1.md` for the full story.
