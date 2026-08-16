// Instrument layer — the studio's "plugin" abstraction.
//
// The six standalone synths in ../../../js already share one protocol: a
// single stereo AudioWorkletNode per synth, driven by
//   { type: 'noteOn', voice, note, velocity } | { type: 'noteOff', voice }
//   { type: 'param', param, value }
//   { type: 'preset', params, fx }
// so they can all be hosted here unchanged. Synthex is wrapped through its
// own engine API. Nothing in the standalone pages is modified — the studio
// only loads copies of their processors (see scripts/sync-worklets.mjs).

import { Synth, factoryDefault, PRESETS, type Patch } from '@synthex/engine'

export type InstrumentKind = 'va' | 'ws' | 'sid' | 'fm' | 'pm' | 'drum' | 'synthex'

export interface InstrumentDef {
  kind: InstrumentKind
  name: string
  subtitle: string
  /**
   * The instrument's own identity, taken from the standalone synth's theme
   * rather than invented here — so a track in the rack is the same colour
   * as the machine you open when you click through to it.
   *
   * `chassis` is the panel material, `ink` is legible text on that material,
   * `accent` is the lit colour (meters, LEDs) and must read on the dark rack.
   */
  chassis: string
  ink: string
  accent: string
  /** Voice count; SID is 3 like the real chip, the rest are 8. */
  polyphony: number
  /** Percussion instruments are driven by channel triggers, not pitches. */
  percussion?: boolean
}

export const INSTRUMENTS: InstrumentDef[] = [
  { kind: 'va',      name: 'VA Synth',   subtitle: 'Virtual Analog',
    chassis: '#6a4526', ink: '#ffd9a8', accent: '#ff9d2e', polyphony: 8 },
  { kind: 'ws',      name: 'WaveSynth',  subtitle: 'Wavetable',
    chassis: '#111c31', ink: '#e8eefc', accent: '#ff8c1a', polyphony: 8 },
  { kind: 'sid',     name: 'SID Synth',  subtitle: 'C64 MOS 6581',
    chassis: '#4038c8', ink: '#d5d2ff', accent: '#8f88ff', polyphony: 3 },
  { kind: 'fm',      name: 'FM Synth',   subtitle: 'DX7-style 6-op',
    chassis: '#33291e', ink: '#efe6d6', accent: '#e8842a', polyphony: 8 },
  { kind: 'pm',      name: 'PM Synth',   subtitle: 'Karplus-Strong',
    chassis: '#e8e2d6', ink: '#3a322a', accent: '#c47a3f', polyphony: 8 },
  { kind: 'drum',    name: 'Drums',      subtitle: '808/909 Machine',
    chassis: '#ded7c9', ink: '#4a3a28', accent: '#e8531f', polyphony: 8, percussion: true },
  { kind: 'synthex', name: 'Synthex',    subtitle: 'Elka Synthex tribute',
    chassis: '#17161a', ink: '#e8e2d8', accent: '#d65a1c', polyphony: 8 },
]

export const DRUM_CHANNELS = ['Kick', 'Snare', 'CH Hat', 'OH Hat', 'Clap', 'Tom', 'Rim', 'Cowbell']

/** Voice-type names, indexed by the processor's `ch.N.type` values. */
export const DRUM_TYPE_NAMES = ['Kick', 'Snare', 'CH Hat', 'OH Hat', 'Clap', 'Tom', 'Rim',
  'Cowbell', 'Cymbal', 'Maraca', 'Conga', 'Claves']

/**
 * Display name for a drum channel: its assigned voice if a kit re-typed it
 * (`ch.N.type` in the track's params), else its default role.
 */
export function drumChannelName(ch: number, params: Record<string, number | string | boolean>): string {
  const t = params[`ch.${ch}.type`]
  if (typeof t === 'number' && DRUM_TYPE_NAMES[t] && t !== ch) return DRUM_TYPE_NAMES[t]
  return DRUM_CHANNELS[ch] ?? `Ch ${ch + 1}`
}

export function instrumentDef(kind: InstrumentKind): InstrumentDef {
  const def = INSTRUMENTS.find(i => i.kind === kind)
  if (!def) throw new Error(`unknown instrument kind: ${kind}`)
  return def
}

/** What every track's instrument can do, regardless of engine underneath. */
export interface Instrument {
  readonly kind: InstrumentKind
  /** Connect this to the track's mixer strip. */
  readonly output: AudioNode
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  allNotesOff(): void
  setParam(param: string, value: number | string | boolean): void
  dispose(): void
}

// ---------------------------------------------------------------------------
// Worklet-backed instruments (VA / WS / SID / FM / PM)
// ---------------------------------------------------------------------------

const PROCESSOR_FILE: Record<string, string> = {
  va: 'va-processor.js',
  ws: 'ws-processor.js',
  sid: 'sid-processor.js',
  fm: 'fm-processor.js',
  pm: 'pm-processor.js',
  drum: 'drum-processor.js',
}

const PROCESSOR_NAME: Record<string, string> = {
  va: 'va-synth-processor',
  ws: 'ws-synth-processor',
  sid: 'sid-synth-processor',
  fm: 'fm-synth-processor',
  pm: 'pm-synth-processor',
  drum: 'drum-machine-processor',
}

// One addModule() per processor per context — repeated calls would throw.
const loadedModules = new WeakMap<BaseAudioContext, Set<string>>()

async function ensureModule(ctx: AudioContext, kind: InstrumentKind): Promise<void> {
  let loaded = loadedModules.get(ctx)
  if (!loaded) {
    loaded = new Set()
    loadedModules.set(ctx, loaded)
  }
  const file = PROCESSOR_FILE[kind]
  if (!file || loaded.has(file)) return
  await ctx.audioWorklet.addModule(`worklets/${file}`)
  loaded.add(file)
}

/**
 * Pitched worklet synth. Voice allocation lives here (the standalone pages
 * each had their own copy) — round-robin with note→voice tracking, and
 * oldest-voice stealing when the pool is exhausted.
 */
class WorkletInstrument implements Instrument {
  readonly output: AudioNode
  private readonly node: AudioWorkletNode
  private readonly noteToVoice = new Map<number, number>()
  private readonly voiceNote: (number | null)[]
  private readonly voiceAge: number[]
  private counter = 0

  constructor(
    readonly kind: InstrumentKind,
    ctx: AudioContext,
    private readonly polyphony: number,
  ) {
    this.node = new AudioWorkletNode(ctx, PROCESSOR_NAME[kind]!, {
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.output = this.node
    this.voiceNote = new Array<number | null>(polyphony).fill(null)
    this.voiceAge = new Array<number>(polyphony).fill(0)
  }

  private alloc(note: number): number {
    // Re-use the voice already holding this note (retrigger).
    const held = this.noteToVoice.get(note)
    if (held !== undefined) return held
    // Prefer a free voice, else steal the least recently started one.
    let best = 0
    let bestAge = Infinity
    for (let i = 0; i < this.polyphony; i++) {
      if (this.voiceNote[i] === null) { best = i; break }
      if (this.voiceAge[i]! < bestAge) { bestAge = this.voiceAge[i]!; best = i }
    }
    const stolen = this.voiceNote[best]
    if (stolen !== null && stolen !== undefined) this.noteToVoice.delete(stolen)
    return best
  }

  noteOn(note: number, velocity: number): void {
    const voice = this.alloc(note)
    this.voiceNote[voice] = note
    this.voiceAge[voice] = ++this.counter
    this.noteToVoice.set(note, voice)
    this.node.port.postMessage({ type: 'noteOn', voice, note, velocity })
  }

  noteOff(note: number): void {
    const voice = this.noteToVoice.get(note)
    if (voice === undefined) return
    this.noteToVoice.delete(note)
    this.voiceNote[voice] = null
    this.node.port.postMessage({ type: 'noteOff', voice })
  }

  allNotesOff(): void {
    for (let v = 0; v < this.polyphony; v++) {
      this.node.port.postMessage({ type: 'noteOff', voice: v })
      this.voiceNote[v] = null
    }
    this.noteToVoice.clear()
  }

  setParam(param: string, value: number | string | boolean): void {
    this.node.port.postMessage({ type: 'param', param, value })
  }

  /** Push a whole preset (same shape the standalone pages send). */
  loadPreset(params: Record<string, unknown>, fx: Record<string, unknown> = {}): void {
    this.node.port.postMessage({ type: 'preset', params, fx })
  }

  /** Raw processor message — for protocol beyond params (SID's GT2 tables). */
  post(msg: Record<string, unknown>): void {
    this.node.port.postMessage(msg)
  }

  dispose(): void {
    this.allNotesOff()
    this.node.disconnect()
  }
}

/**
 * Drum machine. Channel-triggered rather than pitched; its internal
 * sequencer stays idle because the studio transport drives the steps.
 */
class DrumInstrument implements Instrument {
  readonly kind = 'drum' as const
  readonly output: AudioNode
  private readonly node: AudioWorkletNode

  constructor(ctx: AudioContext) {
    this.node = new AudioWorkletNode(ctx, PROCESSOR_NAME['drum']!, {
      numberOfOutputs: 1,
      outputChannelCount: [2],
    })
    this.output = this.node
  }

  trigger(channel: number, velocity = 1): void {
    this.node.port.postMessage({ type: 'trigger', channel, velocity })
  }

  /** Keyboard play: notes map upward from C2 onto the eight channels. */
  noteOn(note: number, velocity: number): void {
    const ch = ((note - 36) % DRUM_CHANNELS.length + DRUM_CHANNELS.length) % DRUM_CHANNELS.length
    this.trigger(ch, velocity)
  }

  noteOff(): void { /* one-shots — nothing to release */ }
  allNotesOff(): void { /* one-shots decay on their own */ }

  setParam(param: string, value: number | string | boolean): void {
    this.node.port.postMessage({ type: 'param', param, value })
  }

  dispose(): void {
    this.node.disconnect()
  }
}

/**
 * Synthex, wrapped from its own engine package. Shares the studio's
 * AudioContext and renders into the track strip instead of the speakers —
 * the standalone Synthex app is unaffected (it just omits `destination`).
 */
class SynthexInstrument implements Instrument {
  readonly kind = 'synthex' as const
  readonly output: AudioNode
  private readonly synth: Synth

  private constructor(synth: Synth, output: AudioNode) {
    this.synth = synth
    this.output = output
  }

  static async create(ctx: AudioContext): Promise<SynthexInstrument> {
    // The engine feeds this node; the studio connects it onward to the strip.
    const bus = new GainNode(ctx, { gain: 1 })
    // Same prebuilt worklet the standalone app uses, copied next to the
    // vanilla processors by the engine's build-worklet script.
    const synth = new Synth({
      context: ctx,
      destination: bus,
      polyphony: 8,
      workletUrl: `${import.meta.env.BASE_URL}worklets/synthex-voice-processor.js`,
    })
    await synth.init()
    // Boot on the iconic Laser Harp, like the standalone app does.
    const laser = PRESETS.find(s => s.address === 46)?.patch ?? factoryDefault()
    synth.setPatch(laser as Patch)
    return new SynthexInstrument(synth, bus)
  }

  noteOn(note: number, velocity: number): void { this.synth.noteOn(note, velocity) }
  noteOff(note: number): void { this.synth.noteOff(note) }
  allNotesOff(): void { this.synth.allNotesOff() }

  setParam(param: string, value: number | string | boolean): void {
    this.synth.setParam(param, value)
  }

  loadPatch(p: Patch): void { this.synth.setPatch(p) }

  dispose(): void {
    this.synth.allNotesOff()
    this.output.disconnect()
  }
}

// ---------------------------------------------------------------------------

/**
 * Warm the worklet modules for several instruments at once. Creating tracks
 * one after another means each addModule() fetch waits for the previous —
 * the demo song took seconds to appear. Fetching them in parallel first cuts
 * that to roughly the slowest single module.
 */
export async function preloadInstruments(
  ctx: AudioContext,
  kinds: InstrumentKind[],
): Promise<void> {
  const worklet = [...new Set(kinds)].filter(k => k !== 'synthex')
  await Promise.all(worklet.map(k => ensureModule(ctx, k)))
}

export async function createInstrument(
  ctx: AudioContext,
  kind: InstrumentKind,
): Promise<Instrument> {
  if (kind === 'synthex') return SynthexInstrument.create(ctx)
  await ensureModule(ctx, kind)
  if (kind === 'drum') return new DrumInstrument(ctx)
  return new WorkletInstrument(kind, ctx, instrumentDef(kind).polyphony)
}

export { DrumInstrument, WorkletInstrument, SynthexInstrument }
