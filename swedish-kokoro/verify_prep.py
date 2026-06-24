"""Mac-side preflight: verify everything that can be checked WITHOUT the GPU.

These are the gates whose failure silently wrecked the previous run. Run this
before copying anything to the 3090.

    python verify_prep.py            # checks symbol map, config, G2P coverage

Exit code 0 = all green.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))

OK, FAIL = "✓", "✗"
fails = 0


def check(name, cond, detail=""):
    global fails
    print(f"  {OK if cond else FAIL} {name}" + (f"  — {detail}" if detail else ""))
    if not cond:
        fails += 1


print("== 1. Symbol map (kokoro_symbols.py) ==")
try:
    from kokoro_symbols import symbols, dicts, TextCleaner

    check("loads", True)
    check("len(symbols) == 178 (embedding slots)", len(symbols) == 178, f"got {len(symbols)}")
    check("sparse ids match Kokoro config", dicts.get("ː") == 158 and dicts.get("ç") == 78 and dicts.get("ʦ") == 20,
          f"ː={dicts.get('ː')} ç={dicts.get('ç')} ʦ={dicts.get('ʦ')}")
    check("114 symbols defined", len(dicts) == 114, f"got {len(dicts)}")
    tc = TextCleaner()
    check("TextCleaner encodes 'banaːn'", tc("banaːn") == [44, 43, 56, 43, 158, 56])
except Exception as e:
    check("kokoro_symbols import", False, repr(e))

print("== 2. Config (config_sv.yml) ==")
try:
    import yaml

    cfg = yaml.safe_load((HERE / "config_sv.yml").read_text())
    mp = cfg.get("model_params", {})
    check("has model_params block", bool(mp))
    check("n_token == 178", mp.get("n_token") == 178, f"got {mp.get('n_token')}")
    check("decoder is istftnet", mp.get("decoder", {}).get("type") == "istftnet")
    check("multispeaker == false (proven single-speaker setting)", mp.get("multispeaker") is False,
          f"got {mp.get('multispeaker')}")
    check("PLBERT_dir is the bundled one, not a foreign multilingual PL-BERT",
          "multilingual" not in str(cfg.get("PLBERT_dir", "")), cfg.get("PLBERT_dir"))
    check("has plbert + slm blocks", "plbert" in mp and "slm" in mp)
    check("pretrained_model is CONVERTED kokoro_base.pth",
          str(cfg.get("pretrained_model", "")).endswith("kokoro_base.pth"),
          cfg.get("pretrained_model"))
    check("references OOD_texts.txt", "OOD" in str(cfg.get("data_params", {}).get("OOD_data", "")))
except Exception as e:
    check("config parse", False, repr(e))

print("== 3. G2P coverage (Gate 1) ==")
try:
    from g2p_sv import SwedishG2P, validate_against_kokoro, kokoro_vocab

    g2p = SwedishG2P(backend="espeak")
    battery = [
        "Sju sjösjuka sjömän sköttes av sjuksköterskan på sjukhuset.",
        "Hus, full, ful, bur, byrå och tjugofyra unga musiker.",
        "Kärlek, hjälp, ärlig, värld, fjäril och köpenhamnsbo.",
        "Åtta öar, ödla, känguru, schysst och ingenjörens dröm.",
        "Banan, bilbanan och en gul banan låg på köksbordet.",
    ]
    phs = [g2p(s) for s in battery]
    vocab = kokoro_vocab()
    misses = validate_against_kokoro(phs, vocab)
    check("zero out-of-vocab symbols after remap", not misses, str(misses))
    tc = TextCleaner()

    def _enc_ok(s):
        try:
            tc(s.replace(" ", ""))
            return True
        except Exception:
            return False

    check("TextCleaner encodes the whole battery", all(_enc_ok(p) for p in phs))
except Exception as e:
    check("g2p coverage", False, repr(e))

print("== 4. Pipeline scripts present ==")
for f in ["convert_weights.py", "setup_3090.sh", "train_3090.sh", "prepare_data.py", "extract_voicepack.py"]:
    check(f, (HERE / f).exists())

print()
if fails:
    print(f"✗ {fails} check(s) FAILED — fix before touching the 3090.")
    sys.exit(1)
print("✓ ALL MAC-SIDE GATES GREEN. Next: data on the 3090, then bash train_3090.sh --smoke")
