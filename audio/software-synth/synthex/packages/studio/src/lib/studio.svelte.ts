// Top-level studio state: one AudioContext, N tracks, the return buses and
// the master bus (see mixer.svelte.ts for the signal flow), and the shared
// transport. Svelte 5 runes provide the reactivity for the UI.

import { Track, emptyDrumGrid, emptyNoteSteps } from './track.svelte.ts'
import { Transport } from './transport.ts'
import { createInstrument, instrumentDef, type InstrumentKind } from './instruments.ts'
import { Bus, loadFxModule, type FxSlot } from './mixer.svelte.ts'
import { defaultReturns, fxDef, nextBusId, type FxKind, type ProjectBus } from './fx.ts'
import {
  SCALES, makeRng, riff, bassLine, drumGrid, type ScaleName,
} from './generate.ts'

export class Studio {
  ctx: AudioContext | null = null
  transport: Transport | null = null

  tracks = $state<Track[]>([])
  /** Return (aux) buses, fed by the tracks' sends. */
  buses = $state<Bus[]>([])
  /** The master bus: its inserts, fader, limiter, meter. */
  master = $state<Bus | null>(null)
  focused = $state<number>(-1)      // track id being edited / played from keys
  bpm = $state(120)
  swing = $state(0)
  playing = $state(false)
  step = $state(0)
  /** Steps since play was pressed (does not wrap at the song's length). */
  stepIndex = $state(0)
  /** The scatter pad being held, if any (a Scatter preset's name). */
  scatterHeld = $state<string | null>(null)
  ready = $state(false)
  error = $state<string | null>(null)

  /** Key + scale the dice and the (scale-locked) editor work in. */
  rootPc = $state(9)                       // A
  scaleName = $state<ScaleName>('minorPentatonic')

  /** The master fader (the project file's `masterLevel`). */
  get masterLevel(): number { return this.master?.level ?? 0.8 }
  set masterLevel(v: number) { if (this.master) this.master.level = v }

  async init(): Promise<void> {
    if (this.ctx) return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      await loadFxModule(ctx)
      // A safety limiter after the master fader, not part of the sound: the
      // demos are mixed to stay clear of it (tests/demo-song.test.ts).
      const limiter = new DynamicsCompressorNode(ctx, {
        threshold: -3, knee: 6, ratio: 12, attack: 0.003, release: 0.15,
      })
      this.master = new Bus(ctx, 'master', 'Master', limiter, true)
      this.master.level = 0.8
      this.setReturns(defaultReturns())

      this.transport = new Transport(ctx)
      this.transport.length = () => this.songLength()
      this.transport.onStep((step, time, index) => {
        const dur = this.transport!.secondsPerStep()
        for (const t of this.tracks) t.scheduleStep(step, time, ctx, dur)
        // Each bar, tell the effect chains where the song is (step-locked
        // effects align to it). Bar starts are even steps: never swung.
        if (index % 16 === 0) for (const c of this.chains()) c.position(index / 4, time)
        this.step = step
        this.stepIndex = index
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
      const track = new Track(kind, instrument, this.ctx, this.master.input, name)
      track.chain.tempo(this.bpm)
      track.connectSends(this.buses)
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

  /**
   * Steps before the whole song repeats: the least common multiple of the
   * track lengths, so a 16-step beat and a 48-step riff both land back on
   * step 0 together.
   */
  songLength(): number {
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
    let n = 16
    for (const t of this.tracks) n = (n * t.length) / gcd(n, t.length)
    return Math.min(n, 16 * 64)
  }

  focusedTrack(): Track | null {
    return this.tracks.find(t => t.id === this.focused) ?? null
  }

  /**
   * Re-evaluate mute/solo across the desk and push gains. Returns are
   * solo-safe: soloing a track keeps the reverb it sends to.
   */
  applyMix(): void {
    const anySoloed = this.tracks.some(t => t.soloed)
    for (const t of this.tracks) t.applyMix(anySoloed)
    for (const b of this.buses) b.applyMix()
    this.master?.applyMix()
    // Reassign to trigger reactivity for meter/fader UI.
    this.tracks = [...this.tracks]
  }

  masterMeter(): number { return this.master?.meter() ?? 0 }

  // ── Return buses ────────────────────────────────────────────────────────

  /** Replace every return bus (project restore); sends are rewired. */
  setReturns(specs: ProjectBus[]): void {
    if (!this.ctx || !this.master) return
    for (const b of this.buses) b.dispose()
    this.buses = specs.map(spec => this.makeBus(spec))
    for (const t of this.tracks) t.connectSends(this.buses)
    this.applyMix()
  }

  /** Add a return with one effect on it; every track gets a send at zero. */
  addReturn(kind: FxKind): Bus | null {
    if (!this.ctx || !this.master) return null
    const id = nextBusId(this.buses.map(b => b.id))
    const bus = this.makeBus({ id, name: fxName(kind), level: 0.8, pan: 0, muted: false, inserts: [] })
    bus.chain.add(kind)
    this.buses = [...this.buses, bus]
    for (const t of this.tracks) t.connectSends(this.buses)
    this.applyMix()
    return this.buses[this.buses.length - 1]!
  }

  removeReturn(id: string): void {
    const bus = this.buses.find(b => b.id === id)
    if (!bus) return
    this.buses = this.buses.filter(b => b.id !== id)
    for (const t of this.tracks) {
      delete t.sends[id]
      t.connectSends(this.buses)
    }
    bus.dispose()
    this.applyMix()
  }

  private makeBus(spec: ProjectBus): Bus {
    const bus = new Bus(this.ctx!, spec.id, spec.name, this.master!.input)
    bus.level = spec.level
    bus.pan = spec.pan
    bus.muted = spec.muted
    bus.chain.load(spec.inserts)
    bus.chain.tempo(this.bpm)
    return bus
  }

  // ── Scatter pads ────────────────────────────────────────────────────────

  /**
   * The Scatter on the master bus that the pads play, added on first use. It
   * sits there with its mix at 0, recording the mix into its buffer, so a
   * pad has the last bars to work with the moment it is pressed.
   */
  masterScatter(): FxSlot | null {
    const chain = this.master?.chain
    if (!chain) return null
    const found = chain.slots.find(s => s.kind === 'scatter')
    if (found) return found
    const slot = chain.add('scatter')
    chain.setParam(slot.id, 'mix', 0, true)
    return slot
  }

  /** Hold a scatter pad: the pattern takes over the whole mix until release. */
  scatterOn(preset: string): void {
    const slot = this.masterScatter()
    if (!slot || !this.master) return
    void this.resume()
    this.master.chain.applyPreset(slot.id, preset)   // a preset's mix is 1
    if (slot.bypass) this.master.chain.setBypass(slot.id, false)
    this.scatterHeld = preset
  }

  scatterOff(): void {
    const chain = this.master?.chain
    const slot = chain?.slots.find(s => s.kind === 'scatter')
    if (chain && slot) chain.setParam(slot.id, 'mix', 0, true)
    this.scatterHeld = null
  }

  /** Every effect chain on the desk, for tempo changes. */
  private chains() {
    return [...this.tracks.map(t => t.chain), ...this.buses.map(b => b.chain), ...(this.master ? [this.master.chain] : [])]
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
    for (const c of this.chains()) c.tempo(v)
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
      const next = new Track(kind, instrument, this.ctx, this.master.input, old.name, old.steps.length)
      // The channel strip stays: inserts and sends move to the new instrument.
      next.chain.load(old.chain.specs())
      next.chain.tempo(this.bpm)
      next.sends = { ...old.sends }
      next.connectSends(this.buses)
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

function fxName(kind: FxKind): string {
  return kind === 'delay' ? 'Echo' : fxDef(kind).name
}
