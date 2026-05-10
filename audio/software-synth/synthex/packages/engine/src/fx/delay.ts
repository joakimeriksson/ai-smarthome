// Stereo echo with three modes (standard / tape / ping-pong) + tone EQ + spread.
//
// Standard:   straight stereo delay (L=time, R=time × (1 + spread))
// Ping-pong:  alternating L/R taps; feedback path crosses
// Tape:       same routing as standard with a slow LFO on delayTime to add
//             ~0.4% wow/flutter, evoking tape-machine pitch wobble

import type { DelayParams, DelayMode } from '../patch.ts'

export class StereoDelay {
  readonly input: GainNode
  readonly output: GainNode
  private readonly delayL: DelayNode
  private readonly delayR: DelayNode
  private readonly fbL: GainNode      // self feedback (standard/tape)
  private readonly fbR: GainNode
  private readonly xfbL: GainNode     // cross-feed feedback (ping-pong)
  private readonly xfbR: GainNode
  private readonly toneL: BiquadFilterNode
  private readonly toneR: BiquadFilterNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private readonly merger: ChannelMergerNode
  private readonly wowLfo: OscillatorNode
  private readonly wowDepthL: GainNode
  private readonly wowDepthR: GainNode
  private currentMode: DelayMode = 'standard'

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx)
    this.output = new GainNode(ctx)
    this.dry = new GainNode(ctx, { gain: 1 })
    this.wet = new GainNode(ctx, { gain: 0 })

    this.delayL = new DelayNode(ctx, { delayTime: 0.25, maxDelayTime: 4 })
    this.delayR = new DelayNode(ctx, { delayTime: 0.5,  maxDelayTime: 4 })

    this.fbL  = new GainNode(ctx, { gain: 0.3 })
    this.fbR  = new GainNode(ctx, { gain: 0.3 })
    this.xfbL = new GainNode(ctx, { gain: 0 })
    this.xfbR = new GainNode(ctx, { gain: 0 })

    this.toneL = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 800, gain: 0 })
    this.toneR = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 800, gain: 0 })

    // Wow LFO for tape mode (off by default = depth 0)
    this.wowLfo = new OscillatorNode(ctx, { type: 'sine', frequency: 0.7 })
    this.wowDepthL = new GainNode(ctx, { gain: 0 })
    this.wowDepthR = new GainNode(ctx, { gain: 0 })
    this.wowLfo.connect(this.wowDepthL).connect(this.delayL.delayTime)
    this.wowLfo.connect(this.wowDepthR).connect(this.delayR.delayTime)
    this.wowLfo.start()

    // Routing
    this.input.connect(this.delayL)
    this.input.connect(this.delayR)
    // Self-feedback
    this.delayL.connect(this.fbL).connect(this.delayL)
    this.delayR.connect(this.fbR).connect(this.delayR)
    // Cross-feedback (off by default; enabled in ping-pong)
    this.delayL.connect(this.xfbL).connect(this.delayR)
    this.delayR.connect(this.xfbR).connect(this.delayL)

    this.delayL.connect(this.toneL)
    this.delayR.connect(this.toneR)
    this.merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
    this.toneL.connect(this.merger, 0, 0)
    this.toneR.connect(this.merger, 0, 1)
    this.merger.connect(this.wet).connect(this.output)
    this.input.connect(this.dry).connect(this.output)
  }

  setParams(p: DelayParams): void {
    const t = this.ctx.currentTime
    const tau = 0.05
    this.delayL.delayTime.setTargetAtTime(Math.max(0.01, p.time), t, tau)
    this.delayR.delayTime.setTargetAtTime(Math.max(0.01, p.time * (1 + p.spread)), t, tau)

    if (p.mode !== this.currentMode) {
      this.currentMode = p.mode
      switch (p.mode) {
        case 'standard':
          this.fbL.gain.value  = p.feedback * 0.95
          this.fbR.gain.value  = p.feedback * 0.95
          this.xfbL.gain.value = 0
          this.xfbR.gain.value = 0
          this.wowDepthL.gain.value = 0
          this.wowDepthR.gain.value = 0
          break
        case 'pingpong':
          this.fbL.gain.value  = 0
          this.fbR.gain.value  = 0
          this.xfbL.gain.value = p.feedback * 0.95
          this.xfbR.gain.value = p.feedback * 0.95
          this.wowDepthL.gain.value = 0
          this.wowDepthR.gain.value = 0
          break
        case 'tape':
          this.fbL.gain.value  = p.feedback * 0.85
          this.fbR.gain.value  = p.feedback * 0.85
          this.xfbL.gain.value = 0
          this.xfbR.gain.value = 0
          // ~0.4% pitch wow on each side, in opposite phase
          this.wowDepthL.gain.value =  p.time * 0.004
          this.wowDepthR.gain.value = -p.time * 0.004
          break
      }
    } else {
      // Same mode — refresh feedback amounts
      const fb = p.mode === 'pingpong' ? 0 : (p.mode === 'tape' ? 0.85 : 0.95) * p.feedback
      const xfb = p.mode === 'pingpong' ? p.feedback * 0.95 : 0
      this.fbL.gain.setTargetAtTime(fb, t, tau)
      this.fbR.gain.setTargetAtTime(fb, t, tau)
      this.xfbL.gain.setTargetAtTime(xfb, t, tau)
      this.xfbR.gain.setTargetAtTime(xfb, t, tau)
    }

    // Tone: -1..1 maps to -12..+12 dB low-shelf (negative = darker, positive = brighter
    // since shelving boosts the highs through the cut on lows).
    const toneDb = (p.tone - 0.5) * 24
    this.toneL.gain.setTargetAtTime(toneDb, t, tau)
    this.toneR.gain.setTargetAtTime(toneDb, t, tau)

    this.wet.gain.setTargetAtTime(p.enabled ? p.mix : 0, t, 0.02)
    this.dry.gain.setTargetAtTime(p.enabled ? 1 - p.mix * 0.5 : 1, t, 0.02)
  }
}
