# CLAUDE.md — synthex-web

You are working on a faithful web tribute to the Elka Synthex (Mario Maggi, 1981, Italy). The complete design lives in **PLAN.md**. This file is the operational manual: read it every session.

---

## Current phase

**Phase 1 — Engine MVP.** Build a single voice that makes sound. Specifically:

- PolyBLEP sawtooth oscillator inside an `AudioWorkletProcessor`.
- One ADSR envelope on the amp.
- ZDF state-variable filter (lowpass output only for now).
- A stub UI in `packages/app/` with one button that triggers a note.
- Vitest tests using `OfflineAudioContext` that assert (a) the saw has the expected harmonic content with no significant aliasing, and (b) the filter rolls off at the right frequency.

**Out of scope for Phase 1** — do not build: panel UI, factory bank loading, layers (Upper/Lower), sync, ring mod, cross-mod, LFOs, second envelope, MIDI, sequencer, chorus/delay/reverb, patch persistence. These are scheduled in PLAN.md §8.

When Phase 1 is verified, ask before starting Phase 2.

---

## Stack decisions (already made — don't relitigate)

- **TypeScript strict mode**, no `any`, no `as` casts unless commented.
- **Vite + pnpm workspaces**. Two packages: `packages/engine/` (framework-agnostic audio core) and `packages/app/` (Svelte UI). The engine must be fully usable without the UI — UI subscribes to engine state, never the reverse.
- **AudioWorklet** for all per-sample DSP. Native Web Audio nodes only for the FX bus (DelayNode for chorus/delay, ConvolverNode for reverb).
- **Svelte 5** for UI (Phase 3+). Do not introduce React.
- **Vitest** for tests, including offline-render assertions.
- **`idb`** package for IndexedDB.

---

## Hard rules

1. **No allocations inside `process()`.** Pre-allocate every buffer in the `AudioWorkletProcessor` constructor and reuse. Profile if unsure.
2. **No per-sample parameter updates from the main thread.** Use `MessagePort.postMessage` for parameter changes; smooth them inside the worklet with one-pole filters (~5 ms time constant) to avoid zipper noise.
3. **No `localStorage` / `sessionStorage`** — IndexedDB only.
4. **Cutoff stored internally as MIDI note number**, converted to Hz at the top of each audio block (`hz = 440 * 2 ** ((note - 69) / 12)`). Makes key tracking and modulation purely additive in note-space. The conversion also reruns inside a block whenever the cutoff has moved more than half a semitone (`CUTOFF_STEP` in `dsp/voice-core.ts`): a 2 ms filter attack is shorter than a block, and holding the old coefficients for it put a click on Take-off.
5. **PWM duty cycle clamped to `[0.05, 0.95]`.** 0% or 100% = silence = bug report.
6. **No `// @ts-ignore` and no `console.log` in committed code.** Use `console.debug` behind a `DEBUG` flag if you need it.

---

## Performance budget

Target: **8 voices @ 44.1 kHz < 25 % main-thread CPU** on a 5-year-old laptop. Per voice: under 0.3 ms per 128-sample quantum.

Profile with Chrome DevTools Performance panel — the AudioWorklet thread shows as "DedicatedWorker". Don't merge a Phase if it regresses this.

---

## Patch schema is canonical

**PLAN.md §4** is the source of truth. Implement it as `packages/engine/src/patch.ts`. Two clarifications not obvious from the prose:

- `mix.crossMod` is the amount of OSC1's audio-rate signal modulating OSC2's pulse width — the Synthex's signature feature, used in the Laser Harp patch (slot 46, "Ring mod.").
- `fx.chorus.mode` is `1 | 2 | 3`, matching the original's three-position switch (rate/depth presets), not a continuous parameter.
- `modMatrix` keys are camelCase strings like `lfo1ToCutoff`, `env1ToOsc2Pitch`. Pin the union type as `ModSlot` and use `Record<ModSlot, number>` for type safety.

The provided factory bank file (`packages/engine/src/presets/factory.ts`) imports from `./patch` and must type-check once you implement the schema.

---

## Repo layout (target)

```
synthex-web/
├── CLAUDE.md
├── PLAN.md
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   └── manual-presets.png       # original manual page, for name verification
└── packages/
    ├── engine/
    │   ├── package.json
    │   ├── src/
    │   │   ├── index.ts          # public API
    │   │   ├── synth.ts          # main thread orchestration
    │   │   ├── voice.ts          # voice allocator
    │   │   ├── patch.ts          # schema (PLAN.md §4)
    │   │   ├── presets/
    │   │   │   └── factory.ts    # provided
    │   │   └── worklets/
    │   │       └── voice-processor.ts
    │   └── tests/
    └── app/
        ├── package.json
        ├── index.html
        ├── vite.config.ts
        └── src/
            ├── main.ts
            └── App.svelte
```

---

## Verification for Phase 1

Phase 1 is done when *all* of the following hold:

1. `pnpm test` passes, including the oscillator-harmonic and filter-response tests.
2. `pnpm dev` opens a page with one button. Clicking it plays an A4 (MIDI 69, 440 Hz) sawtooth through a 24 dB lowpass at note 84 (C6) with envelope `A=10ms, D=200ms, S=0.7, R=300ms`.
3. No glitches, clicks, or DC offset at note-on or note-off (visual check on an `AnalyserNode`-driven scope).
4. Aliasing check: render an A6 saw offline, FFT, assert no significant energy in the alias band above Nyquist mirror.

Stop and report when done. Don't proceed to Phase 2 unprompted.

---

## Reference materials

- **PLAN.md** — full design.
- **`packages/engine/src/presets/factory.ts`** — 80 patch names from the original manual. The 40 ROM PRESETS carry the real parameter values, decoded from the firmware EPROMs (`tools/synthex-rom/`, see its README for the record layout and which scalings are assumptions). The 40 MEMORIES are still reconstructions: the circulating cassette dumps are user banks.
- **`docs/manual-presets.png`** — original manual page 25, the authoritative preset name list.
- **Per Kristian's "All 40 Synthex presets" YouTube recording** — sonic ground truth. A/B against it when patch values feel off.
- **Vadim Zavalishin, *The Art of VA Filter Design*** — the SVF reference.
- **Välimäki & Huovilainen, *Antialiasing Oscillators in Subtractive Synthesis*** — for PolyBLEP.

---

## When stuck

Ask before guessing on Synthex-specific behavior — the manual is available and ambiguous DSP choices (PolyBLEP correction width, exact ZDF discretization, voice-stealing strategy) deserve a quick discussion before implementation.

For non-Synthex-specific TypeScript / Vite / build questions, use your judgment.
