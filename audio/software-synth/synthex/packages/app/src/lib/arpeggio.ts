// Main-thread arpeggiator. Tracks held notes and emits noteOn/noteOff to the
// synth on a steady clock. When `hold` is on, releasing all keys preserves
// the current pattern; new key presses replace the held set.

import type { ArpPattern } from '@synthex/engine'

export interface ArpOptions {
  noteOn(note: number): void
  noteOff(note: number): void
  getTime(): number
}

export class Arpeggiator {
  enabled = false
  pattern: ArpPattern = 'up'
  range = 1
  hold = false
  rate = 8           // steps per second
  gateLength = 0.5   // 0..1 fraction of step

  private held = new Set<number>()
  private lastSorted: number[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private nextStepTime = 0
  private stepIndex = 0
  private heldNote = -1
  private playing = false

  private opts: ArpOptions

  constructor(opts: ArpOptions) {
    this.opts = opts
  }

  noteOn(n: number): void {
    if (this.held.size === 0 && this.hold) this.held.clear() // Clear sticky hold
    this.held.add(n)
    this.refreshSorted()
    if (this.enabled && !this.playing) this.start()
  }

  noteOff(n: number): void {
    if (this.hold) return
    this.held.delete(n)
    this.refreshSorted()
    if (this.held.size === 0 && this.playing) this.stop()
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    if (!v && this.playing) this.stop()
  }

  private refreshSorted(): void {
    this.lastSorted = Array.from(this.held).sort((a, b) => a - b)
  }

  private start(): void {
    if (this.playing) return
    this.playing = true
    this.stepIndex = 0
    this.nextStepTime = this.opts.getTime() + 0.02
    this.timer = setInterval(() => this.tick(), 25)
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
    if (this.heldNote !== -1) {
      this.opts.noteOff(this.heldNote)
      this.heldNote = -1
    }
  }

  private nextNote(): number {
    const base = this.lastSorted
    if (base.length === 0) return -1
    const expanded: number[] = []
    for (let oct = 0; oct < this.range; oct++) {
      for (const n of base) expanded.push(n + oct * 12)
    }
    const len = expanded.length
    let idx: number
    switch (this.pattern) {
      case 'up':
        idx = this.stepIndex % len
        break
      case 'down':
        idx = (len - 1 - (this.stepIndex % len) + len) % len
        break
      case 'updown': {
        const period = Math.max(1, 2 * len - 2)
        const p = this.stepIndex % period
        idx = p < len ? p : period - p
        break
      }
      case 'random':
        idx = Math.floor(Math.random() * len)
        break
      case 'order':
        // Order-of-keypress: re-sort by insertion would need extra state;
        // fall back to natural order for now.
        idx = this.stepIndex % len
        break
    }
    return expanded[idx]!
  }

  private tick(): void {
    const horizon = this.opts.getTime() + 0.1
    while (this.nextStepTime < horizon) {
      const stepDur = 1 / Math.max(0.5, this.rate)
      const note = this.nextNote()
      if (note >= 0) {
        if (this.heldNote !== -1) {
          this.opts.noteOff(this.heldNote)
          this.heldNote = -1
        }
        this.opts.noteOn(note)
        this.heldNote = note
        // Schedule note-off after gate time (still polled via this loop)
        const off = note
        const offWhen = this.nextStepTime + stepDur * this.gateLength
        setTimeout(() => {
          if (this.heldNote === off) {
            this.opts.noteOff(off)
            this.heldNote = -1
          }
        }, Math.max(1, (offWhen - this.opts.getTime()) * 1000))
      }
      this.stepIndex += 1
      this.nextStepTime += stepDur
    }
  }

  setHold(v: boolean): void {
    this.hold = v
    if (!v && this.held.size === 0) this.stop()
  }
}
