# FM-1 Recon — Phase 0

Findings from public sources, 2026-10-08. Sources listed at the bottom.

## Device identity — ESTABLISHED

- **Device**: M-VAVE FM-1 (aka Cuvave), pocket 6-operator FM synthesizer,
  ~$60–80, battery-powered, launched summer 2026.
- **SoC**: **JieLi (珠海杰理) AC791N / WL82** — established by AL-255 via
  package/SPL/SDK provenance. (The embedded `JL-BR22` string is inherited
  library nomenclature, NOT the SoC ID.)
- **CPU**: **pi32v2** — JieLi's proprietary 32-bit ISA. This is the
  instruction set we need to model. Dual-core part ("both cores" per
  lunar-modulator hardware notes).
- **Flash**: 1 MB, **XIP mapped at `0x02000000`**. Single application flash
  bank, **no recovery button, no test pads**.
- **Stock sound engine**: port of Google's **msfa** (the Dexed core) —
  6 operators, 32 algorithms, 128 presets, up to 12 voices.
- **Panel**: 240×240 display, 27 keys, 14 buttons w/ LEDs, 7 encoders,
  MASTER volume; built-in speaker + headphone jack (same line, jack mutes
  speaker); TRS MIDI **in** (MIDI out probably not wired); USB-C; BLE
  (MIDI capable, unused by most firmwares).

## Toolchain — ESTABLISHED, DOWNLOADED, VERIFIED (the "compilers exist" answer)

- **Vendor toolchain**: `jieli-linux-toolchains-20250324.1` from
  https://pkgman.jieliapp.com/s/linux-toolchain (the URL serves the XZ
  archive directly) — extracted to `reference/toolchain/`.
  Clang/LLVM 4.0.1 with `pi32`/`pi32v2`/`q32s` backends, libc/libm,
  vendor objdump/objcopy. Linux x86-64 binaries → run via
  `docker run --platform linux/amd64` (verified working on this Mac).
- **Pipeline proven end-to-end** (`tools/probe.sh`):
  - Reproduced AL-255's authoritative V13 app disassembly byte-for-byte
    (wrap app.bin in ELF `.fw` section, vendor objdump).
  - Compiled `probes/basic.c` from C → pi32v2 object → disassembly.
    Every C construct yields (source → bytes → mnemonic) triples:
    `r0 += r1` = `10 18`, `rts` = `80 00`, big imm = `c0 ff <u32le>`,
    `[--sp] = rets` / `pc = [sp++]` stack return, fused
    `if (--r1 != 0) goto` decrement-branch, `smin` as an instruction,
    `ifs (...)` signed-conditional gotos, `rep N rN { … }` hardware loops.
- **ISA flavor**: Blackfin-style algebraic assembly; variable-length
  (16/32-bit+) encodings; ELF32 machine `0xf1` (241).
- **Vendor objdump > Ghidra SLEIGH for pi32v2**: ghidra-jieli's pi32v2 is
  "very early stage" and mis-splits the `80 ff` long-call prefix
  (AL-255 doc 04). Vendor objdump is authoritative for encodings;
  SLEIGH still useful for semantics cross-checks.
- **Official SDK** (headers/peripherals, not yet fetched):
  `Jieli-Tech/fw-AC79_AIoT_SDK` (Gitee, Apache-2.0). Felucca and
  lunar-modulator both compile against it.
- **JieLi docs**: kagaimiq.github.io/jielie — community JieLi knowledge base
  (ISP, USB boot key, formats).

## Firmware + update protocol — ESTABLISHED

- Stock firmware: V15 (current, 2026-07-30); V13/V14 images preserved in
  AL-255/FM-1-RE `firmware-images/`.
- Update channel: **USB-MIDI SysEx, CRC-16 only, no cryptographic
  signature**. Version gate lives in the host updater app, not the device —
  a rebuilt package with a bumped version number installs.
- Package: `FM-1.fwsc` container (jl-misctools can parse); OTA loader can
  rewrite the flash head (`uboot.boot`, `isd_config.ini`) — bootloader-safety
  rule: keep those byte-identical to V15.
- Danger SysEx (do not send by hand): `F0 22 24 35 7D F7` drops the unit
  into mask-ROM download mode; the normal upgrade command is `...7F F7`.
- **Mask-ROM USB recovery**: device enumerates as **WL80UBOOT** (USB
  4C4A:8057). Reachable via a $4 RP2040 "USB_KEY" dongle on the USB lines
  (clock on D+; key must arrive shortly after power-up). jl-uboot-tool talks
  to it (WL82/AC791N support listed as "unknown" but a user restored a unit
  with it). FM-1-Transporter reads the full 1 MiB flash in ~3 s.

## Existing reverse engineering — EXTENSIVE

| Repo | What it gives us |
|---|---|
| `AL-255/FM-1-RE` | Architecture overview, boot chain, memory layout, OTA protocol, V13 disassembly + reassembly pipeline, function DBs, Ghidra scripts (pi32v2), firmware images. WTFPL. |
| `ip2k/lunar-modulator` | docs/01 hardware, 02 stock firmware, 03 update protocol, 07 recovery & risk, 10 USB-key dongle; `tools/fm1_identify.py` (verified on hardware); compile-only JieLi toolchain setup in `tools/jieli/`. |
| `kagaimiq/jielie` (+ jl-misctools, jl-uboot-tool, ghidra-jieli) | JieLi platform knowledge, container tools, boot tool, Ghidra module. |
| `hugelton/Felucca` | GPL-3.0 C firmware that builds with JieLi toolchain; `hal/` hardware layer = de-facto peripheral documentation (keys, knobs, display, audio, USB). Browser emulator of the same firmware (wasm). |
| `isod89/sloop-fm1`, `charlesvestal/fm1-x0x`, `zednaked/jangada` | More GPL firmwares on the same HAL lineage. |
| `kurogedelic/FM-1-transporter` | Flash read/write hardware + protocol proof. |
| Baud Girl FM-1+VA (closed) | Install page "reports testing builds on a **private FM-1 emulator**" — someone has done a subset of this project already, privately. |

## Implications for the plan

1. **Phase 1 is a mining exercise, not a black-box discovery.** pi32v2 is a
   known proprietary ISA: SDK toolchain + ghidra-jieli + AL-255's disassembly
   give encodings directly. Differential probing becomes the *validation*
   step, not the discovery step.
2. **Golden references abound**: multiple independent GPL firmwares built
   from C with the same toolchain → perfect differential test material.
3. **Peripheral docs exist in code**: Felucca's `hal/` + SDK headers.
4. **Risk to hardware can stay zero**: everything up to Phase 5 is possible
   from published firmware images; probes on real hardware are optional
   gravy (and we own a device? — confirm).

## Next actions

- [x] Clone reference repos into `reference/` (FM-1-RE, lunar-modulator,
      jl-misctools, jl-uboot-tool, ghidra-jieli, Felucca)
- [x] Obtain pi32v2 toolchain (vendor Linux toolchains 20250324.1) and
      verify compile+disasm pipeline (`tools/probe.sh`, docker amd64)
- [ ] Extract pi32v2 ISA docs/encodings → start `isa/fm1.yaml`
      (corpus: `probes/*.c` + the 211k-instruction V13 objdump)
- [ ] Fetch AC79 AIoT SDK (Gitee) for peripheral/MaskROM headers
- [ ] Get a stock V15 `FM-1.fwsc` + unpack it (jl-misctools) → `firmware/`
      (V13/V14 already in reference/FM-1-RE/firmware-images/)
- [x] Physical FM-1: ordered, not yet arrived (2026-10-08). Hardware probing
      (Phase 1.3) is deferred until it lands; all work up to Phase 5 is
      possible from published firmware images.

## Sources

- dreyandersson.com/blog/m-vave-fm-1-custom-firmware (2026-10-06)
- github.com/AL-255/FM-1-RE (README + docs)
- github.com/ip2k/lunar-modulator (README + docs map)
- github.com/hugelton/Felucca (README)
- github.com/oxcar/awesome-mwave-fm1
- kagaimiq.github.io/jielie
