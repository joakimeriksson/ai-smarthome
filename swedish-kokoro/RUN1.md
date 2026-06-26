# swedish-kokoro — Run #1: from data to a deployable Swedish voice

End-to-end account of the first real training run (June 2026): how the data was
built, how training went (and crashed), how we diagnosed the audio artifacts, and
how we produced the shipped voice in `deploy/`. Companion to `README.md` (which
covers the project scaffolding / vocab fix). For terse internal notes see the
agent memory `swedish-kokoro-run1-listen`.

---

## 1. Goal

Fine-tune **Kokoro-82M** (StyleTTS2 architecture) to speak native Swedish, using
the community **kikiri** (kokoro-deutsch) recipe adapted German→Swedish. Target =
a clean **female** Swedish voice deployable as a fast model.

## 2. Data — Chatterbox distillation (not LibriVox)

> Full data-generation story: [`../swedish-chatterbox/README.md`](../swedish-chatterbox/README.md).

The original plan used LibriVox Swedish audio directly, but it failed: the only
usable **female** reader is *"Jordens inre" by Otto Witt* — ~1.7 h, and in a
**skånska** accent. So we pivoted to **TTS distillation**:

- Use **Chatterbox Multilingual** (`language_id="sv"`) to *synthesize* a clean
  dataset, cloning timbre from a single clean clip of the Jordens-inre reader
  (`swedish-chatterbox/refs/female_ref.wav`). Cloning through Chatterbox
  **regularizes the skånska** toward neutral (user-approved over the raw source).
- Result: **1590 clips / 3.83 h** of clean 24 kHz female Swedish
  (`swedish-chatterbox/dataset/`), text from `datadriven-company/TTS-Swedish`,
  with 200 CandyTron domain lines first.
- Chatterbox is slow (~1.5 clips/min, autoregressive); `batch_synth.py` is
  resumable to extend later.

Fed into Kokoro prep via `prepare_data.py --raw ../swedish-chatterbox/dataset
--speaker auto --speaker-label 0 --g2p neural --val 100` → **1308 train / 100 val**
(after the 1–12 s duration filter), written to `data/wavs_24k/` + StyleTTS2
filelists. Two prep gotchas: `--speaker-label 0` must be NUMERIC (meldataset does
`int(speaker_id)`); neural G2P emitted OOV `ɭ`/`-` → added `ɭ→l` + drop `-` to
`KOKORO_REMAP` in `g2p_sv.py`.

## 3. Training — two-stage, and the crash

`config_sv.yml`: `epochs_1st: 6`, `epochs_2nd: 5`, `joint_epoch: 3` (adversarial/
SLM loss switches on at Stage-2 epoch 3). Ran a **700-clip subset** (kept all
CandyTron) on the RTX 3090, **fp32 / batch 4** (bf16 breaks the iSTFTNet decoder;
batch 8 → cuFFT OOM).

What happened (`output/sv_kokoro/`):

| Stage | Result |
|---|---|
| Stage 1 (6 ep) | ✅ complete → `first_stage.pth` |
| Stage 2 (5 ep) | ⚠️ epochs 0–3 done (`epoch_2nd_00000..00003`), val 0.394→0.376 |
| Stage 2 epoch 5 | ❌ **`CUDA error: out of memory`** in `d_loss.backward()` → GPU wedged → **box rebooted** |

So the run finished Stage 1 + 4 of 5 Stage-2 epochs. The OOM is the known 24 GB
ceiling on the WavLM SLM-adversarial path. `train.log` ends cleanly at the epoch-4
checkpoint; `full_run.log` shows the OOM traceback.

## 4. Inference — two paths, both reproduced offline

The trainer renders TensorBoard previews with a hand-written helper
(`kokoro_tb_utils.run_kokoro_inference`). To listen offline and to validate, we
built two scripts:

- **`synth_listen.py`** — mirrors the trainer's preview path (StyleTTS2 model +
  the helper). Two gotchas it handles: monkeypatch `torch.load(weights_only=False)`
  (torch ≥2.6), and **strip the `module.` prefix** from saved DataParallel state
  dicts before `load_state_dict` (else it silently loads nothing → 48 s clips,
  `prosodic_norm 0.39`).
- **`synth_real.py`** — the **real deployable path**: convert the checkpoint to
  Kokoro format (5 modules: bert, bert_encoder, predictor, text_encoder, decoder),
  load into `kokoro.KModel`, and drive `KModel.forward()` directly with `g2p_sv`
  phonemes + a length-indexed `[510,1,256]` voicepack (bypassing KPipeline's
  German-only G2P). This is what shipping inference actually does.

Verified `synth_listen` ≈ trainer's TB audio ≈ `synth_real` (echo within 0.10–0.11),
so the offline scripts are faithful — no script/file/export artifacts.

## 5. The artifacts — diagnosis

The user heard "echo / bad signal path" and a trailing "ending sound." Both are
real and were isolated with spectrogram + cepstrum analysis (scratchpad scripts:
`analyze_audio.py`, `analyze2.py`, `extract_tb_audio.py`, `compare_echo.py`).

### 5a. The comb/echo
- **Signature:** cepstral peaks at **12.5 ms (1 decoder frame, 300 smp)** and
  **25 ms (2 frames)** — a spectral comb. The iSTFTNet hop is 300 smp @ 24 kHz.
- **Not the data:** the clean Chatterbox training clips have ≈0 cepstral energy at
  those lags; the synth manufactures it. (The big 85 ms cepstral peak *is* in the
  training data too — benign spectral envelope, not echo.)
- **Not the voicepack:** rebuilding from 1 / 5 / 200 clips made no difference
  (echo/pitch 1.13 / 1.05 / 1.07) — style-averaging is not the cause.
- **Not linearly cancelable:** fitting an inverse-comb filter at the exact 600-smp
  delay removed only 1–3% → it's a nonlinear/spectral decoder artifact, not a
  delayed copy.
- **Root cause — the adversarial stage.** Measuring echo/pitch on the actual saved
  checkpoints with a *constant* voicepack (isolating the decoder):

  | checkpoint | echo/pitch |
  |---|---|
  | Stage-1 final | 0.62 |
  | 2nd_00000 | 0.60 |
  | 2nd_00001 | 0.53 |
  | **2nd_00002** | **0.45** ← best, ≈ clean ref 0.39 |
  | 2nd_00003 (val-best) | **1.07** ← worst |

  The echo *decreases* through epochs 0→2, then **jumps at epoch 3 — exactly where
  `joint_epoch:3` turns on the WavLM adversarial/SLM loss.** That loss, degenerate
  on only 700 clips, **injects the comb.** So the val-loss-best checkpoint is the
  worst for the artifact, and the best deployable one is the **pre-adversarial
  `epoch_2nd_00002`**.

### 5b. The ending hum
- Every synth clip had **~0.8 s of trailing audio** after the speech, vs ~0.3–0.6 s
  in the training clips. Spectrum is **low-frequency dominant** (0–500 Hz = 0.71
  vs 2–8 kHz = 0.01) → a generated **LF hum** on the final EOS token, not a copied
  recording artifact.

## 6. The fix shipped (option A)

Cleanest result obtainable from run #1 **without retraining**:

1. **Use `epoch_2nd_00002`** (pre-adversarial) instead of the val-best.
2. **Trim the EOS tail** — `synth_real.py:trim_eos_tail()` uses the predicted
   per-token durations (`KModel.forward(..., return_output=True).pred_dur`) to cut
   the EOS-token frames, then a −30 dB trailing trim + 12 ms fade.

Result (`output/listen_final/`):

| metric | before (00003) | after (00002 + trim) |
|---|---|---|
| echo/pitch | 0.66–1.73 | **0.36–0.75** (clean ref 0.39) |
| trailing tail | ~800 ms | **40–60 ms** |

### Deployable bundle — `deploy/`
| file | what |
|---|---|
| `kokoro_sv.pth` | `epoch_2nd_00002` converted to Kokoro format (5 modules) |
| `sv_female.pt` | `[510,1,256]` voicepack (Stage-1 style + 00002 prosody, 200-clip mean) |
| `config.json` | patched Swedish 178-token Kokoro config |
| `README.md` | inference recipe + known limitation |

Reproduce the final render:
```bash
# voicepack from the best (pre-adversarial) checkpoint
uv --project recipe run python recipe/scripts/extract_voicepack.py \
  --model output/sv_kokoro/epoch_2nd_00002.pth \
  --style-encoder-model output/sv_kokoro/first_stage.pth \
  --audio-dir data/wavs_24k --output output/sv_female_00002.pt --num-samples 200
# render the test set (real KModel path + EOS-tail trim)
uv --project recipe run python synth_real.py \
  --checkpoint output/sv_kokoro/epoch_2nd_00002.pth \
  --voicepack output/sv_female_00002.pt \
  --config recipe/training/config.json --out-dir output/listen_final
```

## 7. Known limitation + the real cure (option B)

A residual decoder comb remains (echo/pitch ~0.5 vs 0.39 clean) — checkpoint
selection dodges the *worst* of it but can't remove it. The real fix is a retrain:

- **Disable / soften the adversarial+SLM stage** that injects the comb: push
  `joint_epoch` ≥ `epochs_2nd` so it never engages, or drop `lambda_slm` low.
- **More than 700 clips** (the full 1308, or extend the Chatterbox set) so the
  adversarial loss isn't degenerate.
- Keep the OOM guard: `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`, fp32,
  batch 4.

## 8. Script reference (this run)

| script | role |
|---|---|
| `prepare_data.py` | Chatterbox dataset → 24 kHz wavs + filelists |
| `train_3090.sh` / `config_sv.yml` | Stage 1 → Stage 2 two-stage fine-tune |
| `synth_listen.py` | offline render via the StyleTTS2 preview helper (validation) |
| `synth_real.py` | **deployable** render: convert → KModel → forward + tail trim |
| `extract_voicepack.py` (+ `recipe/scripts/`) | checkpoint → `[510,1,256]` voicepack |
| scratchpad `analyze_*.py`, `compare_echo.py`, `extract_tb_audio.py` | artifact diagnosis |
