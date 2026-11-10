// Low-frequency oscillator. Four shapes per PLAN.md §4 (LfoShape):
//   tri — symmetric triangle in [-1, 1]
//   square — bipolar square ±1
//   sample-hold — random level, held for one period
//   random — smoothed random walk (slewed S&H, less stepped than 'sample-hold')
//   ramp / ramp-down — rising and falling sawtooth (Synthex LFO1 shapes 3 and 2)
//
// Optional `delay` ramps the output amplitude in over `delay` seconds after
// the last trigger() or sync() — like the original's LFO delay knob.
//
// The Synthex has one LFO per layer (board 5850), not one per voice, and it
// never stops: `advance` carries a silent voice's copy along, so that every
// voice of a layer, stepped or advanced by the same number of samples, holds
// the same phase. `sync` is that board's SYNC strobe (see VoiceCore.syncLfo).

import type { LfoShape } from '../patch.ts'

export class Lfo {
  private phase = 0
  private shValue = 0
  private nextShValue = 0
  private smoothed = 0
  private elapsed = 0 // seconds since noteOn (used for delay ramp)
  private rng = 0x9e3779b1 | 0

  constructor(private readonly sr: number) {}

  // Reset on noteOn when sync=true (key sync). Free-running otherwise.
  trigger(): void {
    this.phase = 0
    this.elapsed = 0
    this.shValue = this.nextRand()
    this.nextShValue = this.nextRand()
  }

  /**
   * The LFO board's SYNC strobe: the delay ramp starts again and the oscillator restarts. Its core is a
   * falling ramp (a capacitor charged to +5 V and discharged by the rate's current), reset to the top; the
   * triangle is that ramp folded at its middle, and for it the strobe instead sets the capacitor to a
   * quarter of its swing (the 3.3K / 1K divider on 4066 2G), the triangle's own middle.
   */
  sync(shape: LfoShape): void {
    this.phase = shape === 'tri' ? 0.75 : 0
    this.elapsed = 0
    this.smoothed = Lfo.raw(shape, this.phase, this.shValue, this.nextShValue)
  }

  /** `n` samples pass without output (a silent voice): the same phase and delay ramp as `n` steps. */
  advance(rateHz: number, shape: LfoShape, delaySec: number, n: number): void {
    if (n <= 0) return
    const dt = rateHz / this.sr
    const last = this.phase + (n - 1) * dt        // where the last of the n steps read the waveform
    const end = last + dt
    const wraps = Math.floor(end)
    for (let k = Math.min(wraps, 2); k > 0; k--) { this.shValue = this.nextShValue; this.nextShValue = this.nextRand() }
    this.smoothed = Lfo.raw(shape, last - Math.floor(last), this.shValue, this.nextShValue)
    this.phase = end - wraps
    if (delaySec > 0) this.elapsed += n / this.sr
  }

  private static raw(shape: LfoShape, phase: number, sh: number, nextSh: number): number {
    switch (shape) {
      case 'tri': return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4
      case 'square': return phase < 0.5 ? 1 : -1
      case 'sample-hold': return sh
      case 'random': return sh + (nextSh - sh) * phase
      // Saw rising over the period, mapped to [-1, +1]
      case 'ramp': return phase * 2 - 1
      // Falling ramp (the Synthex LFO's second shape): 1 → -1 over the period
      case 'ramp-down': return 1 - phase * 2
      // Unipolar square: 0 or 1, then mapped to [-1, +1]
      case 'square-uni': return (phase < 0.5 ? 1 : 0) * 2 - 1
    }
    return 0
  }

  private nextRand(): number {
    let x = this.rng | 0
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.rng = x | 0
    return (x | 0) / 0x80000000
  }

  // Returns next sample in [-1, 1], scaled by the delay envelope.
  step(rateHz: number, shape: LfoShape, delaySec: number): number {
    const dt = rateHz / this.sr
    const raw = Lfo.raw(shape, this.phase, this.shValue, this.nextShValue)
    // Smooth a touch (one-pole, cheap) so square-wave LFO doesn't click hard
    // when routed to pitch / amp; preserves character at audio mod rates.
    this.smoothed += 0.5 * (raw - this.smoothed)

    this.phase += dt
    if (this.phase >= 1) {
      this.phase -= 1
      this.shValue = this.nextShValue
      this.nextShValue = this.nextRand()
    }

    // Delay ramp
    let amp = 1
    if (delaySec > 0) {
      this.elapsed += 1 / this.sr
      if (this.elapsed < delaySec) amp = this.elapsed / delaySec
    }
    return this.smoothed * amp
  }
}
