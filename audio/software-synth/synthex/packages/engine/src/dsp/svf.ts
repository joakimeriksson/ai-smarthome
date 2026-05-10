// Zero-Delay-Feedback State-Variable Filter (Vadim Zavalishin TPT topology).
// Single instance gives LP/BP/HP simultaneously at 12 dB/oct.
// Cascade two for 24 dB/oct LP. The Synthex's 6 dB BP is just the BP output
// without resonance (or simply Q=0.5 with reduced gain).

export interface SvfCoeffs {
  g: number
  twoRplusG: number
  denom: number
}

export function svfCoeffs(cutoffHz: number, sampleRate: number, q: number): SvfCoeffs {
  const fc = Math.min(Math.max(cutoffHz, 20), sampleRate * 0.45)
  const g = Math.tan(Math.PI * fc / sampleRate)
  const R = 1 / (2 * q)
  return {
    g,
    twoRplusG: 2 * R + g,
    denom: 1 + 2 * R * g + g * g,
  }
}

export interface SvfOutputs {
  lp: number
  bp: number
  hp: number
}

export class ZdfSvf {
  private ic1 = 0
  private ic2 = 0
  // Scratch struct reused per call to avoid allocations.
  private readonly out: SvfOutputs = { lp: 0, bp: 0, hp: 0 }

  reset(): void {
    this.ic1 = 0
    this.ic2 = 0
  }

  step(input: number, c: SvfCoeffs): SvfOutputs {
    const hp = (input - c.twoRplusG * this.ic1 - this.ic2) / c.denom
    const bp = c.g * hp + this.ic1
    const lp = c.g * bp + this.ic2
    this.ic1 = c.g * hp + bp
    this.ic2 = c.g * bp + lp
    this.out.hp = hp
    this.out.bp = bp
    this.out.lp = lp
    return this.out
  }
}

// Backwards-compatible single-output LP wrapper used by Phase 1 tests.
export class ZdfSvfLowpass {
  private readonly inner = new ZdfSvf()

  reset(): void {
    this.inner.reset()
  }

  step(input: number, c: SvfCoeffs): number {
    return this.inner.step(input, c).lp
  }
}
