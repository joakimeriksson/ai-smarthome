# swedish-tts — realtime Swedish voice for the smart home

A fast, **realtime** Swedish text-to-speech voice built on [Piper](https://github.com/OHF-voice/piper1-gpl),
fine-tuned from KBLab's Swedish NST checkpoint, with a roadmap to correct
pronunciation via a custom lexicon / G2P.

Inference is featherweight (~60× realtime, CPU-only, ~63 MB model) so the voice
runs anywhere in the house — a Pi, the Mac, or the DGX Spark as an always-on
TTS server. Only *training* needs a GPU (the RTX 3090).

## Why this stack

| Need | Choice | Note |
|---|---|---|
| Realtime on cheap hardware | **Piper** (VITS) | ~60× realtime on CPU; ~0.18 s to first audio |
| Speaks Swedish | KBLab NST base | only open Swedish Piper checkpoint with a trainable `.ckpt` |
| Correct pronunciation | **custom espeak dict / G2P** | espeak's Swedish G2P mis-stresses words & vowels (e.g. *godis*) |

Chatterbox (2× *slower* than realtime on a Mac) and Kokoro (no Swedish) were
evaluated and rejected — see the project notes.

## Train on the RTX 3090 (WSL2 Ubuntu)

```bash
# 1. clone this repo in WSL2 Ubuntu, then:
cd swedish-tts
bash setup_3090.sh            # env + CUDA torch + piper + base checkpoint

# 2. get the data into ./data/swedish_raw  (rsync from the Mac, or regenerate
#    from the public HF dataset datadriven-company/TTS-Swedish)

# 3. fine-tune + export
bash train_3090.sh 10000 32   # steps, batch  -> output/sv_nyckfull.onnx
```

Copy `output/sv_nyckfull.onnx` + `.onnx.json` to wherever you run inference.

## Pronunciation fixes (espeak dictionary)

```bash
# add wrong words/names to sv_custom.txt, then rebuild the Swedish dict:
bash build_sv_dict.sh         # needs: brew/apt install espeak-ng
```

Roadmap: replace espeak's Swedish rules with a neural G2P trained on the
**NST lexicon** (927k words, CC0) for correct stress/vowels/names — see notes.

## Files

| File | Purpose |
|---|---|
| `setup_3090.sh` | one-time GPU env + base model |
| `train_3090.sh` | fine-tune on CUDA + export to ONNX |
| `prepare_data.py` | build single-speaker manifest from `data/swedish_raw` |
| `clean_ckpt.py` | make the KBLab checkpoint resumable |
| `finetune_export.sh` | export newest checkpoint to ONNX |
| `synth.py` | synthesize + measure realtime factor |
| `compare.sh` | A/B a voice vs the baseline |
| `build_sv_dict.sh` / `sv_custom.txt` | espeak Swedish pronunciation overrides |
| `pixi.toml` | macOS (MPS) workflow — mirrors the GPU scripts |
