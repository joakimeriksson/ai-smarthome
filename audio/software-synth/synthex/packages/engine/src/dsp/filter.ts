// Multi-mode filter with Synthex's five tap configurations:
//   lp24 — two cascaded SVFs, LP outputs (24 dB/oct)
//   lp12 — single SVF, LP output
//   bp12 — single SVF, BP output (with Q-normalized gain)
//   bp6  — single SVF, BP output, gentle Q (6 dB/oct character)
//   hp12 — single SVF, HP output
//
// Cutoff is supplied in Hz; resonance is mapped to Q on the call site.

import { ZdfSvf, svfCoeffs, type SvfCoeffs } from './svf.ts'
import type { FilterMode } from '../patch.ts'

export class MultiModeFilter {
  private readonly a = new ZdfSvf()
  private readonly b = new ZdfSvf() // Used only for lp24 cascade.

  reset(): void {
    this.a.reset()
    this.b.reset()
  }

  // c is precomputed once per block. mode picks the tap and (for lp24) the
  // second cascade stage.
  step(input: number, mode: FilterMode, c: SvfCoeffs): number {
    const o = this.a.step(input, c)
    switch (mode) {
      case 'lp24': {
        const o2 = this.b.step(o.lp, c)
        return o2.lp
      }
      case 'lp12': return o.lp
      case 'hp12': return o.hp
      case 'bp12': return o.bp * 2 // BP loses ~6 dB at peak; compensate
      case 'bp6':  return o.bp
    }
  }
}

export { svfCoeffs }
export type { SvfCoeffs }
