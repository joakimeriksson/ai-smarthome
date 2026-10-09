#!/usr/bin/env python3
"""Collapse census forms into encoding classes by abstracting registers.

Same as census.py normalization, plus: r0-r15 (and named regs) -> R.
Groups byte samples per (length, class) and computes constant-bit mask/match.
This is the number of distinct encodings the decoder must implement.

Output: work/classes.json
"""
import json
import re
import sys
from collections import defaultdict

REG = re.compile(r"\br(?:1[0-5]|[0-9])\b")


def main(forms_path: str, out: str) -> None:
    d = json.load(open(forms_path))
    classes: dict[tuple[int, str], dict] = {}
    for f in d["forms"]:
        cls = REG.sub("R", f["text"])
        key = (f["len"], cls)
        e = classes.setdefault(key, {"text": cls, "len": f["len"],
                                     "count": 0, "samples": set(),
                                     "forms": set()})
        e["count"] += f["count"]
        e["forms"].add(f["text"])
        for s in f["samples"]:
            if len(e["samples"]) < 4096:
                e["samples"].add(s)

    out_classes = []
    for (length, cls), e in classes.items():
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
        out_classes.append({
            "text": cls,
            "len": length,
            "count": e["count"],
            "mask": f"{mask:0{length * 2}x}",
            "match": f"{match:0{length * 2}x}",
            "distinct_encodings": len(samples),
            "src_forms": len(e["forms"]),
            "samples": samples[:8],
        })

    out_classes.sort(key=lambda x: -x["count"])
    with open(out, "w") as fh:
        json.dump({"distinct_classes": len(out_classes),
                   "classes": out_classes}, fh, indent=1)
    total = sum(e["count"] for e in out_classes)
    print(f"{len(out_classes)} encoding classes")
    for n in (50, 100, 200, 400):
        c = sum(e["count"] for e in out_classes[:n])
        print(f"  top-{n:3d} cover {c}/{total} ({100.0*c/total:.1f}%)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
