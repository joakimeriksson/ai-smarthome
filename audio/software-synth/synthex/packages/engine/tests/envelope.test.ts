import { describe, it, expect } from 'vitest'
import { Adsr } from '../src/dsp/adsr'

const SR = 48000
const params = { a: 0.01, d: 0.2, s: 0.7, r: 0.3 }

describe('ADSR', () => {
  it('reaches sustain after attack + decay and stays there', () => {
    const env = new Adsr(SR)
    env.noteOn()
    const attackSamples = Math.floor(params.a * SR)
    const decaySamples = Math.floor(params.d * SR)
    let last = 0
    for (let i = 0; i < attackSamples + decaySamples + 100; i++) {
      last = env.step(params)
    }
    expect(last).toBeCloseTo(params.s, 2)
    expect(env.stage).toBe('sustain')
  })

  it('decays to zero on noteOff', () => {
    const env = new Adsr(SR)
    env.noteOn()
    // Hold long enough to reach sustain
    for (let i = 0; i < SR; i++) env.step(params)
    env.noteOff()
    expect(env.stage).toBe('release')
    let last = 1
    for (let i = 0; i < Math.floor(params.r * SR) + 100; i++) {
      last = env.step(params)
    }
    expect(last).toBe(0)
    expect(env.stage).toBe('idle')
  })

  it('attack reaches 1.0 within the attack time (±5%)', () => {
    const env = new Adsr(SR)
    env.noteOn()
    let i = 0
    while (env.stage === 'attack' && i < SR) {
      env.step(params)
      i++
    }
    const expected = params.a * SR
    expect(i).toBeGreaterThan(expected * 0.95)
    expect(i).toBeLessThan(expected * 1.05)
  })
})
