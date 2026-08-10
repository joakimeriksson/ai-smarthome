// Transport + step-dispatch logic. Pure timing/routing — no audio hardware,
// so this runs in plain Node with a stub AudioContext clock.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Transport } from '../src/lib/transport.ts'

class FakeCtx {
  currentTime = 0
  advance(s: number) { this.currentTime += s }
}

const asCtx = (c: FakeCtx): AudioContext => c as unknown as AudioContext

/**
 * Run the scheduler for `seconds` of wall/audio time. The transport reads
 * ctx.currentTime AND relies on its interval, so both clocks must advance
 * together — otherwise the lookahead window never moves and only the first
 * step is ever scheduled.
 */
function run(ctx: FakeCtx, seconds: number): void {
  const stepMs = 25
  for (let elapsed = 0; elapsed < seconds * 1000; elapsed += stepMs) {
    ctx.advance(stepMs / 1000)
    vi.advanceTimersByTime(stepMs)
  }
}

describe('Transport', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('computes step duration from BPM and steps-per-beat', () => {
    const t = new Transport(asCtx(new FakeCtx()))
    t.bpm = 120
    t.stepsPerBeat = 4
    // 120 BPM → 0.5 s per beat → 16ths are 0.125 s
    expect(t.secondsPerStep()).toBeCloseTo(0.125, 6)
    t.bpm = 60
    expect(t.secondsPerStep()).toBeCloseTo(0.25, 6)
  })

  it('schedules steps in order at the right times, wrapping the pattern', () => {
    const ctx = new FakeCtx()
    const t = new Transport(asCtx(ctx))
    t.bpm = 120           // 0.125 s per step
    t.steps = 4
    const fired: { step: number; time: number }[] = []
    t.onStep((step, time) => fired.push({ step, time }))

    t.start()
    run(ctx, 1.0)   // 1 s at 0.125 s/step → 8 steps, wrapping a 4-step pattern
    expect(fired.length).toBeGreaterThanOrEqual(6)
    expect(fired[0]!.step).toBe(0)

    // Steps advance by exactly one step duration each.
    for (let i = 1; i < fired.length; i++) {
      const dt = fired[i]!.time - fired[i - 1]!.time
      expect(dt).toBeCloseTo(0.125, 6)
    }
    // Pattern wraps at `steps`.
    expect(fired.every(f => f.step >= 0 && f.step < 4)).toBe(true)
    const seq = fired.map(f => f.step)
    expect(seq.slice(0, 6)).toEqual([0, 1, 2, 3, 0, 1])
    t.stop()
  })

  it('delays odd steps when swing is applied', () => {
    const ctx = new FakeCtx()
    const t = new Transport(asCtx(ctx))
    t.bpm = 120
    t.swing = 0.5
    const fired: { step: number; time: number }[] = []
    t.onStep((step, time) => fired.push({ step, time }))
    t.start()
    run(ctx, 0.6)

    const even = fired.find(f => f.step === 0)!
    const odd = fired.find(f => f.step === 1)!
    // Straight would be 0.125 apart; swing 0.5 adds a quarter step (0.03125).
    expect(odd.time - even.time).toBeCloseTo(0.125 + 0.03125, 6)
    t.stop()
  })

  it('stops firing after stop()', () => {
    const ctx = new FakeCtx()
    const t = new Transport(asCtx(ctx))
    let count = 0
    t.onStep(() => count++)
    t.start()
    run(ctx, 0.5)
    const afterStart = count
    expect(afterStart).toBeGreaterThan(0)
    t.stop()
    run(ctx, 1.0)
    expect(count).toBe(afterStart)
  })
})
