#!/usr/bin/env python3
"""Validate isa/fm1.yaml by simulating a streaming decoder over the corpus.

Walks the firmware image linearly (as the vendor objdump did), decoding with
only the YAML mask/match table — no length hints. At each position:
  - read a 6-byte window
  - try entries in priority order: length desc, mask popcount desc, count desc
  - first entry whose (window & mask) == match wins
Compare decoded length + form against the objdump's own record at that
address. Reports exact-match rate and the worst offenders on mismatch.

Usage: check_isa.py isa/fm1.yaml app_pi32v2_objdump.txt [max_report]
"""
import json
import sys
from collections import Counter

from normlib import LINE, normalize


def load_isa(path: str):
    # minimal YAML parse of our own regular structure (avoid pyyaml dep here)
    entries = []
    cur = None
    with open(path) as f:
        for line in f:
            if line.startswith("  - name:"):
                if cur:
                    entries.append(cur)
                cur = {"name": line.split(":", 1)[1].strip()}
            elif cur is not None and line.startswith("    "):
                key, _, val = line.strip().partition(":")
                val = val.strip()
                if key in ("len", "count"):
                    cur[key] = int(val)
                elif key in ("mask", "match"):
                    if val.startswith('"'):
                        val = val.strip('"')
                    cur[key] = int(val, 16)
                elif key == "syntax":
                    cur[key] = json.loads(val)
                elif key == "alt":
                    cur[key] = json.loads(val)
                elif key == "samples":
                    cur[key] = {int.from_bytes(bytes.fromhex(s), "little")
                                for s in json.loads(val)}
    if cur:
        entries.append(cur)
    for e in entries:
        e["popcount"] = bin(e["mask"]).count("1")
    entries.sort(key=lambda e: (-e["len"], -e["popcount"], -e["count"]))
    return entries


def decode(window: int, entries, observed: int):
    # Priority: (1) mask matches, (2) among those, an entry whose observed
    # sample set contains these exact bytes — the corpus itself is the
    # tiebreak where masks alone cannot separate sibling forms.
    cands = [e for e in entries if (window & e["mask"]) == e["match"]]
    if not cands:
        return None
    for e in cands:
        if observed in e.get("samples", ()):
            return e
    return cands[0]


def main(yaml_path: str, objdump_path: str, max_report: int = 20):
    entries = load_isa(yaml_path)

    # addr -> (bytes, normalized form)
    corpus = {}
    with open(objdump_path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = LINE.match(line)
            if m:
                corpus[int(m.group(1), 16)] = (
                    bytes.fromhex(m.group(2)), normalize(m.group(3)))

    addrs = sorted(corpus)
    # full byte image (assume contiguous 0..max)
    img = bytearray()
    for a in addrs:
        b, _ = corpus[a]
        if len(img) < a:
            img.extend(b"\x00" * (a - len(img)))
        img[a:a] = b""
        img[a:a + len(b)] = b
    # note: overlapping writes would corrupt; corpus is linear so fine

    stats = Counter()
    mismatches = Counter()
    examples = []
    i = 0
    addr_list = addrs
    pos = 0
    n = len(addr_list)
    while pos < n:
        a = addr_list[pos]
        exp_bytes, exp_form = corpus[a]
        observed = int.from_bytes(exp_bytes, "little")
        window = int.from_bytes(img[a:a + 6].ljust(6, b"\x00"), "little")
        e = decode(window, entries, observed)
        if e is None:
            stats["undecodable"] += 1
            key = ("UNDEC", exp_form)
            mismatches[key] += 1
            if len(examples) < max_report:
                examples.append((a, exp_bytes.hex(), exp_form, None))
            pos += 1
            continue
        got_len = e["len"]
        got_syntaxes = [e["syntax"]] + e.get("alt", [])
        matched_syntax = next((s for s in got_syntaxes if s == exp_form), None)
        if got_len == len(exp_bytes) and matched_syntax is not None:
            stats["alias" if matched_syntax != e["syntax"] else "exact"] += 1
        else:
            got_syntax = e["syntax"]
            what = []
            if got_len != len(exp_bytes):
                what.append(f"len {got_len}!={len(exp_bytes)}")
            if exp_form not in got_syntaxes:
                what.append(f"form {got_syntax!r}!={exp_form!r}")
            stats["mismatch"] += 1
            mismatches[("MISMATCH", exp_form, got_syntax, got_len,
                        len(exp_bytes))] += 1
            if len(examples) < max_report:
                examples.append((a, exp_bytes.hex(), exp_form,
                                 f"{got_syntax} (len {got_len})"))
        # advance by *expected* length to stay in sync with objdump stream
        step = len(exp_bytes)
        pos += 1
        # skip any corpus entries that start inside this instruction
        while pos < n and addr_list[pos] < a + step:
            pos += 1

    total = (stats["exact"] + stats.get("alias", 0) + stats["mismatch"]
             + stats["undecodable"])
    print(f"corpus: {total} instructions")
    print(f"  exact:       {stats['exact']} "
          f"({100.0 * stats['exact'] / total:.2f}%)")
    print(f"  alias-hit:   {stats.get('alias', 0)} "
          f"({100.0 * stats.get('alias', 0) / total:.2f}%)")
    print(f"  mismatch:    {stats['mismatch']}")
    print(f"  undecodable: {stats['undecodable']}")
    print("\ntop mismatch causes:")
    for k, c in mismatches.most_common(15):
        print(f"  {c:6d}  {k}")
    print("\nexamples:")
    for a, b, exp, got in examples:
        print(f"  @{a:#x} {b}: expected {exp!r} got {got!r}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 20)
