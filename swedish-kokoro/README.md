# swedish-kokoro — training a Swedish voice for Kokoro-82M

Fine-tunes [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (StyleTTS2
architecture, Apache-2.0 weights) to **speak native Swedish** — the language
Kokoro ships without. Sister project to [`swedish-tts`](../swedish-tts) (Piper);
uses the TTS-Swedish data layout and a **neural G2P** hook.

## Why this is feasible (all blockers checked, June 2026)

| Dependency | Status |
|---|---|
| **Swedish PL-BERT** | ✅ Swedish (`sv`) is in [`papercup-ai/multilingual-pl-bert`](https://huggingface.co/papercup-ai/multilingual-pl-bert)'s 15-language set — no need to train one |
| **Training recipe** | ✅ [`semidark/kikiri-tts`](https://github.com/semidark/kikiri-tts) (a.k.a. kokoro-deutsch) — first public Kokoro new-language recipe (German); we adapt German→Swedish |
| **G2P** (the usual hard part) | ⚠️ must be wired before real training — use `SV_NEURAL_G2P`; espeak-ng `sv` is only a pipeline smoke fallback |
| **Data** | ✅ `datadriven-company/TTS-Swedish` layout: `wavs/` + `speakers.csv` with speaker and DNSMOS metadata |
| **Compute** | ✅ recipe needs 10 GB+ VRAM; the **RTX 3090 (24 GB)** runs batch 8–16 |

> Note: Kokoro's official *training* code was never released — this works because
> the community kikiri recipe reproduced it on the StyleTTS2 base.

### The real gotcha: phoneme vocab (this is what sank attempt #1)
Kokoro's `config.json` defines **114 symbols mapped onto SPARSE ids inside a
178-slot embedding space** (`n_token: 178`; e.g. `a`=43, `ʂ`=130, `ː`=158). Both
numbers are real — 178 embedding slots, 114 populated. StyleTTS2's default
`TextCleaner` builds a *dense* `0..N` map → **wrong ids → NaN losses**. Fix:
`kokoro_symbols.py`, generated from the authoritative `config.json`, wired into
`StyleTTS2/text_utils.py` by `setup_3090.sh`.

Swedish espeak `sv` emits exactly **two** out-of-vocab symbols, remapped in
`g2p_sv.py` to in-vocab central vowels Swedish doesn't otherwise use:
`ʉ → ɨ` (101), `ɵ → ɜ` (87). `prepare_data.py` / `TextCleaner` **fail loudly** on
anything unmapped. This makes espeak usable for plumbing tests, not for the
target voice quality.

### Post-mortem of attempt #1 — fixed in this version
| Was broken | Fix |
|---|---|
| Validated vs `kokoro-onnx` (wrong vocab), dense ids | `kokoro_symbols.py` reproduces `config['vocab']` exactly |
| `ɵ→ʉ` remap (ʉ also missing); `ʉ` unhandled | `ʉ→ɨ`, `ɵ→ɜ` (verified in-vocab) |
| `config_sv.yml` missing `model_params` | full Kokoro-matching `model_params` |
| Loaded raw `kokoro-v1_0.pth` (no warm start) | `convert_weights.py` → `kokoro_base.pth` |
| `train.sh` ran `python` from wrong dir | `accelerate launch` from `recipe/StyleTTS2/` |
| No `monotonic_align` / `OOD_texts.txt` / smoke test | added to setup / prepare_data / `--smoke` |

### Gated workflow (verify cheap before burning GPU)
1. **Mac, free:** `pixi run verify-prep` — symbol map + config + G2P coverage
2. **3090:** `bash setup_3090.sh` — recipe, weight conversion, symbol wiring, monotonic_align
3. **Data:** `export SV_NEURAL_G2P=g2p.nst_g2p && python prepare_data.py --raw data/swedish_raw --speaker auto --g2p neural`
4. **Smoke (minutes):** `bash train_3090.sh --smoke` — losses must be finite & in range
5. **Train:** `bash train_3090.sh` — Stage 1 (mel 0.8→0.25) → Stage 2 (**start ~0.43, not 7.5**) → voicepack

## Layout

| File | Role | Runs on |
|---|---|---|
| `verify_prep.py` | **Mac preflight** — symbol map + config + G2P coverage gates | Mac |
| `kokoro_symbols.py` | authoritative 178-slot / 114-symbol vocab + `TextCleaner` (the fix) | Mac + GPU |
| `convert_weights.py` | raw `kokoro-v1_0.pth` → warm-start `kokoro_base.pth` | RTX 3090 |
| `g2p_sv.py` | Swedish G2P (neural → explicit espeak fallback) + Kokoro-vocab validator | Mac + GPU |
| `prepare_data.py` | TTS-Swedish `speakers.csv` → 24 kHz wavs + StyleTTS2 filelists (`path\|IPA\|speaker`) | GPU box (data lives there) |
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

For real training, `prepare_data.py` defaults to `--g2p neural` and aborts if it
cannot import that module. Use `--g2p espeak` only for plumbing tests.

```bash
pixi run verify-prep             # checks symbols/config and the local G2P path
```

## Run

### On the Mac (prep + sanity only)
```bash
pixi run verify-prep
# data lives on the GPU box; install espeak-ng separately if using local espeak checks
```

### On the RTX 3090 (WSL2 Ubuntu)
```bash
bash setup_3090.sh                              # recipe + PL-BERT + base weights
export SV_NEURAL_G2P=g2p.nst_g2p                 # use the good G2P
# put TTS-Swedish data in data/swedish_raw/{wavs/,speakers.csv}
python prepare_data.py --raw data/swedish_raw --speaker auto --g2p neural --val 200
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
| `sv_kokoro.model.pth` | `output/` | KModel-compatible weights; export step must be wired to the cloned kikiri recipe |
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
- [x] Kokoro sparse vocab validation working
- [x] Data-prep + config + GPU scripts scaffolded
- [ ] Wire the neural G2P module (`SV_NEURAL_G2P`) on the GPU box
- [ ] Wire exact kikiri voicepack + KModel export APIs after clone
- [ ] Stage-1 smoke run before the full fine-tune
