// ADSR envelope. State machine driven, sample-accurate transitions.
// Attack and decay are linear ramps (the Synthex's envelope CVs ramp
// linearly: its filter sweeps fall linearly in note space). The release is
// exponential, as the hardware's amplitude falls linearly in dB after
// note-off: `r` is the time to fall 20 dB (a tenth of the level at note-off),
// and the stage ends at -80 dB. Measured on Per Kristian's recording of the
// 40 ROM presets; see tools/synthex-rom/README.md.

export type EnvStage = 'idle' | 'attack' | 'decay' | 'sustain' | 'release'

export interface AdsrParams {
  a: number // seconds
  d: number // seconds
  s: number // 0..1 sustain level
  r: number // seconds
}

const LN10 = Math.log(10)
const RELEASE_FLOOR = 1e-4 // -80 dB: the release stage ends here

export class Adsr {
  stage: EnvStage = 'idle'
  level = 0
  // Per-sample multiplier for the release, cached per `r` value.
  private releaseMul = 0
  private releaseFor = -1

  constructor(private readonly sr: number) {}

  noteOn(): void {
    this.stage = 'attack'
  }

  noteOff(): void {
    if (this.stage === 'idle') return
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
        if (p.r !== this.releaseFor) {
          // 20 dB (a factor 10) per `r` seconds
          this.releaseFor = p.r
          this.releaseMul = Math.exp(-LN10 / (Math.max(p.r, 1e-4) * this.sr))
        }
        this.level *= this.releaseMul
        if (this.level <= RELEASE_FLOOR) {
          this.level = 0
          this.stage = 'idle'
        }
        return this.level
      }
    }
  }
}
