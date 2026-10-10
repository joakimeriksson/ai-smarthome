# pi32v2 ISA notes

Working notes from Phase 1 (mask-level ISA extraction). Machine-readable
table: `isa/fm1.yaml` (auto-generated — do not hand-edit; edit
`tools/build_isa.py` / probe sources instead).

## Bit numbering convention

The instruction's bytes b0..bn form a little-endian integer V
(b0 = bits 0..7, b1 = bits 8..15, ...). `mask`/`match`/field lsb/msb all
refer to V. A 2-byte instruction `75 04` therefore has V = 0x0475 — the
hex literal in YAML `samples` is the byte string, and its LE value differs
from `int(s,16)`; always convert via `int.from_bytes(bytes.fromhex(s),
"little")` (this exact bug has bitten once already).

## What the table is

- 1067 classes, built from ~421k instructions across 5 vendor-objdump
  corpora (V13 app, V14 app, uboot, uboot-debug, usb-hid-ota).
- Each class: `mask`/`match` (constant bits across all observed samples),
  `syntax` (normalized form), optional `alt` (same-mask spelling families),
  `samples` (hex byte strings, capped at 64; decode tiebreak).
- Validation (`tools/check_isa.py`, streaming decode, sample priority):
  V13 99.98%, V14 99.98%, uboot 100%, ota 99.99% — 0 mismatches,
  0 undecodable on all. Mask-level coverage of real firmware is complete.

## Form normalization (tools/normlib.py)

- Vendor annotation `<_fw+0x... : ... >` stripped anchored at END of line.
  Un-anchored, it eats `ifs (r6 < 3) goto ...` through the `<` operator —
  this produced phantom forms `ifs (R` / `if (R` (3% of the corpus!).
- Hex immediates → `#h`, decimals → `#i`, r0..r15 → `R`.
- Register lists canonicalized: `{rets, r6-r4}` and `{rets, r5, r4}` are
  two objdump spellings over a variable field, so abstract runs become
  `R*k` (`R-R` counts as 2). Named regs (`rets`, `psr`, `icfg`, ...) kept.

## Register-block encoding (open puzzle, needs field-level work)

The pop/push list families encode a block of registers in the low nibble
of byte0 with an r3/r4 symmetry around the block bottom:

| bytes   | objdump text            |
|---------|-------------------------|
| `70 04` | `{rets, r3-r0}`         |
| `71 04` | `{rets, r3-r1}`         |
| `73 04` | `{rets, r3}`            |
| `74 04` | `{rets, r4}`            |
| `75 04` | `{rets, r5, r4}`        |
| `76 04` | `{rets, r6-r4}`         |
| `7a 04` | `{rets, r10-r4}`        |

Hypothesis: field = block size `|n-3.5|+0.5` (n = low nibble), block spans
down to r4 for n>=4, up to r3 for n<=3. *Not yet hand-verified* — needs a
targeted probe (Phase 1.3), and the YAML keeps `R*k` variants merged as one
mask family with `alt` spellings in the meantime.

## Decode semantics of the check tool

Priority = (longest, then mask popcount, then corpus count). Among mask
matches, an entry whose `samples` contain the observed byte string wins.
This is what separates sibling forms the masks alone cannot (e.g.
`[--sp] = {rets, r3}` vs `[--sp] = {rets, r3-r0}` differ only in bits the
V13-only masks left variable). For non-corpus bytes the first candidate
wins — pure-emulator decoding should never rely on that tiebreak; fields
must be refined first.

## Status of entries

Everything is `status: auto` — masks are corpus-derived, semantics (flag
updates, cycle counts, immediates sign-extension) unverified until
probes/hardware (Phase 1.3, device ordered 2026-10-08).

## Known undecoded space

None in the 5 corpora. Expected unknowns beyond them: fpu/coprocessor,
audio-DSP specifics, anything the stock/uboot/ota never emits.

## Operand derivation (Phase 1.2.5, 2026-10-08)

`tools/derive.py` fits per-slot operand encodings (template + `operands`
list per class, output `work/derived.yaml`); `tools/disasm.py` renders
vendor-comparable text and diffs against the corpora.

Current state: ~1067 classes; 437 fully solved + 115 partial (slots);
~55% of all instructions render byte-exact vendor text (incl. branch
offsets and hex constants). 0 undecodable; mask layer unaffected.

### Encoding discoveries (from fitting, all corpus-verified)

- Register operands are not always one span: e.g. `R = #i` packs
  `reg = bits(0,2) | bit7<<3` (byte0 0xc0-family carries reg+8):
  layered concat fitting found it.
- **`R = #i` hides ≥3 opcode families under one normalized form**:
  0x4N-family (imm from bits(0,5)*(0x38-rotations) unclear), 0xCN-family
  prints `field - 0x14`, etc. The fitter's single-formula model cannot
  express per-family bias — flagged for Phase 1.3 hardware probes.
- Immediate formulas found so far: identity, sign-extended, pc-relative
  (×1/×2, ±), bitwise-NOT over 32/16 bits, ×4/×8 shifts. Off-by-one
  variants (+1/-1) exist (`[R++=#i]` seems N-1 encoded) — pending.
- Block lists: `[max(n,hi) .. min(n,lo)]` with class constants (e.g.
  {rets, rN…r4} → hi=3, lo=4) — verified 7129/7129 for the byte1=0x04
  push/pop family.

### Known renderer/fit gaps (next steps)

1. Sibling-mask classes decode wrong without exhaustive samples: YAML
   cap is 64; sibling classes (same len+mask+match across families) need
   their full distinct-encoding set stored.
2. Operand renderers must be formula-versioned identically to the fitter
   (single shared table violation; disasm.py re-declares the table).
3. +1/-1 immediate formula variants; restrict NOT-formulas to classes
   where the printed target is a bitmask-typed operand.

## Stock firmware boot in the emulator (2026-10-09, V13 app.bin)

`fm1-emu --bin app.bin` boots from the **reset vector at 0x02000000** (the
default entry). The CRT there sets `sp = 0x01C14BB4` / `ssp = 0x01C15BB4`,
calls `boot_hwinfo_save` (r0 = SPL boot-param pointer; the runner hands it
an all-zero block at 0x01C7FC00), zero-fills `.bss` (0x17380 bytes at
0x01C09E7C) and copies `.data` (0x9E7C bytes, flash 0x02084820 → RAM
0x01C00000), both with `rep` blocks — now executed with the right counts
(23776 / 10143 iterations).

**Correction of an earlier note.** The "calls into a JieLi mask ROM at
0x1FC05C4C" diagnosis was wrong on two counts: the earlier run entered at
0x02000120 (inside `pll_clock_init`, skipping the CRT) so sp was 0 and RAM
was empty; and the long-call targets vendor objdump prints as
`0xFFC0xxxx` (`_fw` = 0) are `0x01C0xxxx` at the real load address —
**RAM-resident .data code** (flash LMA = 0x02084820 + (target − 0x01C00000);
e.g. 0x01C05C4C is a delay loop at flash 0x0208A46C, 0x01C00D68 is the
RAM early-init at 0x02085588). FM-1-RE's docs call these "mask-ROM
services" in one table and "RAM-resident code" in another; the latter is
right. No mask-ROM dump is needed for boot, and the ROM-stub / zero-insn
stub hacks were removed.

### Encoding conventions verified against the corpus

- `R = #i` (2-byte): reg = bits(0,2)|bit7<<3; imm = (bits 8,12) |
  (bits 3,5)<<5 — 9-bit across the byte boundary (0xC?14 family is the
  separate `rN = 0` alias; 0x4N/0x6N/0x68.. behave differently per family).
- `R = #h` (4-byte): reg = (b3>>4)&0xf; value = f(b3&0xf, b2) = a
  composed-constant builder (IEEE float constants etc). Table of 70
  observed (b3lo, b2)->value pairs in fm1-core MOV_H_TABLE.
- block push/pop pairs: prologue `[--sp] = {rets, rN..rB}` ↔ epilogue
  `{pc, rN..rB} = [sp++]` (identical reg sets, verified on 8 pairs).
  Push: --sp then store, list in printed order (first item highest).
  Pop: read ascending, assign reversed printed list, pc last.
- `r_i_or_h`-family ([R+off] |=/&= const): base = bits(28,31);
  off = bits(0,4)*4; const = bits(16,31) (AND inverts). `r_i_or_r`:
  base = b3>>4, src = b3&0xf, off = b1 (8-bit).
- long call (6-byte `80 ff <imm32-le>`): offset sext32 from pc_next.
- 2-byte shifts `R = R <<|>>|>>> #i` (mask e088): dst = bits(0,2),
  src = bits(4,6), shift = bits(8,12); bit7 = right, bit3 = arithmetic
  (`a2 a2` r2 = r2 >> 2, `9a a2` r2 = r1 >>> 2). Bit 7 is NOT part of the
  register number — the first implementation thought so and silently
  shifted r10 instead of r2, so the CRT loop counts were 4× too big.
- `R = R + R` (2-byte `1c`/`1d`): dst = bits(0,2), a = bits(4,6),
  b = bit3 | bits(7,8)<<1 (`93 1c` r3 = r1 + r2, `29 1d` r1 = r2 + r5).
- `rep N rR {` (`03 xx`): reg = bits(0,3), N = block length in bytes =
  2*(bits(4,7)+1). `rep N #k {` (`8x xx`): same N, k = bits(8,12)+1.
  The block is the N bytes after the rep; it runs k / rR times, rR
  decremented in place. Count 0 skips the block (assumed: the CRT runs
  `r2 = 0; rep 2 r2 {…}` unguarded for the empty overlay) — needs a
  hardware probe. The compiler still emits `if (rR != 0) goto rep` after
  every register-count rep, which hints at a hardware iteration cap; the
  emulator loops until the register hits 0 either way.

### 4-byte families fitted 2026-10-09 (0 mismatches over all V13 samples)

Method: pull every corpus line of one printed shape, propose bit fields,
verify against *all* samples (scratch fitters; the hypotheses are now the
comments in `crates/fm1-core/src/lib.rs`). Verified:

- **Compare-immediate branches** `if[s] (rN <op> #imm) goto #off`
  (5302 samples): reg = bits(0,3); byte1 = family, bit7 = second op:
  f8 ==/!=, f9 >=/< unsigned, fc >/<= unsigned, fd >=/< signed,
  fe >/<= signed. imm = 10 bits = bits(25,31) | bits(4,6)<<7, printed
  sign-extended for ==/!= and the signed families (`r14 != -1`), zero-
  extended for the unsigned ones. off = 2*sext9(bits(16,23) | bit24<<8)
  from pc+4.
- **Composed 12-bit immediate** (code = bits(24,27), m = bits(16,23)),
  shared by `R = #h`, `R = R op #h`, `[R+#i] op= #h`: code 0 literal m;
  1 m per halfword; 2 (m<<8) per halfword; 3 m per byte; 4..15 float-like
  with exponent E = code<<1 | m>>7 and mantissa 0x80|(m&0x7f), value =
  mantissa << (32-E). Reproduces the whole 70-entry observed `R = #h`
  table plus 1519 ALU-immediate and 129 mov-immediate samples. The
  `&~` forms print the inverted value.
- **4-byte ALU** (byte1 e0/e1/e8/eb/ef; 6878 samples): three-register
  forms `b4 e0` (+,-), `90 e1` (|,^,&), `f0 e1` (*) with d = bits(28,31),
  a = bits(20,23), b = bits(24,27), sub-op bits(16,19); register-immediate
  forms with d = bits(0,3), s = bits(28,31), op nibble bits(4,7):
  e1 0..3 `R = R + sext14(bits(16,27) | nibble<<12)`, e1 4/5/6/7 |,^,&,&~
  composed, e1 e `*` composed, e0 e/f +/- composed, e0 a `composed - R`;
  memory RMW `[R+off] op= R` (e8: base bits(28,31), src bits(24,27),
  off = 4*sext6(bits(18,23)), op bits(16,17); byte0 64 logic / 68 arith)
  and `[R+off] op= imm` (ef/eb: off = 4*sext6(bits(0,5)), bits(6,7)
  select |,^,&,&~ (ef) or += composed / += sext12 (eb 2/3)).

### Operand solver and the syntax-driven executor (2026-10-09, later)

`tools/solve_slots.py` replaced `solve_hot.py`: per class it fits every
printed operand as an exact linear model over the varying bits (rational
Gaussian elimination; collinear bits resolved by a power-of-two search),
with kinds imm / rel (sign-extended, scaled) / scaled(+adj) / adj /
zero32 / bit / nbit / composed / const / blk and a few-sample single-field
fallback. Result: 764 of 1067 classes fully solved, 86.8% of corpus
instructions (was 206 / 54%). `gen_isa.py` emits the slots into
`generated_isa.rs` (new SlotKinds: Scaled, Const, Zero32, Bit, NBit,
Composed, NComposed); `fm1-emu --coverage` executes one sample of every
class on a scratch SoC and lists the classes still lacking semantics or
slots. The core now executes **99.2% of corpus instructions by weight**:
semantics are keyed by the printed shape (`Cpu::exec_syntax`, operands
from the slots in printed order), with raw-bit decoders only where one
class mixes encodings (4-byte ALU, compare/bit-test branches, predicated
blocks, register pairs, post-increment and indexed memory forms).

Hand-written per-class arms were removed wherever the solver covers the
class: three of them were wrong and corrupted the boot silently
(`[R+#i] = R` took bit 7 as part of the source register and stored r9
instead of r1; the 2-byte `if (R == #i) goto` sign-extended a 5-bit
offset; the register-pair store used base = bits(24,27)).

### Semantics discovered while booting (all corpus-verified)

- **Dual-issue pairs.** An instruction printed with a trailing `#` and the
  indented instruction after it execute as a pair: the second reads the
  register state from *before* the first (`r5 = r3 #; b[r4+6] = r5`
  stores the old r5). Implemented as deferred register commit in
  `Cpu::step`. A pair counts as **one unit** in the block-size nibbles of
  `if (...) {` (memset's `{ r2 -= 1 #; b[r3++=1] = r1; goto }` is 2 units).
- **Predicated blocks** `if[s] (rA <op> x) {` (4-byte, byte1 e8..ee):
  rA = bits(0,3); byte0 high nibble: 1 reg (rB = bits(24,27)), 2 composed
  immediate, 3 sext12; bit 7 flips the op (bit-test family ea: h=2 ==0,
  h=3 !=0, reg form byte2 bit7). then = bits(30,31)+1 units, else =
  bits(28,29) units (2057 blocks); nested blocks and `rep` headers count
  as one unit including their bodies.
- **Reg-reg compare branches**: 4-byte e8/e9/ec/ed/ee (bit7 alt, A =
  bits(28,31), B = bits(0,3), off = 2*sext9(bits(16,23)|bit24<<8)) and
  6-byte `4x ff` (fam bits(1,3), bit0 alt, A bits(28,31), B bits(24,27),
  off 2*sext16(bits(32,47))). The family code byte1&7 is shared by every
  compare form: 0 ==, 1 >= u, 4 > u, 5 >= s, 6 > s.
- **6-byte compare-immediate** `xx ff`: byte0 bits(1,3) family, bit0 alt,
  bit5 = composed (else sext12(bits(16,27))), reg bits(28,31), off
  2*sext16(bits(32,47)). (1323 samples)
- **Bit-test branches** `if ((rN & m) ==/!= 0) goto`: 6-byte `60/61 ff`
  (m composed, off sext16×2), 4-byte `5x e8` (m = 1<<bits(27,31), bit25 =
  !=, off sext9×2), 4-byte `fa/fb` (m = r[bits(4,7)], off sext16×2).
- **Register pairs** `rH_rL = d[...]`: pair = bits(29,31) (regs 2p+1, 2p),
  bit16 = store; `5x ec` base = bits(20,23), off = 4*(bits(18,19) |
  bits(24,28)<<2 | bit0<<6 | bit1<<7); `d0 e9` sp-relative, off =
  bits(17,23)<<1 | bit24<<8. Low register at the lower address.
- **Post-increment memory** (4-byte `dx ec/ed/ee`): data bits(28,31),
  base bits(20,23), f = bits(16,19)|bits(24,27)<<4; word/half: store =
  bit16, inc = sext10(f&~1 | bit0<<8 | bit1<<9), bit2 = signed (half);
  byte: store = bit1, signed = bit2, inc = bit0 ? sext8(f) : f. The
  indexed `d8 ec/ed/ee` forms share byte0 d8 with word post-increment —
  bit 17 set means indexed. 2-byte forms: byte1 05 word (±4, bit3 sign,
  bit7 store), see the core.
- **Block moves with a register base** `{..} = [rN+]` / `[rN+] = {..}`
  (00/20 eb): base bits(0,3), 16-bit register mask at bits(16,31), lowest
  register at the lowest address; `[rN++]` also advances the base.
- Shift counts: a zero field prints as 32. `testset b[R]`: cc = (old != 0)
  and byte |= 0x80 (SDK spins `testset; ifeq goto retry`). `tbb/tbh [R]`:
  pc = next_pc + 2*table[R] with the table right after the instruction
  (tbh entries are halfwords, R pre-scaled). `cnum` = core id.

### Dual core

The AC791N is dual-core and the firmware uses it: cpu0 runs the RTOS,
cpu1 is the audio render core (`0x01C022B6`, flash 0x02086AD6: sets the
ack byte `b[0x01C1FF08] = 1`, then polls a state byte and calls
`dx7note_compute_block`). `cpu1_boot_start` releases it with
`0x10008 |= 8` and spins on the ack. The runner starts a second `Cpu`
(core id 1, usp/sp = 0x01C15EB4/0x01C16EB4) when that bit is set and
interleaves the cores 1:1. **Open:** the vector at 0x02000098 `rti`s into
0x01C023D6, which is 2 bytes into a 6-byte instruction of
cpu_ipc_call_sync in the RAM image, and the mailbox word 0x020001B8 is
mid-function too — so the real cpu1 entry chain (ROM → ?) is unknown;
the runner enters cpu1 directly at 0x01C022B6. Cross-core IPC goes
through the mailbox at 0x01C06EA0/4 and the doorbell IRQ; interrupts are
not modelled yet.

### Where boot stops now

cpu0 runs the CRT, the RAM early init (interrupt controller, SRAM
clears), clock/board init (`0x02001C24`, 100k-iteration delay loop),
`request_irq` table setup, RTOS init (dlmalloc mspace, queues, mutexes),
releases cpu1, creates the boot task and reaches `os_start`, where the
first task is entered through `{psr, rets, reti} = [sp++]; rti`.
The first task's wrapper (0x0205BFCE → 0x0205BF62 →
`__os_sched_process` = xTaskResumeAll) asserts because
`uxSchedulerSuspended` (0x01C09758) is 0 — `os_start` zeroes it just
before the switch, so either the wrapper is entered differently on
hardware (interrupt context, which we do not model yet) or something on
the switch path is still wrong. Next items: the interrupt controller +
timer tick model (0x1EEE000 region, vector 0x020000B0,
`irq_c_dispatch`), then this assert. `--flash decrypted.bin` backs
the XIP window with the whole flash image (app.bin starts at flash
0x4120) so the `.data` tail past app.bin reads real bytes.

### Fixed by differential probes (2026-10-10)

Probes are small C programs built with the vendor clang
(`tools/probe_build.sh`); each check compares a value computed at run time
from `volatile` inputs with the same expression folded by the compiler, so a
mismatch is an emulator semantic bug. Found this way:

- `read16` at word offset 2 returned bytes 1–2 (sheared every 16-bit canvas).
- `R = R.b0 (u) #` parsed its part name at the wrong index.
- 12-bit compare immediates (6-byte `xx ff` branches and `if (R op #i) {`
  blocks): sign-extended for `==`/`!=` and the signed families, but
  **zero-extended for the unsigned families** `>=u` (1) and `>u` (4) —
  corpus: `if (r2 < 2111)` encodes 0x83F.
- 4-byte `R = R << #n` / `>> #n` read the operator at the wrong index and
  all ran as arithmetic right shifts.
- `[R+#i] <<= #n` (`6c e8`): base bits 28–31, word offset bits 18–23,
  shift bits 24–27, op bits 16–17 as in the e1 shifts.
- `fX e0` is `R = R - #h`; only `f0 e1` is the three-register multiply.
- `R = smin/smax/umin/umax(R, R) #` (`f4`) share the `e4` layout: d bits
  28–31, a bits 20–23, b bits 24–27.

Felucca's I2S words hold a 24-bit sample in the **low** bits (Q15 << 7,
`audio.c OUT_SHIFT`), not left-justified as the HAL comment says.

### Found by the decoder audit (2026-10-10, `tools/audit_decode.py`)

- `d0 e9` sp-relative pair load/store: off = bits(17,27) << 1 (bit16 = store); all 810
  corpus samples. The V13-only fit (bits(17,23)<<1 | bit24<<8) broke offsets >= 512.
- 4-byte push/pop with a register mask (`d9 e8` / `d5 e8`): registers = bits(16,31) as a
  mask; push rets first, then the registers from the highest down; pop ascending, then pc.
- 2-byte shift-by-immediate (`xx a0..`): a count field of 0 is a shift by 32.
- 2-byte `{pc, rN..} = [sp++]`: the range is min(n,4)..max(n,3), as the push's
  (`50 04` = {pc, r3-r0}).
- Interrupt nesting follows the Blackfin rule: an ISR can be interrupted only while its
  `reti` is saved on the stack.

### Remaining exec gaps (known, traced)

- goto/if branch-offset fields: printed = word offset (delta = 2*printed)
  confirmed for goto_i, but the exact multi-piece bit map (over variable
  bits 0, 4..12) still unresolved — hand sweeps failed, needs a 3+-piece
  solver run.
- `&=`/`^=` register masks, `R += R`-with-saturate variants, `d[..]`
  DPRAM pairs, fpu/acc classes — all still Unsupported (halt with class
  name, which is the intended discovery path).
