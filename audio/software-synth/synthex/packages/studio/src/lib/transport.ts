// Shared transport — the studio's single clock.
//
// The standalone synths each ran their own timer (drum machine BPM, sid
// tracker tempo, synthex sequencer). Here one lookahead scheduler drives
// every track so they stay locked together.
//
// Classic web-audio pattern: a coarse setInterval wakes us up, and we
// schedule every step that falls inside a short lookahead window against
// AudioContext.currentTime, which is sample-accurate.

export type StepHandler = (step: number, time: number) => void

const LOOKAHEAD_MS = 25      // how often we wake to schedule
const SCHEDULE_AHEAD_S = 0.1 // how far ahead we commit steps

export class Transport {
  bpm = 120
  /** Swing 0..1 — delays every odd 16th by up to half a step. */
  swing = 0
  stepsPerBeat = 4
  steps = 16
  playing = false
  /** Step index most recently scheduled; the UI reads this for the playhead. */
  currentStep = 0

  private timer: ReturnType<typeof setInterval> | null = null
  private nextStepTime = 0
  private nextStepIndex = 0
  private handlers = new Set<StepHandler>()

  constructor(private readonly ctx: AudioContext) {}

  onStep(fn: StepHandler): () => void {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  secondsPerStep(): number {
    return 60 / this.bpm / this.stepsPerBeat
  }

  start(): void {
    if (this.playing) return
    this.playing = true
    this.nextStepIndex = 0
    this.nextStepTime = this.ctx.currentTime + 0.06
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.currentStep = 0
  }

  toggle(): void {
    if (this.playing) this.stop(); else this.start()
  }

  private tick(): void {
    const horizon = this.ctx.currentTime + SCHEDULE_AHEAD_S
    while (this.nextStepTime < horizon) {
      const step = this.nextStepIndex % this.steps
      // Swing: push odd steps later within their slot.
      const swung = step % 2 === 1 ? this.swing * this.secondsPerStep() * 0.5 : 0
      for (const fn of this.handlers) fn(step, this.nextStepTime + swung)
      this.currentStep = step
      this.nextStepIndex++
      this.nextStepTime += this.secondsPerStep()
    }
  }

  dispose(): void {
    this.stop()
    this.handlers.clear()
  }
}
