#!/usr/bin/env python3
"""Census pi32v2 instruction forms from a vendor-objdump listing.

Parses lines like:
    0:    04 81             	goto 2 <_fw+0x4 : 4 >
    16:    c3 ff 7c 9e c0 01 	r3 = 29445044 <_fw+0x1C09E7C : 1c09e7c >

For each instruction: (addr, raw bytes, text).
Normalizes the text into a *form* by replacing immediates with #imm and
collapsing <...> annotations, then counts occurrences and collects raw-byte
samples per form.

Output: work/forms.json
    { "forms": [ { "text": ..., "len": ..., "count": ...,
                   "mask": "hex", "match": "hex",
                   "samples": ["hexbytes", ...] }, ... ] }

mask/match: bits constant across all samples of the form (same length only).
Forms with multiple distinct byte lengths are split per length.
"""
import json
import sys
from collections import defaultdict

from normlib import LINE, normalize


def main(path: str, out: str) -> None:
    # form key: (length_in_bytes, normalized_text)
    forms: dict[tuple[int, str], dict] = {}
    n_insn = 0
    n_unparsed = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.match(line)
            if not m:
                n_unparsed += 1
                continue
            n_insn += 1
            raw = bytes.fromhex(m.group(2))
            text = m.group(3)
            form = normalize(text)
            key = (len(raw), form)
            e = forms.setdefault(key, {"text": form, "len": len(raw),
                                       "count": 0, "samples": set()})
            e["count"] += 1
            if len(e["samples"]) < 4096:
                e["samples"].add(raw.hex())

    out_forms = []
    for (length, form), e in forms.items():
        samples = sorted(e["samples"])
        # constant-bits mask across samples
        and_all = int.from_bytes(bytes.fromhex(samples[0]), "little")
        or_all = and_all
        for s in samples[1:]:
            v = int.from_bytes(bytes.fromhex(s), "little")
            and_all &= v
            or_all |= v
        width = length * 8
        variable = and_all ^ or_all           # bits that differ somewhere
        mask = (~variable) & ((1 << width) - 1)
        match = and_all & mask
        out_forms.append({
            "text": e["text"],
            "len": length,
            "count": e["count"],
            "mask": f"{mask:0{length * 2}x}",
            "match": f"{match:0{length * 2}x}",
            "distinct_encodings": len(samples),
            "samples": samples[:16],
        })

    out_forms.sort(key=lambda x: -x["count"])
    with open(out, "w") as f:
        json.dump({
            "source": path,
            "instructions_parsed": n_insn,
            "lines_unparsed": n_unparsed,
            "distinct_forms": len(out_forms),
            "forms": out_forms,
        }, f, indent=1)
    print(f"parsed {n_insn} instructions "
          f"({n_unparsed} non-instruction lines), "
          f"{len(out_forms)} distinct forms -> {out}")
    covered = sum(e["count"] for e in out_forms[:100])
    print(f"top-100 forms cover {covered}/{n_insn} "
          f"({100.0 * covered / max(n_insn, 1):.1f}%)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
