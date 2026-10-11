"""Shared form normalization for pi32v2 ISA tooling.

Pipeline per objdump line:
  1. strip the vendor's trailing `<_fw+... : ... >` annotation (anchored at
     end-of-line so a `<` operator in the text can't swallow the rest),
  2. hex immediates -> #h, decimals -> #i,
  3. registers r0..r15 -> R,
  4. canonicalize abstract register lists: `{pc, r6-r4}` and `{pc, r5, r4}`
     are objdump spellings of the same block-pop/push family on a variable
     field, so both become `{pc, R*2}`. Named regs (rets, psr, sr4, ...) are
     kept verbatim; empty lists stay `{}`.
"""
import re

LINE = re.compile(r"^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+[0-9a-f]{2})\s*\t(.*)$")
IMM = re.compile(r"\b\d+\b")
HEXIMM = re.compile(r"\b0x[0-9a-f]+\b", re.I)
ANNOT = re.compile(r"\s*<[^<>]*>\s*$")
WS = re.compile(r"\s+")
REG = re.compile(r"\br(?:1[0-5]|[0-9])\b")
BRACE = re.compile(r"\{([^{}]*)\}")
ITEM = re.compile(r"^(R|(?:R-R))$")


def normalize(text: str) -> str:
    text = ANNOT.sub("", text).rstrip()
    text = HEXIMM.sub("#h", text)
    text = IMM.sub("#i", text)
    text = WS.sub(" ", text)
    text = REG.sub("R", text)

    def canon(m: "re.Match[str]") -> str:
        items = m.group(1).split(", ") if m.group(1) else []
        out, run = [], 0
        for it in items:
            if ITEM.match(it):
                run += 1 if it == "R" else 2
            else:
                if run:
                    out.append(f"R*{run}")
                    run = 0
                out.append(it)
        if run:
            out.append(f"R*{run}")
        return "{" + ", ".join(out) + "}"

    return BRACE.sub(canon, text).strip()
