// The studio's effects, as the mixer, the UI, the project file and the
// offline renderer see them: which effects exist, their parameters (range,
// default, unit), their presets, and the default return buses.
//
// The DSP itself is public/fx/fx-dsp.js (run in an AudioWorklet by
// public/fx/fx-processor.js, and in Node by scripts/render-song.ts).
// tests/fx.test.ts holds the parameter names here and there together.
//
// Deliberately free of runtime imports, so the renderer can use it in Node.

export type FxKind =
  | 'chorus' | 'ensemble' | 'flanger' | 'phaser' | 'tremolo'
  | 'autofilter' | 'drive' | 'lofi' | 'scatter'
  | 'delay'
  | 'plate' | 'hall' | 'room' | 'gated' | 'shimmer'

export interface FxParamSpec {
  id: string
  label: string
  min: number
  max: number
  step: number
  def: number
  unit?: string
  /** Log-scaled control (frequencies, times). */
  log?: boolean
  /** An enum: the value is an index into these labels. */
  options?: string[]
  /** One cell of a step pattern: the editor draws these as a 16-step row. */
  group?: 'steps'
}

export interface FxDef {
  kind: FxKind
  name: string
  family: FxFamily
  params: FxParamSpec[]
  /** Named settings; parameters not listed keep the effect's defaults. */
  presets: { name: string; params: Record<string, number> }[]
}

export type FxFamily = 'modulation' | 'filter' | 'character' | 'performance' | 'delay' | 'reverb'

/** Menu order and headings. */
export const FX_FAMILIES: { family: FxFamily; label: string }[] = [
  { family: 'modulation', label: 'Modulation' },
  { family: 'filter', label: 'Filter' },
  { family: 'character', label: 'Drive & lo-fi' },
  { family: 'performance', label: 'Performance' },
  { family: 'delay', label: 'Delay' },
  { family: 'reverb', label: 'Reverb' },
]

/** One slot as the project file stores it. Missing params take the defaults. */
export interface FxSlotSpec {
  kind: FxKind
  params?: Record<string, number>
  bypass?: boolean
  preset?: string
}

/** Where a slot lives: an insert (on a track or the master) or a return. */
export type FxContext = 'insert' | 'return'

export const DELAY_DIVISION_LABELS = ['1/32', '1/16T', '1/16', '1/16D', '1/8T', '1/8', '1/8D', '1/4T', '1/4', '1/4D', '1/2', '1/2D', '1 bar']
/** One LFO cycle per (fx-dsp.js LFO_DIVISIONS). */
export const LFO_DIVISION_LABELS = ['1/16', '1/8', '1/4', '1/2', '1 bar', '2 bars', '4 bars', '8 bars']
/** fx-dsp.js lfoAt's shapes, in its order. */
export const LFO_SHAPES = ['Sine', 'Triangle', 'Square', 'Ramp down', 'Ramp up', 'S&H']
/** fx-dsp.js SHIMMER_INTERVALS. */
export const SHIMMER_INTERVAL_LABELS = ['+12 octave', '+7 fifth', '+5 fourth', '+19 octave+5th', '+24 two oct', '-12 octave down']

const mix = (def: number): FxParamSpec => ({ id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def })

/** fx-dsp.js SCATTER_TYPES, as the step menu names them... */
export const SCATTER_STEP_LABELS = ['— (play)', 'Loop 1/8', 'Loop 1/16', 'Roll 1/32', 'Roll 1/32T', 'Roll 1/64',
  'Reverse', 'Gate', 'Mute', 'Half speed', 'Tape stop', 'Double speed']
/** ...and as a step cell shows them. */
export const SCATTER_STEP_SHORT = ['·', 'L8', 'L16', 'R32', 'R3T', 'R64', 'REV', 'GAT', 'MUT', '½', 'STP', '×2']
/** fx-dsp.js SCATTER_SPEEDS. */
export const SCATTER_SPEED_LABELS = ['1/8', '1/16', '1/32']

// Step types by index, for writing patterns.
const [P, L8, L16, R32, R3T, R64, REV, GAT, MUT, HLF, STP, DBL] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
/** A 16-step pattern as preset params s1..s16. */
const pattern = (steps: number[]): Record<string, number> =>
  Object.fromEntries(steps.map((v, i) => [`s${i + 1}`, v]))
const SCATTER_DEFAULT = [P, P, P, P, P, P, P, P, P, P, P, P, L16, L16, R32, R64]

/** Rate, sync, note value and shape: every LFO-driven effect's first four. */
const lfo = (rate: number, sync: number, division: number, shape: number): FxParamSpec[] => [
  { id: 'rate', label: 'Rate', min: 0.02, max: 20, step: 0.001, def: rate, unit: 'Hz', log: true },
  { id: 'sync', label: 'Sync', min: 0, max: 1, step: 1, def: sync, options: ['Free', 'Tempo'] },
  { id: 'division', label: 'Note', min: 0, max: LFO_DIVISION_LABELS.length - 1, step: 1, def: division, options: LFO_DIVISION_LABELS },
  { id: 'shape', label: 'LFO', min: 0, max: LFO_SHAPES.length - 1, step: 1, def: shape, options: LFO_SHAPES },
]
const spread = (def: number): FxParamSpec => ({ id: 'spread', label: 'Stereo', min: 0, max: 180, step: 1, def, unit: '°' })

const REVERB_COMMON: FxParamSpec[] = [
  { id: 'predelay', label: 'Pre-delay', min: 0, max: 250, step: 1, def: 20, unit: 'ms' },
  { id: 'decay', label: 'Decay', min: 0.3, max: 15, step: 0.05, def: 2.8, unit: 's', log: true },
  { id: 'size', label: 'Size', min: 0.3, max: 2, step: 0.01, def: 1.2 },
  { id: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.45 },
]

export const FX_DEFS: FxDef[] = [
  {
    kind: 'chorus', name: 'Chorus', family: 'modulation',
    params: [
      { id: 'rate', label: 'Rate', min: 0.05, max: 10, step: 0.001, def: 0.513, unit: 'Hz', log: true },
      { id: 'depth', label: 'Depth', min: 0, max: 8, step: 0.01, def: 3.6, unit: 'ms' },
      { id: 'delay', label: 'Delay', min: 0.5, max: 25, step: 0.01, def: 3.35, unit: 'ms', log: true },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.9, step: 0.01, def: 0 },
      { id: 'tone', label: 'Tone', min: 1000, max: 18000, step: 10, def: 7500, unit: 'Hz', log: true },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      { id: 'shape', label: 'LFO', min: 0, max: 1, step: 1, def: 0, options: ['Triangle', 'Sine'] },
      mix(0.5),
    ],
    // The Juno-60's two BBD chorus modes and both at once, as measured on
    // the hardware (0.513 / 0.863 Hz over 1.54-5.15 ms; 9.75 Hz shallow).
    presets: [
      { name: 'Juno I', params: { rate: 0.513, depth: 3.61, delay: 3.35 } },
      { name: 'Juno II', params: { rate: 0.863, depth: 3.61, delay: 3.35 } },
      { name: 'Juno I+II', params: { rate: 9.75, depth: 0.34, delay: 3.39 } },
      { name: 'Dimension', params: { rate: 0.25, depth: 1.2, delay: 8, shape: 1, mix: 0.35, tone: 12000 } },
      { name: 'Slow & wide', params: { rate: 0.2, depth: 5, delay: 12, shape: 1, tone: 11000 } },
      { name: 'Flanger', params: { rate: 0.15, depth: 3, delay: 1.2, feedback: 0.7, shape: 1, tone: 14000 } },
    ],
  },
  {
    kind: 'ensemble', name: 'Ensemble', family: 'modulation',
    params: [
      { id: 'rate', label: 'Rate', min: 0.1, max: 3, step: 0.01, def: 0.63, unit: 'Hz', log: true },
      { id: 'depth', label: 'Depth', min: 0, max: 6, step: 0.01, def: 2.2, unit: 'ms' },
      { id: 'shimmer', label: 'Shimmer', min: 0, max: 1, step: 0.01, def: 0.24, unit: 'ms' },
      { id: 'shimmerRate', label: 'Shimmer rate', min: 2, max: 10, step: 0.1, def: 6.1, unit: 'Hz' },
      { id: 'delay', label: 'Delay', min: 2, max: 15, step: 0.1, def: 6, unit: 'ms' },
      { id: 'tone', label: 'Tone', min: 1000, max: 16000, step: 10, def: 9000, unit: 'Hz', log: true },
      mix(0.55),
    ],
    presets: [
      { name: 'String ensemble', params: {} },
      { name: 'Lush', params: { depth: 3.5, shimmer: 0.35, mix: 0.65 } },
      { name: 'Subtle', params: { depth: 1.2, shimmer: 0.12, mix: 0.4 } },
    ],
  },
  {
    kind: 'flanger', name: 'Flanger', family: 'modulation',
    params: [
      ...lfo(0.2, 0, 5, 1),
      { id: 'manual', label: 'Manual', min: 0.1, max: 10, step: 0.01, def: 2, unit: 'ms', log: true },
      { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.7 },
      { id: 'feedback', label: 'Feedback', min: -0.95, max: 0.95, step: 0.01, def: 0.5 },
      { id: 'tzf', label: 'Through-zero', min: 0, max: 1, step: 1, def: 0, options: ['Off', 'On'] },
      spread(90),
      mix(0.5),
    ],
    // Negative feedback inverts the swept signal ("negative flanging"); in
    // through-zero mode that makes the full cancellation at the crossing.
    presets: [
      { name: 'Jet', params: { rate: 0.12, manual: 1.5, depth: 0.9, feedback: 0.75, spread: 30 } },
      { name: 'Negative', params: { rate: 0.25, manual: 2, depth: 0.7, feedback: -0.7 } },
      { name: 'Through-zero', params: { tzf: 1, manual: 3, depth: 1, feedback: 0.2, rate: 0.15 } },
      { name: 'Through-zero inverted', params: { tzf: 1, manual: 3, depth: 1, feedback: -0.3, rate: 0.15 } },
      { name: 'Synced 2 bars', params: { sync: 1, division: 5, feedback: 0.6, depth: 0.8 } },
      { name: 'Metallic', params: { rate: 0.4, manual: 0.6, depth: 0.3, feedback: 0.9 } },
      { name: 'Wide', params: { rate: 0.2, feedback: 0.5, spread: 180 } },
    ],
  },
  {
    kind: 'phaser', name: 'Phaser', family: 'modulation',
    params: [
      ...lfo(0.4, 0, 4, 0),
      { id: 'center', label: 'Center', min: 100, max: 5000, step: 1, def: 800, unit: 'Hz', log: true },
      { id: 'depth', label: 'Depth', min: 0, max: 4, step: 0.01, def: 2, unit: 'oct' },
      { id: 'feedback', label: 'Feedback', min: -0.9, max: 0.9, step: 0.01, def: 0.3 },
      { id: 'stages', label: 'Stages', min: 0, max: 3, step: 1, def: 0, options: ['4', '6', '8', '12'] },
      spread(90),
      mix(0.5),
    ],
    presets: [
      { name: 'Phase 90', params: { stages: 0, rate: 0.5, feedback: 0, center: 700, depth: 1.8, spread: 0 } },
      { name: 'Small Stone', params: { stages: 0, rate: 0.3, feedback: 0.65, center: 900, depth: 2.2, spread: 0 } },
      { name: 'Bi-Phase', params: { stages: 1, rate: 0.15, feedback: 0.4, depth: 2.5, spread: 90 } },
      { name: 'Deep 12-stage', params: { stages: 3, rate: 0.08, feedback: 0.5, depth: 2.4 } },
      { name: 'Synced bar sweep', params: { sync: 1, division: 4, stages: 2, feedback: 0.45 } },
      { name: 'Fast warble', params: { rate: 5.5, depth: 0.6, stages: 0, feedback: 0.2, spread: 120 } },
    ],
  },
  {
    kind: 'tremolo', name: 'Tremolo', family: 'modulation',
    params: [
      ...lfo(5, 0, 2, 0),
      { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, def: 0.6 },
      spread(0),
      { id: 'smooth', label: 'Smooth', min: 0.1, max: 30, step: 0.1, def: 2, unit: 'ms', log: true },
      mix(1),
    ],
    // Stereo 180 degrees is an equal-power auto-pan.
    presets: [
      { name: 'Amp tremolo', params: { rate: 5.5, depth: 0.55, shape: 0 } },
      { name: 'Auto-pan 1/4', params: { sync: 1, division: 2, depth: 1, spread: 180 } },
      { name: 'Slow pan', params: { sync: 1, division: 5, depth: 0.8, spread: 180 } },
      { name: 'Stutter 1/16', params: { sync: 1, division: 0, shape: 2, depth: 1, smooth: 1 } },
      { name: 'Helicopter', params: { rate: 11, shape: 1, depth: 0.9 } },
    ],
  },
  {
    kind: 'autofilter', name: 'Auto-filter', family: 'filter',
    params: [
      { id: 'type', label: 'Type', min: 0, max: 3, step: 1, def: 0, options: ['Lowpass', 'Bandpass', 'Highpass', 'Notch'] },
      { id: 'cutoff', label: 'Cutoff', min: 30, max: 15000, step: 1, def: 600, unit: 'Hz', log: true },
      { id: 'resonance', label: 'Resonance', min: 0, max: 1, step: 0.01, def: 0.5 },
      ...lfo(0.5, 1, 4, 0),
      { id: 'lfoDepth', label: 'LFO depth', min: -4, max: 4, step: 0.01, def: 2, unit: 'oct' },
      { id: 'envDepth', label: 'Env depth', min: -5, max: 5, step: 0.01, def: 0, unit: 'oct' },
      { id: 'sensitivity', label: 'Sensitivity', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'attack', label: 'Attack', min: 0.5, max: 200, step: 0.1, def: 5, unit: 'ms', log: true },
      { id: 'release', label: 'Release', min: 10, max: 2000, step: 1, def: 150, unit: 'ms', log: true },
      spread(0),
      mix(1),
    ],
    presets: [
      { name: 'Synced LP sweep', params: {} },
      { name: 'Auto-wah', params: { type: 1, cutoff: 300, resonance: 0.6, lfoDepth: 0, envDepth: 3.5, sensitivity: 0.6, attack: 5, release: 120 } },
      { name: 'Random S&H', params: { type: 0, cutoff: 800, resonance: 0.7, lfoDepth: 2.5, shape: 5, sync: 1, division: 0 } },
      { name: 'Dub HP sweep', params: { type: 2, cutoff: 200, resonance: 0.3, lfoDepth: 2.5, sync: 1, division: 6 } },
      { name: 'Talking', params: { type: 1, cutoff: 500, resonance: 0.8, lfoDepth: 0, envDepth: 2, sensitivity: 0.8 } },
      { name: 'Wide wobble', params: { cutoff: 500, resonance: 0.55, lfoDepth: 2, sync: 1, division: 1, spread: 90 } },
    ],
  },
  {
    kind: 'drive', name: 'Drive', family: 'character',
    params: [
      { id: 'type', label: 'Type', min: 0, max: 2, step: 1, def: 0, options: ['Tape', 'Tube', 'Fuzz'] },
      { id: 'drive', label: 'Drive', min: 0, max: 40, step: 0.1, def: 9, unit: 'dB' },
      { id: 'tone', label: 'Tone', min: 1000, max: 20000, step: 10, def: 12000, unit: 'Hz', log: true },
      { id: 'output', label: 'Output', min: -24, max: 12, step: 0.1, def: 0, unit: 'dB' },
      mix(1),
    ],
    // Loudness-matched: the Drive knob changes the colour, Output the level.
    presets: [
      { name: 'Tape warmth', params: { type: 0, drive: 6, tone: 12000 } },
      { name: 'Tube crunch', params: { type: 1, drive: 15, tone: 9000 } },
      { name: 'Fuzz', params: { type: 2, drive: 30, tone: 5000 } },
      { name: 'Bus glue', params: { type: 0, drive: 3, tone: 16000, mix: 0.6 } },
    ],
  },
  {
    kind: 'lofi', name: 'Lo-Fi', family: 'character',
    params: [
      { id: 'rate', label: 'Sample rate', min: 500, max: 48000, step: 10, def: 26040, unit: 'Hz', log: true },
      { id: 'bits', label: 'Bits', min: 2, max: 16, step: 0.5, def: 12, unit: 'bit' },
      { id: 'antialias', label: 'Anti-alias', min: 0, max: 1, step: 1, def: 0, options: ['Off', 'On'] },
      { id: 'drive', label: 'Drive', min: 0, max: 24, step: 0.1, def: 0, unit: 'dB' },
      { id: 'noise', label: 'Hiss', min: -96, max: -24, step: 0.5, def: -96, unit: 'dB' },
      { id: 'tone', label: 'Tone', min: 1000, max: 20000, step: 10, def: 14000, unit: 'Hz', log: true },
      mix(1),
    ],
    presets: [
      { name: 'SP-1200', params: { rate: 26040, bits: 12, antialias: 0, tone: 14000 } },
      { name: 'Fairlight 8-bit', params: { rate: 24000, bits: 8, antialias: 1, tone: 10000 } },
      { name: 'C64 digi', params: { rate: 7800, bits: 4, antialias: 0, tone: 6000 } },
      { name: 'Telephone', params: { rate: 8000, bits: 8, antialias: 1, tone: 3400, drive: 6 } },
      { name: 'Crushed', params: { rate: 4000, bits: 5, drive: 12, tone: 9000 } },
      { name: 'Tape hiss', params: { rate: 48000, bits: 16, noise: -50, tone: 9000 } },
    ],
  },
  {
    kind: 'scatter', name: 'Scatter', family: 'performance',
    params: [
      ...SCATTER_DEFAULT.map((def, i): FxParamSpec => ({
        id: `s${i + 1}`, label: `Step ${i + 1}`, min: 0, max: SCATTER_STEP_LABELS.length - 1, step: 1, def,
        options: SCATTER_STEP_LABELS, group: 'steps',
      })),
      { id: 'speed', label: 'Step length', min: 0, max: 2, step: 1, def: 1, options: SCATTER_SPEED_LABELS },
      mix(1),
    ],
    // Consecutive steps of one type are one run: a loop or roll plays its
    // first slice live and repeats it for the rest of the run. The first
    // eight are the studio's scatter pads, in order (SCATTER_PADS).
    presets: [
      { name: 'Stutter fill', params: pattern(SCATTER_DEFAULT) },
      { name: 'Build-up', params: pattern([P, P, P, P, P, P, P, P, L16, L16, L16, L16, R32, R32, R64, R64]) },
      { name: 'Beat repeat', params: pattern([P, P, L16, L16, P, P, P, P, P, P, L16, L16, P, P, R32, R32]) },
      { name: 'Reverse fill', params: pattern([P, P, P, P, P, P, P, P, P, P, P, P, REV, REV, REV, REV]) },
      { name: 'Rewind', params: pattern([P, P, P, P, P, P, P, P, REV, REV, REV, REV, DBL, DBL, DBL, DBL]) },
      { name: 'Trance gate', params: pattern([GAT, GAT, P, GAT, GAT, P, GAT, GAT, GAT, GAT, P, GAT, GAT, P, GAT, P]) },
      { name: 'Tape stop', params: pattern([P, P, P, P, P, P, P, P, STP, STP, STP, STP, STP, STP, STP, STP]) },
      { name: 'Half-time', params: pattern(new Array<number>(16).fill(HLF)) },
      { name: 'Eighth loop', params: pattern([L8, L8, L8, L8, L8, L8, L8, L8, P, P, P, P, P, P, P, P]) },
      { name: 'Triplet rolls', params: pattern([P, P, P, P, R3T, R3T, P, P, P, P, P, P, R3T, R3T, R3T, R3T]) },
      { name: 'Chop', params: pattern([P, MUT, P, P, MUT, P, P, MUT, P, MUT, P, P, MUT, P, MUT, MUT]) },
      { name: 'Glitch', params: pattern([P, P, R32, R32, REV, REV, P, R64, L16, L16, P, GAT, MUT, DBL, DBL, R64]) },
      { name: 'Machine gun', params: pattern(new Array<number>(16).fill(R32)) },
    ],
  },
  {
    kind: 'delay', name: 'Delay', family: 'delay',
    params: [
      { id: 'sync', label: 'Sync', min: 0, max: 1, step: 1, def: 1, options: ['Free', 'Tempo'] },
      { id: 'division', label: 'Note', min: 0, max: DELAY_DIVISION_LABELS.length - 1, step: 1, def: 6, options: DELAY_DIVISION_LABELS },
      { id: 'time', label: 'Time', min: 1, max: 2000, step: 1, def: 375, unit: 'ms', log: true },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01, def: 0.35 },
      { id: 'pingpong', label: 'Ping-pong', min: 0, max: 1, step: 1, def: 0, options: ['Off', 'On'] },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 2000, step: 1, def: 200, unit: 'Hz', log: true },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 7000, unit: 'Hz', log: true },
      { id: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.01, def: 0.1 },
      mix(0.25),
    ],
    presets: [
      { name: 'Dotted eighth', params: { division: 6, feedback: 0.38 } },
      { name: 'Quarter ping-pong', params: { division: 8, pingpong: 1, feedback: 0.45 } },
      { name: 'Slapback', params: { sync: 0, time: 90, feedback: 0.08, highcut: 5000 } },
      { name: 'Tape echo', params: { division: 8, feedback: 0.5, wobble: 0.6, highcut: 3500, lowcut: 300 } },
    ],
  },
  {
    kind: 'plate', name: 'Plate', family: 'reverb',
    params: [
      { id: 'predelay', label: 'Pre-delay', min: 0, max: 250, step: 1, def: 10, unit: 'ms' },
      { id: 'decay', label: 'Decay', min: 0.3, max: 15, step: 0.05, def: 2.2, unit: 's', log: true },
      { id: 'size', label: 'Size', min: 0.5, max: 2, step: 0.01, def: 1 },
      { id: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.35 },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 12000, unit: 'Hz', log: true },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 1000, step: 1, def: 120, unit: 'Hz', log: true },
      { id: 'diffusion', label: 'Diffusion', min: 0, max: 1, step: 0.01, def: 1 },
      { id: 'mod', label: 'Modulation', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      mix(0.3),
    ],
    presets: [
      { name: 'Vocal plate', params: { decay: 1.6, predelay: 25 } },
      { name: 'Bright plate', params: { decay: 2.4, damping: 0.1, highcut: 16000 } },
      { name: 'Long plate', params: { decay: 4.5, damping: 0.4 } },
      { name: 'Dark plate', params: { decay: 3, damping: 0.7, highcut: 6000 } },
    ],
  },
  {
    kind: 'hall', name: 'Hall', family: 'reverb',
    params: [
      ...REVERB_COMMON,
      { id: 'early', label: 'Early', min: 0, max: 1, step: 0.01, def: 0.3 },
      { id: 'diffusion', label: 'Diffusion', min: 0, max: 1, step: 0.01, def: 0.8 },
      { id: 'mod', label: 'Modulation', min: 0, max: 1, step: 0.01, def: 0.4 },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 1000, step: 1, def: 150, unit: 'Hz', log: true },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 10000, unit: 'Hz', log: true },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      mix(0.3),
    ],
    presets: [
      { name: 'Concert hall', params: {} },
      { name: 'Large hall', params: { decay: 4.5, size: 1.6, predelay: 35 } },
      { name: 'Cathedral', params: { decay: 8, size: 2, predelay: 50, damping: 0.35, early: 0.15 } },
      { name: 'Dark hall', params: { decay: 3.5, damping: 0.75, highcut: 5000 } },
      { name: 'Endless', params: { decay: 12, size: 2, predelay: 60, mod: 0.7, damping: 0.5, early: 0.1 } },
    ],
  },
  {
    kind: 'room', name: 'Room', family: 'reverb',
    params: [
      { id: 'predelay', label: 'Pre-delay', min: 0, max: 250, step: 1, def: 4, unit: 'ms' },
      { id: 'decay', label: 'Decay', min: 0.2, max: 4, step: 0.01, def: 0.7, unit: 's', log: true },
      { id: 'size', label: 'Size', min: 0.2, max: 1, step: 0.01, def: 0.45 },
      { id: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'early', label: 'Early', min: 0, max: 1, step: 0.01, def: 0.6 },
      { id: 'diffusion', label: 'Diffusion', min: 0, max: 1, step: 0.01, def: 0.7 },
      { id: 'mod', label: 'Modulation', min: 0, max: 1, step: 0.01, def: 0.2 },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 1000, step: 1, def: 100, unit: 'Hz', log: true },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 12000, unit: 'Hz', log: true },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      mix(0.25),
    ],
    presets: [
      { name: 'Studio room', params: {} },
      { name: 'Small room', params: { size: 0.28, decay: 0.4, early: 0.75 } },
      { name: 'Drum room', params: { size: 0.55, decay: 0.9, damping: 0.35, early: 0.8 } },
      { name: 'Live room', params: { size: 0.8, decay: 1.4, early: 0.5 } },
    ],
  },
  {
    kind: 'gated', name: 'Gated', family: 'reverb',
    params: [
      { id: 'predelay', label: 'Pre-delay', min: 0, max: 100, step: 1, def: 5, unit: 'ms' },
      { id: 'time', label: 'Time', min: 40, max: 1000, step: 1, def: 320, unit: 'ms', log: true },
      { id: 'shape', label: 'Shape', min: -1, max: 1, step: 0.01, def: 0 },
      { id: 'diffusion', label: 'Diffusion', min: 0, max: 1, step: 0.01, def: 0.7 },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 1000, step: 1, def: 150, unit: 'Hz', log: true },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 10000, unit: 'Hz', log: true },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      mix(0.3),
    ],
    // Shape: 0 flat (gated), +1 falling, -1 rising (reverse).
    presets: [
      { name: 'Gated snare', params: { time: 320, shape: 0, predelay: 5, lowcut: 200 } },
      { name: 'Big 80s', params: { time: 480, shape: 0.15, predelay: 10, lowcut: 250 } },
      { name: 'Reverse', params: { time: 450, shape: -1, predelay: 0 } },
      { name: 'Nonlin short', params: { time: 160, shape: 0.3, predelay: 2 } },
    ],
  },
  {
    kind: 'shimmer', name: 'Shimmer', family: 'reverb',
    params: [
      { id: 'predelay', label: 'Pre-delay', min: 0, max: 250, step: 1, def: 30, unit: 'ms' },
      { id: 'decay', label: 'Decay', min: 0.5, max: 20, step: 0.05, def: 5, unit: 's', log: true },
      { id: 'size', label: 'Size', min: 0.3, max: 2, step: 0.01, def: 1.6 },
      { id: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, def: 0.4 },
      { id: 'shimmer', label: 'Shimmer', min: 0, max: 0.85, step: 0.01, def: 0.5 },
      { id: 'interval', label: 'Interval', min: 0, max: SHIMMER_INTERVAL_LABELS.length - 1, step: 1, def: 0, options: SHIMMER_INTERVAL_LABELS },
      { id: 'lowcut', label: 'Low cut', min: 20, max: 1000, step: 1, def: 200, unit: 'Hz', log: true },
      { id: 'highcut', label: 'High cut', min: 1000, max: 20000, step: 10, def: 9000, unit: 'Hz', log: true },
      { id: 'mod', label: 'Modulation', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'width', label: 'Width', min: 0, max: 1, step: 0.01, def: 1 },
      mix(0.35),
    ],
    presets: [
      { name: 'Octave shimmer', params: {} },
      { name: 'Fifths', params: { interval: 1, shimmer: 0.45 } },
      { name: 'Cathedral shimmer', params: { decay: 10, size: 2, shimmer: 0.6, predelay: 50 } },
      { name: 'Angel', params: { interval: 4, shimmer: 0.4, decay: 7 } },
      { name: 'Sub bloom', params: { interval: 5, shimmer: 0.4, lowcut: 60 } },
    ],
  },
]

/**
 * Each effect family's faceplate, like outboard gear racked beside the
 * instruments: reverbs in the dark blue of a digital hall unit, delays in a
 * tape echo's green and amber, modulation in a chorus box's brushed grey.
 * The rack itself stays hue-less; these belong to the units.
 */
export const FAMILY_LOOK: Record<FxFamily, { chassis: string; ink: string; accent: string }> = {
  reverb: { chassis: '#262a3f', ink: '#e4e2f5', accent: '#a99bff' },
  delay: { chassis: '#243128', ink: '#ebe4cf', accent: '#ff9a3c' },
  modulation: { chassis: '#39404a', ink: '#e8eef2', accent: '#6fd3c9' },
  // An envelope-filter pedal's purple, and a sampler's yellow LED digits.
  filter: { chassis: '#33202e', ink: '#f3e4ee', accent: '#ff6fa8' },
  character: { chassis: '#2f2b22', ink: '#efe8d2', accent: '#e8d44d' },
  // A groovebox's pads: black with a lit red.
  performance: { chassis: '#1d1b1f', ink: '#f1e9ea', accent: '#ff4d5e' },
}

export function lookOf(kind: FxKind) { return FAMILY_LOOK[fxDef(kind).family] }

export function fxDef(kind: FxKind): FxDef {
  const d = FX_DEFS.find(x => x.kind === kind)
  if (!d) throw new Error(`unknown effect ${kind}`)
  return d
}

/**
 * Every parameter's value for a slot: the defaults, the preset, then the
 * slot's own edits. On a return the default mix is 100 % wet: the fader
 * and the sends set the amount, as on any mixing desk.
 */
export function resolveParams(spec: FxSlotSpec, context: FxContext): Record<string, number> {
  const def = fxDef(spec.kind)
  const out: Record<string, number> = {}
  for (const p of def.params) out[p.id] = p.def
  if (context === 'return') out['mix'] = 1
  const preset = spec.preset ? def.presets.find(p => p.name === spec.preset) : undefined
  if (preset) Object.assign(out, preset.params)
  if (context === 'return') out['mix'] = 1
  return { ...out, ...(spec.params ?? {}) }
}

/** The patterns on the studio's scatter pads: the first eight presets. */
export const SCATTER_PADS: string[] = fxDef('scatter').presets.slice(0, 8).map(p => p.name)

// ── Buses ────────────────────────────────────────────────────────────────

/** A track's send to one return: post-fader unless `pre`. */
export interface SendSpec { level: number; pre?: boolean }

export interface ProjectBus {
  /** 'A', 'B', ... — what a track's `sends` are keyed by. */
  id: string
  name: string
  level: number
  pan: number
  muted: boolean
  inserts: FxSlotSpec[]
}

/**
 * The return buses a new or old project starts with, as in most DAW
 * templates: a hall, a plate and a tempo echo. A project saved before the
 * studio had buses gets these with every send at zero, so it sounds as it
 * did.
 */
export function defaultReturns(): ProjectBus[] {
  return [
    { id: 'A', name: 'Hall', level: 0.8, pan: 0, muted: false, inserts: [{ kind: 'hall', preset: 'Concert hall' }] },
    { id: 'B', name: 'Plate', level: 0.8, pan: 0, muted: false, inserts: [{ kind: 'plate', preset: 'Vocal plate' }] },
    { id: 'C', name: 'Echo', level: 0.8, pan: 0, muted: false, inserts: [{ kind: 'delay', preset: 'Dotted eighth' }] },
  ]
}

/** Next free bus letter. */
export function nextBusId(taken: string[]): string {
  for (let c = 65; c < 91; c++) {
    const id = String.fromCharCode(c)
    if (!taken.includes(id)) return id
  }
  return `R${taken.length + 1}`
}

/** A send value from the project file, old or new shape. */
export function sendOf(v: SendSpec | number | undefined): SendSpec {
  if (v === undefined) return { level: 0 }
  return typeof v === 'number' ? { level: v } : v
}
