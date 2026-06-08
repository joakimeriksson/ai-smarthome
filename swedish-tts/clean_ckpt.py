"""Make KBLab's Swedish NST checkpoint resumable under torch 2.12 / Lightning 2.6.

Only one thing actually blocks it: pathlib.PosixPath objects embedded in
`hyper_parameters` trip Lightning's weights_only=True validation load. We
recursively convert every Path to str and re-save, keeping the full training
state (weights + optimizer + LR schedulers + loops) intact so `--ckpt_path`
performs a normal Lightning resume (which requires optimizer state).

Because the resume inherits the base global_step, fine-tuning runs must set
`--trainer.max_steps` to BASE_STEP + N. We print BASE_STEP for convenience.
"""
import pathlib
import torch

SRC = "basemodel/sv_nst_base.ckpt"
DST = "basemodel/sv_nst_base_resume.ckpt"


def deplath(o):
    if isinstance(o, pathlib.PurePath):
        return str(o)
    if isinstance(o, dict):
        return {k: deplath(v) for k, v in o.items()}
    if isinstance(o, list):
        return [deplath(v) for v in o]
    if isinstance(o, tuple):
        return tuple(deplath(v) for v in o)
    return o


ck = torch.load(SRC, weights_only=False, map_location="cpu")
ck = deplath(ck)

# LightningCLI re-applies the checkpoint's stored hyper_parameters as CLI options
# on resume. KBLab's old hparams (e.g. model.sample_bytes) no longer exist on
# piper1-gpl's VitsModel and break parsing. The architecture comes from our CLI
# args, so blank these out — we only want the weights + optimizer state restored.
ck["hyper_parameters"] = {}
ck["hparams_name"] = None
ck.pop("datamodule_hyper_parameters", None)
ck.pop("datamodule_hparams_name", None)

torch.save(ck, DST)

# Verify Lightning's strict safe-load path now succeeds.
peek = torch.load(DST, weights_only=True, map_location="cpu")
print(f"wrote {DST}")
print(f"BASE_STEP={peek['global_step']}")
print(f"base_epoch={peek['epoch']}")
print(f"has optimizer_states={'optimizer_states' in peek}")
print(f"emb_shape={tuple(peek['state_dict']['model_g.enc_p.emb.weight'].shape)}")
