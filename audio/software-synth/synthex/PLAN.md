# Synthex Web — Design & Implementation Plan

A faithful, browser-native tribute to the **Elka Synthex** (Mario Maggi, 1981): 8-voice DCO polysynth with multimode filter, hard sync, ring mod, cross-modulated PWM, dual LFOs, joystick mod, onboard chorus, and a 4-track sequencer.

The goal is *Synthex character*, not bit-accurate emulation. Approach the sound model the way Cherry Audio's Elka-X does: respect the architecture, allow modern affordances (velocity, unison, MIDI, wider polyphony, stereo FX).

---

## 1. Scope

### In scope (v1)
- 8-voice polyphonic synth, **two layers** (Upper/Lower) with Single / Split / Double modes.
- Per-voice signal path: 2 DCOs → mixer → multimode filter → VCA → FX bus.
- DCO features: triangle / sawtooth / square+PWM, hard sync (OSC1 → OSC2), ring mod, cross-mod (OSC1 → OSC2 PWM), noise.
- Filter: 24 dB LP, 12 dB BP, 6 dB BP, 12 dB HP — switchable, with resonance and self-oscillation.
- Two ADSR envelopes (filter + amp), bipolar filter envelope amount.
- Two LFOs (triangle / square / S&H / random), free or key-synced, routable to pitch / filter / PWM / amp.
- Joystick mod source (X/Y bipolar) + 6 routing sliders matching the original layout.
- Chorus (stereo, 2-tap, slow LFO) with original's three switch positions.
- Onboard reverb + delay (modern addition, defeatable).
- 4-track step/real-time sequencer with per-track length, transposition, sound assignment.
- Patch browser with import/export (JSON) and IndexedDB persistence.
- Computer keyboard input, on-screen keyboard, **WebMIDI in/out**.
- Velocity (modern addition, switchable on/off per layer).
- Master tune, fine tune, polyphony cap, voice stealing strategy.
- 80 named factory slots: 40 ROM PRESETS + 40 cassette MEMORIES (manual page 25).

### Out of scope (v1)
- Cassette tape patch dump emulation.
- Bit-accurate CEM3320 / SSM modeling.
- DAW plugin (CLAP/VST3) — see §10 stretch.

---

## 2. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **TypeScript** (strict) | Audio code benefits from types; large surface area. |
| Build | **Vite** | Fast, native ESM, simple worklet handling. |
| UI | **Svelte 5** | Smaller runtime, cleaner reactivity for a knob-heavy UI. |
| Audio core | **Web Audio API + AudioWorklet** | AudioWorklet is mandatory for hard sync, anti-aliased oscillators, and cross-mod. |
| DSP utilities | Hand-rolled (PolyBLEP, ZDF SVF) | Avoid heavy libs; this is the fun part. |
| MIDI | **WebMIDI API** (no library needed) | Native and sufficient. |
| Storage | **IndexedDB** via `idb` | Patch banks > localStorage limits. |
| Visualization | Canvas 2D for scope/spectrum, CSS for knobs | Avoid WebGL unless needed. |
| Tests | Vitest + offline-render harness using `OfflineAudioContext` | Render-and-FFT to assert oscillator shape, filter response, etc. |

Recommended monorepo layout:

```
synthex-web/
├── packages/
│   ├── engine/        # framework-agnostic audio core
│   │   ├── worklets/  # .ts files compiled to worklet bundles
│   │   ├── voice.ts
│   │   ├── patch.ts   # patch schema + serialization
│   │   └── synth.ts   # public API
│   └── app/           # Svelte UI
└── pnpm-workspace.yaml
```

The engine must be UI-framework-agnostic — UI subscribes to engine state, never the reverse.

---

## 3. Audio architecture

### 3.1 Worklet boundary

Put inside AudioWorklet:
- Oscillators (PolyBLEP saw/square, naive triangle, sine, noise).
- Hard sync logic (phase reset of OSC2 on OSC1 zero-crossing).
- PWM and cross-mod (OSC1 modulating OSC2 PWM).
- Ring mod (OSC1 × OSC2).
- State-Variable Filter (TPT/ZDF) — gives LP/BP/HP simultaneously, perfect for the Synthex multimode design.
- ADSR envelopes (sample-accurate).
- LFOs (sample-accurate, key-syncable).

Keep outside the worklet (use native nodes):
- Stereo chorus (DelayNode + slow OscillatorNode on delayTime).
- Reverb (ConvolverNode with a synthesized IR, or a Freeverb worklet).
- Delay (DelayNode + feedback gain).
- Master gain, oscilloscope tap (AnalyserNode).

Recommended approach: one **`SynthexVoiceProcessor`** worklet per voice, pooled. Voices live in a pool; the main thread allocates and routes via `MessagePort`. Refactor to a single all-voices worklet only if profiling demands.

### 3.2 Voice signal flow

```
            ┌─── sync ──┐
OSC1 ──────►│           │
            │   OSC2 ──►├──┐
            └───────────┘  │
                           ├── ring? ──┐
                           │           │
                           ▼           ▼
                       ┌── mixer (osc1, osc2, noise, ringOut) ──┐
                       │                                         │
                       └────► SVF filter ────► VCA ────► output ─┘
                                  ▲              ▲
                                  │              │
                              env1, lfo,      env2, vel
                              joy-Y, kbd-track
```

### 3.3 Modulation matrix

The original has fixed routings via the slider bank. Implement as a **fixed matrix** with sliders for:

| Source | Destinations available |
|---|---|
| LFO 1 | OSC1 pitch, OSC2 pitch, filter cutoff, OSC1 PWM, OSC2 PWM, amp |
| LFO 2 | OSC1 pitch, OSC2 pitch, filter cutoff, OSC1 PWM, OSC2 PWM, amp |
| Env 1 | filter cutoff (bipolar), OSC2 pitch (cross-mod approximation) |
| Env 2 | amp (always-on, scaled by velocity) |
| Joystick X | LFO1 depth, LFO2 depth (pitch) |
| Joystick Y | filter cutoff, LFO depth (filter) |
| Velocity | amp, filter cutoff, env1 amount |
| Key tracking | filter cutoff (0–100%) |

A more general mod matrix is tempting but breaks the "feels like a Synthex" goal. Keep it fixed.

### 3.4 DCO behavior notes

- DCOs are *digitally controlled* — model as perfectly tuned with a small, optional drift parameter (0–10 cents random walk per voice) for analog character.
- PWM range: 5%–50% duty cycle. Never let it hit 0% or 100% (silence).
- Cross-mod = OSC1's audio-rate output modulating OSC2's pulse width. Implement as: `osc2_duty = base_duty + crossmod_amount * osc1_signal * 0.45`. Clamp.
- Hard sync: when OSC1 phase wraps past 1.0, force OSC2 phase to 0 (or to a phase offset for "soft sync"). PolyBLEP correction is needed at the reset point to avoid aliasing.

### 3.5 Filter

State-Variable Filter, ZDF / TPT topology (Vadim Zavalishin). Gives LP, BP, HP outputs from one structure and is stable up to self-oscillation. The Synthex's 6 dB BP is just the BP output without resonance compensation; the 24 dB LP can be cascaded LP×LP if you want the steeper slope, otherwise a single 12 dB SVF is fine for v1.

Resonance: 0–1 mapped to Q. Self-oscillates around 0.97. Compensate output gain at high resonance (drop the input mix) so the filter doesn't dominate.

Cutoff: store as note number internally (semitones from C-1). Convert to Hz at the top of the audio block. Makes key tracking and LFO modulation trivially additive.

---

## 4. Patch schema

Single source of truth. Everything serializable.

```ts
type Waveform = 'triangle' | 'sawtooth' | 'square' | 'sine' | 'noise';
type FilterMode = 'lp24' | 'lp12' | 'bp12' | 'bp6' | 'hp12';
type LfoShape = 'tri' | 'square' | 'sample-hold' | 'random';
type Octave = -2 | -1 | 0 | 1 | 2;
type ChorusMode = 1 | 2 | 3;        // original's 3-position switch
type GlideMode = 'off' | 'legato' | 'always';

interface ADSR { a: number; d: number; s: number; r: number }

type ModSlot =
  | 'lfo1ToOsc1Pitch' | 'lfo1ToOsc2Pitch' | 'lfo1ToCutoff'
  | 'lfo1ToOsc1Pwm'   | 'lfo1ToOsc2Pwm'   | 'lfo1ToAmp'
  | 'lfo2ToOsc1Pitch' | 'lfo2ToOsc2Pitch' | 'lfo2ToCutoff'
  | 'lfo2ToOsc1Pwm'   | 'lfo2ToOsc2Pwm'   | 'lfo2ToAmp'
  | 'env1ToCutoff'    | 'env1ToOsc2Pitch'
  | 'joyXToLfo1Depth' | 'joyXToLfo2Depth'
  | 'joyYToCutoff'    | 'joyYToLfoFiltDepth'
  | 'velToAmp' | 'velToCutoff' | 'velToEnv1';

interface LayerPatch {
  osc1: { wave: Waveform; octave: Octave; pwm: number /*0..1*/ };
  osc2: { wave: Waveform; octave: Octave; detune: number /*cents*/; pwm: number; sync: boolean };
  mix:  { osc1: number; osc2: number; noise: number; ringMod: boolean; crossMod: number };
  filter: { mode: FilterMode; cutoff: number /*0..1*/; resonance: number; envAmount: number /*-1..1*/; keyTrack: number };
  envFilter: ADSR;
  envAmp:    ADSR;
  lfo1: { shape: LfoShape; rate: number; sync: boolean; delay: number };
  lfo2: { shape: LfoShape; rate: number; sync: boolean; delay: number };
  modMatrix: Record<ModSlot, number>;
  velocity: { amp: number; cutoff: number; env1: number };
  glide: { time: number; mode: GlideMode };
}

interface ChorusParams { enabled: boolean; mode: ChorusMode; mix: number; rate: number; depth: number }
interface DelayParams  { enabled: boolean; time: number; feedback: number; mix: number }
interface ReverbParams { enabled: boolean; size: number; damping: number; mix: number }

interface Patch {
  version: 1;
  name: string;
  upper: LayerPatch;
  lower: LayerPatch;
  voiceMode: 'single' | 'split' | 'double';
  splitPoint: number;     // MIDI note
  fx: { chorus: ChorusParams; delay: DelayParams; reverb: ReverbParams };
  master: { tune: number; fineTune: number; volume: number; polyphony: number /*1..16*/ };
}
```

Patches are JSON. A bank is `Patch[]`. The factory file ships **80 named slots** matching the original manual page 25: 40 ROM PRESETS (Bank 1–4 × Program 0–9) plus 40 cassette MEMORIES.

Hardware addressing: `Bank * 10 + Program`. So slot 46 = Bank 4 / Program 6 = "Ring mod." (Wiffen's Laser Harp).

---

## 5. UI / UX

### 5.1 Layout

The original's panel is iconic. Stay close to it: slanted strip layout with sections (LFO, DCO1, DCO2, Filter, Envelopes, Modulation, Joystick area, Sequencer, Master) reading left-to-right. Labels accurate, no decorative noise.

```
┌──────────────────────────────────────────────────────────────┐
│ [Patch browser]  [Voice mode]  [Display: patch name + value]  │
├──────────────────────────────────────────────────────────────┤
│ LFO1 │ LFO2 │ DCO1 │ DCO2 │ MIX │ FILTER │ ENV1 │ ENV2 │ FX  │
├──────────────────────────────────────────────────────────────┤
│ MOD MATRIX (6 sliders)  │  JOYSTICK  │  SEQUENCER (4 tracks) │
├──────────────────────────────────────────────────────────────┤
│ Keyboard (5 octaves, scrollable)                              │
└──────────────────────────────────────────────────────────────┘
```

Two visual modes:
1. **Vintage** — cream panel, orange Synthex screenprinted look, recessed knobs. Use SVG knob graphics, not 3D.
2. **Dark** — flat modern theme for those who prefer it.

### 5.2 Knob/slider behavior

- Drag vertical to change value. **Shift = fine** (×0.25). **Cmd/Ctrl = coarse** (×4). Double-click = default. Right-click = MIDI learn.
- Show numeric value in a central display (one shared readout) while dragging — like the original's two-digit display approach.
- All controls keyboard-accessible (arrow keys, Page Up/Dn for ×10).

### 5.3 Keyboard

- Computer keyboard mapping: `awsedftgyhujk` for chromatic, `z`/`x` for octave shift.
- Onscreen keyboard supports touch + mouse, shows held notes, shows split point as a colored line.
- WebMIDI: device picker, channel filter, program-change → patch select.

### 5.4 Sequencer

Four tracks, monophonic (matching the original). Per track: length (1–16 steps in v1, 1–64 in v2), step grid with note + accent + tie + rest, source layer assignment (Upper/Lower). Real-time record from MIDI/computer keyboard. Transposition by playing on the keyboard during playback (as in the original).

### 5.5 Accessibility

- All controls have `aria-label` and announce values.
- Color is not the only indicator (use shape/text too).
- Respect `prefers-reduced-motion` (no pulsing LEDs, etc.).

---

## 6. State management

- Single store (Svelte 5 runes) for patch state.
- Engine subscribes to patch changes and pushes parameter updates to worklet via `MessagePort`. Use a **smoothed parameter system** (~5 ms time constant) inside the worklet to avoid zipper noise; never send per-sample updates from the main thread.
- A separate, transient store for "live" state (held notes, joystick position, scope data, MIDI activity).
- Undo/redo on patch edits using a small history ring (last 50 changes).

---

## 7. Performance budget

- Target: 8 voices @ 44.1 kHz on a 5-year-old laptop, < 25 % main-thread CPU.
- Worklet processes 128 samples per quantum. Stay under ~0.3 ms per voice per quantum on midrange hardware.
- Avoid allocations inside `process()`. Pre-allocate all scratch buffers in the constructor.
- Voice stealing: oldest released voice → oldest playing voice. Surface the strategy as a setting.

---

## 8. Implementation phases

**Phase 1 — Engine MVP (1–2 weeks)**
- AudioWorklet with one oscillator (PolyBLEP saw), envelope, ZDF SVF lowpass.
- Single voice, fixed patch, on-screen button triggers note.
- OfflineAudioContext tests asserting oscillator shape and filter response.

**Phase 2 — Synth core**
- Second oscillator + sync + ring + cross-mod.
- Voice pool (8 voices), allocator, voice stealing.
- Both envelopes, both LFOs, mod matrix.
- Patch schema fully implemented + load/save to IndexedDB.
- Factory bank loads (40 PRESETS audible).

**Phase 3 — UI**
- Knob component, panel sections, patch browser (with bank/program addressing).
- Computer keyboard + on-screen keyboard.
- Single voice mode only (no Split/Double yet).

**Phase 4 — Multitimbral & FX**
- Upper/Lower layers, Single/Split/Double.
- Chorus (3-mode), delay, reverb.
- WebMIDI in/out.

**Phase 5 — Sequencer**
- Step editor, real-time record, transposition.
- Tempo sync (internal clock; MIDI clock in v2).

**Phase 6 — Polish**
- 40 cassette MEMORIES authored.
- Vintage theme.
- Accessibility audit.
- Performance pass.

---

## 9. Testing

- **Unit**: patch schema validation, mod matrix math, envelope curves.
- **Audio render**: OfflineAudioContext + FFT to assert (a) oscillator harmonic content, (b) filter cutoff/Q response, (c) envelope timing.
- **Aliasing**: render a high-note saw, FFT, assert no significant energy above Nyquist mirror.
- **Manual A/B**: against Per Kristian's "All 40 Synthex presets" recording, and Cherry Audio Elka-X / Arturia SynthX V where useful.

---

## 10. Stretch goals

- **CLAP/VST3 export** via WebAudioModules → CLAP wrapper, or rewrite engine in C++ with the same patch format.
- **Patch sharing** via URL fragment (base64'd patch JSON).
- **Multiplayer** jam mode (CRDT over WebRTC — overkill but fun).
- **Joystick hardware** support via WebHID.
- **MPE** input.
- **Microtuning** (Scala .scl/.kbm).
- **Cassette decoder** — Python or browser-side FSK demod of the original cassette dump, recovering authentic parameter bytes.

---

## 11. References

- Elka Synthex User's Manual (page 25 = preset name list).
- Vadim Zavalishin, *The Art of VA Filter Design* — for the SVF.
- Välimäki & Huovilainen, *Antialiasing Oscillators in Subtractive Synthesis* — for PolyBLEP.
- Cherry Audio Elka-X manual — for modern feature additions to consider.
- Per Kristian's "All 40 Synthex presets" YouTube recording — sonic ground truth.
- JMJ *Rendez-Vous* (1986) — sonic reference for the laser harp patch (slot 46, "Ring mod.").

---

## 12. Open questions

1. **Authentic 4-track sequencer** (monophonic, original-style) or **modern step sequencer** (polyphonic per track, automation lanes)? Currently scoped as authentic-mono in v1.
2. **Velocity on by default**, or off by default to honor the original? Currently scoped off-by-default (original had no velocity).
3. **MIDI clock** sync in v1 or v2? Currently v2.
4. **Hosted demo** plan — GitHub Pages is fine for static, but worklets need correct MIME types; Cloudflare Pages or Netlify often easier.
5. **Cassette `.wav` decoder** — author parameters by ear, or invest in the FSK demodulator first? Currently scoped as v2 (parameters by ear in v1).
