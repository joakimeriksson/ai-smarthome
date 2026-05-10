// Chord memory: capture a set of held notes as a chord, then play that
// chord transposed to the root of every subsequently pressed key.

export class ChordMemory {
  enabled = false
  notes: number[] = [0]    // semitone offsets from root
  private capturing = false
  private capturedSet = new Set<number>()
  private capturedRoot = -1
  private heldRoots = new Set<number>()
  private lastEmitted = new Map<number, number[]>() // root → emitted notes

  // Begin capturing the next set of held keys as the chord shape. The first
  // pressed note becomes the root; subsequent notes are stored as semitone
  // offsets.
  startLearn(): void {
    this.capturing = true
    this.capturedSet.clear()
    this.capturedRoot = -1
  }

  finishLearn(): void {
    if (!this.capturing) return
    this.capturing = false
    if (this.capturedSet.size === 0) return
    const sorted = Array.from(this.capturedSet).sort((a, b) => a - b)
    this.capturedRoot = sorted[0]!
    this.notes = sorted.map(n => n - this.capturedRoot)
  }

  // Returns the notes to actually play for this incoming root note,
  // or null if chord memory is off (caller should play the note as-is).
  noteOn(root: number): number[] | null {
    if (this.capturing) {
      this.capturedSet.add(root)
      return null
    }
    if (!this.enabled || this.notes.length === 0) return null
    const out = this.notes.map(off => root + off)
    this.heldRoots.add(root)
    this.lastEmitted.set(root, out)
    return out
  }

  noteOff(root: number): number[] | null {
    if (!this.enabled) return null
    const emitted = this.lastEmitted.get(root)
    if (!emitted) return null
    this.lastEmitted.delete(root)
    this.heldRoots.delete(root)
    return emitted
  }
}
