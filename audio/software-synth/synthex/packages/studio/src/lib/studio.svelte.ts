// Top-level studio state: one AudioContext, a master bus, N tracks, and the
// shared transport. Svelte 5 runes provide the reactivity for the UI.

import { Track, emptyDrumGrid, emptyNoteSteps } from './track.svelte.ts'
import { Transport } from './transport.ts'
import { createInstrument, instrumentDef, type InstrumentKind } from './instruments.ts'
import {
  SCALES, makeRng, riff, bassLine, drumGrid, type ScaleName,
} from './generate.ts'

export class Studio {
  ctx: AudioContext | null = null
  transport: Transport | null = null

  tracks = $state<Track[]>([])
  focused = $state<number>(-1)      // track id being edited / played from keys
  masterLevel = $state(0.8)
  bpm = $state(120)
  swing = $state(0)
  playing = $state(false)
  step = $state(0)
  ready = $state(false)
  error = $state<string | null>(null)

  /** Key + scale the dice and the (scale-locked) editor work in. */
  rootPc = $state(9)                       // A
  scaleName = $state<ScaleName>('minorPentatonic')

  private master: GainNode | null = null
  private masterAnalyser: AnalyserNode | null = null
  private masterBuf = new Float32Array(new ArrayBuffer(256 * 4))

  async init(): Promise<void> {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      this.master = new GainNode(ctx, { gain: this.masterLevel })
      const limiter = new DynamicsCompressorNode(ctx, {
        threshold: -3, knee: 6, ratio: 12, attack: 0.003, release: 0.15,
      })
      this.masterAnalyser = new AnalyserNode(ctx, { fftSize: 256 })
      this.master.connect(limiter).connect(this.masterAnalyser).connect(ctx.destination)

      this.transport = new Transport(ctx)
      this.transport.onStep((step, time) => {
        const dur = this.transport!.secondsPerStep()
        for (const t of this.tracks) t.scheduleStep(step, time, ctx, dur)
        this.step = step
      })
      this.ready = true
    } catch (err) {
      this.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
  }

  /** Browsers need a gesture before audio runs. */
  async resume(): Promise<void> {
    if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume()
  }

  async addTrack(kind: InstrumentKind): Promise<Track | null> {
    if (!this.ctx || !this.master) return null
    try {
      const instrument = await createInstrument(this.ctx, kind)
      const def = instrumentDef(kind)
      const existing = this.tracks.filter(t => t.kind === kind).length
      const name = existing > 0 ? `${def.name} ${existing + 1}` : def.name
      const track = new Track(kind, instrument, this.ctx, this.master, name)
      this.tracks = [...this.tracks, track]
      // Return the instance as it lives in the reactive array. Assigning to a
      // $state array deep-proxies its contents; handing back the raw object
      // would let callers (e.g. project restore) mutate it without the UI
      // ever hearing about it.
      const added = this.tracks[this.tracks.length - 1]!
      if (this.focused < 0) this.focused = added.id
      this.applyMix()
      return added
    } catch (err) {
      this.error = `Failed to load ${kind}: ${err instanceof Error ? err.message : String(err)}`
      return null
    }
  }

  removeTrack(id: number): void {
    const track = this.tracks.find(t => t.id === id)
    if (!track) return
    track.dispose()
    this.tracks = this.tracks.filter(t => t.id !== id)
    if (this.focused === id) this.focused = this.tracks[0]?.id ?? -1
    this.applyMix()
  }

  focusedTrack(): Track | null {
    return this.tracks.find(t => t.id === this.focused) ?? null
  }

  /** Re-evaluate mute/solo across the desk and push gains. */
  applyMix(): void {
    const anySoloed = this.tracks.some(t => t.soloed)
    for (const t of this.tracks) t.applyMix(anySoloed)
    if (this.master) this.master.gain.value = this.masterLevel
    // Reassign to trigger reactivity for meter/fader UI.
    this.tracks = [...this.tracks]
  }

  masterMeter(): number {
    if (!this.masterAnalyser) return 0
    this.masterAnalyser.getFloatTimeDomainData(this.masterBuf)
    let peak = 0
    for (let i = 0; i < this.masterBuf.length; i++) {
      const v = Math.abs(this.masterBuf[i]!)
      if (v > peak) peak = v
    }
    return Math.min(1, peak)
  }

  play(): void {
    if (!this.transport) return
    void this.resume()
    this.transport.bpm = this.bpm
    this.transport.swing = this.swing
    this.transport.start()
    this.playing = true
  }

  stop(): void {
    if (!this.transport) return
    this.transport.stop()
    this.playing = false
    for (const t of this.tracks) t.instrument.allNotesOff()
  }

  toggle(): void {
    if (this.playing) this.stop(); else this.play()
  }

  setBpm(v: number): void {
    this.bpm = v
    if (this.transport) this.transport.bpm = v
  }

  setSwing(v: number): void {
    this.swing = v
    if (this.transport) this.transport.swing = v
  }

  /** Live play from computer keyboard / MIDI → focused track. */
  noteOn(note: number, velocity = 100): void {
    void this.resume()
    this.focusedTrack()?.instrument.noteOn(note, velocity)
  }

  noteOff(note: number): void {
    this.focusedTrack()?.instrument.noteOff(note)
  }

  get scale(): number[] { return SCALES[this.scaleName] }

  /**
   * Re-roll one track's pattern. Percussion gets a euclidean beat; melodic
   * tracks get a scale-locked riff, pitched by role — a track named like a
   * bass gets the low, sparse treatment.
   */
  rollTrack(id: number, seed = Math.floor(Math.random() * 1e9)): void {
    const t = this.tracks.find(x => x.id === id)
    if (!t) return
    const rng = makeRng(seed)
    if (t.isPercussion) {
      t.drumGrid = drumGrid(rng, t.drumGrid[0]?.length ?? 16, t.drumGrid.length)
    } else {
      const steps = t.steps.length
      const isBass = /bass/i.test(t.name)
      t.steps = isBass
        ? bassLine(rng, { steps, rootMidi: 21 + this.rootPc, scale: this.scale })
        : riff(rng, { steps, rootMidi: 57 + this.rootPc, scale: this.scale })
    }
    this.tracks = [...this.tracks]
  }

  /** Roll the whole desk — the "give me something new" button. */
  rollAll(): void {
    const base = Math.floor(Math.random() * 1e9)
    this.tracks.forEach((t, i) => this.rollTrack(t.id, base + i * 7919))
  }

  /**
   * Swap a track's instrument while keeping its pattern, level, pan and name.
   * This is the studio's signature move: hear the same riff on a different
   * sound engine in one click.
   */
  async swapInstrument(id: number, kind: InstrumentKind): Promise<void> {
    if (!this.ctx || !this.master) return
    const idx = this.tracks.findIndex(t => t.id === id)
    const old = this.tracks[idx]
    if (!old || old.kind === kind) return
    try {
      const instrument = await createInstrument(this.ctx, kind)
      const next = new Track(kind, instrument, this.ctx, this.master, old.name, old.steps.length)
      // Carry everything the player set up by hand.
      next.level = old.level
      next.pan = old.pan
      next.muted = old.muted
      next.soloed = old.soloed
      next.gate = old.gate
      next.transpose = old.transpose
      next.steps = old.steps
      next.drumGrid = old.drumGrid
      // Default name follows the instrument unless it was renamed by hand.
      if (old.name === instrumentDef(old.kind).name) next.name = instrumentDef(kind).name

      old.dispose()
      const copy = [...this.tracks]
      copy[idx] = next
      this.tracks = copy
      if (this.focused === id) this.focused = next.id
      this.applyMix()
    } catch (err) {
      this.error = `Failed to swap to ${kind}: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  clearPatterns(): void {
    for (const t of this.tracks) {
      t.steps = emptyNoteSteps(t.steps.length)
      t.drumGrid = emptyDrumGrid(t.drumGrid[0]?.length ?? 16)
    }
    this.tracks = [...this.tracks]
  }
}
