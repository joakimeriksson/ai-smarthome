#!/usr/bin/env python3
"""Derive per-class operand encodings for pi32v2 from vendor objdump corpora.

For every ISA class — grouped by (len, normalized form) like build_isa.py —
each corpus sample gives printed operand values plus raw bytes. Per operand
slot we search which concatenation of contiguous bit-ranges (within the
class's variable-bit spans) reproduces the value across ALL samples.

Layered search: a match must hold as `low_piece | (mid_piece << w0) | ...`
with each piece a contiguous sub-range of a span (operands sit at arbitrary
positions, e.g. reg = bits(0,2) | bit7<<3). Immediate formulas (identity,
pc-relative ×k, bitwise-NOT) transform targets before the layered search.

Output: derived.yaml — the class list with, for solved classes:

    template: "<syntax with {oN} slots>"
    operands: [{kind, spans, order, ...}, ...]   # slot order

kinds: reg {spans} · imm {spans, signed, formula, rel} ·
himm {spans, formula} · blk {spans, hi, lo}  (regs = max(n,hi)..min(n,lo)).

Usage: derive.py isa/fm1.yaml derived.yaml stats.json corpus1.txt [...]
"""
import json
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normlib import LINE, normalize  # noqa: E402

HEXTOK = re.compile(r"0x[0-9a-fA-F]+")
NUMTOK = re.compile(r"\d+")
REGX = re.compile(r"r(?:1[0-5]|[0-9])(?![0-9_])")
IDTOK = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*")
BRACE = re.compile(r"\{([^{}]*)\}")
RUN = re.compile(r"R\*(\d+)")
PLH = re.compile(r"(-?)#h|(-?)#i|\bR\b")

# ------------------------------------------------------------ raw parsing


def parse_raw(text: str) -> list[tuple[str, object]]:
    """Printed operands in template-slot order (see normlib.normalize)."""
    anno = re.search(r"\s*<[^<>]*>\s*$", text)
    if anno:
        text = text[: anno.start()]
    ops: list[tuple[str, object]] = []
    i, n = 0, len(text)
    brace_regs: list[int] | None = None
    pending_neg = False
    while i < n:
        c = text[i]
        if c.isspace():
            i += 1
            continue
        if c == "{":
            brace_regs = []
            i += 1
            continue
        if c == "}":
            if brace_regs:
                ops.append(("blk", brace_regs))
            brace_regs = None
            i += 1
            continue
        m = HEXTOK.match(text, i)
        if m and brace_regs is None:
            ops.append(("himm", int(m.group(0), 16)))
            i = m.end()
            continue
        m = NUMTOK.match(text, i)
        if m and brace_regs is None:
            v = int(m.group(0))
            ops.append(("imm", -v if pending_neg else v))
            pending_neg = False
            i = m.end()
            continue
        m = IDTOK.match(text, i)
        if m:
            w = m.group(0)
            mreg = REGX.match(w)
            if mreg and not re.match(r"[0-9A-Za-z_]", w[mreg.end():]):
                rv = int(mreg.group(0)[1:])
                if brace_regs is not None:
                    rest = text[m.end():].lstrip()
                    mr = re.match(r"-\s*r(\d+)", rest)
                    if mr:
                        lo = int(mr.group(1))
                        brace_regs.extend(range(rv, lo - 1, -1))
                        i = m.end() + mr.end()
                        continue
                    brace_regs.append(rv)
                else:
                    ops.append(("reg", rv))
            else:
                pending_neg = False
            i = m.end()
            continue
        if c == "-":
            pending_neg = not pending_neg
        elif c != ",":
            pending_neg = False
        i += 1
    return ops

# --------------------------------------------------------- template build


def build_template(form: str) -> tuple[str, list[str]]:
    slots: list[str] = []

    def assign(kind: str) -> str:
        slots.append(kind)
        return "{o}"

    def body_sub(m: "re.Match[str]") -> str:
        body = m.group(1)
        if RUN.search(body):
            return RUN.sub(lambda _m: assign("blk"), body)
        merged, run = [], 0
        for p in (q.strip() for q in body.split(",")):
            if p == "R":
                run += 1
            elif p == "R-R":
                run += 2
            else:
                if run:
                    merged.append(assign("blk"))
                    run = 0
                merged.append(p)
        if run:
            merged.append(assign("blk"))
        return "{" + ", ".join(merged) + "}"

    t = BRACE.sub(body_sub, form)
    t = RUN.sub(lambda _m: assign("blk"), t)
    t = PLH.sub(lambda m: assign("himm" if "#h" in m.group(0) else
                                 "imm" if "#" in m.group(0) else "reg"), t)
    return t, slots

# ------------------------------------------------------------- span math


def spans_from_mask(mask: int, width: int) -> list[tuple[int, int]]:
    spans, lsb = [], None
    for b in range(width + 1):
        var = b < width and not (mask >> b) & 1
        if var and lsb is None:
            lsb = b
        elif not var and lsb is not None:
            spans.append((lsb, b - 1))
            lsb = None
    return spans


def concat_val(v: int, ranges) -> int:
    r, bits = 0, 0
    for lsb, msb in ranges:
        w = msb - lsb + 1
        r |= ((v >> lsb) & ((1 << w) - 1)) << bits
        bits += w
    return r


def sext(v: int, bits: int) -> int:
    return v - (1 << bits) if v & (1 << (bits - 1)) else v


def _vkey(p):
    return p[0]


def dedup(pairs):
    """Reduce samples to one row per V. Returns None on conflicting values."""
    seen = {}
    for p in pairs:
        v, val = p[0], p[1]
        if v in seen and seen[v][1] != val:
            return None
        seen[v] = p
    return list(seen.values())

# ---------------------------------------------------------------- formulas


def _f_signed(c, s, bits, v, ln, neg):
    return s if neg else c


IMM_FORMULAS = [
    (_f_signed, None),
    (lambda c, s, bits, v, ln, neg: v + ln + s, [1, "pc_next"]),
    (lambda c, s, bits, v, ln, neg: v + ln + 2 * s, [2, "pc_next"]),
    (lambda c, s, bits, v, ln, neg: v + ln - s, [-1, "pc_next"]),
    (lambda c, s, bits, v, ln, neg: v + ln - 2 * s, [-2, "pc_next"]),
    (lambda c, s, bits, v, ln, neg: (~s) & 0xFFFFFFFF, None),
    (lambda c, s, bits, v, ln, neg: (~s) & 0xFFFF, None),
]

HIMM_FORMULAS = [
    lambda c, v, ln: c,
    lambda c, v, ln: (~c) & 0xFFFFFFFF,
    lambda c, v, ln: (~c) & 0xFFFF,
    lambda c, v, ln: c << 4,
    lambda c, v, ln: c << 8,
]

# ---------------------------------------------------------- layered fit


def _layered(pairs, spans, max_pieces=3):
    """pairs = [(V, value, *rest)] — find concats of DISJOINT contiguous
    ranges (low piece first) reproducing (unsigned, non-negative) values."""
    if max_pieces <= 0:
        return None
    dd = dedup(pairs)
    if dd is None:
        return None
    cands = bit_ranges(spans)
    for sub in cands:
        c0 = concat_val(dd[0][0], [sub])
        if all(concat_val(v, [sub]) == val for v, val, *_ in dd):
            return [sub]
    for sub in cands:
        if len(dd) < 2:
            continue
        w0 = sub[1] - sub[0] + 1
        mask = (1 << w0) - 1
        rest = []
        ok = True
        for p in dd:
            v, val = p[0], p[1]
            if val < 0:
                ok = False
                break
            c = (v >> sub[0]) & mask
            if val & mask != c:
                ok = False
                break
            rest.append((v, val >> w0, *p[2:]))
        if not ok:
            continue
        subs = _layered(rest, spans, max_pieces - 1)
        if subs and disjoint([sub] + subs):
            return [sub] + subs
    return None


def disjoint(ranges):
    marks = []
    for lsb, msb in ranges:
        marks.append((lsb, 1))
        marks.append((msb + 1, -1))
    depth = 0
    for _, d in sorted(marks):
        depth += d
        if depth > 1:
            return False
    return True


def bit_ranges(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Every contiguous sub-range of every span, widest first."""
    out = set()
    for lsb, msb in spans:
        for a in range(lsb, msb + 1):
            for b in range(a, msb + 1):
                out.add((a, b))
    return sorted(out, key=lambda r: -(r[1] - r[0] + 1))


def ordered_ranges(spans):
    """Candidates: whole spans first, then every other sub-range."""
    full = [(lsb, msb) for lsb, msb in spans]
    subs = [r for r in bit_ranges(spans) if r not in full]
    return full + subs

# ---------------------------------------------------------------- fitters


def fit_reg(pairs, spans):
    ranges = _layered(pairs, spans, 3)
    if ranges:
        return {"kind": "reg", "spans": [list(s) for s in ranges],
                "order": "asc"}
    return None


def fit_imm(pairs, spans):
    neg = any(val < 0 for _, val, _ in pairs)
    dd = dedup(pairs)
    if dd is None:
        return None
    # candidate piece-sets from non-negative targets of any formula
    piece_sets = {}
    for fi, (f, rel) in enumerate(IMM_FORMULAS):
        variants, plausible = [], True
        for v, val, ln in dd:
            if val < 0 or fi in (5, 6):
                variants, plausible = [], False
                break
            t = val
            if rel:
                delta = val - v - ln
                if delta % rel[0]:
                    plausible = False
                    break
                t = delta // rel[0]
                if t < 0:
                    variants, plausible = [], False
                    break
            variants.append((v, t, ln))
        if not plausible:
            continue
        ranges = _layered(variants, spans, 3)
        if ranges:
            piece_sets[tuple(ranges)] = True
    # validate each candidate piece-set against ALL pairs per formula
    for ranges in piece_sets:
        for fi, (f, rel) in enumerate(IMM_FORMULAS):
            if all(_imm_check(f, ranges, v, val, ln, neg) == val
                   for v, val, ln in dd):
                return {"kind": "imm", "spans": [list(s) for s in ranges],
                        "order": "asc", "signed": neg, "formula": fi,
                        "rel": rel}
    return None


def _imm_check(f, ranges, v, val, ln, neg):
    c = concat_val(v, ranges)
    bits = sum(msb - lsb + 1 for lsb, msb in ranges)
    s = sext(c, bits)
    return f(c, s, bits, v, ln, neg) + 0


def fit_himm(pairs, spans):
    dd = dedup(pairs)
    if dd is None:
        return None
    for fi, f in enumerate(HIMM_FORMULAS):
        variants = []
        if fi in (1, 2):
            # NOT: width unknown; try layered against the un-masked value
            variants = [(v, (~val) & 0xFFFFFFFF, 0) for v, val in
                        ((p[0], p[1]) for p in dd)]
        elif fi in (3, 4):
            shift = 4 * (fi - 2)
            if any(val % (1 << shift) for _, val in
                   ((p[0], p[1]) for p in dd)):
                continue
            variants = [(v, val >> shift, 0)
                        for v, val in ((p[0], p[1]) for p in dd)]
        else:
            variants = [(v, val, 0) for v, val in
                        ((p[0], p[1]) for p in dd)]
        ranges = _layered(variants, spans, 3)
        if ranges:
            return {"kind": "himm", "spans": [list(s) for s in ranges],
                    "order": "asc", "formula": fi}
    return None


def fit_blk(pairs, spans):
    dd = dedup(pairs)
    if dd is None or not dd:
        return None
    for sub in ordered_ranges(spans):
        for hi in range(16):
            for lo in range(16):
                n0 = concat_val(dd[0][0], [sub])
                if list(range(max(n0, hi), min(n0, lo) - 1, -1)) != dd[0][1]:
                    continue
                ok = True
                for v, regs in dd:
                    n = concat_val(v, [sub])
                    if list(range(max(n, hi), min(n, lo) - 1, -1)) != regs:
                        ok = False
                        break
                if ok:
                    return {"kind": "blk", "spans": [list(sub)],
                            "order": "asc", "hi": hi, "lo": lo}
    return None


FITTERS = {"reg": fit_reg, "imm": fit_imm, "himm": fit_himm, "blk": fit_blk}

# ------------------------------------------------------------------- yaml


def load_classes(yaml_path: str) -> list[dict]:
    classes = []
    cur = None
    for raw in open(yaml_path):
        if raw.startswith("  - name:"):
            if cur:
                classes.append(cur)
            cur = {"name": raw.split(":", 1)[1].strip(), "lines": []}
        elif cur is not None and raw.startswith("    "):
            cur["lines"].append(raw.rstrip("\n"))
    if cur:
        classes.append(cur)
    return classes


def class_attr(c: dict) -> dict:
    body = {}
    for ln in c["lines"]:
        k, _, v = ln.strip().partition(":")
        body[k.strip()] = v.strip()
    return {
        "syntax": json.loads(body["syntax"]),
        "len": int(body["len"]),
        "mask": int(body["mask"].strip('"'), 16),
    }


def class_fields(c: dict) -> list[tuple[int, int]]:
    spans = []
    in_fields = False
    for ln in c["lines"]:
        s = ln.strip()
        if s == "fields:":
            in_fields = True
            continue
        if in_fields:
            m = re.fullmatch(r"f\d+: \[(\d+), (\d+)\]", s)
            if m:
                spans.append((int(m.group(1)), int(m.group(2))))
                continue
            in_fields = False
    if spans:
        return spans
    a = class_attr(c)
    return spans_from_mask(a["mask"], a["len"] * 8)


# ------------------------------------------------------------------ main


def main(yaml_path: str, out_yaml: str, stats_path: str,
         corpus_paths: list[str], max_samples: int = 32) -> None:
    recs = {}
    for p in corpus_paths:
        for line in open(p, encoding="utf-8", errors="replace"):
            m = LINE.match(line)
            if m:
                recs[int(m.group(1), 16)] = (bytes.fromhex(m.group(2)),
                                             m.group(3).rstrip())
    per_class: dict[tuple[int, str], list] = {}
    for addr, (b, t) in recs.items():
        per_class.setdefault((len(b), normalize(t)), []).append((addr, b, t))

    classes = load_classes(yaml_path)
    stats = {"classes": 0, "solved": 0, "partial": 0, "unsolved": 0,
             "no_slots": 0, "conflict_or_gaps": 0}
    kind_total, kind_ok = {}, {}

    with open(out_yaml, "w") as out:
        out.write("# pi32v2 ISA — derived operand table (tools/derive.py).\n")
        out.write("# Solved classes carry template + operands; others keep\n")
        out.write("# plain syntax (mask decoding still applies).\n")
        out.write("isa: pi32v2\nendianness: little\ninstructions:\n")
        for c in classes:
            a = class_attr(c)
            stats["classes"] += 1
            template, slot_kinds = build_template(a["syntax"])
            spans = class_fields(c)
            samples = per_class.get((a["len"], a["syntax"]), [])
            pairs = [[] for _ in slot_kinds]
            for addr, b, t in samples:
                if all(len(p) >= max_samples for p in pairs):
                    break
                raw_ops = parse_raw(t)
                V = int.from_bytes(b, "little")
                if len(raw_ops) != len(slot_kinds) or \
                        any(k != sk for (k, _), sk in
                            zip(raw_ops, slot_kinds)):
                    stats["conflict_or_gaps"] += 1
                    continue
                for idx, (kind, val) in enumerate(raw_ops):
                    if len(pairs[idx]) >= max_samples:
                        continue
                    if kind == "imm":
                        pairs[idx].append((V, val, a["len"]))
                        kind_total["imm"] = kind_total.get("imm", 0) + 1
                    else:
                        pairs[idx].append((V, val))
                        kind_total[kind] = kind_total.get(kind, 0) + 1
            solved_ops = []
            for idx, kind in enumerate(slot_kinds):
                op = FITTERS[kind](pairs[idx], spans) if pairs[idx] else None
                solved_ops.append(op)
                if op:
                    kind_ok[kind] = kind_ok.get(kind, 0) + 1
            if not slot_kinds:
                stats["no_slots"] += 1
            elif all(solved_ops):
                stats["solved"] += 1
            elif any(solved_ops):
                stats["partial"] += 1
            else:
                stats["unsolved"] += 1
            all_solved = bool(slot_kinds) and all(solved_ops)
            out.write(f"  - name: {c['name']}\n")
            for ln in c["lines"]:
                if ln.strip().startswith("syntax:") and all_solved:
                    out.write(ln + "\n")
                    out.write(f'    template: "{template}"\n')
                    out.write("    operands:\n")
                    for o in solved_ops:
                        out.write(f"      - {json.dumps(o)}\n")
                else:
                    out.write(ln + "\n")

    json.dump({"class_stats": stats, "slot_total": kind_total,
               "slot_solved": kind_ok}, open(stats_path, "w"), indent=1)
    print(json.dumps(stats, indent=1))
    print("slot solve:",
          {k: f"{kind_ok.get(k, 0)}/{n}" for k, n in kind_total.items()})


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
