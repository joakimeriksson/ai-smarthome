#!/usr/bin/env python3
"""Generate crates/fm1-isa/src/generated_isa.rs from isa/fm1.yaml (+ solver).

Single source of truth: isa/fm1.yaml for the mask table; work/semantics_raw.json
(solver-verified operand layouts) for the per-class operand slots.

Usage: gen_isa.py [isa/fm1.yaml] [semantics_raw.json] [generated_isa.rs]
"""
import json
import os
import sys

LINE_KEYS = ("len", "count", "mask", "match", "syntax", "alt", "samples",
             "group")


def load_isa(path: str):
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
                    cur[key] = int(val.strip('"'), 16)
                elif key in ("syntax",):
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


def rs_str(s: str) -> str:
    return json.dumps(s)


def main(yaml_path: str, sem_path: str, out_path: str) -> None:
    entries = load_isa(yaml_path)

    # solver-verified operand slots, keyed by class name
    try:
        semantic = json.load(open(sem_path))
    except OSError:
        semantic = {}

    def slot_rust(s):
        kind = s.get("kind", "unsolved")
        if kind == "unsolved":
            return None
        if kind == "blk":
            return (f"SlotSpec {{ kind: SlotKind::Blk, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: 0, adj: 0, hi: {s.get('hi', 0)}, lo: {s.get('lo', 0)} }}")
        if kind == "rel":
            return (f"SlotSpec {{ kind: SlotKind::Rel, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: {int(s.get('mult', 0) or 0)}, adj: 0, hi: 0, lo: 0 }}")
        if kind == "scaled":
            return (f"SlotSpec {{ kind: SlotKind::Scaled, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: {int(s.get('mult', 0) or 0)}, adj: {int(s.get('adj', 0) or 0)}, hi: 0, lo: 0 }}")
        if kind == "zero32":
            return (f"SlotSpec {{ kind: SlotKind::Zero32, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: 0, adj: 0, hi: 0, lo: 0 }}")
        if kind == "const":
            v = int(s.get('value', 0)) & 0xffffffff
            if v >= 1 << 31:
                v -= 1 << 32
            return (f"SlotSpec {{ kind: SlotKind::Const, pieces: &[], "
                    f"mult: 0, adj: {v}, hi: 0, lo: 0 }}")
        if kind in ("composed", "ncomposed"):
            k = "Composed" if kind == "composed" else "NComposed"
            return (f"SlotSpec {{ kind: SlotKind::{k}, pieces: &[(16, 27)], "
                    f"mult: 0, adj: 0, hi: 0, lo: 0 }}")
        if kind in ("bit", "nbit"):
            k = "Bit" if kind == "bit" else "NBit"
            return (f"SlotSpec {{ kind: SlotKind::{k}, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: 0, adj: 0, hi: 0, lo: 0 }}")
        if kind.startswith("adj"):
            adj = int(kind[3:])
            return (f"SlotSpec {{ kind: SlotKind::Adj, pieces: &{pieces_rust(s['pieces'])}, "
                    f"mult: 0, adj: {adj}, hi: 0, lo: 0 }}")
        # imm
        return (f"SlotSpec {{ kind: SlotKind::Imm, pieces: &{pieces_rust(s['pieces'])}, "
                f"mult: 0, adj: 0, hi: 0, lo: 0 }}")

    def pieces_rust(pieces):
        if not pieces:
            return "[]"
        return "[" + ", ".join(f"({lo}, {hi})" for lo, hi in pieces) + "]"

    with open(out_path, "w") as f:
        f.write("// GENERATED from isa/fm1.yaml by tools/gen_isa.py —\n")
        f.write("// edit tools/build_isa.py's sources, not this file.\n")
        f.write("//\n")
        f.write("// mask/match refer to the little-endian integer formed by\n")
        f.write("// the instruction bytes (see docs/isa-notes.md).\n\n")
        f.write("use super::{IsaEntry, SlotKind, SlotSpec};\n\n")
        f.write("pub static ISA: &[IsaEntry] = &[\n")
        for e in entries:
            name = e["name"].replace('"', r'\"')
            f.write("    IsaEntry {\n")
            f.write(f"        name: {rs_str(name)},\n")
            f.write(f"        syntax: {rs_str(e['syntax'])},\n")
            f.write(f"        len: {e['len']},\n")
            f.write(f"        count: {int(e.get('count', 0))},\n")
            f.write(f"        mask: 0x{e['mask']:016x}_u64,\n")
            f.write(f"        match_: 0x{e['match']:016x}_u64,\n")
            f.write(f"        group: {rs_str(e.get('group', 'misc'))},\n")
            alts = e.get("alt", [])
            f.write("        alt: &[\n")
            for a in alts:
                f.write(f"            {rs_str(a)},\n")
            f.write("        ],\n")
            samples = sorted(e.get("samples", ()))[:512]
            f.write("        samples: &[\n")
            for s in samples:
                f.write(f"            0x{s:012x}_u64,\n")
            f.write("        ],\n")
            # solver-verified slots if available and complete
            slots = semantic.get(name, {}).get("slots")
            if slots and all(s.get("kind") != "unsolved" for s in slots):
                f.write("        slots: &[\n")
                for s in slots:
                    r = slot_rust(s)
                    if r:
                        f.write(f"            {r},\n")
                f.write("        ],\n")
            else:
                f.write("        slots: &[],\n")
            f.write("    },\n")
        f.write("];\n")
    print(f"{len(entries)} entries (+{sum(1 for e in entries if semantic.get(e['name'], {}).get('slots'))} with solver slots) -> {out_path}")


if __name__ == "__main__":
    here = __file__.rsplit("/", 1)[0]
    yaml = sys.argv[1] if len(sys.argv) > 1 else "isa/fm1.yaml"
    sem = sys.argv[2] if len(sys.argv) > 2 else "work/semantics_raw.json"
    out = sys.argv[3] if len(sys.argv) > 3 else "crates/fm1-isa/src/generated_isa.rs"
    main(yaml, sem, out)
