// A studio track: one instrument + its mixer strip + its 16-step pattern.
//
//   instrument → gain(level) → panner → analyser(meter) → master bus
//
// Timing note: the transport hands us a sample-accurate AudioContext time,
// but the hosted worklets trigger on message arrival rather than on a
// scheduled timestamp, so we dispatch with setTimeout at the right offset
// (a few ms of jitter). Tightening this means moving step dispatch inside
// the worklets — the approach the SID tracker already uses.

import type { Instrument, InstrumentKind } from './instruments.ts'
import { DrumInstrument, DRUM_CHANNELS } from './instruments.ts'

export interface NoteStep {
  /** MIDI note, or null for a rest. */
  note: number | null
  velocity: number
}

export const emptyNoteSteps = (n: number): NoteStep[] =>
  Array.from({ length: n }, () => ({ note: null, velocity: 100 }))

export const emptyDrumGrid = (n: number): number[][] =>
  DRUM_CHANNELS.map(() => new Array<number>(n).fill(0))

let nextId = 1

export class Track {
  readonly id = nextId++
  // These are all edited from the UI. Svelte 5 deep-proxies plain objects and
  // arrays but NOT class instances, so without $state a mutation here would
  // change the value and never repaint — which silently broke both project
  // restore and the pattern editor.
  name = $state('')
  /** 0..1 fader. */
  level = $state(0.8)
  /** -1..1 */
  pan = $state(0)
  muted = $state(false)
  soloed = $state(false)
  /** Fraction of a step that a melodic note sounds. */
  gate = $state(0.8)
  /** Semitone offset applied to this track's pattern notes. */
  transpose = $state(0)

  /** Name of the preset last loaded, for the editor and the project file. */
  presetName = $state<string | null>(null)
  /**
   * Parameter edits made in the studio's editor, on top of that preset. Kept
   * here rather than read back from the worklet because a processor has no
   * "tell me your state" message — this is the only record, so it is what the
   * project file saves and what a re-created instrument is replayed into.
   */
  params = $state<Record<string, number | string | boolean>>({})

  /**
   * Push a preset into the instrument and record it. Worklet synths take the
   * `{params, fx}` message their standalone pages already send; Synthex takes
   * a whole Patch through its engine.
   */
  loadPreset(name: string, params: Record<string, unknown>, fx: Record<string, unknown> = {}): void {
    this.presetName = name
    this.params = {}
    const inst = this.instrument as Instrument & {
      loadPreset?: (p: Record<string, unknown>, f: Record<string, unknown>) => void
      loadPatch?: (p: unknown) => void
    }
    if (this.kind === 'synthex' && inst.loadPatch) inst.loadPatch(params)
    else if (inst.loadPreset) inst.loadPreset(params, fx)
    else for (const [k, v] of Object.entries(params)) this.setParam(k, v as number)
  }

  /** Set one parameter, remembering it so the edit survives a save/reload. */
  setParam(param: string, value: number | string | boolean): void {
    this.params[param] = value
    this.instrument.setParam(param, value)
  }

  /** Replay the recorded sound into a freshly created instrument. */
  reapply(): void {
    for (const [k, v] of Object.entries(this.params)) this.instrument.setParam(k, v)
  }

  readonly input: GainNode
  private readonly levelGain: GainNode
  private readonly panner: StereoPannerNode
  private readonly analyser: AnalyserNode
  private readonly meterBuf: Float32Array<ArrayBuffer>

  /** Melodic pattern (unused for percussion tracks). */
  steps = $state<NoteStep[]>([])
  /** Percussion grid [channel][step] = velocity 0..127 (unused otherwise). */
  drumGrid = $state<number[][]>([])

  constructor(
    readonly kind: InstrumentKind,
    readonly instrument: Instrument,
    ctx: AudioContext,
    master: AudioNode,
    name: string,
    stepCount = 16,
  ) {
    this.name = name
    this.input = new GainNode(ctx, { gain: 1 })
    this.levelGain = new GainNode(ctx, { gain: this.level })
    this.panner = new StereoPannerNode(ctx, { pan: 0 })
    this.analyser = new AnalyserNode(ctx, { fftSize: 256 })
    this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))

    instrument.output.connect(this.input)
    this.input.connect(this.levelGain).connect(this.panner).connect(this.analyser)
    this.analyser.connect(master)

    this.steps = emptyNoteSteps(stepCount)
    this.drumGrid = emptyDrumGrid(stepCount)
  }

  get isPercussion(): boolean {
    return this.instrument instanceof DrumInstrument
  }

  applyMix(anySoloed: boolean): void {
    const audible = !this.muted && (!anySoloed || this.soloed)
    this.levelGain.gain.value = audible ? this.level : 0
    this.panner.pan.value = this.pan
  }

  /** Peak level 0..1 for the meter. */
  meter(): number {
    this.analyser.getFloatTimeDomainData(this.meterBuf)
    let peak = 0
    for (let i = 0; i < this.meterBuf.length; i++) {
      const v = Math.abs(this.meterBuf[i]!)
      if (v > peak) peak = v
    }
    return Math.min(1, peak)
  }

  /** Called by the transport for every step. */
  scheduleStep(step: number, time: number, ctx: AudioContext, stepDur: number): void {
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000)

    if (this.isPercussion) {
      const drum = this.instrument as DrumInstrument
      for (let ch = 0; ch < this.drumGrid.length; ch++) {
        const vel = this.drumGrid[ch]?.[step] ?? 0
        if (vel > 0) {
          setTimeout(() => drum.trigger(ch, vel / 127), delayMs)
        }
      }
      return
    }

    const s = this.steps[step]
    if (!s || s.note === null) return
    const note = s.note + this.transpose
    const velocity = s.velocity
    setTimeout(() => this.instrument.noteOn(note, velocity), delayMs)
    setTimeout(() => this.instrument.noteOff(note), delayMs + this.gate * stepDur * 1000)
  }

  dispose(): void {
    this.instrument.dispose()
    this.input.disconnect()
    this.levelGain.disconnect()
    this.panner.disconnect()
    this.analyser.disconnect()
  }
}
