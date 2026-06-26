# swedish-kokoro deployable voice (sv_female)

Best checkpoint from run #1: **epoch_2nd_00002** (PRE-adversarial — the Stage-2
adversarial/SLM epoch injects the 25 ms comb, so we stop before it). EOS-tail
trimming removes the trailing low-frequency hum.

Files:
- `kokoro_sv.pth` — Kokoro-format weights (bert, bert_encoder, predictor,
  text_encoder, decoder) converted from epoch_2nd_00002.
- `sv_female.pt`  — voicepack [510,1,256] (style_encoder from Stage-1 first_stage,
  predictor_encoder from epoch_2nd_00002; 200-clip mean).
- `config.json`   — patched Swedish Kokoro config (178-token vocab).

## Multilingual + Swedish (one model, drop-in)

`../kokoro_svml.py` wraps these weights so the SAME model speaks Swedish AND the
normal Kokoro languages (Kokoro's KModel is language-blind — IPA -> audio):

    from kokoro_svml import KokoroSVML
    tts = KokoroSVML()                                  # loads kokoro_sv.pth + sv_female.pt
    sv = tts.generate("Hej, jag är CandyTron!", lang="sv")   # g2p_sv + sv_female + tail-trim
    en = tts.generate("Hello from the same model.",  lang="en")  # KPipeline 'a' + af_heart
    es = tts.generate("Hola.",                       lang="es")
    # returns 24 kHz float32 mono numpy; langs: sv, en/en-gb, es, fr, hi, it, pt, zh, ja

For Swedish set the neural G2P env (else espeak fallback):
    SV_NEURAL_G2P=nst_g2p  SV_G2P_DIR=/…/swedish-tts/g2p
Run via the recipe venv with `uv --project recipe run --no-sync` (ja/zh extras).

Low-level Swedish-only path (see ../synth_real.py):
    KModel(repo_id="hexgrad/Kokoro-82M", config="config.json", model="kokoro_sv.pth")
    voice = torch.load("sv_female.pt")
    ipa = SwedishG2P()(text)              # espeak 'sv'
    ids = [vocab[p] for p in ipa if p in vocab]
    audio = kmodel(ipa, voice[len(ids)-1])      # then trim_eos_tail(audio, pred_dur)

KNOWN LIMITATION: a residual ~12.5/25 ms decoder comb remains (echo/pitch ~0.5 vs
0.39 clean). Real fix = retrain Stage 2 with adversarial disabled/gentler on >700
clips. See memory swedish-kokoro-run1-listen.
