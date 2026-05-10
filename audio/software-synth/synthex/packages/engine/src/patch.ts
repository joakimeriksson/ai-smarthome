// PLAN.md §4 — patch schema. Single source of truth, fully serializable.

export type Waveform = 'triangle' | 'sawtooth' | 'square' | 'sine' | 'noise'
export type FilterMode = 'lp24' | 'lp12' | 'bp12' | 'bp6' | 'hp12'
export type LfoShape = 'tri' | 'square' | 'sample-hold' | 'random' | 'ramp' | 'square-uni'
export type Octave = -2 | -1 | 0 | 1 | 2
export type ChorusMode = 1 | 2 | 3
export type GlideMode = 'off' | 'legato' | 'always'
export type VoiceMode = 'single' | 'split' | 'double'      // layer mode
export type KeyAssign = 'poly' | 'mono' | 'unison'         // voice allocation
export type NoiseColor = 'white' | 'pink'
export type DelayMode = 'standard' | 'tape' | 'pingpong'
export type ReverbAlgorithm = 'plate' | 'room' | 'hall' | 'galactic'
export type ArpPattern = 'up' | 'down' | 'updown' | 'random' | 'order'

export interface ADSR {
  a: number
  d: number
  s: number
  r: number
}

export type ModSlot =
  | 'lfo1ToOsc1Pitch' | 'lfo1ToOsc2Pitch' | 'lfo1ToCutoff'
  | 'lfo1ToOsc1Pwm'   | 'lfo1ToOsc2Pwm'   | 'lfo1ToAmp'
  | 'lfo2ToOsc1Pitch' | 'lfo2ToOsc2Pitch' | 'lfo2ToCutoff'
  | 'lfo2ToOsc1Pwm'   | 'lfo2ToOsc2Pwm'   | 'lfo2ToAmp'
  | 'env1ToCutoff'    | 'env1ToOsc2Pitch'
  | 'joyXToLfo1Depth' | 'joyXToLfo2Depth'
  | 'joyYToCutoff'    | 'joyYToLfoFiltDepth'
  | 'velToAmp' | 'velToCutoff' | 'velToEnv1'

// Synthex "Glide" is a per-osc one-shot attack pitch envelope (NOT
// portamento, which is `glide.time/mode` below). On every note-on, the
// oscillator's pitch starts `amount` semitones away from the target and
// decays exponentially to 0 over `speed` seconds. Either osc, both, or
// neither can have it.
export interface OscGlideParams {
  amount: number   // -32..+31 semitones, signed
  speed: number    // seconds (time-constant of exponential decay)
}

export interface Osc1Params {
  wave: Waveform
  octave: Octave
  pwm: number
  glide: OscGlideParams
}

export interface Osc2Params {
  wave: Waveform
  octave: Octave
  detune: number
  pwm: number
  sync: boolean
  glide: OscGlideParams
}

export interface MixParams {
  osc1: number
  osc2: number
  noise: number
  noiseColor: NoiseColor
  ringMod: boolean
  crossMod: number          // OSC1 → OSC2 PWM
  crossMod2: number         // OSC2 → OSC1 PWM (the other direction)
}

export interface FilterParams {
  mode: FilterMode
  cutoff: number
  resonance: number
  envAmount: number
  keyTrack: number
}

export interface LfoParams {
  shape: LfoShape
  rate: number
  sync: boolean
  delay: number
  // Synthex split-depth routing. Multipliers applied on top of the per-slot
  // mod-matrix amounts: depthA scales pitch+PWM destinations; depthB scales
  // cutoff+amp destinations. 1 = matrix amount as-is; 0 = no contribution.
  depthA: number
  depthB: number
}

export interface VelocityParams {
  amp: number
  cutoff: number
  env1: number
}

export interface GlideParams {
  time: number
  mode: GlideMode
}

export interface LayerPatch {
  osc1: Osc1Params
  osc2: Osc2Params
  mix: MixParams
  filter: FilterParams
  envFilter: ADSR
  envAmp: ADSR
  lfo1: LfoParams
  lfo2: LfoParams
  modMatrix: Record<ModSlot, number>
  velocity: VelocityParams
  glide: GlideParams
  keyAssign: KeyAssign       // poly / mono / unison
  multiTrigger: boolean      // false = legato (skip env retrigger when sustaining)
  pan: number                // -1..1 (per-layer panning)
}

export interface ChorusParams {
  enabled: boolean
  mode: ChorusMode
  mix: number
  rate: number
  depth: number
}

export interface DelayParams {
  enabled: boolean
  mode: DelayMode
  time: number
  feedback: number
  tone: number      // 0 = dark, 1 = bright (one-pole tilt on wet)
  spread: number    // 0..1 stereo offset (right delay = time × (1+spread))
  mix: number
}

export interface ReverbParams {
  enabled: boolean
  algorithm: ReverbAlgorithm
  size: number
  damping: number
  mix: number
}

export interface ArpParams {
  enabled: boolean
  pattern: ArpPattern
  range: number       // 1..4 octaves
  hold: boolean
  rate: number        // Hz (steps per second)
  gateLength: number  // 0..1 fraction of step
}

export interface ChordMemoryParams {
  enabled: boolean
  notes: number[]     // semitone offsets from the played key (root = 0)
}

export interface FxParams {
  chorus: ChorusParams
  delay: DelayParams
  reverb: ReverbParams
}

export interface MasterParams {
  tune: number
  fineTune: number
  volume: number
  polyphony: number       // 1..16
  unisonDetune: number    // 0..1 — spread between unison voices
  limiter: boolean
}

export interface Patch {
  version: 1
  name: string
  upper: LayerPatch
  lower: LayerPatch
  voiceMode: VoiceMode      // single / split / double
  splitPoint: number
  fx: FxParams              // upper-layer FX
  fxLower?: FxParams        // optional independent lower-layer FX (split/double)
  master: MasterParams
  arp?: ArpParams
  chordMemory?: ChordMemoryParams
}

// ---------------------------------------------------------------------------
// Helpers — DeepPartial + mergeDeep, used by presets/factory.ts
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends object
  ? T extends ReadonlyArray<infer _U>
    ? T
    : { [K in keyof T]?: DeepPartial<T[K]> }
  : T

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)

export function mergeDeep<T>(base: T, over: DeepPartial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(over)) {
    return (over === undefined ? base : over) as T
  }
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(over)) {
    const bv = (base as Record<string, unknown>)[key]
    const ov = (over as Record<string, unknown>)[key]
    if (ov === undefined) continue
    if (isPlainObject(bv) && isPlainObject(ov)) {
      out[key] = mergeDeep(bv, ov as DeepPartial<typeof bv>)
    } else {
      out[key] = ov
    }
  }
  return out as T
}
