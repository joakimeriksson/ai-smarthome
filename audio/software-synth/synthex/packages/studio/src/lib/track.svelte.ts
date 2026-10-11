// A studio track: one instrument + its mixer strip + its pattern. A pattern
// is 16 steps per bar and may run 1-4 bars; shorter tracks loop inside the
// song, so a 16-step beat repeats under a 64-step chord progression.
//
//   instrument -> inserts -> mute -> fader -> pan -> meter -> master
//                              |pre             |post
//                              +--- sends ------+---> return buses
//
// (See mixer.svelte.ts for the buses and the insert chains.)
//
// Timing note: the transport hands us a sample-accurate AudioContext time,
// but the hosted worklets trigger on message arrival rather than on a
// scheduled timestamp, so we dispatch with setTimeout at the right offset
// (a few ms of jitter). Tightening this means moving step dispatch inside
// the worklets — the approach the SID tracker already uses.

import type { Instrument, InstrumentKind } from './instruments.ts'
import { DrumInstrument, DRUM_CHANNELS } from './instruments.ts'
import { PRESSURE_AT, PRESSURE_RISE, SCOOP_TIME, BEND_AT, BEND_RISE } from './expression.ts'
import { FxChain, peakOf, type Bus } from './mixer.svelte.ts'
import type { SendSpec } from './fx.ts'

export interface NoteStep {
  /** MIDI note, or null for a rest. */
  note: number | null
  velocity: number
  /**
   * Extra notes sounded with `note`, as semitones above it ([3, 7] makes a
   * minor triad). Intervals rather than MIDI numbers so pitching the step
   * in the editor moves the whole chord.
   */
  chord?: number[]
  /** How many steps the note holds, overriding the track's gate. */
  length?: number
  /**
   * Aftertouch: partway through the note (`pressureAt` of its length,
   * default 0.35) the player leans in, and key pressure rises to this value
   * (0..1) over the next 40 % of the note. A VA preset routes the pressure
   * source wherever it likes — the demos open the filter with it.
   */
  pressure?: number
  pressureAt?: number
  /**
   * Pitch expression, for engines with per-voice bend (VA). `scoop`: the
   * note starts this many semitones flat and slides up into pitch
   * (SCOOP_TIME). `bendUp`: partway through, the held note is bent up this
   * many semitones, like a guitarist pushing a string (BEND_AT, BEND_RISE).
   */
  scoop?: number
  bendUp?: number
}



/** Pattern lengths the editor offers, in bars (16 steps each). */
export const BAR_CHOICES = [1, 2, 4, 8, 16]

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
  loadPreset(name: string, params: Record<string, unknown>, fx: Record<string, unknown> = {},
    extras: Record<string, unknown> = {}): void {
    this.presetName = name
    this.params = {}
    const inst = this.instrument as Instrument & {
      loadPreset?: (p: Record<string, unknown>, f: Record<string, unknown>, e: Record<string, unknown>) => void
      loadPatch?: (p: unknown) => void
    }
    if (this.kind === 'synthex' && inst.loadPatch) inst.loadPatch(params)
    else if (inst.loadPreset) inst.loadPreset(params, fx, extras)
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

  /** Sends to return buses, by bus id; post-fader unless `pre`. */
  sends = $state<Record<string, SendSpec>>({})

  readonly input: GainNode
  /** The insert slots: one worklet running the track's effects in order. */
  readonly chain: FxChain
  private readonly muteGain: GainNode
  private readonly levelGain: GainNode
  private readonly panner: StereoPannerNode
  private readonly analyser: AnalyserNode
  private readonly meterBuf: Float32Array<ArrayBuffer>
  private readonly sendGains = new Map<string, { gain: GainNode; bus: Bus; pre: boolean }>()

  /** Melodic pattern (unused for percussion tracks). */
  steps = $state<NoteStep[]>([])
  /** Percussion grid [channel][step] = velocity 0..127 (unused otherwise). */
  drumGrid = $state<number[][]>([])

  constructor(
    readonly kind: InstrumentKind,
    readonly instrument: Instrument,
    private readonly ctx: AudioContext,
    master: AudioNode,
    name: string,
    stepCount = 16,
  ) {
    this.name = name
    this.input = new GainNode(ctx, { gain: 1 })
    this.chain = new FxChain(ctx, 'insert')
    this.muteGain = new GainNode(ctx, { gain: 1 })
    this.levelGain = new GainNode(ctx, { gain: this.level })
    this.panner = new StereoPannerNode(ctx, { pan: 0 })
    this.analyser = new AnalyserNode(ctx, { fftSize: 256 })
    this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))

    instrument.output.connect(this.input)
    this.input.connect(this.chain.node).connect(this.muteGain)
    this.muteGain.connect(this.levelGain).connect(this.panner).connect(this.analyser)
    this.analyser.connect(master)

    this.steps = emptyNoteSteps(stepCount)
    this.drumGrid = emptyDrumGrid(stepCount)
  }

  get isPercussion(): boolean {
    return this.instrument instanceof DrumInstrument
  }

  /**
   * Mute and solo act before the fader and the sends, so a muted track is
   * silent in the returns too, pre-fader sends included.
   */
  applyMix(anySoloed: boolean): void {
    const audible = !this.muted && (!anySoloed || this.soloed)
    this.muteGain.gain.value = audible ? 1 : 0
    this.levelGain.gain.value = this.level
    this.panner.pan.value = this.pan
    for (const [id, s] of this.sendGains) s.gain.gain.value = this.sends[id]?.level ?? 0
  }

  /**
   * Wire this track's sends to the given return buses: one gain per bus,
   * tapped after the pan (post-fader) or before the fader (pre). Buses not
   * in the list lose their send; a send's level lives in `sends`.
   */
  connectSends(buses: Bus[]): void {
    for (const [id, s] of [...this.sendGains]) {
      const bus = buses.find(b => b.id === id)
      const pre = !!this.sends[id]?.pre
      if (bus === s.bus && pre === s.pre) continue
      s.gain.disconnect()
      this.sendGains.delete(id)
    }
    for (const bus of buses) {
      if (this.sendGains.has(bus.id)) continue
      const pre = !!this.sends[bus.id]?.pre
      const gain = new GainNode(this.ctx, { gain: this.sends[bus.id]?.level ?? 0 })
      ;(pre ? this.muteGain : this.panner).connect(gain)
      gain.connect(bus.input)
      this.sendGains.set(bus.id, { gain, bus, pre })
    }
  }

  setSend(busId: string, level: number, pre = this.sends[busId]?.pre ?? false): void {
    this.sends[busId] = pre ? { level, pre } : { level }
    const s = this.sendGains.get(busId)
    if (s && s.pre === pre) s.gain.gain.value = level
    else if (s) this.connectSends([...this.sendGains.values()].map(x => x.bus))
  }

  /** Peak level 0..1 for the meter. */
  meter(): number { return peakOf(this.analyser, this.meterBuf) }

  /** Called by the transport for every step. */
  scheduleStep(step: number, time: number, ctx: AudioContext, stepDur: number): void {
    const delayMs = Math.max(0, (time - ctx.currentTime) * 1000)

    if (this.isPercussion) {
      const drum = this.instrument as DrumInstrument
      const at = step % this.length
      for (let ch = 0; ch < this.drumGrid.length; ch++) {
        const vel = this.drumGrid[ch]?.[at] ?? 0
        if (vel > 0) {
          setTimeout(() => drum.trigger(ch, vel / 127), delayMs)
        }
      }
      return
    }

    const s = this.steps[step % this.steps.length]
    if (!s || s.note === null) return
    const root = s.note + this.transpose
    const notes = [root, ...(s.chord ?? []).map(iv => root + iv)]
    const velocity = s.velocity
    const holdMs = (s.length ?? this.gate) * stepDur * 1000
    // Each note-on takes a token; its note-off only releases that token. A
    // held note that the next step strikes again (a chord's common tone, a
    // repeated bass note) has its old note-off and the new note-on due at
    // the same moment from two timers, and whichever fires second wins —
    // without the token the old note-off could silence the new note.
    const tokens = new Map<number, number>()
    setTimeout(() => {
      for (const n of notes) {
        const token = ++this.noteSerial
        this.sounding.set(n, token)
        tokens.set(n, token)
        this.instrument.noteOn(n, velocity)
        if (s.scoop && this.instrument.bend) {
          this.instrument.bend(n, -s.scoop, 0)
          this.instrument.bend(n, 0, SCOOP_TIME)
        }
      }
    }, delayMs)
    if (s.bendUp && this.instrument.bend) {
      const value = s.bendUp, rise = holdMs * BEND_RISE / 1000
      setTimeout(() => {
        for (const n of notes) {
          if (this.sounding.get(n) === tokens.get(n)) this.instrument.bend!(n, value, rise)
        }
      }, delayMs + holdMs * BEND_AT)
    }
    if (s.pressure && this.instrument.pressure) {
      const at = delayMs + holdMs * (s.pressureAt ?? PRESSURE_AT)
      const value = s.pressure, rise = holdMs * PRESSURE_RISE / 1000
      setTimeout(() => {
        for (const n of notes) {
          if (this.sounding.get(n) === tokens.get(n)) this.instrument.pressure!(n, value, rise)
        }
      }, at)
    }
    setTimeout(() => {
      for (const n of notes) {
        if (this.sounding.get(n) !== tokens.get(n)) continue
        this.sounding.delete(n)
        this.instrument.noteOff(n)
      }
    }, delayMs + holdMs)
  }

  private noteSerial = 0
  /** Note -> token of the note-on that currently owns it. */
  private readonly sounding = new Map<number, number>()

  /** Steps in this track's pattern (notes, or the drum grid's width). */
  get length(): number {
    return this.isPercussion ? (this.drumGrid[0]?.length ?? 16) : this.steps.length
  }

  dispose(): void {
    this.instrument.dispose()
    this.input.disconnect()
    this.chain.dispose()
    this.muteGain.disconnect()
    for (const s of this.sendGains.values()) s.gain.disconnect()
    this.levelGain.disconnect()
    this.panner.disconnect()
    this.analyser.disconnect()
  }
}
