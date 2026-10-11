#!/usr/bin/env python3
"""Carry class names from an existing isa/fm1.yaml over to a freshly mined one.

build_isa.py names classes in mining order, so adding corpora renumbers the suffixes; the
emulator keys some decoders on names. Each new class with the same length and syntax as an old
one takes the old name of the class it shares the most samples with (one to one); the rest get
fresh names that collide with nothing.
    tools/isa_stable_names.py OLD.yaml NEW.yaml OUT.yaml
"""
import json, re, sys

def entries(path):
    out, cur = [], None
    for line in open(path):
        m = re.match(r"  - name: (\S+)", line)
        if m:
            cur = {"name": m[1], "lines": [line]}
            out.append(cur)
            continue
        if cur is None:
            continue
        cur["lines"].append(line)
        m = re.match(r'    (syntax|len|samples): (.*)', line)
        if m:
            cur[m[1]] = m[2]
    return out

old_path, new_path, out_path = sys.argv[1:]
old = entries(old_path)
new = entries(new_path)
header = []
for line in open(new_path):
    if line.startswith("  - name:"):
        break
    header.append(line)

key = lambda e: (e.get("len"), e.get("syntax"))
samples = lambda e: set(json.loads(e.get("samples", "[]")))
by_key = {}
for o in old:
    by_key.setdefault(key(o), []).append(o)

# candidate pairs by overlap, best first; assign one to one
pairs = []
for i, n in enumerate(new):
    ns = samples(n)
    for o in by_key.get(key(n), []):
        ov = len(ns & samples(o))
        if ov:
            pairs.append((ov, i, o["name"]))
pairs.sort(reverse=True)
name_of, used = {}, set()
for ov, i, oname in pairs:
    if i in name_of or oname in used:
        continue
    name_of[i] = oname
    used.add(oname)

taken = {o["name"] for o in old}
fresh = 0
for i, n in enumerate(new):
    if i in name_of:
        continue
    base = n["name"]
    cand, k = base, 2
    while cand in taken:
        cand = f"{base}_n{k}"
        k += 1
    taken.add(cand)
    name_of[i] = cand
    fresh += 1

with open(out_path, "w") as f:
    f.writelines(header)
    for i, n in enumerate(new):
        lines = n["lines"][:]
        lines[0] = f"  - name: {name_of[i]}\n"
        f.writelines(lines)
missing = [o["name"] for o in old if o["name"] not in used]
print(f"{len(new)} classes: {len(new) - fresh} keep their old name, {fresh} new; "
      f"{len(missing)} old names not carried over: {missing[:12]}")
