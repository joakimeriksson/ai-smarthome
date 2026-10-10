# FM-1 SoC Emulator — Plan

Goal: a full instruction-set emulator of the **M-VAVE FM-1** pocket synth —
**JieLi AC791N / WL82 SoC** with a **pi32v2** CPU (JieLi's proprietary 32-bit
ISA) — CPU core(s) + SoC peripherals, accurate enough to boot the stock
firmware and run custom firmwares (Felucca, SLOOP, X0X, …) unmodified.

**Phase 0 recon is done** — see `docs/recon.md`. Headline findings:

- pi32v2 is a *known* proprietary ISA: the official AC79 AIoT SDK (Gitee,
  Apache-2.0) ships the toolchain, and kagaimiq's **ghidra-jieli** plus
  AL-255/FM-1-RE's pi32v2 Ghidra pipelines already disassemble it.
- XIP flash at `0x02000000`, 1 MB, single bank; stock engine is msfa/Dexed.
- Multiple GPL C firmwares built with the same toolchain = free golden
  references for differential testing.

---

## 0. Strategy overview

Custom firmwares exist, which means a working compiler/assembler for the target
already exists. That gives us three ground-truth sources, in order of
reliability:

1. **The toolchain + existing RE**: the AC79 SDK's pi32v2 assembler/disassembler
   tables, kagaimiq's ghidra-jieli SLEIGH spec, and AL-255's V13 disassembly
   give us instruction encodings directly.
2. **Compiled binaries**: the SDK + GPL firmwares let us compile known C/asm
   input and confirm encodings/semantics by correlating input and output —
   used here as *validation* of the mined ISA, and to fill gaps the tools miss.
3. **The real device**: deliberate probe code via the SysEx update path (or
   USB_KEY mask-ROM recovery mode) to observe semantics binaries can't reveal —
   flags behavior, cycle counts, undocumented opcodes, MMIO behavior. Optional
   until late phases; zero hardware risk before that.

We use all three: toolchain mining to bootstrap, binary diffing to validate and
fill the matrix, hardware probing to confirm semantics.

---

## 1. Phase 0 — Recon — ✅ DONE (2026-10-08)

Deliverable: `docs/recon.md`. Device, SoC, ISA family, toolchain, update
protocol, and the existing RE landscape are all established there. Remaining
recon actions (tracked in recon.md): clone reference repos, obtain the AC79
SDK and a stock V15 `.fwsc`, confirm physical device availability.

## 2. Phase 1 — ISA extraction (pi32v2)

Deliverable: `isa/fm1.yaml` — machine-readable instruction table:
mnemonic, encoding fields, operands, affected flags, cycle counts, notes.

**Status (2026-10-08): mask level DONE.** 1067 classes from ~421k
instructions across 5 corpora (V13, V14, uboot, uboot-debug, ota);
check_isa streaming decode = 0 mismatches / 0 undecodable on all.
Findings in `docs/isa-notes.md`.

**Operand level (2026-10-09): solved for most of the ISA.**
`tools/solve_slots.py` (exact linear fits over the varying bits, every
sample verified) covers 764 of 1067 classes = 86.8% of corpus
instructions (`derive.py` had 206 / 54%); `fm1-emu --coverage` lists the
remainder. 99.2% of corpus instructions execute. What worked on 2026-10-09:
**family-level fitting** — take every corpus line of one printed shape
(e.g. all 5302 `if (rN op #i) goto` lines), propose the bit fields, and
verify against all of them; five families (compare-immediate branches,
composed immediates, 4-byte ALU reg/imm/memory forms) went to 0
mismatches in one session and cover tens of thousands of instructions.
Continue that for the next families the boot hits. For sparse classes
and bits the corpus never varies, use the **assembler oracle** (2.2):
the vendor assembler is available and authoritative, so enumerate the
operand combinations per syntax and read the bytes back.

### 2.1 Toolchain mining (primary path)
- **ghidra-jieli SLEIGH spec**: if complete, this is nearly the whole ISA —
  SLEIGH semantics translate well into both our YAML and emulator pseudocode.
- **AC79 AIoT SDK toolchain**: read the pi32v2 assembler/disassembler
  (binutils/LLVM fork) opcode tables directly. Also gives relocations,
  ABI, calling convention — needed later for the GDB stub and for compiling
  probes.
- **AL-255's disassembly of V13**: a full real-firmware decode to
  cross-validate coverage: every opcode byte pattern in the stock firmware
  must decode with our table.

### 2.2 Assembler oracle + compiler probing (validation + gap filling)

**Assembler oracle (primary operand-level path).** For each syntax in
`isa/fm1.yaml`, generate assembly text sweeping each operand (every
register, immediates over the plausible range, each register-list shape),
assemble with the vendor clang (`tools/probe.sh --asm`, docker amd64,
batched thousands of lines per run), disassemble, and record
(text → bytes). One-variable-at-a-time diffs give exact bit fields,
sign-extension and scaling per syntax — no fitting ambiguity. Output
feeds `work/semantics_raw.json` → `tools/gen_isa.py` slots.

**Compiler probing.** Write minimal C/assembly snippets that each exercise
exactly one construct (compiled with the SDK toolchain):

- integer add/sub/mul/div, shifts, rotates (8/16/32-bit, signed/unsigned)
- logic ops, compares, all branch conditions, calls/returns
- loads/stores: every width × every addressing mode × offset ranges
- immediates: sweep values to find field widths and sign-extension behavior
- stack ops, special registers, supervisor/system instructions

Method:

1. Compile each snippet to a raw object/flat binary.
2. Diff binaries pairwise (one parameter changed at a time) to locate which
   bits encode the operand/opcode — the classic "one-variable-at-a-time"
   encoding extraction.
3. Record each discovered encoding row in `isa/fm1.yaml` with the probe that
   produced it (each row links to `probes/<name>.c` + expected bytes).

Automation: `tools/probe.py` compiles the whole `probes/` corpus and regenerates
a candidate encoding table; mismatches against the current YAML fail loudly.

### 2.3 Semantic confirmation on hardware
Encodings ≠ semantics. For each instruction class, build a probe firmware that:

- executes the instruction with crafted inputs,
- writes results/flags to a known memory location or UART,
- and lets us diff hardware truth vs. our assumptions.

Focus on: flag update rules (carry/overflow/zero/negative), edge cases
(shift-by-0, div-by-0, misaligned access), multiply/divide cycle counts, and any
opcode the toolchain never emits (fill the unused encoding space by executing
candidate bytes inside a fault-trapping harness and observing behavior — classic
"Opcode logger" / sandsifter-style approach, adapted to whatever fault handling
the SoC exposes).

### 2.4 Cross-check against stock firmware
Disassemble the stock firmware with the discovered ISA. A correct ISA table
yields clean, sensible disassembly: functions with proper prologues, no long
runs of unknown opcodes, branch targets landing on instruction boundaries.
Residual unknown regions = either data (find literal pools) or undiscovered
instructions (back to 2.3).

## 3. Phase 2 — Tooling

Deliverables in `tools/`:

- **Disassembler** driven by `isa/fm1.yaml` (single source of truth).

**Status (2026-10-08): started.** `fm1-isa` now contains the codegen'd
table (`tools/gen_isa.py` → `crates/fm1-isa/src/generated_isa.rs`,
regenerate after every `build_isa.py`) with a streaming decoder that
matches the Python checker's priority rules (len/popcount/count, sample
tiebreak). `fm1-core::step` fetches a 6-byte window and uses it. Pipeline:
`objdump corpora → tools/build_isa.py → isa/fm1.yaml → tools/gen_isa.py →
crates/fm1-isa/src/generated_isa.rs`. (2026-10-10: the corpora are listed in
`isa/corpora.txt`; after a re-mine run `tools/isa_stable_names.py` against the previous
yaml, `tools/solve_slots.py work/slots.json $(cat isa/corpora.txt)`, then gen_isa, and
`tools/audit_decode.py` on every listing.)

Operand layer (Python prototype first): `tools/derive.py` fits per-class
operand encodings against all corpora (437 classes fully solved, 115
partial; see `docs/isa-notes.md`); `tools/disasm.py` renders
vendor-comparable text — ~55% of all corpus instructions byte-exact,
0 undecodable. Next: exhaustive samples for sibling-mask classes, shared
formula table between fitter and renderer, +1/-1 immediates — then port
the operand spec into `gen_isa.py` + Rust formatting.
- **Assembler** — reuse the existing toolchain if redistributable; otherwise a
  small one from the same YAML, so tests can self-assemble.
- **Ghidra processor module** (SLEIGH spec) if the ISA is complex enough to
  warrant it — hugely helpful for navigating stock firmware.

## 4. Phase 3 — CPU core emulator

Deliverable: `crates/fm1-core` — an interpreter core, correctness before speed.

- Decode driven by `isa/fm1.yaml` (codegen the decoder from the YAML; never
  hand-maintain a second table).
- Interpreting fetch/decode/execute loop; exact flag semantics per Phase 1.3.
- Memory bus as a trait/interface: the core never touches peripherals directly —
  everything goes through the bus so the SoC layer owns the memory map.
- **Golden test vectors**: each probe from Phase 1 becomes a test — run the same
  bytes in the emulator, assert the hardware-observed result. CI runs the full
  corpus.
- Debugger hooks from day one: breakpoints, register/memory inspect, single
  step, and an execution trace log format we can diff against hardware traces.

## 5. Phase 4 — SoC peripherals

Deliverable: `crates/fm1-soc` — memory map + devices, added in boot-order priority.

1. Interrupt controller + reset/vector logic (needed before anything boots).
2. Clock/reset & timers (firmwares usually spin on these early).
3. UART/console — gives firmware a voice; debug output appears, boot progresses.
4. GPIO + the front-panel/display/storage devices as required by the firmware's
   boot sequence — implement lazily: log every unknown MMIO access, stub it,
   implement when the firmware actually depends on the behavior.
5. DMA, and any audio/DSP path, last (needed for full function, not for boot).

Every peripheral gets: a register map doc (`docs/peripherals/`), MMIO access
tracing (our primary reverse-engineering tool — watch what the stock firmware
touches), and unit tests where hardware behavior is known.

Unknown-access policy: log + return benign default, never silently swallow.
The access log *is* the reverse-engineering roadmap.

## 5.5 Phase 5 status — RTOS boot, dual core (2026-10-09, evening)

**The emulator runs the stock V13 firmware from reset through RTOS
start on two cores.** `fm1-emu --bin app.bin --flash decrypted.bin`:
CRT → RAM early init → clock/board init → interrupt tables → RTOS init
(dlmalloc heap, queues, mutexes) → cpu1 released (second `Cpu`, core id 1,
enters its render loop and acknowledges) → boot task created → `os_start`
enters the first task; ~370k instructions on cpu0. The task wrapper then
asserts in `xTaskResumeAll` (`uxSchedulerSuspended` is 0 — see
docs/isa-notes.md); the **interrupt controller + timer tick**
(0x1EEE000 region, IRQ vectors at 0x020000B0, `irq_c_dispatch`) is the
next piece, and the likely missing context for that assert. Verified semantics and
encodings: `docs/isa-notes.md`.

Core coverage: `fm1-emu --coverage` → 99.2% of corpus instructions by
weight execute (672 classes). Operand layouts: `tools/solve_slots.py`
(exact linear fits, corpus-verified) solves 764 classes = 86.8% of
instructions; semantics are keyed by printed shape (`exec_syntax`) with
raw-bit decoders where a class mixes encodings. Every hand-written
per-class arm that the solver covers was removed — three of them were
silently wrong.

Earlier in the day (kept for the record): the boot entry was wrong
(0x02000120 instead of the reset vector), the `0xFFC0xxxx` long-call
targets are RAM-resident `.data` code (not a mask ROM), and the 2-byte
shift / `rep` / post-increment decodes were corrupting RAM.

The SoC layer has RAM, the SRAM bank at 0x01F00000, the XIP window, the
interrupt-controller ready bit, a logged unknown-MMIO stub, and a first
ST7789-style LCD model on SPI1 (`crates/fm1-soc/src/lcd.rs`, frames
dumped to `work/lcd.bmp`) — nothing in the boot path has reached the LCD
yet.

## 5.6 Felucca runs: screen, keys, knobs, audio (2026-10-10)

**Felucca (GPL firmware, `reference/Felucca`) runs end to end.** It boots,
reads its fonts from the SPI-flash model, draws its UI on the LCD, takes
key presses and encoder turns from the modelled front panel, renders audio
in its ALNK0 interrupt, and runs its main loop with TIMER5 nesting into the
audio ISR. A scripted 7 s session (notes, a knob-driven filter sweep, PLAY)
comes out as `work/lcd_<ms>.bmp` snapshots and a 44.1 kHz WAV:

    fm1-emu --bin work/felucca_xip.bin --entry 0x02000120 --ms 7000 \
      --keys "800-1500:n7,3300:K1:-2,5200:PLAY" --wav work/demo.wav --snap 400,500,...
    tools/demo_page.py out.html     # snapshots + WAV + script -> one page

Peripherals added (`crates/fm1-soc/src/periph.rs`, `spiflash.rs`), all from
Felucca's HAL headers: SPI0 NOR flash, TIMER4 (24 MHz base) and TIMER5
(10 kHz tick) on a 240 MHz cycle clock, ALNK0 I2S double-buffered DMA,
SARADC (MASTER pot, battery), the interrupt controller (enable/priority
nibbles at 0x1EEF100, software latch 0x1EEF1A0/4, RAM vectors 0x01C7FE00,
nesting by priority), and the 2×74HC595 key matrix with 7 quadrature
encoders. The core gained interrupt entry, `sti`/`cli` and an `icfg` that
reports the active ISR levels.

CPU bugs found on the way, each pinned with a differential probe
(`probes/*.c`, built by `tools/probe_build.sh` with the vendor clang and
checked against compile-time constants): halfword reads at word offset 2,
`R = R.b0 (u) #`, 12-bit compare immediates (unsigned families
zero-extend), 4-byte `R = R << #n` executing as `>>>`, `[R+#i] <<= #n`,
`fX e0` decoded as a multiply, the flag-setting `smin/smax` forms. Probes
pass: arith 121/121, huff 139/139 (Felucca's own Huffman font decoder on
data from its own packer), lcdtest (SPI1/DMA stripes).

Speed: a decode cache plus cheap string matching took the runner from 1 M to
~17 M instructions/s, so one emulated second takes ~14 s. Live play
(host keyboard in, speakers out) needs ~1×: next steps are a per-class
pre-decoded dispatch instead of matching the printed syntax every step, and
fast-forwarding the clock through known busy-wait loops.

## 5.7 Live play at full speed (2026-10-10)

`cargo run --release -p fm1-live` plays Felucca live: a native window drawn after
Felucca's controls diagram (LCD, knobs, buttons, the 27 keys, LEDs from the firmware's LED
lines), mouse and computer keyboard input, audio through cpal, paced by the audio buffer. It
runs the FM-1's real 240 MHz at ~1.4x real time:

- interpreter: decoded-instruction cache, micro-ops for the common forms (operands and branch
  targets resolved once), straight-line blocks, interrupt delivery exact at block granularity
  (blocks stop at due ticks, peripheral writes, and the end of pairs / predicated blocks / rep
  loops), RAM/XIP fast paths, idle skipping of TIMER4 polling loops (capped at 20 us)
- JIT (`crates/fm1-core/src/jit.rs`, AArch64 macOS): hot blocks compiled to native code with
  chaining, guest state in the Cpu, inline RAM/XIP loads and stores, helpers for everything
  else that sync the clock to the exact instruction; assembler vendored from esp32sim
- verification: `fm1-live --bench MS --mhz N` with `FM1_BENCH_WAV=out.raw` must give
  byte-identical audio with the JIT, the block interpreter and `FM1_NO_BLOCKS=1` (per step);
  `tools/audit_decode.py OBJDUMP` compares every decoded instruction with the vendor
  disassembly (0 real mismatches: Felucca 92% covered, stock V13/V14 80%)

Bugs found on the way: the `d0 e9` sp pair store offset (>= 512 went to the wrong slot: stale
LED arrays, keys stayed lit), interrupt nesting (a tick between an ISR's `reti` pop and its
`rti` made the rti return to itself: now nesting only while reti is on the stack, the Blackfin
rule), the 4-byte register-mask push/pop, 2-byte shifts by 32, the `{pc, r3-rN}` pop range.

## 5.8 A selection of firmwares (2026-10-10)

All fifteen downloadable community firmwares from fm1-editor.com/firmware run: Felucca and
its forks, AMB-1, ChoralRoot, FoMni, FuMi-1, GHOULBOX, Hortator, Jangada, Melodee,
PurpleMonkey, FM1 Quest, SLOOP (+ALG), X0X. `web/firmwares.json` is the catalog;
`tools/fetch_firmwares.py` downloads the .fwsc packages and extracts each app with Felucca's
own package code (`tools/fwsc_extract.mjs`, verified byte-equal on Felucca's build).

- Browser: a firmware and a clock picker (`?fw=x0x&mhz=120`, remembered); a change reboots
  the worklet. The worklet now gets the wasm bytes (a compiled Module is a messageerror in
  the AudioWorklet scope: the page never booted in Chrome before) and reports traps.
- Native: `fm1-live --fw x0x`, `--fw list`.
- What it took: the FPU and float compares, three decoder bugs (pair modes, the extract,
  `66 e8`), an unknown-access log that shifted 8192 entries per access (FuMi polls P33), a
  JIT fall-through for branches run through the interpreter, and `[++R=-#i]` routing. The
  exercise (`FM1_BENCH_KEYS`: every button, every encoder, notes) runs 40 s on all fifteen;
  JIT == per-step audio on Felucca, X0X (playing a pattern), AMB-1, FoMni, FuMi, Melodee.
- Speed at 240 MHz native: 0.9x (X0X, GHOULBOX, PurpleMonkey) to 2.5x (Melodee). Web at
  100 MHz: 1.0x (GHOULBOX) to 2x (Melodee).
- Melodee and X0X hand audio work to core 1 when it answers; it does not here (cpu1 is not
  modelled), and both fall back to core 0.

## 6. Phase 5 — Boot & integration

- Boot stock firmware to a stable idle/main-loop state.
- Boot a known custom firmware; diff behavior against hardware (front panel
  state, UART output, displayed content).
- GDB stub over TCP (`crates/fm1-gdbstub`) so the existing toolchain's debugger works
  against the emulator — huge payoff for both using and validating the emu.

## 7. Phase 6 — Timing & validation

- Cycle counting per instruction (from Phase 1.3 measurements) — start
  instruction-accurate, refine toward cycle-accurate only where it matters
  (timer-driven code, DSP/audio loops).
- Long-running differential tests: feed identical inputs (UART scripts, panel
  events) to hardware and emulator, compare observable outputs.
- Performance pass only after correctness: decode caching / threaded dispatch
  if needed; keep the simple interpreter as the reference.

---

## Repo layout (target)

```
fm-1/
├── PLAN.md
├── docs/
│   ├── recon.md
│   ├── isa-notes.md
│   └── peripherals/
├── firmware/            # stock + custom images (gitignored)
├── isa/
│   └── fm1.yaml         # single source of truth for the ISA
├── probes/              # ISA-discovery probe sources + expected bytes
├── tools/               # probe runner, assembler, ghidra/ (Python)
└── crates/              # Rust workspace
    ├── fm1-isa/         # codegen'd decoder/disassembler from fm1.yaml
    ├── fm1-core/        # CPU interpreter + bus trait
    ├── fm1-soc/         # memory map + peripherals
    ├── fm1-gdbstub/     # GDB remote protocol
    └── fm1-emu/         # binary: runner + debugger CLI
```

## Tech choices

- **Emulator language: Rust** (decided). One Cargo workspace:
  - `crates/fm1-isa` — generated decoder/disassembler from `isa/fm1.yaml`
  - `crates/fm1-core` — CPU interpreter + bus trait
  - `crates/fm1-soc` — memory map + peripherals
  - `crates/fm1-emu` — binary: runner, debugger CLI, GDB stub
  - `crates/fm1-gdbstub` — GDB remote protocol integration
- Bus as a Rust trait (`read`/`write` by width); peripherals implement it,
  keeping the core SoC-agnostic and unit-testable.
- Rust also keeps the door open to `wasm32-unknown-unknown` later, if the
  emulator should ever run in the browser (WebAudio worklet).
- Python for tooling/probing scripts.

## Open questions

1. ~~What is the device / SoC / toolchain?~~ Answered in Phase 0 (see
   `docs/recon.md`): M-VAVE FM-1, JieLi AC791N/WL82, pi32v2, AC79 AIoT SDK.
2. ~~How complete is ghidra-jieli's pi32v2 SLEIGH?~~ "Very early stage";
   vendor objdump is the authority for encodings, and the vendor assembler
   is the oracle for operand fields (2.2). SLEIGH only as a semantics
   cross-check.
3. AC791N peripheral set: how much is documented in SDK headers vs. needs
   MMIO-log reverse engineering? (Dual-core: what runs on core 2?)
4. ~~Do we have a physical FM-1?~~ Ordered, not yet arrived (2026-10-08).
   Phase 1.3 hardware probing deferred until delivery.
5. Target accuracy: "boots and behaves right" vs. cycle-accurate audio/DSP?
   (Suggest: behavior-first, cycle counts only where the audio path needs it.)
6. Is there a real mask ROM in the boot path at all? Every "ROM" target
   seen so far is RAM-resident `.data` code. The SPL (`uboot.boot`) is the
   only code before the app; if the app never calls into
   `0xFFC0xxxx`-as-ROM, no dump is needed.
