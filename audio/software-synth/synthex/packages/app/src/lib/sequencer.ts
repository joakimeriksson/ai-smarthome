// Multi-track step sequencer. Each track is monophonic with its own length
// and step content; tracks share the master clock. A track may be assigned
// to upper or lower layer (caller resolves the routing).

export type Step =
  | { kind: 'rest' }
  | { kind: 'note'; note: number; tie: boolean }

export type LayerTarget = 'upper' | 'lower'

export interface Track {
  steps: Step[]
  enabled: boolean
  target: LayerTarget
}

export interface SequencerOptions {
  tracks: Track[]
  bpm: number
  stepsPerBeat: number // 4 = 16th notes
  onNoteOn(note: number, target: LayerTarget): void
  onNoteOff(note: number, target: LayerTarget): void
  getTime(): number
}

interface TrackState {
  stepIndex: number
  heldNote: number
  nextStepTime: number
}

export class StepSequencer {
  tracks: Track[]
  bpm: number
  stepsPerBeat: number
  playing = false
  /** Fraction of a step a note sounds before its note-off (1 = full step). */
  gate = 1

  private timer: ReturnType<typeof setInterval> | null = null
  private states: TrackState[]
  private pendingOffs: { time: number; note: number; target: LayerTarget; trackIdx: number }[] = []
  private onNoteOn: (n: number, t: LayerTarget) => void
  private onNoteOff: (n: number, t: LayerTarget) => void
  private getTime: () => number

  constructor(opts: SequencerOptions) {
    this.tracks = opts.tracks
    this.bpm = opts.bpm
    this.stepsPerBeat = opts.stepsPerBeat
    this.onNoteOn = opts.onNoteOn
    this.onNoteOff = opts.onNoteOff
    this.getTime = opts.getTime
    this.states = opts.tracks.map(() => ({ stepIndex: 0, heldNote: -1, nextStepTime: 0 }))
  }

  setTracks(tracks: Track[]): void {
    this.tracks = tracks
    while (this.states.length < tracks.length) {
      this.states.push({ stepIndex: 0, heldNote: -1, nextStepTime: this.getTime() })
    }
    this.states.length = tracks.length
  }
  setBpm(bpm: number): void { this.bpm = Math.max(20, Math.min(300, bpm)) }
  setGate(g: number): void { this.gate = Math.max(0.1, Math.min(1, g)) }

  start(): void {
    if (this.playing) return
    this.playing = true
    const t = this.getTime() + 0.05
    for (let i = 0; i < this.states.length; i++) {
      this.states[i]!.stepIndex = 0
      this.states[i]!.nextStepTime = t
      this.states[i]!.heldNote = -1
    }
    this.timer = setInterval(() => this.tick(), 25)
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    if (this.timer != null) clearInterval(this.timer)
    this.timer = null
    for (const p of this.pendingOffs) this.onNoteOff(p.note, p.target)
    this.pendingOffs = []
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]!
      const tr = this.tracks[i]
      if (s.heldNote !== -1 && tr) {
        this.onNoteOff(s.heldNote, tr.target)
        s.heldNote = -1
      }
    }
  }

  private secondsPerStep(): number {
    return 60 / this.bpm / this.stepsPerBeat
  }

  private tick(): void {
    const horizon = this.getTime() + 0.1

    // Fire gated note-offs that fall inside the horizon.
    if (this.pendingOffs.length > 0) {
      const still: typeof this.pendingOffs = []
      for (const p of this.pendingOffs) {
        if (p.time < horizon) {
          this.onNoteOff(p.note, p.target)
          const st = this.states[p.trackIdx]
          if (st && st.heldNote === p.note) st.heldNote = -1
        } else {
          still.push(p)
        }
      }
      this.pendingOffs = still
    }

    for (let ti = 0; ti < this.tracks.length; ti++) {
      const track = this.tracks[ti]!
      const state = this.states[ti]!
      if (!track.enabled || track.steps.length === 0) continue
      while (state.nextStepTime < horizon) {
        const step = track.steps[state.stepIndex % track.steps.length]
        if (step) {
          if (step.kind === 'note') {
            if (!step.tie && state.heldNote !== -1) {
              this.onNoteOff(state.heldNote, track.target); state.heldNote = -1
            }
            if (state.heldNote !== step.note) {
              this.onNoteOn(step.note, track.target); state.heldNote = step.note
              // Gate: schedule the note-off inside this step unless the NEXT
              // step ties this note onward (a tie keeps it sounding).
              const next = track.steps[(state.stepIndex + 1) % track.steps.length]
              const tiedOn = next && next.kind === 'note' && next.tie
              if (this.gate < 1 && !tiedOn) {
                this.pendingOffs.push({
                  time: state.nextStepTime + this.gate * this.secondsPerStep(),
                  note: step.note,
                  target: track.target,
                  trackIdx: ti,
                })
              }
            }
          } else {
            if (state.heldNote !== -1) {
              this.onNoteOff(state.heldNote, track.target); state.heldNote = -1
            }
          }
        }
        state.stepIndex += 1
        state.nextStepTime += this.secondsPerStep()
      }
    }
  }

  currentStep(trackIdx: number): number {
    const t = this.tracks[trackIdx]
    if (!t) return 0
    return this.states[trackIdx]!.stepIndex % t.steps.length
  }
}
