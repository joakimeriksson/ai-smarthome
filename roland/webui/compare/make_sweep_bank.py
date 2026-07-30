#!/usr/bin/env python3
"""Generate a bank where one parameter is stepped across its range.

The point: we cannot set Zenology's parameters over SysEx (no standalone build,
and Logic does not pass SysEx to instruments), but we CAN write .svz banks it
imports - that is already proven. So instead of changing one parameter N times,
we write N tones that differ in exactly one parameter, import once, and step
through them with MIDI Program Change while capturing.

    python3 webui/compare/make_sweep_bank.py User2.svz 2 \
        --group PCMT_PTL_1 --id CUTOFF --values 100,200,300,400,500,600,700,800,900,1023 \
        -o sweep-cutoff.svz

Every tone is otherwise byte-identical to the source, so any difference in the
captured audio is attributable to that one parameter - which is what makes the
result a measurement rather than an impression.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from zencore import Schema, ToneFile  # noqa: E402
from zencore.container import build, read_file  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("file")
    ap.add_argument("tone", type=int, nargs="?", default=0)
    ap.add_argument("--group", required=True)
    ap.add_argument("--id", dest="pid", required=True)
    ap.add_argument("--values", required=True, help="comma-separated values")
    ap.add_argument("--partials", default="1,2,3,4",
                    help="apply to these partials when the group ends in _1")
    ap.add_argument("--dry", action="store_true",
                    help="also strip MFX and the chorus/reverb sends")
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args(argv)

    schema = Schema.load()
    src = ToneFile.open(a.file, schema)
    base = src.tones[a.tone]
    values = [int(v) for v in a.values.split(",")]

    # if the group is per-partial, step the same parameter on each partial so
    # the change is audible regardless of which partial dominates
    groups = [a.group]
    if a.group.endswith("_1"):
        stem = a.group[:-2]
        groups = [f"{stem}_{n}" for n in a.partials.split(",")]

    out = ToneFile.open(a.file, schema)
    out.tones = []
    out.svz.chunks = [c for c in out.svz.chunks if c.kind != "MDL"]

    for i, v in enumerate(values):
        t = base.copy()
        t.name = f"SW{i + 1:02d} {a.pid[:8]}{v}"
        for g in groups:
            if schema.has(g, a.pid):
                t.set(g, a.pid, v)
        if a.dry:
            t.set("MFX", "mfxSwitch", 0)
            t.set("MFX", "choSend", 0)
            t.set("MFX", "revSend", 0)
            for n in range(1, 5):
                t.set(f"PCMT_PTL_{n}", "CHO_SEND", 0)
                t.set(f"PCMT_PTL_{n}", "REV_SEND", 0)
        out.append(t)

    out.save(a.out)
    assert build(read_file(a.out)) == Path(a.out).read_bytes()

    print(f"{a.out}: {len(values)} tones stepping {a.group}.{a.pid}")
    for i, (t, v) in enumerate(zip(ToneFile.open(a.out, schema).tones, values)):
        print(f"  program {i + 1:3}  {t.name:22} {a.pid}={v}")
    print("\nImport into Zenology, then step with Program Change while capturing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
