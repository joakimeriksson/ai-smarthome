"""Audio post-processing shared by the PyTorch and ONNX paths (pure numpy, no torch
or kokoro import — so importing it never forces a particular kokoro onto sys.path)."""
import numpy as np


def trim_eos_tail(audio, pred_dur, sr=24000, fade_ms=15,
                  tail_keep_ms=70, floor_ms=70, thr_db=-38):
    """Remove the trailing low-frequency hum the decoder generates for the final
    EOS token, WITHOUT clipping the end of real speech.

    pred_dur is per-token frame counts ([BOS, ...phonemes, EOS]); the last entry is
    the EOS tail. We cut the audio span mapping to those EOS frames but keep a
    `tail_keep_ms` margin first, because the final phoneme's release spills past the
    token boundary (coarticulation) — cutting exactly at the boundary sounds clipped.
    Then a gentle <thr_db trailing-silence trim with a `floor_ms` pad, and a fade-out
    so the cut is click-free.
    """
    pd = np.asarray(pred_dur).astype(np.int64)
    total = int(pd.sum())
    if total <= 0:
        return audio
    spf = len(audio) / total                          # samples per decoder frame
    keep = int(round((total - int(pd[-1])) * spf)) + int(tail_keep_ms / 1000 * sr)
    keep = max(1, min(keep, len(audio)))
    audio = audio[:keep].copy()
    w = int(0.02 * sr)
    if len(audio) > w:
        env = np.array([np.sqrt(np.mean(audio[i:i + w] ** 2))
                        for i in range(0, len(audio) - w, w)])
        if len(env):
            thr = env.max() * 10 ** (thr_db / 20)
            sp = np.where(env > thr)[0]
            if len(sp):
                end = min(len(audio), (sp[-1] + 1) * w + int(floor_ms / 1000 * sr))
                audio = audio[:end]
    f = int(fade_ms / 1000 * sr)
    if 0 < f < len(audio):
        audio[-f:] *= np.linspace(1.0, 0.0, f).astype(audio.dtype)
    return audio
