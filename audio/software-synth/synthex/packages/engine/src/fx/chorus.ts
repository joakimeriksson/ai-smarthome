// Stereo chorus, original-style. Two delay taps modulated by a slow
// triangle LFO in opposite phase between L and R channels. The original's
// 3-position switch maps to (rate, depth) presets:
//   1 — slow & shallow
//   2 — medium
//   3 — fast & deep
//
// Built from Web Audio nodes (no worklet needed for this rate).

import type { ChorusMode, ChorusParams } from '../patch.ts'

export const CHORUS_PRESETS: Record<ChorusMode, { rate: number; depth: number }> = {
  1: { rate: 0.30, depth: 0.0020 },
  2: { rate: 0.55, depth: 0.0040 },
  3: { rate: 0.90, depth: 0.0070 },
}

export class StereoChorus {
  readonly input: GainNode
  readonly output: GainNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private readonly delayL: DelayNode
  private readonly delayR: DelayNode
  private readonly lfoL: OscillatorNode
  private readonly lfoR: OscillatorNode
  private readonly depthL: GainNode
  private readonly depthR: GainNode
  private readonly merger: ChannelMergerNode
  private readonly baseDelay = 0.012 // 12 ms baseline

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx)
    this.output = new GainNode(ctx)
    this.dry = new GainNode(ctx, { gain: 0.7 })
    this.wet = new GainNode(ctx, { gain: 0.3 })

    this.delayL = new DelayNode(ctx, { delayTime: this.baseDelay, maxDelayTime: 0.05 })
    this.delayR = new DelayNode(ctx, { delayTime: this.baseDelay, maxDelayTime: 0.05 })

    this.lfoL = new OscillatorNode(ctx, { type: 'sine', frequency: 0.5 })
    this.lfoR = new OscillatorNode(ctx, { type: 'sine', frequency: 0.5 })
    this.depthL = new GainNode(ctx, { gain: 0.003 })
    this.depthR = new GainNode(ctx, { gain: 0.003 })

    // Right LFO is inverted to widen the stereo image.
    const invR = new GainNode(ctx, { gain: -1 })

    this.lfoL.connect(this.depthL).connect(this.delayL.delayTime)
    this.lfoR.connect(invR).connect(this.depthR).connect(this.delayR.delayTime)
    this.lfoL.start()
    this.lfoR.start()

    this.merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
    this.input.connect(this.delayL).connect(this.merger, 0, 0)
    this.input.connect(this.delayR).connect(this.merger, 0, 1)

    this.input.connect(this.dry).connect(this.output)
    this.merger.connect(this.wet).connect(this.output)
  }

  setParams(p: ChorusParams): void {
    const preset = CHORUS_PRESETS[p.mode]
    const rate = preset.rate * (0.5 + p.rate)        // patch rate biases
    const depth = preset.depth * (0.5 + p.depth)     // patch depth biases
    const t = this.ctx.currentTime
    this.lfoL.frequency.setTargetAtTime(rate, t, 0.05)
    this.lfoR.frequency.setTargetAtTime(rate, t, 0.05)
    this.depthL.gain.setTargetAtTime(depth, t, 0.05)
    this.depthR.gain.setTargetAtTime(depth, t, 0.05)

    const wetTarget = p.enabled ? p.mix : 0
    const dryTarget = p.enabled ? 1 - p.mix * 0.5 : 1
    this.wet.gain.setTargetAtTime(wetTarget, t, 0.02)
    this.dry.gain.setTargetAtTime(dryTarget, t, 0.02)
  }
}
