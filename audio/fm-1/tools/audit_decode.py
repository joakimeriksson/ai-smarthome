#!/usr/bin/env python3
"""Audit the emulator's decoders against the vendor disassembly.

    tools/audit_decode.py OBJDUMP.txt [fm1-emu binary]

Runs `fm1-emu --describe OBJDUMP` (what the emulator decodes each instruction into) and compares
it with what objdump printed for the same address: branch / call targets, load and store
operands (register, base, offset, width, sign), and register constants. Prints the mismatches
grouped by encoding (first two bytes) with examples, and a summary.
"""
import collections, re, subprocess, sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
uncovered = "--uncovered" in sys.argv          # list the instruction shapes nothing compares
objdump = args[0]
emu = args[1] if len(args) > 1 else "target/release/fm1-emu"

ours = {}
for line in subprocess.run([emu, "--describe", objdump], capture_output=True, text=True, check=True).stdout.splitlines():
    a, d = line.split("|", 1)
    ours[int(a, 16)] = d

LD = re.compile(r"^r(\d+) = ([bh]?)\[(r\d+|sp)(?:\+(-?\d+))?\](?: \(([us])\))?$")
ST = re.compile(r"^([bh]?)\[(r\d+|sp)(?:\+(-?\d+))?\] = r(\d+)$")
MOVI = re.compile(r"^r(\d+) = (-?\d+)$")
NUM = r"-?(?:0x[0-9A-Fa-f]+|\d+)"
OPS = r"\+|-|&|\||\^|\*|<<|>>>|>>"
ALU3 = re.compile(rf"^r(\d+) = r(\d+) ({OPS}) (r\d+|{NUM})$")
ALU2 = re.compile(rf"^r(\d+) ({OPS})= (r\d+|{NUM})$")
ANDN = re.compile(r"^r(\d+) = r(\d+) & ~r(\d+)$")
RSUB = re.compile(rf"^r(\d+) = ({NUM}) - r(\d+)$")
BIT = re.compile(rf"^r(\d+) = r(\d+) ({OPS}) \(1 << r(\d+)\)$")
MOV = re.compile(r"^r(\d+) = r(\d+)$")
PAIR_LD = re.compile(r"^r(\d+)_r(\d+) = d\[(r\d+|sp)(?:\+(\d+))?\]$")
PAIR_ST = re.compile(r"^d\[(r\d+|sp)(?:\+(\d+))?\] = r(\d+)_r(\d+)$")

LDX = re.compile(r"^r(\d+) = ([bh]?)\[r(\d+)\+r(\d+)(?:<<(\d+))?\](?: \(([us])\))?$")
STX = re.compile(r"^([bh]?)\[r(\d+)\+r(\d+)(?:<<(\d+))?\] = r(\d+)$")
RMW = re.compile(rf"^([bh]?)\[r(\d+)\+({NUM})\] (\|=|&=|\^=|\+=|-=|=) (r\d+|{NUM}|\(1 << r\d+\))$")
PUSH = re.compile(r"^\[--sp\] = \{rets(?:, ([^}]*))?\}$")
POP = re.compile(r"^\{pc(?:, ([^}]*))?\} = \[sp\+\+\]$")
EXT = re.compile(r"^r(\d+) = r(\d+)\.(b0|l|h) \(([us])\)$")

def reglist(txt):
    """'r7-r4' / 'r5, r4' -> sorted register names"""
    out = set()
    for part in (txt or "").split(","):
        part = part.strip()
        if not part:
            continue
        if not part[1:].replace("-r", "").isdigit():
            return None                                   # (special registers: retx, psr, ..)
        if "-" in part:
            a, b = (int(x[1:]) for x in part.split("-"))
            out.update(range(min(a, b), max(a, b) + 1))
        else:
            out.add(int(part[1:]))
    return " ".join("r%d" % r for r in sorted(out))

def num(x):
    return int(x, 0) & 0xFFFFFFFF if not x.startswith("r") else x
WIDTH = {"": 4, "h": 2, "b": 1}

def theirs(text):
    """objdump's text -> the canonical form, or None if not comparable"""
    m = re.search(r"<[^>]*: ([0-9a-f]+) >\s*$", text)
    if m and ("goto" in text or text.startswith("call")):
        return "T %x" % (int(m[1], 16) & 0xFFFFFFFF)   # (base-0 listings print 64-bit wrapped targets)
    t = re.sub(r"\s*<[^>]*>\s*$", "", text).strip()
    t = re.sub(r"\s+#$", "", t)
    m = LD.match(t)
    if m:
        w = WIDTH[m[2]]
        return "L r%s %s %d w%d %s" % (m[1], m[3], int(m[4] or 0), w, m[5] or "u")
    m = ST.match(t)
    if m:
        return "S r%s %s %d w%d" % (m[4], m[2], int(m[3] or 0), WIDTH[m[1]])
    m = MOVI.match(t)
    if m:
        return "I r%s %d" % (m[1], int(m[2]) & 0xFFFFFFFF)
    m = LDX.match(t)
    if m:
        return "X r%s r%s r%s %s w%d %s" % (m[1], m[3], m[4], m[5] or 0, WIDTH[m[2]], m[6] or "u")
    m = STX.match(t)
    if m:
        return "Y r%s r%s r%s %s w%d" % (m[5], m[2], m[3], m[4] or 0, WIDTH[m[1]])
    m = RMW.match(t)
    if m:
        v = m[5]
        v = ("1<<r" + v.split("<< r")[1].rstrip(")")) if v.startswith("(") else (v if v.startswith("r") else str(num(v)))
        return "M w%d r%s %d %s %s" % (WIDTH[m[1]], m[2], int(m[3], 0), m[4], v)
    m = PUSH.match(t)
    if m and reglist(m[1]) is not None:
        return ("U rets " + reglist(m[1])).strip()
    m = POP.match(t)
    if m and reglist(m[1]) is not None:
        return ("O pc " + reglist(m[1])).strip()
    if t == "[--sp] = rets":
        return "U rets"
    if t == "pc = [sp++]":
        return "O pc"
    m = EXT.match(t)
    if m:
        return "E r%s r%s %s %s" % (m[1], m[2], m[3], m[4])
    m = PAIR_LD.match(t)
    if m:
        return "P r%s_r%s %s %d ld" % (m[1], m[2], m[3], int(m[4] or 0))
    m = PAIR_ST.match(t)
    if m:
        return "P r%s_r%s %s %d st" % (m[3], m[4], m[1], int(m[2] or 0))
    m = ANDN.match(t)
    if m:
        return "A r%s r%s &~ r%s" % (m[1], m[2], m[3])
    m = RSUB.match(t)
    if m:
        return "A r%s r%s rsub %d" % (m[1], m[3], num(m[2]))
    m = BIT.match(t)
    if m:
        return "A r%s r%s %s 1<<r%s" % (m[1], m[2], m[3], m[4])
    m = ALU3.match(t)
    if m:
        if m[3] in ("<<", ">>") and num(m[4]) == 32:
            return "I r%s 0" % m[1]                       # a logical shift by 32 clears
        if m[3] == ">>>" and num(m[4]) == 32:
            return "A r%s r%s >>> 31" % (m[1], m[2])      # >>> 32 is the sign fill
        return "A r%s r%s %s %s" % (m[1], m[2], m[3], num(m[4]))
    m = ALU2.match(t)
    if m:
        return "A r%s r%s %s %s" % (m[1], m[1], m[2], num(m[3]))
    m = MOV.match(t)
    if m:
        return "A r%s r%s mov" % (m[1], m[2])
    return None

line_re = re.compile(r"^\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*\t\s*(.*)$")
IFC = re.compile(rf"^(ifs?) \((r\d+) (==|!=|<=|>=|<|>) (r\d+|{NUM})\) \{{$")
IFB = re.compile(rf"^if \(\((r\d+) & (r\d+|{NUM}|\(1 << r\d+\))\) (==|!=) 0\) \{{$")

def block_units(lines, i):
    """units of the then / else parts of the block opened at listing line i: instructions, a `#` pair
    counting once; objdump closes the parts with `}` / `} else {` lines"""
    parts, units, pair, depth = [], 0, False, 0
    for l in lines[i + 1:]:
        s = l.strip()
        if s.startswith("}"):
            if depth > 0:                                 # (the end of a nested block / rep body)
                if "else" not in s:
                    depth -= 1
                continue
            parts.append(units)
            units = 0
            if "else" not in s:
                break
            continue
        m = line_re.match(l)
        if not m:
            continue
        if depth == 0 and not pair:
            units += 1                                    # a nested block counts once, as in block_end
        pair = depth == 0 and m[3].rstrip().endswith("#")
        if m[3].rstrip().endswith("{"):
            depth += 1
        if len(parts) == 0 and units > 4 or len(parts) == 1 and units > 3:
            return None
    if len(parts) == 1:
        parts.append(0)
    return parts if len(parts) == 2 else None

def if_block(text, lines, i):
    t = re.sub(r"\s*<[^>]*>\s*$", "", text).strip()
    units = None
    m = IFC.match(t)
    if m:
        rhs = m[4] if m[4].startswith("r") else str(num(m[4]))
        cond = "C%s %s %s %s" % ("s" if m[1] == "ifs" else "", m[2], m[3], rhs)
    else:
        m = IFB.match(t)
        if not m:
            return None
        rhs = m[2]
        rhs = ("1<<r" + rhs.split("<< r")[1].rstrip(")")) if rhs.startswith("(") else (rhs if rhs.startswith("r") else str(num(rhs)))
        cond = "C %s %s %s" % (m[1], "&!=0" if m[3] == "!=" else "&==0", rhs)
    units = block_units(lines, i)
    if units is None:
        return None
    return "%s %d %d" % (cond, units[0], units[1])
bad = collections.defaultdict(list)
skipped = collections.Counter()
total = 0
n = same = 0
listing = [l.rstrip("\n") for l in open(objdump, errors="replace")]
for li, line in enumerate(listing):
    m = line_re.match(line)
    if not m:
        continue
    pc = int(m[1], 16)
    total += 1
    want = theirs(m[3].strip())
    if want is None and m[3].rstrip().endswith("{"):
        want = if_block(m[3].strip(), listing, li)
    if want is None or pc not in ours:
        shape = re.sub(r"\s*<[^>]*>\s*$", "", m[3].strip())
        shape = re.sub(r"\br\d+\b", "R", shape)
        skipped[re.sub(r"-?0x[0-9a-fA-F]+|-?\b\d+\b", "N", shape)] += 1
        continue
    n += 1
    got = ours[pc]
    # `x &~ imm` is objdump's `x & ~imm`
    g = got.split()
    if len(g) == 5 and g[0] == "A" and g[3] == "&~" and not g[4].startswith(("r", "1<<")):
        got = "A %s %s & %d" % (g[1], g[2], ~int(g[4]) & 0xFFFFFFFF)
    # (word loads: objdump prints no (u)/(s); ours says u)
    if got == want:
        same += 1
    else:
        key = " ".join(m[2].split()[:2])
        bad[key].append((pc, m[2].strip(), m[3].strip(), got, want))

print(f"{n} comparable instructions, {same} agree, {n - same} differ in {len(bad)} encodings"
      f" ({total} instructions listed, {100 * n / max(total, 1):.0f}% compared)")
if uncovered:
    for k, c in skipped.most_common(40):
        print(f"  {c:6}  {k}")
for key, items in sorted(bad.items(), key=lambda kv: -len(kv[1])):
    print(f"\n[{key}] x{len(items)}")
    for pc, b, text, got, want in items[:3]:
        print(f"  {pc:08x}  {b:20} {text[:50]:50}  emu: {got:28} objdump: {want}")
