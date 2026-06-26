# swedish-chatterbox — synthesizing a clean Swedish dataset to train Kokoro

This project exists to **manufacture training data**. It uses **Chatterbox
Multilingual** (`language_id="sv"`) to synthesize a clean, single-speaker female
Swedish corpus, which is then distilled into a fast **Kokoro-82M** voice over in
[`../swedish-kokoro`](../swedish-kokoro). This is **TTS distillation**: a big, slow,
high-quality teacher (Chatterbox) generates the dataset for a small, fast student
(Kokoro).

## Why — the data problem this solves

Training Kokoro on Swedish needs hours of clean, **consistent single-speaker**
audio with transcripts. The natural source, **LibriVox**, failed for a female
voice: the only usable female reader is *"Jordens inre" by Otto Witt* — only
~1.7 h, and in a **skånska** accent. The larger Swedish readings are male, and the
LibriVox gender labels are unreliable.

The fix: don't *find* the data, **generate** it.

- Chatterbox Multilingual does high-quality zero-shot Swedish from a single
  reference clip.
- Key finding: cloning the skånska reader through Chatterbox **regularizes the
  accent** — the output is more neutral than the source recording (user approved
  this over the raw skånska).
- `language_id="sv"` sets pronunciation; the fixed reference clip
  (`refs/female_ref.wav`, a clean Jordens-inre snippet) sets timbre/accent. Using
  the **same reference for every line** yields one consistent synthetic speaker —
  exactly what Kokoro fine-tuning wants.

## Environment (uv venv, Python 3.11)

```bash
uv venv && uv pip install chatterbox-tts "setuptools<81"
# torch 2.6.0+cu124 on the 3090
```

⚠️ **`setuptools<81` is required.** Chatterbox's Perth watermarker imports
`pkg_resources`, removed in setuptools 81+. Without the pin,
`PerthImplicitWatermarker` is silently `None` and generation crashes.

## Scripts

| file | role |
|---|---|
| `synth_sv.py` | single-clip synth — default voice or zero-shot clone (`--ref`). Quick checks / the CandyTron preview line. |
| `batch_synth.py` | **mass synth** — one fixed reference for every line → single consistent speaker. Resumable (skips existing wavs), rewrites `speakers.csv` every 10 clips so a partial run is always usable. |
| `corpus_sv.txt` | 13 489 lines: the 50 CandyTron persona lines first (so the smart-home domain is covered even on a partial run), then `datadriven-company/TTS-Swedish` transcripts, in file order (not shuffled). |
| `candytron_lines.txt` | the 50 CandyTron persona lines (smart-home candy robot; `godis` is the pronunciation check). |
| `refs/female_ref.wav` | the fixed female reference clip (clean Jordens-inre snippet) every clip clones. |

### Generate the dataset
```bash
uv run python batch_synth.py \
  --corpus corpus_sv.txt --ref refs/female_ref.wav --out dataset --speaker sv_female
```
Output (consumed by Kokoro's `prepare_data.py --raw <out>`):
```
dataset/wavs/<idx>.wav        # 24 kHz mono
dataset/speakers.csv          # audio|text|speaker_id|duration|dnsmos
```
The first 200 clips (idx 0–199) are the 50 CandyTron lines ×4, so the domain is
front-loaded.

## What was built

**1590 clips / 3.83 h** of clean female Swedish (`dataset/`), 24 kHz, single
speaker `sv_female`. `speakers.csv` carries `dnsmos=4.0` as a placeholder (not
measured per-clip). The set is the 200 CandyTron domain clips followed by ~1390
general TTS-Swedish sentences.

### Why it stopped at 3.83 h

Chatterbox is **slow for bulk**: a 0.5B autoregressive T3, batch 1, single-stream
→ ~1.5 clips/min at ~25% GPU. The full 13.5k corpus would be ~5.5 days. We stopped
at 3.83 h — plenty for a Kokoro fine-tune — and `batch_synth.py` is resumable to
extend later (it skips already-synthesized indices).

## Where it goes next

`dataset/` feeds Kokoro training: `prepare_data.py --raw ../swedish-chatterbox/dataset
--speaker auto --speaker-label 0 --g2p neural --val 100`. The full run #1 story
(training, crash, artifact diagnosis, deployable voice) is in
[`../swedish-kokoro/RUN1.md`](../swedish-kokoro/RUN1.md).

> Note for that pipeline: the Chatterbox audio is **clean** — the echo/comb
> artifact found in the Kokoro output is introduced by Kokoro's decoder/adversarial
> training, *not* inherited from this data (verified: training clips have ≈0
> cepstral energy at the comb lags). See RUN1 §5.

## Deployment note

Chatterbox itself is **too heavy for a Pi** — it would run on the 3090 box. It is
the *teacher* here, not the deployable model; Kokoro-82M is the fast student that
ships. This project's job ends once `dataset/` exists.
