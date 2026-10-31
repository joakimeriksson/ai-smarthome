// The Synthex's chorus, after its schematic (board 410CST5860, sheet 7 of the
// service schematics) and Per Kristian's recording.
//
// Each layer has its own chorus: a compander around two TDA1022 bucket-brigade
// lines (512 stages, a few milliseconds each), every line clocked by its own
// VCO that a triangle LFO sweeps. Line 1's LFO runs at 0.49 Hz (3.3 MΩ into
// 330 nF, thresholds at ±0.47 of the swing); line 2's at 0.60 Hz, or 4.6 Hz
// when a mode bit opens a 400 kΩ path beside the 2.7 MΩ one, and its sweep is
// 0.59 of line 1's (560 kΩ against 330 kΩ into the clock). The three buttons
// set the mode bits and the dry/wet resistors on the output amp. Measured on
// the recording (mode 3 on the strings): a 4.5 to 5 Hz wobble of ~9 cents and
// a 3 to 4 dB ripple in a mono mix, which is what two lines at these rates
// and ~0.18 wet give. Modes 1 and 2 are inferred from the circuit: line 1
// alone, then both lines with line 2 still slow.
//
// The hardware's stereo is upper layer left, lower layer right; this chorus
// keeps a stereo pair per layer by sweeping the right channel's lines in
// opposite phase, which widens the single-layer sounds the way the old one did.

import type { ChorusMode, ChorusParams } from '../patch.ts'

/** The bucket brigade's mean delay, seconds: 512 stages at a ~64 kHz clock. */
export const CHORUS_BASE = 0.004
/** Each mode's lines: triangle LFO rate (Hz), sweep around the base (seconds, peak) and wet gain at the patch's nominal mix of 0.5. */
export const CHORUS_LINES: Record<ChorusMode, { rate: number; depth: number; wet: number }[]> = {
  1: [{ rate: 0.49, depth: 0.0016, wet: 0.30 }],
  2: [{ rate: 0.49, depth: 0.0016, wet: 0.22 }, { rate: 0.60, depth: 0.0012, wet: 0.22 }],
  3: [{ rate: 0.49, depth: 0.0016, wet: 0.25 }, { rate: 4.6, depth: 0.0012, wet: 0.25 }],
}
/** A line's settings with the patch's rate / depth / mix biases applied (0.5 is neutral). */
export function chorusLine(p: ChorusParams, k: number): { rate: number; depth: number; wet: number } {
  const lines = CHORUS_LINES[p.mode]
  const line = lines[k]
  if (!line) return { rate: 0.49, depth: 0, wet: 0 }
  return { rate: line.rate * (0.5 + p.rate), depth: line.depth * (0.5 + p.depth), wet: line.wet * (p.mix / 0.5) }
}
/** Triangle from a phase in [0, 1): -1 at 0, +1 at 1/2. */
export const chorusTri = (phase: number): number => 1 - 4 * Math.abs(phase - 0.5)

export class StereoChorus {
  readonly input: GainNode
  readonly output: GainNode
  private readonly delays: DelayNode[][] = []   // [line][channel]
  private readonly lfos: OscillatorNode[] = []  // [line]
  private readonly depths: GainNode[][] = []    // [line][channel]
  private readonly wets: GainNode[] = []        // [line]
  private readonly merger: ChannelMergerNode

  constructor(private readonly ctx: BaseAudioContext) {
    this.input = new GainNode(ctx)
    this.output = new GainNode(ctx)
    this.merger = new ChannelMergerNode(ctx, { numberOfInputs: 2 })
    this.input.connect(this.output)              // dry, unity: the hardware sums the dry through 300 k and the wet beside it
    for (let k = 0; k < 2; k++) {
      const lfo = new OscillatorNode(ctx, { type: 'triangle', frequency: 0.49 })
      const wet = new GainNode(ctx, { gain: 0 })
      const line: DelayNode[] = [], depth: GainNode[] = []
      for (let ch = 0; ch < 2; ch++) {
        const d = new DelayNode(ctx, { delayTime: CHORUS_BASE, maxDelayTime: 0.02 })
        const g = new GainNode(ctx, { gain: ch ? -0.0014 : 0.0014 })   // the right channel swept in opposite phase
        lfo.connect(g).connect(d.delayTime)
        this.input.connect(d).connect(wet).connect(this.merger, 0, ch)
        line.push(d); depth.push(g)
      }
      lfo.start()
      this.delays.push(line); this.lfos.push(lfo); this.depths.push(depth); this.wets.push(wet)
    }
    this.merger.connect(this.output)
  }

  setParams(p: ChorusParams): void {
    const t = this.ctx.currentTime
    for (let k = 0; k < 2; k++) {
      const line = chorusLine(p, k)
      this.lfos[k]!.frequency.setTargetAtTime(line.rate, t, 0.05)
      this.depths[k]![0]!.gain.setTargetAtTime(line.depth, t, 0.05)
      this.depths[k]![1]!.gain.setTargetAtTime(-line.depth, t, 0.05)
      this.wets[k]!.gain.setTargetAtTime(p.enabled ? line.wet : 0, t, 0.02)
    }
  }
}
