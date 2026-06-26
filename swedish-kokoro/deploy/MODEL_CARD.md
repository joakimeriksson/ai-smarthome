---
license: apache-2.0
language:
- sv
- en
- es
- fr
- it
- pt
- hi
- zh
- ja
library_name: kokoro
pipeline_tag: text-to-speech
base_model: hexgrad/Kokoro-82M
tags:
- text-to-speech
- tts
- swedish
- kokoro
- styletts2
---

# swedish-kokoro — Kokoro-82M fine-tuned to also speak Swedish

A fine-tune of [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (StyleTTS2,
82 M params) that adds a **Swedish** voice while keeping Kokoro's native languages.
Kokoro's `KModel` is language-blind (it maps IPA → audio), so the **same weights**
serve every language; the language lives in the G2P front-end you feed it.

- **Swedish**: a female voice (`sv_female`) trained via TTS distillation.
- **Other languages** (English, Spanish, French, Italian, Portuguese, Hindi,
  Mandarin, Japanese): inherited from the base model — only lightly perturbed by
  the short Swedish fine-tune (English verified near-identical to base).

## Files

| file | what |
|---|---|
| `kokoro_sv.pth` | PyTorch weights (5 inference modules), best checkpoint (pre-adversarial) |
| `kokoro_sv.onnx` | ONNX export (fp32) for torch-free / CPU / edge inference |
| `sv_female.pt` | Swedish voicepack `[510, 1, 256]` |
| `config.json` | Kokoro config (178-token IPA vocab) |

## Usage

**PyTorch** (best on NVIDIA GPU / Apple Silicon) — via the
[`kokoro_svml.py`](https://github.com/) wrapper from the project repo:

```python
from kokoro_svml import KokoroSVML
tts = KokoroSVML()                                   # auto-downloads these weights
sv = tts.generate("Hej, jag pratar svenska!", lang="sv")
en = tts.generate("And English, from the same model.", lang="en")
import soundfile as sf; sf.write("sv.wav", sv, 24000)
```

**ONNX** (torch-free, CPU/edge) — onnxruntime + numpy only:

```python
import json, numpy as np, onnxruntime as ort
from huggingface_hub import hf_hub_download
from misaki import espeak  # Swedish G2P (espeak 'sv')

sess  = ort.InferenceSession(hf_hub_download("Joakim/swedish-kokoro", "kokoro_sv.onnx"))
voice = ...  # load sv_female.pt -> [510,1,256] numpy
vocab = json.load(open(hf_hub_download("Joakim/swedish-kokoro", "config.json")))["vocab"]
ipa, _ = espeak.EspeakG2P(language="sv")("Hej världen!")
ids = [vocab[p] for p in ipa if p in vocab]
audio, pred_dur = sess.run(None, {"input_ids": np.array([[0,*ids,0]], np.int64),
                                  "ref_s": voice[len(ids)-1]})
```

Output is 24 kHz mono. Trim the EOS tail using `pred_dur` (see the repo's
`trim_eos_tail`). For Swedish, set `SV_NEURAL_G2P=nst_g2p` for the higher-quality
neural G2P (else espeak `sv`).

## How it was made

- **Data**: Swedish couldn't be sourced cleanly from LibriVox (the one usable
  female reader is ~1.7 h of skånska), so the training set was **synthesized** with
  Chatterbox Multilingual (`language_id="sv"`) cloning one clean reference clip —
  ~3.8 h of consistent single-speaker Swedish (TTS distillation).
- **Training**: warm-started from base Kokoro; StyleTTS2 two-stage fine-tune on a
  700-clip subset (RTX 3090, fp32, batch 4).
- **Checkpoint choice**: the Stage-2 **adversarial/SLM epoch injects a 25 ms
  comb/echo** (degenerate on little data), so the shipped weights are the
  **pre-adversarial** checkpoint — the cleanest of the run.

## Limitations

- **Swedish quality** is TTS-distilled (Chatterbox-grade timbre), not human-grade,
  and carries a faint residual decoder comb (~12.5 ms). Good for use, not native.
- The sj-ljud /ɧ/ is approximated as retroflex /ʂ/.
- Text normalization (numbers, Roman numerals — e.g. "Vi" → "VI" = 6) is the
  caller's responsibility; the bundled G2P doesn't normalize.
- ONNX **int8** is *not* provided — dynamic int8 slowed this conv-heavy vocoder
  down; use the fp32 ONNX (≈7× realtime on CPU) or PyTorch on GPU (≈60× realtime).

## License

Apache-2.0, inheriting [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).
The Swedish reference voice derives from a public-domain LibriVox recording.
