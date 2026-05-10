// Voice pool with oldest-released-then-oldest-playing stealing strategy
// (PLAN.md §7) and helpers for the three Synthex key-assign modes
// (poly / mono / unison).

export interface VoiceSlot {
  index: number
  note: number       // -1 when free
  releasedAt: number // performance.now() at noteOff; Infinity while held
  startedAt: number  // performance.now() at noteOn
}

export class VoicePool {
  readonly slots: VoiceSlot[]

  constructor(size: number) {
    this.slots = []
    for (let i = 0; i < size; i++) {
      this.slots.push({ index: i, note: -1, releasedAt: 0, startedAt: 0 })
    }
  }

  // Single-voice mode: always reuse slot 0 (caller is responsible for using
  // a 1-voice pool, but we still expose an explicit hook for clarity).
  monoSlot(): VoiceSlot {
    return this.slots[0]!
  }

  // All slots — used by unison mode to fan a single note out across the pool.
  allSlots(): VoiceSlot[] {
    return this.slots
  }

  allocate(note: number): VoiceSlot {
    let idle: VoiceSlot | null = null
    let oldestReleased: VoiceSlot | null = null
    let oldestPlaying: VoiceSlot | null = null
    for (const s of this.slots) {
      if (s.note === -1 && idle == null) idle = s
      if (s.releasedAt > 0 && s.releasedAt !== Infinity) {
        if (oldestReleased == null || s.releasedAt < oldestReleased.releasedAt) {
          oldestReleased = s
        }
      }
      if (s.releasedAt === Infinity) {
        if (oldestPlaying == null || s.startedAt < oldestPlaying.startedAt) {
          oldestPlaying = s
        }
      }
    }
    const chosen = idle ?? oldestReleased ?? oldestPlaying ?? this.slots[0]!
    chosen.note = note
    chosen.startedAt = performance.now()
    chosen.releasedAt = Infinity
    return chosen
  }

  release(note: number): VoiceSlot | null {
    for (const s of this.slots) {
      if (s.note === note && s.releasedAt === Infinity) {
        s.releasedAt = performance.now()
        return s
      }
    }
    return null
  }

  // Mark every held slot as released; returns the slots that changed state.
  releaseAll(): VoiceSlot[] {
    const out: VoiceSlot[] = []
    for (const s of this.slots) {
      if (s.releasedAt === Infinity) {
        s.releasedAt = performance.now()
        out.push(s)
      }
    }
    return out
  }
}
