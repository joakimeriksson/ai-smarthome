"""Audio post-processing shared by the PyTorch and ONNX paths (pure numpy, no torch
or kokoro import — so importing it never forces a particular kokoro onto sys.path)."""
import numpy as np


def trim_eos_tail(audio, pred_dur, sr=24000, fade_ms=12, floor_ms=40):
    """Remove the trailing low-frequency hum the decoder generates for the final
    EOS token. pred_dur is per-token frame counts ([BOS, ...phonemes, EOS]); the
    last entry is the EOS tail. Cut the audio span mapping to those frames, trim any
    remaining <-30 dB trailing silence, and fade out so the cut is click-free.
    """
    pd = np.asarray(pred_dur).astype(np.int64)
    total = int(pd.sum())
    if total <= 0:
        return audio
    spf = len(audio) / total                          # samples per decoder frame
    keep = int(round((total - int(pd[-1])) * spf))     # drop EOS-token frames
    keep = max(1, min(keep, len(audio)))
    audio = audio[:keep].copy()
    w = int(0.02 * sr)
    if len(audio) > w:
        env = np.array([np.sqrt(np.mean(audio[i:i + w] ** 2))
                        for i in range(0, len(audio) - w, w)])
        if len(env):
            thr = env.max() * 10 ** (-30 / 20)
            sp = np.where(env > thr)[0]
            if len(sp):
                end = min(len(audio), (sp[-1] + 1) * w + int(floor_ms / 1000 * sr))
                audio = audio[:end]
    f = int(fade_ms / 1000 * sr)
    if 0 < f < len(audio):
        audio[-f:] *= np.linspace(1.0, 0.0, f).astype(audio.dtype)
    return audio
