// PolyBLEP-corrected oscillators (saw, square with PWM, triangle, sine) with
// band-limited hard sync.
// Reference: Välimäki & Huovilainen, "Antialiasing Oscillators in Subtractive Synthesis".
//
// All oscillators expose a stateful `next(dt)` returning the next sample in
// [-1, 1]. dt = freq / sampleRate; clamp the caller side to keep the
// BLEP correction window valid (roughly dt < 0.4).
//
// Discontinuities are corrected with the two-sample PolyBLEP. For a step of
// size A at time τ samples after the current sample (0 < τ <= 1), the current
// sample gets A * stepBefore(τ) and the next one A * stepAfter(1 - τ). A
// slope change of S (per sample) gets the integrated form, slopeBefore /
// slopeAfter (PolyBLAMP), which the triangle's corners and every sync reset
// need.

export function stepBefore(tau: number): number { const u = 1 - tau; return u * u / 2 }
export function stepAfter(t: number): number { const u = 1 - t; return -u * u / 2 }
export function slopeBefore(tau: number): number { const u = 1 - tau; return u * u * u / 6 }
export function slopeAfter(t: number): number { const u = 1 - t; return -u * u * u / 6 }

// PolyBLEP residual at the discontinuity of a saw wrapping 1 → 0 (kept for
// callers that use the classic form: subtract it from a saw of slope +2).
export function polyBlep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

/**
 * An oscillator with a phase in [0, 1) that a master can hard-sync.
 *
 * `sync(tau)` is called before this sample's `next()` when the master wraps
 * τ samples (0 < τ <= 1) after the current sample: the slave then plays its
 * naive value for this sample, jumps to phase (1 - τ) · dt for the next one,
 * and spreads the jump's step and slope change over the two samples with
 * the PolyBLEP / PolyBLAMP residuals above. The hardware's slave is a saw
 * core reset by the master's edge, so a synced triangle restarts from its
 * trough with a step, which is what gives sync its edge; an integrated
 * triangle only bends there and drifts to a DC offset (Metallic, slot 13,
 * before 2026-10-31).
 */
export interface PhaseOsc {
  phase: number
  /** True when the last `next()` crossed the end of a cycle. */
  wrapped: boolean
  reset(phase?: number): void
  sync(tau: number): void
}

const frac = (x: number): number => x - Math.floor(x)

abstract class SyncedOsc implements PhaseOsc {
  phase = 0
  wrapped = false
  /** Time in samples until the pending sync reset, < 0 when none. */
  protected syncTau = -1
  /** Residual owed to the sample after a sync reset, and whether that sample skips its own wrap residual. */
  protected pending = 0
  protected afterSync = false

  reset(phase = 0): void {
    this.phase = phase
    this.wrapped = false
    this.syncTau = -1
    this.pending = 0
    this.afterSync = false
  }

  sync(tau: number): void {
    this.syncTau = tau < 0 ? 0 : tau > 1 ? 1 : tau
  }

  /** Naive waveform at a phase, and its slope in value per unit phase. */
  protected abstract value(phase: number): number
  protected abstract slope(phase: number): number

  /**
   * Handles a pending sync for this sample: returns the residual to add to
   * the naive output at `this.phase`, moves the phase to where the restarted
   * cycle is at the next sample, and books the next sample's residual.
   */
  protected applySync(dt: number): number {
    const tau = this.syncTau
    this.syncTau = -1
    const atReset = frac(this.phase + tau * dt)       // where the free-running cycle would have been
    const a = this.value(0) - this.value(atReset)      // the step
    const s = (this.slope(0) - this.slope(atReset)) * dt   // the slope change, per sample
    this.pending = a * stepAfter(1 - tau) + s * slopeAfter(1 - tau)
    this.afterSync = true
    this.phase = (1 - tau) * dt
    this.wrapped = false
    return a * stepBefore(tau) + s * slopeBefore(tau)
  }

  /** Advances the phase for the next sample when no sync intervened. */
  protected advance(dt: number): void {
    this.phase += dt
    if (this.phase >= 1) {
      this.phase -= 1
      this.wrapped = true
    } else {
      this.wrapped = false
    }
  }
}

export class PolyBlepSaw extends SyncedOsc {
  protected value(phase: number): number { return 2 * phase - 1 }
  protected slope(): number { return 2 }

  next(dt: number): number {
    const ph = this.phase
    let saw = 2 * ph - 1
    const syncing = this.syncTau >= 0
    // Own wrap (step -2): the sample before it, unless a sync reset comes first.
    if (ph > 1 - dt && (!syncing || (1 - ph) / dt < this.syncTau)) saw -= 2 * stepBefore((1 - ph) / dt)
    // The sample after it, unless this cycle was started by a sync (then `pending` has it).
    if (this.afterSync) { saw += this.pending; this.afterSync = false }
    else if (ph < dt) saw -= 2 * stepAfter(ph / dt)
    if (syncing) saw += this.applySync(dt)
    else this.advance(dt)
    return saw
  }
}

// Square / pulse with variable PWM: +1 for phase < pwm, -1 after. Steps of
// +2 at the wrap and -2 at the duty edge, each BLEP-corrected.
// `pwm` is the duty cycle in [0.05, 0.95] — caller clamps.
export class PolyBlepSquare extends SyncedOsc {
  private pwm = 0.5
  protected value(phase: number): number { return phase < this.pwm ? 1 : -1 }
  protected slope(): number { return 0 }

  next(dt: number, pwm: number): number {
    this.pwm = pwm
    const ph = this.phase
    let s = ph < pwm ? 1 : -1
    const syncing = this.syncTau >= 0
    const tauWrap = (1 - ph) / dt, tauEdge = (pwm - ph) / dt
    if (ph > 1 - dt && (!syncing || tauWrap < this.syncTau)) s += 2 * stepBefore(tauWrap)
    if (ph < pwm && tauEdge < 1 && (!syncing || tauEdge < this.syncTau)) s -= 2 * stepBefore(tauEdge)
    if (this.afterSync) { s += this.pending; this.afterSync = false }
    else if (ph < dt) s += 2 * stepAfter(ph / dt)
    if (ph >= pwm && ph < pwm + dt) s -= 2 * stepAfter((ph - pwm) / dt)
    if (syncing) s += this.applySync(dt)
    else this.advance(dt)
    return s
  }
}

// Triangle from the phase: -1 at the start of the cycle, +1 at the middle,
// slopes ±4 per cycle. Its two corners are PolyBLAMP-corrected, and a sync
// reset restarts it from -1 with a step, as the hardware's folded saw does.
export class PolyBlepTriangle extends SyncedOsc {
  protected value(phase: number): number { return 1 - 4 * Math.abs(phase - 0.5) }
  protected slope(phase: number): number { return phase < 0.5 ? 4 : -4 }

  next(dt: number): number {
    const ph = this.phase
    let tri = 1 - 4 * Math.abs(ph - 0.5)
    const syncing = this.syncTau >= 0
    const s = 8 * dt                                  // slope change at the trough, per sample (-s at the peak)
    const tauWrap = (1 - ph) / dt, tauPeak = (0.5 - ph) / dt
    if (ph > 1 - dt && (!syncing || tauWrap < this.syncTau)) tri += s * slopeBefore(tauWrap)
    if (ph < 0.5 && tauPeak < 1 && (!syncing || tauPeak < this.syncTau)) tri -= s * slopeBefore(tauPeak)
    if (this.afterSync) { tri += this.pending; this.afterSync = false }
    else if (ph < dt) tri += s * slopeAfter(ph / dt)
    if (ph >= 0.5 && ph < 0.5 + dt) tri -= s * slopeAfter((ph - 0.5) / dt)
    if (syncing) tri += this.applySync(dt)
    else this.advance(dt)
    return tri
  }
}

// Sine. Used for "pure" waveforms in some patches (pan flutes, tremolo
// piano). Alias-free on its own; a sync reset is a corrected step.
export class SineOsc extends SyncedOsc {
  protected value(phase: number): number { return Math.sin(phase * 2 * Math.PI) }
  protected slope(phase: number): number { return 2 * Math.PI * Math.cos(phase * 2 * Math.PI) }

  next(dt: number): number {
    let out = Math.sin(this.phase * 2 * Math.PI)
    if (this.afterSync) { out += this.pending; this.afterSync = false }
    if (this.syncTau >= 0) out += this.applySync(dt)
    else this.advance(dt)
    return out
  }
}
