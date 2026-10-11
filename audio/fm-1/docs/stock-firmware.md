# M-VAVE's stock firmware, and the second core

The emulator runs M-VAVE's own firmware (V13 and the current V15 tested) straight from its update
package, with both cores:

    fm1-live --fwsc FM-1.fwsc [--syx bank.syx]
    fm1-emu  --fwsc FM-1.fwsc --ms 5000 --keys "2500-4000:n7" --wav out.wav
    web page: "Open .fwsc…" (M-VAVE's server sends no CORS header, so the page cannot fetch it)

The package is not in the repository and the page hosts nothing: users bring their own copy.

## Booting from the package (`fm1_soc::fwsc`, `stock_from_package`)

The stock app needs more than its `app.bin`:

- **XIP** shows the app area from flash `0x4000` (directory heads at `0x02000000`, the app at
  `0x02000120`), unscrambled. Past the image the window continues into the flash chip
  (`Soc::xip_flash`, set only for package boots): the patch bank is read through it.
- **The flash chip** holds the image as stored, grown to 1 MiB.
- **r0** points at the SPL's boot parameters (`write_boot_info`): the NOR file system finds the
  flash through them.
- **The USR area** (flash `0xEA000`–`0xFC000`) holds the patches: 128 DX7 VMEM voices at
  `+0x4000`, 128 per-slot settings of 59 bytes at `+0x10000`. Updates never write it; real units
  carry the factory bank (Yamaha's ROM1A) there. A blank area gets the emulator's own small bank
  (`EMU E.PNO`, `EMU BASS`, … then `INIT VOICE`) with zeroed settings; erased settings (0xFF) leave
  only one voice sounding. `--syx` loads a DX7 32-voice bank into slots 1-32.

Every community package boots the same way with byte-identical audio, so the page boots all
firmwares from their whole package.

## What the stock firmware needed

| Missing piece | Symptom | Now |
|---|---|---|
| SPI2 (`0x11E00`) + IRQ 37 | keys ignored | the matrix columns are shifted into the 74HC595s by SPI2 DMA, one column per interrupt, at the SPI's own pace |
| `lockset` / `lockclr` | a task queued twice on a wait list, then a hang | a real lock between the cores (`Bus::hw_lock`); held by the other core, the instruction retries |
| latch clear word `0x1EEF1A4` | a pending context switch lost, a task ran on after blocking | reads 0 (the set word reads the pending bits) |
| CRC-16 unit (`0x13500`) | the USR area did not open: every directory entry failed its CRC | `[+4]` register, writes to `[+0]` feed bytes (CCITT, MSB first) |
| `idle` | 0.44x real time | waits for an interrupt: with `skip_idle`, time jumps to the next event |
| two stacks | interrupts clobbered task stacks or tasks never switched | see below |

## The stack model (`Cpu::user`)

`sp` is the stack in use; `usp` and `ssp` are registers of their own. In user mode an interrupt
saves `sp` in `usp` and continues on `ssp`; the `rti` that returns to user mode keeps `sp` in `ssp`
and continues on `usp`. In supervisor mode an interrupt stays on its stack. The SPL hands cpu0 over
in user mode (every crt0 sets `sp`, then a different `ssp`); cpu1 starts in supervisor mode (the
stock stub leaves it with `usp = ..; sp = ..; reti = ..; rti`). The stock RTOS's context switch
relies on it (`sp = usp`, save the frame, load the next task, `usp = sp`, `sp = ssp`, `rti`).
The old shortcut that made `ssp = #imm` also move `sp` gave single-stack firmwares one stack by
accident; with the old "switch at task level" rule it put their ISRs on top of the task stack.

## The second core (`fm1_soc::machine`)

cpu1 starts when cpu0 sets `0x10008` bit 3 (latched at the write: X0X and Melodee hold the bit
only briefly), at the word in `0x01C7FFF8`. It has no clock of its own: cpu0 runs in slices of
1024 instructions, then cpu1 may run as many instructions as cycles passed (idle skips included),
through `Core1Bus`, whose tick budget stops interpreted and compiled code alike. It stops early
when it is back at the same pc with the same registers (a job loop with nothing to do). Compiled
code is capped to a slice (`Periph::room_cap`): unbounded, a JIT loop waiting on cpu1 ran for up
to 2^30 instructions before cpu1 ran at all. `fm1-live` and the browser build share this code;
`fm1-emu` interleaves the cores instruction by instruction.

Users: the stock firmware (synth rendering on cpu1), X0X, Melodee 1.0.1, ChoralRoot. With two
cores the JIT and the interpreter interleave them at slightly different points, so their audio is
no longer byte-identical for those firmwares (each is deterministic); single-core firmwares are.

## Verifying

- Felucca: `fm1-live --bench 6000 --mhz 240` with `FM1_BENCH_WAV`, byte-identical to before.
- Every community firmware: bench audio against a build of the last commit (a worktree), plus a
  package boot (`--fwsc reference/firmwares/<id>.fwsc`) against the image boot.
- Stock: `fm1-emu --fwsc … --keys` with `--snap` (the LCD shows `001 EMU E.PNO`, the scope the
  wave) and the WAV's spectrum (the chord's three notes).
- Debug aids added on the way: `FM1_BREAK_PCS`, `FM1_TRACE_RANGE=a:b` (fm1-emu),
  `FM1_FWSC_DIR` (print the package directory), `FM1_FLASH_TRACE`, `FM1_AUDIO_TRACE`,
  `FM1_DUAL_TRACE`, `FM1_BENCH_TRACE` (checkpoints to diff JIT against interpreter).
