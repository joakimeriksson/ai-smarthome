// Main-thread orchestration. Owns:
//   - the AudioContext + worklet module
//   - up to TWO voice pools (upper / lower layers)
//   - per-layer FX chains: voices → mixer → chorus → delay → reverb → pan
//   - merged through a master gain → optional limiter → analyser → out
//   - the canonical Patch (pushed to all voices on change)
//   - voice allocation, including poly / mono / unison and split/double/single
//
// UI talks to this via setPatch / setParam / noteOn / noteOff.

function toPlainObject<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(toPlainObject) as unknown as T
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(v as object)) {
    out[k] = toPlainObject((v as Record<string, unknown>)[k])
  }
  return out as T
}

import { VoicePool } from './voice.ts'
import { StereoChorus } from './fx/chorus.ts'
import { StereoDelay } from './fx/delay.ts'
import { SynthReverb } from './fx/reverb.ts'
import { loadVoiceWorklet } from './load-worklet.ts'
import type { Patch, LayerPatch, FxParams } from './patch.ts'
import { factoryDefault } from './presets/default.ts'

export interface SynthOptions {
  workletUrl?: string | URL
  context?: AudioContext
  polyphony?: number       // initial pool size; can be overridden by patch.master.polyphony later
}

type LayerKey = 'upper' | 'lower'

interface LayerChain {
  voices: AudioWorkletNode[]
  pool: VoicePool
  mixer: GainNode
  chorus: StereoChorus
  delay: StereoDelay
  reverb: SynthReverb
  panner: StereoPannerNode
  // Track held notes for mono / unison mode
  heldNotes: number[]
}

export class Synth {
  readonly context: AudioContext
  private readonly workletUrl: string | URL | null
  private readonly ownsContext: boolean
  private polyphony: number

  private upper: LayerChain | null = null
  private lower: LayerChain | null = null
  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private analyser: AnalyserNode | null = null

  private patch: Patch = factoryDefault()
  private initialized = false

  constructor(opts: SynthOptions = {}) {
    this.workletUrl = opts.workletUrl ?? null
    this.polyphony = Math.max(1, Math.min(16, opts.polyphony ?? 8))
    if (opts.context) {
      this.context = opts.context
      this.ownsContext = false
    } else {
      this.context = new AudioContext()
      this.ownsContext = true
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.workletUrl) {
      await this.context.audioWorklet.addModule(this.workletUrl)
    } else {
      await loadVoiceWorklet(this.context)
    }
    const ctx = this.context
    this.master = new GainNode(ctx, { gain: this.patch.master.volume })
    this.limiter = new DynamicsCompressorNode(ctx, {
      threshold: -3, knee: 6, ratio: 12, attack: 0.003, release: 0.15,
    })
    this.analyser = new AnalyserNode(ctx, { fftSize: 2048 })

    this.polyphony = this.patch.master.polyphony
    this.upper = this.buildLayerChain('upper')
    if (this.patch.voiceMode !== 'single') {
      this.lower = this.buildLayerChain('lower')
    }

    this.master
      .connect(this.limiter)
      .connect(this.analyser)
      .connect(ctx.destination)

    this.broadcastPatch()
    this.applyAllFx()
    this.initialized = true
  }

  private buildLayerChain(_which: LayerKey): LayerChain {
    const ctx = this.context
    const mixer = new GainNode(ctx, { gain: 1 / Math.sqrt(this.polyphony) })
    const chorus = new StereoChorus(ctx)
    const delay = new StereoDelay(ctx)
    const reverb = new SynthReverb(ctx)
    const panner = new StereoPannerNode(ctx, { pan: 0 })
    const voices: AudioWorkletNode[] = []
    for (let i = 0; i < this.polyphony; i++) {
      const node = new AudioWorkletNode(ctx, 'synthex-voice', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      node.connect(mixer)
      voices.push(node)
    }
    mixer.connect(chorus.input)
    chorus.output.connect(delay.input)
    delay.output.connect(reverb.input)
    reverb.output.connect(panner)
    panner.connect(this.master!)
    return { voices, pool: new VoicePool(this.polyphony), mixer, chorus, delay, reverb, panner, heldNotes: [] }
  }

  private destroyLayerChain(c: LayerChain): void {
    for (const v of c.voices) v.disconnect()
    c.mixer.disconnect()
    c.chorus.input.disconnect()
    c.chorus.output.disconnect()
    c.delay.input.disconnect()
    c.delay.output.disconnect()
    c.reverb.input.disconnect()
    c.reverb.output.disconnect()
    c.panner.disconnect()
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume()
  }

  // -------------------------------------------------------------------------
  // Note routing
  // -------------------------------------------------------------------------

  noteOn(note: number, velocity = 1): void {
    if (!this.initialized) return
    const route = this.routeNote(note)
    for (const target of route) this.layerNoteOn(target.layer, target.note, velocity)
  }

  noteOff(note: number): void {
    if (!this.initialized) return
    const route = this.routeNote(note)
    for (const target of route) this.layerNoteOff(target.layer, target.note)
  }

  allNotesOff(): void {
    for (const c of this.layers()) {
      c.heldNotes = []
      for (const slot of c.pool.releaseAll()) {
        c.voices[slot.index]?.port.postMessage({ type: 'noteOff' })
      }
    }
  }

  // Decide which layers receive a given note based on voice mode + split point.
  private routeNote(note: number): { layer: LayerKey; note: number }[] {
    const out: { layer: LayerKey; note: number }[] = []
    switch (this.patch.voiceMode) {
      case 'single':
        out.push({ layer: 'upper', note })
        break
      case 'double':
        out.push({ layer: 'upper', note })
        out.push({ layer: 'lower', note })
        break
      case 'split':
        if (note >= this.patch.splitPoint) out.push({ layer: 'upper', note })
        else out.push({ layer: 'lower', note })
        break
    }
    return out
  }

  private layerNoteOn(which: LayerKey, note: number, velocity: number): void {
    const chain = which === 'upper' ? this.upper : this.lower
    if (!chain) return
    const layer = this.patch[which]
    chain.heldNotes.push(note)

    switch (layer.keyAssign) {
      case 'poly': {
        const slot = chain.pool.allocate(note)
        chain.voices[slot.index]?.port.postMessage({ type: 'noteOn', note, velocity })
        return
      }
      case 'mono': {
        const slot = chain.pool.monoSlot()
        slot.note = note
        slot.startedAt = performance.now()
        slot.releasedAt = Infinity
        chain.voices[slot.index]?.port.postMessage({ type: 'noteOn', note, velocity })
        return
      }
      case 'unison': {
        // Fan the note across all voices with symmetric detune.
        const detuneCents = this.patch.master.unisonDetune * 25 // ±25 cents max
        const slots = chain.pool.allSlots()
        const n = slots.length
        for (let i = 0; i < n; i++) {
          const slot = slots[i]!
          slot.note = note
          slot.startedAt = performance.now()
          slot.releasedAt = Infinity
          // Spread detune across [-detuneCents, +detuneCents]
          const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2
          const bend = (t * detuneCents) / 100 // semis
          chain.voices[i]?.port.postMessage({ type: 'bend', semitones: bend })
          chain.voices[i]?.port.postMessage({ type: 'noteOn', note, velocity })
        }
        return
      }
    }
  }

  private layerNoteOff(which: LayerKey, note: number): void {
    const chain = which === 'upper' ? this.upper : this.lower
    if (!chain) return
    const idx = chain.heldNotes.lastIndexOf(note)
    if (idx >= 0) chain.heldNotes.splice(idx, 1)
    const layer = this.patch[which]

    switch (layer.keyAssign) {
      case 'poly': {
        const slot = chain.pool.release(note)
        if (slot) chain.voices[slot.index]?.port.postMessage({ type: 'noteOff' })
        return
      }
      case 'mono': {
        // If other notes are still held, retrigger to the most recent held
        // note (last-note priority) — typical mono behavior.
        if (chain.heldNotes.length > 0) {
          const next = chain.heldNotes[chain.heldNotes.length - 1]!
          const slot = chain.pool.monoSlot()
          slot.note = next
          chain.voices[slot.index]?.port.postMessage({ type: 'noteOn', note: next, velocity: 1 })
        } else {
          const slot = chain.pool.monoSlot()
          slot.note = -1
          slot.releasedAt = performance.now()
          chain.voices[slot.index]?.port.postMessage({ type: 'noteOff' })
        }
        return
      }
      case 'unison': {
        if (chain.heldNotes.length === 0) {
          for (let i = 0; i < chain.voices.length; i++) {
            chain.voices[i]?.port.postMessage({ type: 'noteOff' })
          }
        }
        return
      }
    }
  }

  pitchBend(semitones: number): void {
    for (const c of this.layers()) {
      for (const v of c.voices) v.port.postMessage({ type: 'bend', semitones })
    }
  }

  setJoy(x: number, y: number): void {
    for (const c of this.layers()) {
      for (const v of c.voices) v.port.postMessage({ type: 'joy', x, y })
    }
  }

  // -------------------------------------------------------------------------
  // Patch routing
  // -------------------------------------------------------------------------

  getPatch(): Patch {
    return this.patch
  }

  setPatch(p: Patch): void {
    this.patch = structuredClone(toPlainObject(p))
    if (!this.initialized) return
    this.reconcileLayers()
    this.reconcilePolyphony()
    this.broadcastPatch()
    this.applyAllFx()
    this.applyLayerPan()
    this.applyMasterControls()
  }

  setParam(path: string, value: number | string | boolean): void {
    const segs = path.split('.')
    let target: Record<string, unknown> = this.patch as unknown as Record<string, unknown>
    for (let i = 0; i < segs.length - 1; i++) {
      const next = target[segs[i]!]
      if (next && typeof next === 'object') target = next as Record<string, unknown>
      else return
    }
    target[segs[segs.length - 1]!] = value as unknown
    if (!this.initialized) return

    if (path === 'voiceMode') return this.reconcileLayers()
    if (path === 'master.polyphony') return this.reconcilePolyphony()
    if (path === 'master.volume' && this.master) {
      this.master.gain.value = value as number; return
    }
    if (path === 'master.limiter') {
      this.applyMasterControls(); return
    }
    if (path.startsWith('fx.') || path.startsWith('fxLower.')) {
      this.applyAllFx(); return
    }
    if (path === 'upper.pan' || path === 'lower.pan') {
      this.applyLayerPan(); return
    }
    // Strip layer prefix when broadcasting param changes to voices.
    const layerKey: LayerKey | null =
      path.startsWith('upper.') ? 'upper' :
      path.startsWith('lower.') ? 'lower' : null
    if (layerKey) {
      const voicePath = path.slice(6)
      const chain = layerKey === 'upper' ? this.upper : this.lower
      if (chain) for (const v of chain.voices) {
        v.port.postMessage({ type: 'param', path: voicePath, value })
      }
    }
  }

  private layers(): LayerChain[] {
    return this.upper && this.lower ? [this.upper, this.lower]
         : this.upper ? [this.upper]
         : []
  }

  private broadcastPatch(): void {
    if (this.upper) this.broadcastLayer(this.upper, this.patch.upper)
    if (this.lower) this.broadcastLayer(this.lower, this.patch.lower)
  }

  private broadcastLayer(chain: LayerChain, layer: LayerPatch): void {
    const snap = structuredClone(toPlainObject(layer))
    for (const v of chain.voices) {
      v.port.postMessage({ type: 'patch', patch: snap })
    }
  }

  private applyAllFx(): void {
    if (this.upper) {
      this.upper.chorus.setParams(this.patch.fx.chorus)
      this.upper.delay.setParams(this.patch.fx.delay)
      this.upper.reverb.setParams(this.patch.fx.reverb)
    }
    if (this.lower) {
      const fx: FxParams = this.patch.fxLower ?? this.patch.fx
      this.lower.chorus.setParams(fx.chorus)
      this.lower.delay.setParams(fx.delay)
      this.lower.reverb.setParams(fx.reverb)
    }
  }

  private applyLayerPan(): void {
    const t = this.context.currentTime
    if (this.upper) this.upper.panner.pan.setTargetAtTime(this.patch.upper.pan, t, 0.02)
    if (this.lower) this.lower.panner.pan.setTargetAtTime(this.patch.lower.pan, t, 0.02)
  }

  private applyMasterControls(): void {
    if (!this.master || !this.limiter || !this.analyser) return
    if (this.patch.master.limiter) {
      // Master → limiter → analyser (already wired in init)
    } else {
      // Bypass limiter: master → analyser direct. Simple mode toggle by
      // setting limiter ratio low and threshold high, effectively transparent.
      this.limiter.threshold.value = 0
      this.limiter.ratio.value = 1
    }
    this.master.gain.value = this.patch.master.volume
  }

  // Bring layer chains in/out of existence to match patch.voiceMode.
  private reconcileLayers(): void {
    const wantLower = this.patch.voiceMode !== 'single'
    if (wantLower && !this.lower) {
      this.lower = this.buildLayerChain('lower')
      if (this.lower) this.broadcastLayer(this.lower, this.patch.lower)
    } else if (!wantLower && this.lower) {
      this.destroyLayerChain(this.lower)
      this.lower = null
    }
  }

  // Resize voice pools when patch polyphony changes. Cheap teardown of
  // affected chains and rebuild.
  private reconcilePolyphony(): void {
    const want = this.patch.master.polyphony
    if (want === this.polyphony) return
    this.polyphony = want
    // Rebuild upper
    if (this.upper) {
      this.destroyLayerChain(this.upper)
      this.upper = this.buildLayerChain('upper')
      this.broadcastLayer(this.upper, this.patch.upper)
    }
    if (this.lower) {
      this.destroyLayerChain(this.lower)
      this.lower = this.buildLayerChain('lower')
      this.broadcastLayer(this.lower, this.patch.lower)
    }
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  async dispose(): Promise<void> {
    if (this.upper) this.destroyLayerChain(this.upper)
    if (this.lower) this.destroyLayerChain(this.lower)
    this.master?.disconnect()
    this.limiter?.disconnect()
    this.analyser?.disconnect()
    if (this.ownsContext) await this.context.close()
  }
}

