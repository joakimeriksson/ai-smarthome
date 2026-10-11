#!/usr/bin/env python3
"""Build isa/fm1.yaml from the V13 vendor-objdump corpus.

Pipeline:
  1. parse objdump listing -> (addr, bytes, text)
  2. normalize text -> form (immediates -> #i/#h, registers -> R)
  3. group ALL byte samples per (len, form); constant bits -> mask/match
  4. variable-bit spans -> candidate fields f0..fN (bit positions in the
     little-endian integer formed by the instruction bytes)
  5. emit YAML skeleton, entries sorted by corpus frequency

Mask caveat: masks are derived from observed samples only. Bits that never
varied in the corpus appear fixed even if they are architecturally operand
bits. Entries are marked `status: auto` until hand-verified against targeted
probes (tools/probe.sh).

Bit numbering convention (used everywhere in this project):
  the instruction's bytes b0..bn form a little-endian integer V
  (b0 = bits 0..7, b1 = bits 8..15, ...). mask/match/fields refer to V.
"""
import json
import re
import sys

from normlib import LINE, normalize


def spans_from_mask(mask: int, width: int) -> list[tuple[int, int]]:
    """Variable (=operand) bits of ~mask grouped into [lsb, msb] spans."""
    variable = (~mask) & ((1 << width) - 1)
    spans = []
    lsb = None
    for b in range(width + 1):
        set_bit = b < width and (variable >> b) & 1
        if set_bit and lsb is None:
            lsb = b
        elif not set_bit and lsb is not None:
            spans.append((lsb, b - 1))
            lsb = None
    return spans


def slug(text: str, length: int, taken: set[str]) -> str:
    s = text.lower()
    s = s.replace(">=", "ge").replace("<=", "le").replace("!=", "ne")
    s = s.replace("==", "eq").replace(">>>=", "asr").replace(">>>", "asr")
    s = s.replace(">>", "lsr").replace("<<", "lsl").replace(">", "gt").replace("<", "lt")
    s = s.replace("+=", "add").replace("-=", "sub").replace("&=", "and")
    s = s.replace("|=", "or").replace("^=", "xor").replace("*=", "mul")
    s = s.replace("=~", "not").replace("=", "mov")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    s = re.sub(r"_+", "_", s)[:60] or "insn"
    name = s
    i = 2
    while name in taken:
        name = f"{s}_l{length}" if i == 2 else f"{s}_{i}"
        i += 1
    taken.add(name)
    return name


def group_of(text: str) -> str:
    t = text
    if t.startswith(("if", "ifs", "goto")) or " goto " in t:
        return "branch"
    if t.startswith(("call", "rts", "rtns", "rti", "rte")) or t.startswith("pc ="):
        return "control"
    if t.startswith("rep"):
        return "rep"
    if t in ("nop", "csync", "idle", "cli", "sti", "lockclr", "sevg") \
            or t.startswith(("sti ", "cli ", "pfetch", "sic", "mtm", "mfm")):
        return "system"
    if "[" in t and "sp" in t and (t.startswith("[--sp]") or "= [sp++]" in t):
        return "stack"
    if "[" in t:
        rhs = t.split("=", 1)[-1]
        return "load" if "[" in rhs else "store"
    if "#i" in t or "#h" in t:
        return "alu_imm" if any(o in t for o in "+-&|^*<>") else "imm"
    return "alu"


def main(corpus_paths: list[str], out_yaml: str, stats_path: str) -> None:
    forms: dict[tuple[int, str], dict] = {}
    n_insn = 0
    for objdump_path in corpus_paths:
        with open(objdump_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = LINE.match(line)
                if not m:
                    continue
                n_insn += 1
                raw = bytes.fromhex(m.group(2))
                form = normalize(m.group(3))
                key = (len(raw), form)
                e = forms.setdefault(key, {"count": 0, "samples": set()})
                e["count"] += 1
                e["samples"].add(raw.hex())

    taken: set[str] = set()
    entries = []
    for (length, form), e in forms.items():
        samples = sorted(e["samples"])
        and_all = int.from_bytes(bytes.fromhex(samples[0]), "little")
        or_all = and_all
        for s in samples[1:]:
            v = int.from_bytes(bytes.fromhex(s), "little")
            and_all &= v
            or_all |= v
        width = length * 8
        variable = and_all ^ or_all
        mask = (~variable) & ((1 << width) - 1)
        match = and_all & mask
        fields = [{"name": f"f{i}", "lsb": lo, "msb": hi}
                  for i, (lo, hi) in enumerate(spans_from_mask(mask, width))]
        entries.append({
            "name": slug(form, length, taken),
            "syntax": form,
            "len": length,
            "mask": f"{mask:0{length * 2}x}",
            "match": f"{match:0{length * 2}x}",
            "group": group_of(form),
            "fields": fields,
            "count": e["count"],
            "distinct_encodings": len(samples),
            "samples": set(samples[:512]),
            "status": "auto",
        })

    entries.sort(key=lambda x: -x["count"])

    # Merge spelling-variant families that share identical (len, mask, match):
    # e.g. "{pc, r6-r4} = [sp++]" vs "{pc, r5, r4} = [sp++]" have the same
    # constant bits, so one encoder family; keep the most common syntax as
    # primary, record the rest as `alt` (aliased decodes).
    families: dict[tuple[int, str, str], list[dict]] = {}
    for e in entries:
        families.setdefault((e["len"], e["mask"], e["match"]), []).append(e)
    merged = []
    for fam in families.values():
        fam.sort(key=lambda x: -x["count"])
        primary = fam[0]
        if len(fam) > 1:
            alts = sorted({f["syntax"] for f in fam[1:] if f["syntax"] != primary["syntax"]})
            primary["count"] = sum(f["count"] for f in fam)
            samples = set()
            for f in fam:
                samples |= forms[(f["len"], f["syntax"])]["samples"]
            primary["samples"] = samples
            if alts:
                primary["alt"] = alts
        merged.append(primary)
    entries = sorted(merged, key=lambda x: -x["count"])

    with open(out_yaml, "w") as f:
        f.write("# pi32v2 ISA — AUTO-EXTRACTED from the V13 stock firmware\n")
        f.write("# vendor-objdump corpus. See tools/build_isa.py.\n")
        f.write("# Bit numbering: instruction bytes form a little-endian integer;\n")
        f.write("# mask/match/fields refer to that integer. status: auto entries\n")
        f.write("# have corpus-derived masks, not yet hand-verified.\n")
        f.write("isa: pi32v2\n")
        f.write("endianness: little\n")
        f.write("instructions:\n")
        for e in entries:
            f.write(f"  - name: {e['name']}\n")
            f.write(f"    syntax: {json.dumps(e['syntax'])}\n")
            f.write(f"    len: {e['len']}\n")
            f.write(f"    mask: \"{e['mask']}\"\n")
            f.write(f"    match: \"{e['match']}\"\n")
            f.write(f"    group: {e['group']}\n")
            if e["fields"]:
                f.write("    fields:\n")
                for fld in e["fields"]:
                    f.write(f"      {fld['name']}: [{fld['lsb']}, {fld['msb']}]\n")
            if e.get("alt"):
                f.write(f"    alt: {json.dumps(e['alt'])}\n")
            f.write(f"    count: {e['count']}\n")
            # capped samples; used by check_isa as a decode tiebreak when
            # two mask entries cover the same window
            f.write(f"    samples: {json.dumps(sorted(e.get('samples', set()))[:512])}\n")
            f.write(f"    status: {e['status']}\n")

    total = sum(e["count"] for e in entries)
    with open(stats_path, "w") as f:
        json.dump({
            "instructions_parsed": n_insn,
            "distinct_classes": len(entries),
            "coverage_top_n": {
                str(n): sum(e["count"] for e in entries[:n]) / total
                for n in (50, 100, 200, 400, 800)
            },
        }, f, indent=1)
    print(f"{len(entries)} classes -> {out_yaml}")


if __name__ == "__main__":
    # usage: build_isa.py out.yaml stats.json corpus1.txt [corpus2.txt ...]
    *rest, out_yaml, stats_path = sys.argv[1:]
    main(rest, out_yaml, stats_path)
