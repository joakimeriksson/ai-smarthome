// Low-frequency oscillator. Four shapes per PLAN.md §4 (LfoShape):
//   tri — symmetric triangle in [-1, 1]
//   square — bipolar square ±1
//   sample-hold — random level, held for one period
//   random — smoothed random walk (slewed S&H, less stepped than 'sample-hold')
//
// Optional `delay` ramps the output amplitude in over `delay` seconds after
// noteOn — like the original's LFO delay slider.

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
    let raw = 0
    switch (shape) {
      case 'tri': {
        raw = this.phase < 0.5 ? this.phase * 4 - 1 : 3 - this.phase * 4
        break
      }
      case 'square':
        raw = this.phase < 0.5 ? 1 : -1
        break
      case 'sample-hold':
        raw = this.shValue
        break
      case 'random':
        raw = this.shValue + (this.nextShValue - this.shValue) * this.phase
        break
      case 'ramp':
        // Saw rising 0→1 over the period, mapped to [-1, +1]
        raw = this.phase * 2 - 1
        break
      case 'square-uni':
        // Unipolar square: 0 or 1, then mapped to [-1, +1]
        raw = this.phase < 0.5 ? 1 : 0
        raw = raw * 2 - 1
        break
    }
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
