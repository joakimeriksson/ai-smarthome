#!/usr/bin/env python3
"""Solve operand field layouts for every class in isa/fm1.yaml against the
vendor-objdump corpora, corpus-wide verified.

Per class: collect every corpus line that decodes to it (same length and
normalized syntax, mask/match hit, sample-set tiebreak like check_isa),
parse the printed operands in order, and for each operand search for a
1-2 piece bit field + transform that reproduces the printed value on ALL
samples:

  imm      value = field                      (registers, unsigned fields)
  scaled   value = k * field                  k a power of two
  rel      value = k * sext(field)            (branch offsets print as byte
                                              deltas from pc_next, so the same)
  adj      value = field - adj
  zero32   value = field, but a zero field prints 32 (shift counts)
  bit      value = 1 << field;  nbit: value = ~(1 << field) (bit masks)
  composed the 12-bit float-like immediate at bits 16-27 (ncomposed: inverted)
  const    value is fixed for the class
  blk      register lists {rA-rB} (as solve_hot.py)

The field may have any number of pieces: each scalar is fitted as a linear
model over the varying bits (exact rational solve), so split fields such as
the 2-byte `goto` offset (bits 8-12, 4-7, 0, 1) come out directly.

Output: JSON in the semantics_raw.json shape consumed by tools/gen_isa.py.
Unsolved slots are reported with the first few conflicting samples so the
family-level fitting (docs/isa-notes.md) can take over.

Usage: solve_slots.py out.json corpus1.txt [corpus2.txt ...]
"""
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normlib import LINE, normalize  # noqa: E402
from solve_hot import printed_ops as _printed_ops, solve_blk  # noqa: E402


def printed_ops(text):
    """solve_hot's parser skips hex immediates; splice them back in order."""
    anno = re.search(r"\s*<[^<>]*>\s*$", text)
    if anno:
        text = text[: anno.start()]
    ops = []
    brace = 0
    for t in re.finditer(r"[{}]|r\d+|0x[0-9a-fA-F]+|-?\d+", text):
        tok = t.group(0)
        if tok == "{":
            brace += 1
            ops.append([])
        elif tok == "}":
            brace -= 1
        elif tok.startswith("r"):
            if brace and ops and isinstance(ops[-1], list):
                ops[-1].append(int(tok[1:]))
            else:
                ops.append(int(tok[1:]))
        elif tok.startswith("0x"):
            if not brace:
                ops.append(int(tok, 16))
        else:
            if not brace:
                ops.append(int(tok))
    return ops


def composed(code, m):
    if code == 0:
        return m
    if code == 1:
        return m * 0x10001
    if code == 2:
        return ((m << 8) * 0x10001) & 0xffffffff
    if code == 3:
        return m * 0x01010101
    e = (code << 1) | (m >> 7)
    return ((0x80 | (m & 0x7f)) << (32 - e)) & 0xffffffff


def sext(x, w):
    return x - (1 << w) if x & (1 << (w - 1)) else x


def concat(v, pieces):
    r, bits = 0, 0
    for lo, hi in pieces:
        w = hi - lo + 1
        r |= ((v >> lo) & ((1 << w) - 1)) << bits
        bits += w
    return r


def load_classes():
    classes = {}
    cur = None
    for raw in open("isa/fm1.yaml"):
        if raw.startswith("  - name:"):
            cur = {"name": raw.split(":", 1)[1].strip()}
            classes[cur["name"]] = cur
        elif cur is None:
            continue
        elif raw.startswith("    syntax:"):
            cur["syntax"] = json.loads(raw.partition(":")[2].strip())
        elif raw.startswith("    len:"):
            cur["len"] = int(raw.partition(":")[2].strip())
        elif raw.startswith("    mask:"):
            cur["mask"] = int(raw.partition(":")[2].strip().strip('"'), 16)
        elif raw.startswith("    match:"):
            cur["match"] = int(raw.partition(":")[2].strip().strip('"'), 16)
        elif raw.startswith("    samples:"):
            cur["samples"] = {
                int.from_bytes(bytes.fromhex(s), "little")
                for s in json.loads(raw.partition(":")[2].strip())
            }
    return classes


def var_bits(c):
    mask, width = c["mask"], c["len"] * 8
    return [b for b in range(width) if not (mask >> b) & 1]


def _weights_to_exps(sol, bits, vs, n):
    """Validate a candidate weight vector: integral, exact on all samples,
    every weight mult * 2^k with distinct k, at most one (top) negative."""
    w = {b: sol[i] for i, b in enumerate(bits)}
    c = sol[-1]
    if any(x.denominator != 1 for x in w.values()) or c.denominator != 1:
        return None
    w = {b: int(x) for b, x in w.items() if x != 0}
    c = int(c)
    if not w:
        return None
    if not all(sum(w.get(b, 0) * ((v >> b) & 1) for b in bits) + c == val for v, val in vs):
        return None
    mult = min(abs(x) for x in w.values())
    if mult & (mult - 1):
        return None
    exps = {}
    for b, x in w.items():
        q = abs(x) // mult
        if q * mult != abs(x) or q & (q - 1):
            return None
        k = q.bit_length() - 1
        if k in exps:
            return None
        exps[k] = (b, x < 0)
    return w, c, mult, exps


def solve_linear(vs, varbits, constbits, width):
    """Linear model: printed = sum(w_b * bit_b) + c over the bits that vary
    in the samples, solved exactly (Fractions) and verified on all samples.
    Weights must be mult * 2^k with distinct k; a negative top weight means
    the field is sign-extended. Exponent gaps and the sign position may be
    filled by mask-constant bits (the class split `call #i` / `call -#i`
    puts the sign bit into the mask), accounted for through c."""
    from fractions import Fraction
    bits = [b for b in varbits
            if any(((v >> b) & 1) != ((vs[0][0] >> b) & 1) for v, _ in vs)]
    if not bits:
        return None
    n = len(bits) + 1
    rows = []
    for v, val in vs:
        rows.append([Fraction((v >> b) & 1) for b in bits] + [Fraction(1), Fraction(val)])
    # Gaussian elimination (row echelon) over the sample rows
    m = rows
    piv_cols = []
    r = 0
    for col in range(n):
        pr = next((i for i in range(r, len(m)) if m[i][col] != 0), None)
        if pr is None:
            continue
        m[r], m[pr] = m[pr], m[r]
        inv = 1 / m[r][col]
        m[r] = [x * inv for x in m[r]]
        for i in range(len(m)):
            if i != r and m[i][col] != 0:
                f = m[i][col]
                m[i] = [x - f * y for x, y in zip(m[i], m[r])]
        piv_cols.append(col)
        r += 1
        if r == len(m):
            break
    # Free (collinear) columns: bits that always move together, e.g. two
    # offset bits never seen apart. Their weight is not determined by the
    # samples, so try power-of-two assignments until every weight is one.
    free = [col for col in range(n - 1) if col not in piv_cols]
    cands = [0] + [sgn << k for k in range(width) for sgn in (1, -1)]
    import itertools
    tries = itertools.product(cands, repeat=len(free)) if len(free) <= 2 else [(0,) * len(free)]
    for assignment in itertools.islice(tries, 20000):
        sol = [Fraction(0)] * n
        for f, t in zip(free, assignment):
            sol[f] = Fraction(t)
        for i, col in enumerate(piv_cols):
            sol[col] = m[i][-1] - sum(m[i][f] * sol[f] for f in free)
        res = _weights_to_exps(sol, bits, vs, n)
        if res:
            break
    else:
        return None
    w, c, mult, exps = res
    negs = [k for k, (b, neg) in exps.items() if neg]
    if len(negs) > 1 or (negs and negs[0] != max(exps)):
        return None
    signed = bool(negs)
    # fill exponent gaps (and the sign slot) with adjacent mask-constant bits
    fixed_one = {b for b in constbits if (vs[0][0] >> b) & 1}
    top = max(exps)
    k0 = min(exps)
    b0 = exps[k0][0]
    order = []
    rest = c
    for k in range(top + 1):
        if k in exps:
            order.append(exps[k][0])
        else:
            # exponent never varies in the corpus (e.g. the always-even bit 0
            # of a byte offset): take the adjacent mask-constant bit
            cand = order[-1] + 1 if order else b0 - (k0 - k)
            if cand < 0 or cand >= width or cand not in constbits:
                return None
            order.append(cand)
            if cand in fixed_one:
                rest -= mult << k
    # sign bit lives one above the top when the samples never flip it
    if not signed and rest != 0:
        cand = order[-1] + 1
        if cand in fixed_one and cand < width and rest == -(mult << (top + 1)):
            order.append(cand)
            rest = 0
            signed = True
    adj = 0
    if rest != 0:
        if signed:
            return None
        adj = -rest
        kind = f"adj{adj:+d}" if mult == 1 else "scaled"
    else:
        kind = "rel" if signed else ("imm" if mult == 1 else "scaled")
    # bits in concat order -> contiguous pieces
    pieces = []
    for b in order:
        if pieces and pieces[-1][1] + 1 == b:
            pieces[-1][1] = b
        else:
            pieces.append([b, b])
    spec = {"kind": kind, "pieces": pieces, "mult": mult if kind in ("rel", "scaled") else None}
    if kind == "scaled" and adj:
        spec["adj"] = adj  # value = mult * field - adj
    return spec


def solve_piece(vs, varbits, width):
    """Few-sample fallback: one contiguous field (<= 16 bits) inside the
    variable bits, plain / sign-extended / scaled. Underdetermined for the
    linear model but unambiguous when every sample agrees."""
    vals = [val for _, val in vs]
    for lo in varbits:
        for hi in range(lo, min(lo + 16, width)):
            if hi not in varbits:
                break
            pcs = [[lo, hi]]
            w = hi - lo + 1
            if all(concat(v, pcs) == val for v, val in vs):
                return {"kind": "imm", "pieces": pcs, "mult": None}
            for k in (1, 2, 4):
                if all(k * sext(concat(v, pcs), w) == val for v, val in vs) and min(vals) < 0:
                    return {"kind": "rel", "pieces": pcs, "mult": k}
                if k > 1 and all(k * concat(v, pcs) == val for v, val in vs):
                    return {"kind": "scaled", "pieces": pcs, "mult": k}
    return None


def solve_scalar(vs, varbits, constbits, width):
    """vs: list[(V, printed int)]. Returns a slot dict or None."""
    spec = solve_linear(vs, varbits, constbits, width)
    if spec:
        return spec
    spec = solve_piece(vs, varbits, width)
    if spec:
        return spec
    # shift-count quirk: a zero field prints as 32
    z = [(v, 0 if val == 32 else val) for v, val in vs]
    if any(val == 32 for _, val in vs):
        spec = solve_linear(z, varbits, constbits, width)
        if spec and spec["kind"] == "imm":
            spec["kind"] = "zero32"
            return spec
    # the 12-bit composed immediate always sits at bits 16-27 (docs/isa-notes.md)
    if width >= 32:
        for inv in (False, True):
            if all((composed((v >> 24) & 0xf, (v >> 16) & 0xff) ^ (0xffffffff if inv else 0)) == (val & 0xffffffff)
                   for v, val in vs):
                return {"kind": "ncomposed" if inv else "composed", "pieces": [[16, 27]], "mult": None}
    # single-bit masks: printed = 1 << field, or ~(1 << field) for AND masks
    for kind, conv in (("bit", lambda val: val), ("nbit", lambda val: (~val) & 0xffffffff)):
        bl = []
        for v, val in vs:
            m = conv(val)
            if m <= 0 or m & (m - 1):
                bl = None
                break
            bl.append((v, m.bit_length() - 1))
        if bl:
            spec = solve_linear(bl, varbits, constbits, width)
            if spec and spec["kind"] == "imm":
                spec["kind"] = kind
                return spec
    return None


def assign(classes):
    """(len, syntax) -> [classes] for corpus lookup."""
    by_form = defaultdict(list)
    for c in classes.values():
        by_form[(c["len"], c["syntax"])].append(c)
    return by_form


def pick(cands, V):
    hits = [c for c in cands if V & c["mask"] == c["match"]]
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    sampled = [c for c in hits if V in c.get("samples", ())]
    if sampled:
        return sampled[0]
    return max(hits, key=lambda c: bin(c["mask"]).count("1"))


def main(out_path, corpus_paths, min_pairs=4):
    classes = load_classes()
    by_form = assign(classes)
    groups = defaultdict(dict)
    for p in corpus_paths:
        for line in open(p, encoding="utf-8", errors="replace"):
            m = LINE.match(line)
            if not m:
                continue
            b = bytes.fromhex(m.group(2).replace(" ", ""))
            t = m.group(3).rstrip()
            am = re.search(r"\s*<[^<>]*>\s*$", t)
            if am:
                t = t[: am.start()].rstrip()
            cands = by_form.get((len(b), normalize(t)))
            if not cands:
                continue
            V = int.from_bytes(b, "little")
            c = pick(cands, V)
            if c is None:
                continue
            ops = printed_ops(t)
            groups[c["name"]][V] = ops  # dedupe on encoding

    out = {}
    solved = partial = unsolved = 0
    for name in sorted(groups, key=lambda n: -len(groups[n])):
        c = classes[name]
        pairs = sorted(groups[name].items())
        if not pairs:
            continue
        ops_max = max(len(o) for _, o in pairs)
        pairs = [(v, o) for v, o in pairs if len(o) == ops_max]
        width = c["len"] * 8
        varbits = var_bits(c)
        constbits = set(range(width)) - set(varbits)
        slots = []
        for idx in range(ops_max):
            if any(isinstance(o[idx], list) for _, o in pairs):
                spec = solve_blk(pairs, idx, c["len"], None) if False else None
                # reuse solve_hot's blk solver signature (pairs, idx, ln, spans)
                from solve_hot import class_spans
                spec = solve_blk(pairs, idx, c["len"], class_spans(c))
                slots.append(spec or {"kind": "unsolved", "slot": idx})
                continue
            vs = [(v, o[idx]) for v, o in pairs if isinstance(o[idx], int)]
            if vs and len({val for _, val in vs}) == 1:
                # a constant operand carries no field information
                slots.append({"kind": "const", "value": vs[0][1]})
                continue
            spec = solve_scalar(vs, varbits, constbits, width)
            if spec is None:
                spec = {"kind": "unsolved", "slot": idx,
                        "examples": [[f"{v:0{c['len']*2}x}", val] for v, val in vs[:4]]}
            slots.append(spec)
        ok = sum(1 for s in slots if s["kind"] != "unsolved")
        out[name] = {"slots": slots, "pairs": len(pairs), "ops_max": ops_max}
        tag = "SOLVED" if ok == ops_max else ("partial" if ok else "UNSOLVED")
        if tag == "SOLVED":
            solved += 1
        elif tag == "partial":
            partial += 1
        else:
            unsolved += 1
        print(f"{name:30} {tag:8} {ok}/{ops_max} slots, {len(pairs):5} encodings  {c['syntax']}")
    json.dump(out, open(out_path, "w"), indent=1)
    print(f"solved {solved} partial {partial} unsolved {unsolved} -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
