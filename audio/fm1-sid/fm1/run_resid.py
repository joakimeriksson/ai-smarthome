#!/usr/bin/env python3
"""reSID 0.16 on the emulated FM-1: fm1/run_resid.py [method ...]  (0 fast, 1 interpolate, 2 resample)

Builds fm1/bench_resid.cc per method, runs it in ../fm-1's fm1-emu, reports instructions per
sample, the heap, and how far the samples are from the host's reSID (build/sid_replay on the
same register log; floating-point init on the device can differ in the last bits).
SPDX-License-Identifier: BSD-2-Clause"""
import re, struct, subprocess, sys, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import EMU, RES, FS, MHZ, ROOT, symbol

NAMES = {0: "fast", 1: "interp", 2: "resample"}


def main():
    methods = [int(a) for a in sys.argv[1:]] or [0, 1, 2]
    print(f"reSID 0.16 on the emulated FM-1 (pi32v2, -O2), {FS} Hz, {MHZ} MHz:")
    print(" method     instr/sample  % of a core  heap KB   max |diff| vs host reSID")
    for m in methods:
        subprocess.run([str(ROOT / "fm1" / "build_resid.sh"), str(m)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        dis = (ROOT / "build" / f"fm1_resid_{m}" / "bench.dis").read_text()
        mark = symbol(dis, "bench_mark")
        n = 11025
        steps = 400_000_000
        while True:
            out = subprocess.run([str(EMU), "--bin", f"build/resid_{m}.bin", "--entry", "0x02000120",
                                  "--break-pc", hex(mark), "--steps", str(steps), "--quiet",
                                  "--dump", hex(RES), str(16 + n // 2 + 1)],
                                 cwd=ROOT, capture_output=True, text=True).stdout
            marks = [int(s) for s in re.findall(r"^break c0 pc=\S+ \[(\d+)\]", out, re.M)]
            if len(marks) >= 3 or steps > 8_000_000_000:
                break
            steps *= 3
        mem = []
        for line in out.splitlines():
            mm = re.match(r"\s+0x([0-9a-f]+): (.*)", line)
            if mm:
                mem += [int(w, 16) for w in mm.group(2).split()]
        if len(marks) < 3 or mem[0] != 0x53494442:
            sys.exit(f"method {m}: did not finish\n{out[-1500:]}")
        dev = []
        for w in mem[16:]:
            dev += [w & 0xFFFF, w >> 16]
        dev = [s - 65536 if s >= 32768 else s for s in dev[:n]]
        eng = {0: "r016-fast", 1: "r016-interp", 2: "r016-resample"}[m]
        subprocess.run([str(ROOT / "build" / "sid_replay"), "build/cmp/workload.sidlog", "build/cmp/workload", eng],
                       cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        w = wave.open(str(ROOT / "build" / "cmp" / f"workload.{eng}.wav"))
        host = struct.unpack(f"<{n}h", w.readframes(n))
        diff = max(abs(a - b) for a, b in zip(dev, host))
        per = (marks[2] - marks[1]) / n
        print(f" {m} {NAMES[m]:9} {per:12.0f} {per * FS / (MHZ * 1e6) * 100:10.1f} % {mem[4] / 1024:8.1f}   {diff}")


if __name__ == "__main__":
    main()
