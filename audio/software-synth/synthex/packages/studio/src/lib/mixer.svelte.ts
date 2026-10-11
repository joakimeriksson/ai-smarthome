// The mixer's building blocks, in the shape every DAW uses:
//
//   track   instrument -> [inserts] -> mute -> fader -> pan -> meter -> master
//                                        |pre              |post
//                                        +-- sends --------+--> return buses
//   return  input -> [inserts] -> mute -> fader -> pan -> meter -> master
//   master  input -> [inserts] -> fader -> limiter -> meter -> speakers
//
// An insert chain is one AudioWorkletNode (public/fx/fx-processor.js) that
// runs its slots in order. A return is a bus with its own chain, fed by the
// tracks' sends — so one reverb serves every track that sends to it, instead
// of each synth running its own.

import {
  fxDef, resolveParams, type FxContext, type FxKind, type FxSlotSpec, type ProjectBus,
} from './fx.ts'

/** Load the effects worklet into a context; once per context. */
export async function loadFxModule(ctx: BaseAudioContext): Promise<void> {
  await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}fx/fx-processor.js`)
}

let slotSeq = 1

/** One effect in a chain. Its params are always complete (every parameter). */
export class FxSlot {
  readonly id = `fx${slotSeq++}`
  params = $state<Record<string, number>>({})
  bypass = $state(false)
  /** The preset last chosen, until a parameter is edited by hand. */
  preset = $state<string | null>(null)

  constructor(readonly kind: FxKind) {}

  get name(): string { return fxDef(this.kind).name }
}

/** An ordered chain of effect slots on one worklet node. */
export class FxChain {
  slots = $state<FxSlot[]>([])
  readonly node: AudioWorkletNode

  constructor(ctx: AudioContext, readonly context: FxContext) {
    this.node = new AudioWorkletNode(ctx, 'studio-fx', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // A mono source is upmixed rather than processed as one channel.
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    })
  }

  add(kind: FxKind, index = this.slots.length, preset?: string): FxSlot {
    const def = fxDef(kind)
    const slot = new FxSlot(kind)
    const name = preset ?? def.presets[0]?.name
    const spec: FxSlotSpec = name ? { kind, preset: name } : { kind }
    slot.params = resolveParams(spec, this.context)
    slot.preset = name ?? null
    const next = [...this.slots]
    next.splice(Math.max(0, Math.min(index, next.length)), 0, slot)
    this.slots = next
    this.sync()
    return this.slots.find(s => s.id === slot.id)!
  }

  remove(id: string): void {
    this.slots = this.slots.filter(s => s.id !== id)
    this.sync()
  }

  /** Move a slot one place earlier (-1) or later (+1) in the chain. */
  move(id: string, dir: -1 | 1): void {
    const i = this.slots.findIndex(s => s.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= this.slots.length) return
    const next = [...this.slots]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    this.slots = next
    this.sync()
  }

  /**
   * `performed`: the change is a performance gesture (a scatter pad punching
   * the mix in and out), not an edit, so the slot keeps its preset's name.
   */
  setParam(id: string, name: string, value: number, performed = false): void {
    const slot = this.slots.find(s => s.id === id)
    if (!slot) return
    slot.params[name] = value
    if (!performed) slot.preset = null
    this.node.port.postMessage({ type: 'param', id, name, value })
  }

  setBypass(id: string, on: boolean): void {
    const slot = this.slots.find(s => s.id === id)
    if (!slot) return
    slot.bypass = on
    this.node.port.postMessage({ type: 'bypass', id, on })
  }

  applyPreset(id: string, presetName: string): void {
    const slot = this.slots.find(s => s.id === id)
    if (!slot) return
    slot.params = resolveParams({ kind: slot.kind, preset: presetName }, this.context)
    slot.preset = presetName
    this.sync()
  }

  tempo(bpm: number): void {
    this.node.port.postMessage({ type: 'tempo', bpm })
  }

  /**
   * The song is at `beat` at context time `at`: Scatter's steps and the
   * tempo-synced LFOs align to it. Remembered, so an effect added later is
   * in step at once.
   */
  position(beat: number, at: number): void {
    this.lastPos = { beat, at }
    if (this.slots.length) this.node.port.postMessage({ type: 'pos', beat, at })
  }
  private lastPos: { beat: number; at: number } | null = null

  /** Send the whole chain to the worklet (slots it already runs keep their state). */
  sync(): void {
    this.node.port.postMessage({
      type: 'chain',
      slots: this.slots.map(s => ({ id: s.id, kind: s.kind, params: { ...s.params }, bypass: s.bypass })),
    })
    if (this.lastPos) this.position(this.lastPos.beat, this.lastPos.at)
  }

  /** The chain as the project file stores it. */
  specs(): FxSlotSpec[] {
    return this.slots.map(s => {
      const spec: FxSlotSpec = { kind: s.kind, params: { ...s.params } }
      if (s.bypass) spec.bypass = true
      if (s.preset) spec.preset = s.preset
      return spec
    })
  }

  load(specs: FxSlotSpec[] | undefined): void {
    this.slots = (specs ?? []).map(spec => {
      const slot = new FxSlot(spec.kind)
      slot.params = resolveParams(spec, this.context)
      slot.bypass = !!spec.bypass
      slot.preset = spec.preset ?? null
      return slot
    })
    this.sync()
  }

  dispose(): void {
    this.node.disconnect()
    this.node.port.close()
  }
}

/** Peak 0..1 from an analyser, for the meters. */
export function peakOf(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf)
  let peak = 0
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i]!)
    if (v > peak) peak = v
  }
  return Math.min(1, peak)
}

/**
 * A return bus, or the master. Returns are solo-safe: soloing a track keeps
 * the reverb it sends to audible, as on any desk.
 */
export class Bus {
  name = $state('')
  level = $state(0.8)
  pan = $state(0)
  muted = $state(false)

  readonly input: GainNode
  readonly chain: FxChain
  private readonly muteGain: GainNode
  private readonly fader: GainNode
  private readonly panner: StereoPannerNode | null
  private readonly analyser: AnalyserNode
  private readonly meterBuf: Float32Array<ArrayBuffer>

  /**
   * `out` is where the bus goes: the master's input for a return, the
   * limiter for the master.
   */
  constructor(ctx: AudioContext, readonly id: string, name: string, out: AudioNode, readonly isMaster = false) {
    this.name = name
    this.input = new GainNode(ctx, { gain: 1 })
    this.chain = new FxChain(ctx, isMaster ? 'insert' : 'return')
    this.muteGain = new GainNode(ctx, { gain: 1 })
    this.fader = new GainNode(ctx, { gain: this.level })
    this.analyser = new AnalyserNode(ctx, { fftSize: 256 })
    this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
    this.input.connect(this.chain.node).connect(this.muteGain).connect(this.fader)
    // The master is not panned: fader -> limiter (`out`) -> meter -> speakers.
    if (isMaster) {
      this.panner = null
      this.fader.connect(out).connect(this.analyser).connect(ctx.destination)
    } else {
      this.panner = new StereoPannerNode(ctx, { pan: 0 })
      this.fader.connect(this.panner).connect(this.analyser).connect(out)
    }
  }

  applyMix(): void {
    this.muteGain.gain.value = this.muted ? 0 : 1
    this.fader.gain.value = this.level
    if (this.panner) this.panner.pan.value = this.pan
  }

  meter(): number { return peakOf(this.analyser, this.meterBuf) }

  /** The bus as the project file stores it (returns only). */
  spec(): ProjectBus {
    return { id: this.id, name: this.name, level: this.level, pan: this.pan, muted: this.muted, inserts: this.chain.specs() }
  }

  dispose(): void {
    this.input.disconnect()
    this.chain.dispose()
    this.muteGain.disconnect()
    this.fader.disconnect()
    this.panner?.disconnect()
    this.analyser.disconnect()
  }
}
