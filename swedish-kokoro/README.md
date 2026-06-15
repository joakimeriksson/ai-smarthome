# swedish-kokoro — training a Swedish voice for Kokoro-82M

Fine-tunes [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (StyleTTS2
architecture, Apache-2.0 weights) to **speak native Swedish** — the language
Kokoro ships without. Sister project to [`swedish-tts`](../swedish-tts) (Piper);
reuses its Swedish NST dataset and **neural G2P**.

## Why this is feasible (all blockers checked, June 2026)

| Dependency | Status |
|---|---|
| **Swedish PL-BERT** | ✅ Swedish (`sv`) is in [`papercup-ai/multilingual-pl-bert`](https://huggingface.co/papercup-ai/multilingual-pl-bert)'s 15-language set — no need to train one |
| **Training recipe** | ✅ [`semidark/kikiri-tts`](https://github.com/semidark/kikiri-tts) (a.k.a. kokoro-deutsch) — first public Kokoro new-language recipe (German); we adapt German→Swedish |
| **G2P** (the usual hard part) | ✅ already solved — our **NST-lexicon neural G2P** from the Piper project (beat espeak); espeak-ng `sv` is the fallback |
| **Data** | ✅ the Swedish NST set already used for the Piper voice |
| **Compute** | ✅ recipe needs 10 GB+ VRAM; the **RTX 3090 (24 GB)** runs batch 8–16 |

> Note: Kokoro's official *training* code was never released — this works because
> the community kikiri recipe reproduced it on the StyleTTS2 base.

### The one real gotcha: phoneme vocab
Kokoro has a fixed **114-symbol** IPA vocabulary. A rich Swedish G2P can emit
symbols it lacks (the German recipe had to remap `ʏ`→`y`). We verified espeak's
Swedish output stays fully in-vocab; `g2p_sv.py` carries a `KOKORO_REMAP` table
and `prepare_data.py` **fails loudly** on any out-of-vocab symbol so nothing is
silently corrupted. (Swedish candidates to watch: `ʏ`, `ɵ`, `ɧ`.)

## Layout

| File | Role | Runs on |
|---|---|---|
| `g2p_sv.py` | Swedish G2P (neural → espeak fallback) + Kokoro-vocab validator | Mac + GPU |
| `prepare_data.py` | NST data → 24 kHz wavs + StyleTTS2 filelists (`path\|IPA\|speaker`) | GPU box (data lives there) |
| `config_sv.yml` | two-stage fine-tune config (warm-start from base Kokoro + Swedish PL-BERT) | GPU box |
| `setup_3090.sh` | clone kikiri recipe, env, download PL-BERT + base Kokoro | RTX 3090 |
| `train_3090.sh` | Stage 1 → Stage 2 → voicepack extraction | RTX 3090 |
| `extract_voicepack.py` | trained checkpoint → Kokoro voicepack tensor | RTX 3090 |
| `pixi.toml` | Mac mirror env (G2P + vocab checks, no GPU) | Mac |

## Plug in your neural G2P

`g2p_sv.py` auto-loads it if importable. Point it at your module:

```bash
export SV_NEURAL_G2P=nst_g2p     # module exposing phonemize(text)->IPA, or a G2P class
```

Without it, it falls back to espeak-ng `sv` (what the Mac uses). Verify either way:

```bash
pixi run check-g2p               # phonemizes a battery, checks Kokoro-vocab coverage
```

## Run

### On the Mac (prep + sanity only)
```bash
pixi run check-g2p
# (data lives on the GPU box; espeak fallback is used here)
```

### On the RTX 3090 (WSL2 Ubuntu)
```bash
bash setup_3090.sh                              # recipe + PL-BERT + base weights
export SV_NEURAL_G2P=nst_g2p                     # use the good G2P
# put NST data in data/swedish_raw/{wavs/,metadata.csv}
python prepare_data.py --raw data/swedish_raw --speaker sv0 --val 200
bash train_3090.sh                               # Stage 1 → Stage 2 → voicepack
```

Output: `output/sv_kokoro.voicepack.pt` — copy it anywhere (Mac, Pi) and run
Kokoro inference with your Swedish G2P. Then A/B it against the Piper voice with
the same harness used in `gemma4stt`.

## Bring it back to the Mac for testing

On the 3090, training produces everything under `output/`. Pull only what
inference needs (the ⚠️ G2P is the one people forget — inference must phonemize
**identically** to training or the voice sounds broken):

| Artifact | From | Why |
|---|---|---|
| `sv_kokoro.model.pth` | `output/` | the trained voice (strip optimizer state to shrink ~330→160 MB) |
| `sv_kokoro.voicepack.pt` | `output/` | per-voice style vectors Kokoro needs at inference |
| neural G2P (model + lexicon) ⚠️ | `g2p/` | must match training's phonemization exactly |
| `config_sv.yml` + vocab | repo | sample rate (24 kHz) + token map |
| 3–5 held-out clips | `data/refs/` | honest A/B vs the Piper voice |

```bash
# on the Mac:
HOST=user@3090-box bash fetch_from_3090.sh      # rsyncs the above into ./voices, ./g2p
export SV_NEURAL_G2P=g2p.nst_g2p                 # use the fetched neural G2P
pixi run python test_voice.py --text "Hej, det här är min nya svenska röst."
afplay output/sv_kokoro_test.wav
```

Once `test_voice.py` sounds right, plug this voice into the **streaming Gemma
loop** in `../gemma4stt`: add a Kokoro backend to `streaming_tts.py:StreamingSpeaker`
(swap Piper's `voice.synthesize()` for the KModel call) so the spoken assistant
uses the trained Swedish Kokoro voice. Alternatively, export the model to ONNX on
the 3090 and it drops straight into the existing `kokoro-onnx` path on the Mac.

## Status / TODO
- [x] Feasibility verified (PL-BERT, recipe, G2P, data, compute)
- [x] G2P + vocab validation working (Mac, espeak fallback)
- [x] Data-prep + config + GPU scripts scaffolded
- [ ] Confirm exact kikiri `train_first.py`/`train_second.py` flags vs `config_sv.yml` (check `recipe/docs/TRAINING_GUIDE.md` after clone)
- [ ] Wire the neural G2P module (`SV_NEURAL_G2P`) on the GPU box
- [ ] Stage-1 smoke run (a few hundred steps) before the full fine-tune
