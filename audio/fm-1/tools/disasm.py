#!/usr/bin/env python3
"""Streaming disassembler for pi32v2 driven by isa/fm1.yaml + derived.yaml.

Walks the corpus addrs exactly like the vendor objdump, decodes with the
mask table (sample-priority tiebreak, mirroring check_isa.py), renders the
operand template and diffs against the vendor's own text.

Render rules:
  reg   r{val}
  imm   formula per operands[].formula (IMM_FORMULAS in derive.py)
  himm  0x… literal (formula family shifts/NOT per derive.py)
  blk   regs = max(n,hi)..min(n,lo); vendor style: 1 reg plain, 2 comma,
        >=3 as rA-rB range
Unsolved classes fall back to the normalized syntax (mask decode still
fixes the length and the form, just not every printed operand).

Usage: disasm.py isa/fm1.yaml derived.yaml corpus.txt [--quiet]
"""
import json
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normlib import normalize, LINE  # noqa: E402
from derive import (parse_raw, sext,  # noqa: E402
                    spans_from_mask)

IMM_FORMULAS = [
    lambda c, s, bits, v, ln, neg: s if neg else c,
    lambda c, s, bits, v, ln, neg: v + ln + s,
    lambda c, s, bits, v, ln, neg: v + ln + 2 * s,
    lambda c, s, bits, v, ln, neg: v + ln - s,
    lambda c, s, bits, v, ln, neg: v + ln - 2 * s,
    lambda c, s, bits, v, ln, neg: (~s) & 0xFFFFFFFF,
    lambda c, s, bits, v, ln, neg: (~s) & 0xFFFF,
]

HIMM_FORMULAS = [
    lambda c: c,
    lambda c: (~c) & 0xFFFFFFFF,
    lambda c: (~c) & 0xFFFF,
    lambda c: c << 4,
    lambda c: c << 8,
]

# ----------------------------------------------------------------- load


def load_isa(path):
    entries = []
    cur = None
    for line in open(path):
        if line.startswith("  - name:"):
            if cur:
                entries.append(cur)
            cur = {"name": line.split(":", 1)[1].strip()}
        elif cur is not None and line.startswith("    "):
            k, _, v = line.strip().partition(":")
            v = v.strip()
            if k in ("len", "count"):
                cur[k] = int(v)
            elif k in ("mask", "match"):
                cur[k] = int(v.strip('"'), 16)
            elif k == "syntax":
                cur[k] = json.loads(v)
            elif k == "alt":
                cur[k] = json.loads(v)
            elif k == "samples":
                cur[k] = {int.from_bytes(bytes.fromhex(s), "little")
                          for s in json.loads(v)}
    if cur:
        entries.append(cur)
    for e in entries:
        e["popcount"] = bin(e["mask"]).count("1")
    entries.sort(key=lambda e: (-e["len"], -e["popcount"], -e["count"]))
    return entries


def load_derived(path):
    """name -> (template, [operands]) for solved classes."""
    out = {}
    cur = None
    template = None
    ops = []
    in_ops = False
    for line in open(path):
        if line.startswith("  - name:"):
            if cur and template is not None:
                out[cur] = (template, ops)
            cur, template, ops, in_ops = (line.split(":", 1)[1].strip(),
                                          None, [], False)
        elif cur is None:
            continue
        elif line.startswith("    template:"):
            template = json.loads(line.strip().split(":", 1)[1].strip())
            in_ops = False
        elif line.strip() == "operands:":
            in_ops = True
        elif in_ops and line.startswith("      - "):
            ops.append(json.loads(line.strip()[2:]))
        elif line.startswith("  - ") is False and in_ops:
            in_ops = False
    if cur and template is not None:
        out[cur] = (template, ops)
    return out

# ---------------------------------------------------------------- render


def render_reg(op, V, inslen):
    c = concat_ranges(V, op["spans"])
    return f"r{c}"


def concat_ranges(V, spans):
    r, bits = 0, 0
    for lsb, msb in spans:
        w = msb - lsb + 1
        r |= ((V >> lsb) & ((1 << w) - 1)) << bits
        bits += w
    return r


def render_imm(op, V, inslen):
    c = concat_ranges(V, op["spans"])
    bits = sum(msb - lsb + 1 for lsb, msb in op["spans"])
    s = sext(c, bits)
    fi = op.get("formula", 0)
    val = IMM_FORMULAS[fi](c, s, bits, V, inslen, op.get("signed", False))
    return str(val)


def render_himm(op, V, inslen):
    c = concat_ranges(V, op["spans"])
    fi = op.get("formula", 0)
    val = HIMM_FORMULAS[fi](c)
    return f"0x{val:X}"


def render_blk(op, V, inslen):
    n = concat_ranges(V, op["spans"])
    hi = op.get("hi", 0)
    lo = op.get("lo", 0)
    regs = list(range(max(n, hi), min(n, lo) - 1, -1))
    k = len(regs)
    if k == 1:
        return f"r{regs[0]}"
    if k == 2:
        return f"r{regs[0]}, r{regs[1]}"
    return f"r{regs[0]}-r{regs[-1]}"


RENDER = {"reg": render_reg, "imm": render_imm, "himm": render_himm,
          "blk": render_blk}


def render(template, operands, V, inslen):
    parts = template.split("{o}")
    out = parts[0]
    for i, op in enumerate(operands):
        out += RENDER[op["kind"]](op, V, inslen)
        out += parts[i + 1]
    return out

# ----------------------------------------------------------------- main


def main(yaml_path, derived_path, corpus_path):
    entries = load_isa(yaml_path)
    solved = load_derived(derived_path)

    corpus = {}
    anno_re = re.compile(r"\s*<[^<>]*>\s*$")
    for line in open(corpus_path, encoding="utf-8", errors="replace"):
        m = LINE.match(line)
        if m:
            txt = m.group(3).rstrip()
            am = anno_re.search(txt)
            if am:
                txt = txt[: am.start()].rstrip()
            corpus[int(m.group(1), 16)] = (bytes.fromhex(m.group(2)), txt)
    addrs = sorted(corpus)
    img = bytearray()
    for a in addrs:
        b, _ = corpus[a]
        if len(img) < a:
            img.extend(b"\x00" * (a - len(img)))
        img[a:a + len(b)] = b

    stats = {"total": 0, "text_match": 0, "unrendered": 0, "text_wrong": 0,
             "undecodable": 0}
    wrong_examples = []
    pos = 0
    n = len(addrs)
    while pos < n:
        a = addrs[pos]
        raw_bytes, vendor = corpus[a]
        stats["total"] += 1
        V = int.from_bytes(raw_bytes, "little")
        window = int.from_bytes(img[a:a + 6].ljust(6, b"\x00"), "little")
        e = None
        cands = [x for x in entries if (window & x["mask"]) == x["match"]]
        for x in cands:
            if V in x.get("samples", ()):
                e = x
                break
        if e is None and cands:
            e = cands[0]
        spec = solved.get(e["name"]) if e else None
        if e is None:
            stats["undecodable"] += 1
        elif spec is None:
            stats["unrendered"] += 1
        else:
            template, operands = spec
            text = render(template, operands, V, e["len"])
            if text == vendor:
                stats["text_match"] += 1
            else:
                stats["text_wrong"] += 1
                if len(wrong_examples) < 20:
                    wrong_examples.append((a, raw_bytes.hex(), text, vendor))
        # advance by decoded length in sync with the corpus stream
        step = len(raw_bytes)
        pos += 1
        while pos < n and addrs[pos] < a + step:
            pos += 1
    print(json.dumps(stats, indent=1))
    if wrong_examples:
        print("text mismatches:")
        for a, b, got, want in wrong_examples[:15]:
            print(f"  @{a:x} {b}: got {got!r} want {want!r}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
