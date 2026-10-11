#!/usr/bin/env python3
"""Verify hand-authored operand layouts for hot pi32v2 classes against the
vendor objdump corpora, corpus-wide (not sample-capped).

A layout maps each class's operands to bit-ranges + formulas. Verified
layouts go to work/semantics.json — the single trusted table consumed by
gen_isa.py (Rust codegen) and disasm.py. Classes failing verification are
listed with mismatch counts so layouts can be fixed iteratively.

Layout DSL (JSON, per class):
    operands: [ {expr: <python-expr over V> } ]
each expr is evaluated per sample and compared with the printed value.

Usage: verify_semantics.py semantics_src.json out.json corpus1.txt [...]
"""
import json
import re
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normlib import LINE, normalize  # noqa: E402


def _bits(v, lo, hi):
    return (v >> lo) & ((1 << (hi - lo + 1)) - 1)


class Env:
    """ encouraged helpers for expr evaluation """

    def __init__(self, V, ln, addr):
        self._V = V
        self._ln = ln
        self._addr = addr
        self.b0 = V & 0xFF
        self.b1 = (V >> 8) & 0xFF
        self.b2 = (V >> 16) & 0xFF
        self.b3 = (V >> 24) & 0xFF

    def bits(self, lo, hi):
        return _bits(self._V, lo, hi)

    def concat(self, *rng):
        r, bits = 0, 0
        for lo, hi in rng:
            w = hi - lo + 1
            r |= _bits(self._V, lo, hi) << bits
            bits += w
        return r

    def sext(self, x, w):
        return x - (1 << w) if x & (1 << (w - 1)) else x

    def curaddr(self):
        return self._addr


def parse_and_group(corpora, wanted_forms):
    """addr -> (V, raw-bytes, text) grouped by (len, form)."""
    out = {}
    for p in corpora:
        for line in open(p, encoding="utf-8", errors="replace"):
            m = LINE.match(line)
            if not m:
                continue
            b = bytes.fromhex(m.group(2))
            t = m.group(3).rstrip()
            am = re.search(r"\s*<[^<>]*>\s*$", t)
            if am:
                t = t[: am.start()].rstrip()
            form = normalize(t)
            if wanted_forms is not None and (len(b), form) not in wanted_forms:
                continue
            out.setdefault((len(b), form), []).append(
                (int(m.group(1), 16), b, t))
    return out


def main(src_path, out_path, corpus_paths):
    layouts = json.load(open(src_path))
    # names map to classes via fm1.yaml (syntax per name)
    classes = {}
    cur = None
    for raw in open("isa/fm1.yaml"):
        if raw.startswith("  - name:"):
            cur = {"name": raw.split(":", 1)[1].strip()}
        elif cur is not None and raw.startswith("    syntax:"):
            cur["syntax"] = json.loads(raw.partition(":")[2].strip())
        elif cur is not None and raw.startswith("    len:"):
            cur["len"] = int(raw.partition(":")[2].strip())
        elif cur is not None and raw.startswith("    mask:"):
            cur["mask"] = int(raw.partition(":")[2].strip().strip('"'), 16)
        elif cur is not None and raw.startswith("    samples:"):
            cur["samples"] = [int.from_bytes(bytes.fromhex(s), "little")
                              for s in json.loads(raw.partition(":")[2]
                                                  .strip())]
        elif cur is not None and raw.startswith("    "):
            k, _, v = raw.strip().partition(":")
            cur.setdefault("body", {})[k.strip()] = v.strip()
        elif raw.startswith("  - ") is False and cur is not None and not raw.startswith("    "):
            classes[cur["name"]] = cur
            cur = None
    if cur:
        classes[cur["name"]] = cur

    wanted = set()
    for name in layouts:
        c = classes.get(name)
        if c:
            wanted.add((c["len"], c["syntax"]))
    groups = parse_and_group(corpus_paths, wanted)

    results = {}
    ok_classes = []
    for name, layout in layouts.items():
        c = classes.get(name)
        if c is None:
            results[name] = {"error": "class not found"}
            continue
        key = (c["len"], c["syntax"])
        samples = groups.get(key, [])
        exprs = [dict(x) for x in layout["operands"]]
        ok = 0
        bad = 0
        bad_examples = []
        for addr, b, t in samples:
            V = int.from_bytes(b, "little")
            printed = parse_raw_text(t)
            env = Env(V, len(b), addr)
            got = []
            try:
                for ex in exprs:
                    got.append(eval(ex["expr"], {}, dict(env.__dict__,
                                                         **{k: getattr(env, k) for k in ("bits", "concat", "sext", "curaddr")})))
            except Exception as e:
                bad += 1
                continue
            if got == printed:
                ok += 1
            else:
                bad += 1
                if len(bad_examples) < 4:
                    bad_examples.append(((hex(addr), len(b)), t, got, printed))
        rate = ok / max(1, ok + bad)
        results[name] = {"samples": ok + bad, "ok": ok, "bad": bad,
                         "rate": round(rate, 4),
                         "err": bad_examples if rate < 1 else None}
        if rate >= 0.999:
            ok_classes.append(name)
        else:
            print(f"{name:28} {ok:6}/{ok+bad:6} {rate:6.2%}")
            for ex in bad_examples:
                print("   ", ex)

    verified = {n: layouts[n] for n in ok_classes}
    json.dump({"verified": verified, "stats": results},
              open(out_path, "w"), indent=1)
    print(f"\nverified {len(ok_classes)}/{len(layouts)} layouts -> {out_path}")


def parse_raw_text(text):
    """printed operands (regs/int) in order, tokens rN / +-int."""
    anno = re.search(r"\s*<[^<>]*>\s*$", text)
    if anno:
        text = text[: anno.start()]
    ops = []
    for tok in re.finditer(r"r(\d+)|-?\d+|0x[0-9a-fA-F]+", text):
        s = tok.group(0)
        if s.startswith("r"):
            ops.append(int(s[1:]))
        elif s.startswith("0x"):
            ops.append(int(s, 16))
        else:
            ops.append(int(s))
    return ops


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
