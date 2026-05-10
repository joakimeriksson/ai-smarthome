// Linear ADSR envelope. State machine driven, sample-accurate transitions.
// Linear segments are click-free for Phase 1 verification; exponential
// curves can come later if we want more "analog" feel.

export type EnvStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release'

export interface AdsrParams {
  a: number // seconds
  d: number // seconds
  s: number // 0..1 sustain level
  r: number // seconds
}

export class Adsr {
  stage: EnvStage = 'idle'
  level = 0
  // Snapshot of `level` at the moment of noteOff, so release can be linear
  // (decays to 0 in exactly `r` seconds regardless of where it started).
  private releaseStart = 0

  constructor(private readonly sr: number) {}

  noteOn(): void {
    this.stage = 'attack'
  }

  noteOff(): void {
    if (this.stage === 'idle') return
    this.releaseStart = this.level
    this.stage = 'release'
  }

  step(p: AdsrParams): number {
    switch (this.stage) {
      case 'idle': return 0
      case 'attack': {
        const inc = 1 / (Math.max(p.a, 1e-4) * this.sr)
        this.level += inc
        if (this.level >= 1) {
          this.level = 1
          this.stage = 'decay'
        }
        return this.level
      }
      case 'decay': {
        const inc = (1 - p.s) / (Math.max(p.d, 1e-4) * this.sr)
        this.level -= inc
        if (this.level <= p.s) {
          this.level = p.s
          this.stage = 'sustain'
        }
        return this.level
      }
      case 'sustain': return p.s
      case 'release': {
        const inc = this.releaseStart / (Math.max(p.r, 1e-4) * this.sr)
        this.level -= inc
        if (this.level <= 0) {
          this.level = 0
          this.stage = 'idle'
        }
        return this.level
      }
    }
  }
}
