#!/usr/bin/env python3
"""Run the SID bench on the emulated FM-1 and report the cost.

    fm1/run.py [chips ...] [--opt -O2|-Os]

For each chip count: build (fm1/build.sh), run ../fm-1's fm1-emu with a break on bench_mark,
take the instruction counts between the marks, check the hash against the host build
(build/sid_demo hash, same workload) and write the emulator's samples to
build/workload_fm1_<chips>.wav. Instructions are not cycles: the % of a 240 MHz core assumes
one instruction per cycle (pi32v2 issues one most of the time; loads from XIP and divides
take longer), so read it as a lower bound with some margin.
SPDX-License-Identifier: BSD-2-Clause
"""
import re
import struct
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EMU = ROOT.parent / "fm-1" / "target" / "release" / "fm1-emu"
RES = 0x01C80000
FS = 44100
MHZ = 240


def host_hash(chips):
    exe = ROOT / "build" / f"sid_hash_{chips}"
    src = ["src/sid.c", "src/sidsynth.c", "host/demo.c"]
    subprocess.run(["cc", "-O2", "-ffp-contract=off", f"-DWL_CHIPS={chips}", "-o", str(exe), *src],
                   cwd=ROOT, check=True)
    out = subprocess.run([str(exe), "hash"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return int(re.search(r"hash ([0-9a-f]{8})", out).group(1), 16)


def symbol(dis, name):
    m = re.search(rf"^([0-9a-f]+) <{name}>:|^{name}:\n\s*([0-9a-f]+):", dis, re.M)
    return int(m.group(1) or m.group(2), 16)


def run(chips, opt):
    subprocess.run([str(ROOT / "fm1" / "build.sh"), str(chips), opt], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL)
    dis = (ROOT / "build" / f"fm1_{chips}" / "bench.dis").read_text()
    mark = symbol(dis, "bench_mark")
    nsamp = 11025
    words = 16 + (nsamp + 1) // 2
    out = subprocess.run([str(EMU), "--bin", f"build/bench_{chips}.bin", "--entry", "0x02000120",
                          "--break-pc", hex(mark), "--steps", "1000000000", "--quiet",
                          "--dump", hex(RES), str(words)],
                         cwd=ROOT, check=True, capture_output=True, text=True).stdout
    steps = [int(s) for s in re.findall(r"^break c0 pc=\S+ \[(\d+)\]", out, re.M)]
    mem = []
    for line in out.splitlines():
        m = re.match(r"\s+0x([0-9a-f]+): (.*)", line)
        if m:
            mem += [int(w, 16) for w in m.group(2).split()]
    if len(steps) < 3 or mem[0] != 0x53494442:
        sys.exit(f"chips={chips}: the bench did not finish:\n{out[-2000:]}")
    init, render = steps[1] - steps[0], steps[2] - steps[1]
    per = render / nsamp
    samples = []
    for w in mem[16:]:
        samples += [w & 0xFFFF, w >> 16]
    samples = samples[:nsamp]
    wav = ROOT / "build" / f"workload_fm1_{chips}.wav"
    with open(wav, "wb") as f:
        data = struct.pack(f"<{nsamp}H", *samples)
        f.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " +
                struct.pack("<IHHIIHH", 16, 1, 1, FS, FS * 2, 2, 16) + b"data" + struct.pack("<I", len(data)) + data)
    want = host_hash(chips)
    return {"chips": chips, "init": init, "per": per, "pct": per * FS / (MHZ * 1e6) * 100,
            "hash": mem[1], "match": mem[1] == want, "wav": wav}


def main():
    args = sys.argv[1:]
    opt = "-O2"
    if "--opt" in args:
        i = args.index("--opt")
        opt = args[i + 1]
        del args[i:i + 2]
    chips = [int(a) for a in args] or [1, 2, 3, 4]
    if not EMU.exists():
        sys.exit(f"no emulator at {EMU}: cargo build --release -p fm1-emu in ../fm-1")
    print(f"SID bench on the emulated FM-1 (pi32v2, {opt}), {FS} Hz, {MHZ} MHz:")
    print(" chips voices  instr/sample  % of a core  init (instr)  hash      = host")
    for c in chips:
        r = run(c, opt)
        print(f" {c:5} {3 * c:6} {r['per']:13.0f} {r['pct']:11.1f} % {r['init']:13,}  {r['hash']:08x}  "
              f"{'yes' if r['match'] else 'NO'}")


if __name__ == "__main__":
    main()
