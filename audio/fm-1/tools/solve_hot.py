#!/usr/bin/env python3
"""Solve operand layouts for hot pi32v2 classes: joint piece-concat search
per slot, corpus-wide verified. Writes work/semantics_raw.json (best fits)
so verify_semantics.py can adopt them as exprs.

Strategy per class:
  1. dedup (V -> printed operand values) pairs corpus-wide
  2. candidate fields per slot: all contiguous sub-ranges (1..2 pieces)
     over the instruction's 16/32/48-bit window
  3. joint search with 2-sample probe, full-set verification, disjointness
  4. emit the winning pieces (and record coverage)

Usage: solve_hot.py out.json corpus1.txt [...]
"""
import itertools
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normlib import LINE, normalize  # noqa: E402


def sext(x, w):
    return x - (1 << w) if x & (1 << (w - 1)) else x

HEXTOK = re.compile(r"0x[0-9a-fA-F]+")
NUMTOK = re.compile(r"\d+|0x[0-9a-fA-F]+")


def printed_ops(text):
    """operand values in printed order (ints; braced lists too)."""
    anno = re.search(r"\s*<[^<>]*>\s*$", text)
    if anno:
        text = text[: anno.start()]
    ops = []
    i = 0
    brace = False
    for t in re.finditer(r"[{}]|r\d+|0x[0-9a-fA-F]+|-?\d+|\w+|\S",
                         text):
        s = t.group(0)
        if s == "{":
            brace = True
            ops.append([])
            continue
        if s == "}":
            brace = False
            continue
        if s.startswith("r") and re.fullmatch(r"r\d+", s):
            v = int(s[1:])
            if brace and ops and isinstance(ops[-1], list):
                ops[-1].append(v)
            else:
                ops.append(v)
        elif re.fullmatch(r"-?\d+", s):
            if not brace:
                ops.append(int(s))
    return ops


def candidates(width):
    rng = [(a, b) for a in range(width) for b in range(a, width)]
    one = [(x,) for x in rng]
    two = []
    for p, q in itertools.product(rng, rng):
        if q[0] > p[1] or p[0] > q[1]:
            two.append((p, q))
    return one, two


def concat(v, pieces):
    r, bits = 0, 0
    for lo, hi in pieces:
        w = hi - lo + 1
        r |= ((v >> lo) & ((1 << w) - 1)) << bits
        bits += w
    return r



def class_spans(c):
    """Variable-bit spans of the class (from its mask)."""
    mask = c.get("mask", 0)
    width = c["len"] * 8
    spans, lsb = [], None
    for b in range(width + 1):
        var = b < width and not (mask >> b) & 1
        if var and lsb is None:
            lsb = b
        elif not var and lsb is not None:
            spans.append((lsb, b - 1))
            lsb = None
    return spans or [(0, width - 1)]


def ranges_within(spans):
    out = set()
    for lsb, msb in spans:
        for a in range(lsb, msb + 1):
            for b in range(a, msb + 1):
                out.add((a, b))
    return sorted(out)


def solve_slot(pairs, idx, width, spans, max_pieces=2):
    """pairs: list[(V, printed-operand-list)]. Solve slot idx to a 1-2 piece
    concat equal to the printed value on all pairs."""
    if not pairs:
        return None, 0
    vs = []
    for p in pairs:
        if idx < len(p[1]) and isinstance(p[1], list) and \
                isinstance(p[1][idx], int):
            vs.append((p[0], p[1][idx]))
    one, two = candidates(width)
    for pieces in one:
        if concat(vs[0][0], pieces) == vs[0][1] and \
                concat(vs[min(1, len(vs) - 1)][0], pieces) == vs[min(1, len(vs) - 1)][1]:
            if all(concat(v, pieces) == val for v, val in vs):
                return pieces, 0
    for pieces in two:
        if concat(vs[0][0], pieces) != vs[0][1]:
            continue
        if len(vs) > 1 and concat(vs[1][0], pieces) != vs[1][1]:
            continue
        if all(concat(v, pieces) == val for v, val in vs):
            return pieces, 1
    return None, -1


def rel_solve(rpairsl, idx, ln, spans):
    """vendor prints pc_next-relative byte offsets: printed == k * sext(field)
    with k in windows sizes; field = 1-2 piece concat."""
    vs = [(v, ops[idx]) for v, a, ops in rpairsl
          if isinstance(ops[idx], int)]
    if len(vs) < 3:
        return None, 0
    rng = ranges_within(spans)
    for k in (1, 2, 4, -1, -2, -4):
        for pcs in [(p,) for p in rng]:
            w = pcs[0][1] - pcs[0][0] + 1
            if all(sext(concat(v, pcs), w) * k == val for v, val in vs):
                return pcs, k
        # 2-piece (concat order asc only)
        for p, q in itertools.product(rng, rng):
            if not (q[0] > p[1] or p[0] > q[1]):
                continue
            w = (p[1] - p[0] + 1) + (q[1] - q[0] + 1)
            if all(sext(concat(v, [p, q]), w) * k == val for v, val in vs):
                return [p, q], k
    return None, 0


def adjusted_slot(pairs, idx, width, spans):
    """slot solves under printed + adj (N-1 encoded, biased fields)."""
    for adj in (1, -1, 16, -16, 32, -32, 20, -20):
        if any(not isinstance(p[1][idx], int) for p in pairs):
            return None, 0
        vs = [(p[0], p[1][idx] + adj) for p in pairs]
        rng = ranges_within(spans)
        for pcs in [(p,) for p in rng]:
            if all(concat(v, pcs) == val for v, val in vs[:48]) \
                    and all(concat(v, pcs) == val for v, val in vs):
                return pcs, adj
        for p, q in itertools.product(rng, rng):
            if not (q[0] > p[1] or p[0] > q[1]):
                continue
            if all(concat(v, [p, q]) == val for v, val in vs[:48]) and \
                    all(concat(v, [p, q]) == val for v, val in vs):
                return [p, q], adj
    return None, 0


def hot_name(n):
    return bool(re.match(
        r"^(r_mov_(i|r)(_|$)|goto_i|call_i|if_r_(eq|ne)_i_goto_i|r_i_mov_r"
        r"|b_r_i_mov_r|h_r_i_mov_r|r_mov_(b|h)_r_i_u|r_add|r_mov_sp_i"
        r"|sp_i_mov_r|r_mov_r_(lsl|lsr|rlsl)|r_rlsl_i_mov_r|sp_mov_rets"
        r"|pc_r_[0-9_]*mov_sp|r_mov_cnum|sti_r|rep_)", n))


HOT = ["r_mov_i_l2", "r_mov_r", "r_mov_i", "r_mov_i_l4", "goto_i",
       "call_i_l4", "call_i_l6", "call_i", "r_mov_r_i", "r_mov_r_i_3",
       "r_mov_r_i_4", "r_i_mov_r", "r_i_mov_r_l4", "r_mov_b_r_i_u",
       "r_mov_b_r_i_u_l4", "r_mov_h_r_i_u", "b_r_i_mov_r", "b_r_i_mov_r_l4",
       "h_r_i_mov_r", "r_add_r", "r_add_i", "r_add_i_l2", "r_mov_sp_i",
       "r_mov_sp_i_l2", "sp_i_mov_r", "r_mov_r_lsl_i", "r_mov_r_lsr_i",
       "r_mov_r_rlsl_i", "r_rlsl_i_mov_r", "if_r_eq_i_goto_i",
       "if_r_ne_i_goto_i", "if_r_eq_i_goto_i_l2", "if_r_ne_i_goto_i_l2",
       "if_r_eq_i_goto_i_l4", "if_r_ne_i_goto_i_l4", "sp_mov_rets_r_2",
       "pc_r_2_mov_sp", "r_mov_r_l2", "r_mov_cnum", "sti_r", "rep_i_i"]




FAMILY_EXCLUDE = {
    # r_mov_i_l2: 0xCN-0x14 family ("rN = 0"-like, prints 0)
    "r_mov_i_l2": lambda V: (V & 0xc0) == 0xc0 and (V >> 8 & 0xff) == 0x14,
}


def solve_blk(pairs, idx, ln, spans):
    """blk slot: printed = [top..bottom] regs; regs == [max(n,hi)..min(n,lo)]"""
    kind = "blk"
    vs = []
    for v, p in pairs:
        if not isinstance(p, list) or idx >= len(p):
            continue
        val = p[idx]
        if not isinstance(val, list):
            continue
        vs.append((v, val))
    if len(vs) < 2:
        return None
    rng = ranges_within(spans)
    for pcs in [(p,) for p in rng]:
        for hi in range(16):
            for lo in range(16):
                if list(range(max(concat(vs[0][0], pcs), hi),
                              min(concat(vs[0][0], pcs), lo) - 1, -1)) \
                        != vs[0][1]:
                    continue
                if all(list(range(max(concat(v, pcs), hi),
                                  min(concat(v, pcs), lo) - 1, -1)) == val
                       for v, val in vs):
                    return {"kind": "blk", "pieces": [list(p) for p in pcs],
                            "hi": hi, "lo": lo}
    return None


def main(out_path, corpus_paths):
    classes = {}
    cur = None
    for raw in open("isa/fm1.yaml"):
        if raw.startswith("  - name:"):
            cur = {"name": raw.split(":", 1)[1].strip()}
        elif cur is not None and raw.startswith("    syntax:"):
            cur["syntax"] = json.loads(raw.partition(":")[2].strip())
        elif cur is not None and raw.startswith("    len:"):
            cur["len"] = int(raw.partition(":")[2].strip())
    if cur:
        classes[cur["name"]] = cur
    cur = None
    for raw in open("isa/fm1.yaml"):
        if raw.startswith("  - name:"):
            if cur:
                classes.setdefault(cur["name"], cur)
            cur = {"name": raw.split(":", 1)[1].strip()}
        elif cur is not None and raw.startswith("    syntax:"):
            cur["syntax"] = json.loads(raw.partition(":")[2].strip())
        elif cur is not None and raw.startswith("    len:"):
            cur["len"] = int(raw.partition(":")[2].strip())
        elif cur is not None and raw.startswith("    mask:"):
            cur["mask"] = int(raw.strip().partition(":")[2].strip().strip('"'), 16)
        elif cur is not None and raw.startswith("    "):
            cur.setdefault("body", {})[
                raw.strip().partition(":")[0].strip()] = raw.strip().partition(":")[2].strip()
    if cur:
        classes[cur["name"]] = cur

    groups = defaultdict(dict)
    name_by_form = {}
    HOT_SET = set()
    for n, c in classes.items():
        if hot_name(n):
            HOT_SET.add(n)
            name_by_form[(c["len"], c["syntax"])] = n
    for p in corpus_paths:
        for line in open(p, encoding="utf-8", errors="replace"):
            m = LINE.match(line)
            if not m:
                continue
            b = bytes.fromhex(m.group(2))
            t = m.group(3).rstrip()
            am = re.search(r"\s*<[^<>]*>\s*$", t)
            if am:
                t = t[: am.start()].rstrip()
            addr = int(m.group(1), 16)
            key = (len(b), normalize(t))
            if key not in name_by_form:
                continue
            name = name_by_form[key]
            V = int.from_bytes(b, "little")
            g = groups[name]
            ops = printed_ops(t)
            g[addr] = (V, ops)

    out = {}
    for name in HOT_SET:
        c = classes[name]
        width = c["len"] * 8
        pairs = [(V, ops) for (addr, (V, ops)) in sorted(groups[name].items())
                 if ops]
        pairs = [(v, ops if isinstance(ops, list) else [ops])
                 for v, ops in pairs]
        pairsl = [(v, list(ops) if isinstance(ops, list) else [ops])
                  for v, ops in pairs]
        ops_max = max((len(o) for _, o in pairsl), default=0)
        pairsl = [(v, o) for v, o in pairsl if len(o) == ops_max]
        rpairsl = [(v, addr, ops)
                   for addr, (v, ops) in sorted(groups[name].items())
                   if ops and len(ops) == ops_max]
        exclude = FAMILY_EXCLUDE.get(name)
        if exclude:
            pairsl = [(v, o) for v, o in pairsl if not exclude(v)]
            rpairsl = [(v, a, o) for v, a, o in rpairsl if not exclude(v)]
        solved = []
        for idx in range(ops_max):
            if any(isinstance(p[1][idx], list) for p in pairsl):
                spec = solve_blk(pairsl, idx, c["len"], class_spans(c))
                solved.append(spec if spec else {"kind": "unsolved",
                                                 "slot": idx})
                continue
            pieces, k = solve_slot(pairsl, idx, width, class_spans(c))
            kind = "imm"
            if pieces is None:
                pieces, k = rel_solve(rpairsl, idx, c["len"], class_spans(c))
                if pieces:
                    kind = "rel"
            if pieces is None:
                pieces, adj = adjusted_slot(pairsl, idx, width, class_spans(c))
                if pieces:
                    kind = f"adj{adj:+d}"
            if pieces is None:
                # registers often 3/4-bit ranges incl bit7 — special try
                solved.append({"kind": "unsolved", "slot": idx})
                continue
            solved.append({"kind": kind, "pieces": [list(p) for p in pieces],
                           "mult": k if kind == "rel" else None})
        ok = sum(1 for s in solved if s["kind"] != "unsolved")
        out[name] = {"slots": solved, "pairs": len(pairsl),
                     "ops_max": ops_max}
        if ok == ops_max and ops_max:
            print(f"{name:28} SOLVED ({ops_max} slots, {len(pairsl)} pairs)")
        elif ops_max == 0:
            print(f"{name:28} no operands")
        else:
            print(f"{name:28} partial {ok}/{ops_max} ({len(pairsl)} pairs)")
    json.dump(out, open(out_path, "w"), indent=1)
    print(f"-> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
