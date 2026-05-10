// Convolution reverb with four IR generators (algorithm presets).
//
// Plate    — short, dense, bright; mild early reflections
// Room     — short, dry-ish, distinct early reflections
// Hall     — long, smooth, slow buildup
// Galactic — extra-long, heavily damped, ambient pad

import type { ReverbParams, ReverbAlgorithm } from '../patch.ts'

interface IRRecipe {
  baseSec: number          // shortest possible decay
  maxSec: number           // longest at size=1
  earlyReflections: number // taps before diffuse tail (0 = pure tail)
  brightness: number       // 0..1 baseline brightness
}

const RECIPES: Record<ReverbAlgorithm, IRRecipe> = {
  plate:    { baseSec: 0.6, maxSec: 2.5, earlyReflections: 4,  brightness: 0.85 },
  room:     { baseSec: 0.3, maxSec: 1.4, earlyReflections: 8,  brightness: 0.65 },
  hall:     { baseSec: 1.2, maxSec: 4.5, earlyReflections: 2,  brightness: 0.55 },
  galactic: { baseSec: 3.0, maxSec: 9.0, earlyReflections: 0,  brightness: 0.35 },
}

export class SynthReverb {
  readonly input: GainNode
  readonly output: GainNode
  private readonly conv: ConvolverNode
  private readonly wet: GainNode
  private readonly dry: GainNode
  private cacheKey = ''

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx)
    this.output = new GainNode(ctx)
    this.dry = new GainNode(ctx, { gain: 1 })
    this.wet = new GainNode(ctx, { gain: 0 })
    this.conv = new ConvolverNode(ctx)
    this.input.connect(this.conv).connect(this.wet).connect(this.output)
    this.input.connect(this.dry).connect(this.output)
  }

  private buildIR(algo: ReverbAlgorithm, sizeSec: number, damping: number): AudioBuffer {
    const sr = this.ctx.sampleRate
    const recipe = RECIPES[algo]
    const length = Math.max(1, Math.floor(sizeSec * sr))
    const ir = this.ctx.createBuffer(2, length, sr)
    const decayPower = -Math.log(0.001) / length

    // Damping LP coefficient — higher damping → more high-freq attenuation.
    const cutoffHz = 20000 * (1 - damping) * recipe.brightness + 200
    const dampCoef = 1 - Math.exp(-2 * Math.PI * cutoffHz / sr)

    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c)
      let lp = 0
      // Early reflections: a few sparse impulses with decreasing amplitude.
      for (let er = 0; er < recipe.earlyReflections; er++) {
        const offset = Math.floor((0.005 + er * 0.012 + Math.random() * 0.008) * sr)
        if (offset < length) data[offset] = (1 - er / recipe.earlyReflections) * 0.6
      }
      // Diffuse tail: filtered noise with exponential decay.
      for (let i = 0; i < length; i++) {
        const noise = Math.random() * 2 - 1
        lp += dampCoef * (noise - lp)
        const env = Math.exp(-decayPower * i)
        data[i] = (data[i] ?? 0) + lp * env
      }
    }
    return ir
  }

  setParams(p: ReverbParams): void {
    const recipe = RECIPES[p.algorithm]
    const sizeSec = recipe.baseSec + p.size * (recipe.maxSec - recipe.baseSec)
    const key = `${p.algorithm}|${sizeSec.toFixed(3)}|${p.damping.toFixed(3)}`
    if (key !== this.cacheKey) {
      this.cacheKey = key
      this.conv.buffer = this.buildIR(p.algorithm, sizeSec, p.damping)
    }
    const t = this.ctx.currentTime
    this.wet.gain.setTargetAtTime(p.enabled ? p.mix : 0, t, 0.05)
    this.dry.gain.setTargetAtTime(p.enabled ? 1 - p.mix * 0.5 : 1, t, 0.05)
  }
}
