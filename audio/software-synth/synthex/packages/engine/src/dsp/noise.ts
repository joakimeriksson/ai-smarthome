// White noise. xorshift32 — fast, deterministic across worklet instances
// when seeded distinctly per voice (avoids correlated noise across voices).

export class WhiteNoise {
  private state: number

  constructor(seed: number = (Math.random() * 0xffffffff) | 0 || 1) {
    this.state = seed === 0 ? 1 : seed | 0
  }

  next(): number {
    let x = this.state | 0
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.state = x | 0
    return (x | 0) / 0x80000000
  }
}

// Pink noise via Voss-McCartney algorithm. Uses 16 octave-bands with the
// lowest band updated every sample and progressively higher bands updated
// less often. Output is divided by 16 to keep amplitude near unity.

export class PinkNoise {
  private readonly white: WhiteNoise
  private readonly bands = new Float32Array(16)
  private counter = 1

  constructor(seed?: number) {
    this.white = new WhiteNoise(seed)
    for (let i = 0; i < 16; i++) this.bands[i] = this.white.next()
  }

  next(): number {
    // Pick which band to update this sample by counting trailing zeros
    // of the running counter (Voss-McCartney trick).
    let bit = 0
    let c = this.counter
    while ((c & 1) === 0 && bit < 15) { c >>>= 1; bit++ }
    this.bands[bit] = this.white.next()
    this.counter = (this.counter + 1) | 0
    let sum = 0
    for (let i = 0; i < 16; i++) sum += this.bands[i]!
    return sum * (1 / 8)
  }
}
