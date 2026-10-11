// Computer-keyboard note input for the focused track.
// Two rows, tracker-style: Z-row = lower octave, Q-row = upper octave.

const LAYOUT: Record<string, number> = {
  // lower octave (Z row)
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
  KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  // upper octave (Q row)
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24,
}

export interface KeyHandlers {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  onOctave?(octave: number): void
  /** Space toggles the transport. */
  onTransport?(): void
  /** Shift + 1-8, held: a performance pad (0-7) goes down, then up. */
  onPad?(pad: number, down: boolean): void
}

const PAD_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8']

export class ComputerKeys {
  octave = 4
  private readonly held = new Set<string>()
  /** The key holding a pad down, so its release ends it whatever Shift does. */
  private padKey: string | null = null

  constructor(private readonly h: KeyHandlers) {}

  attach(target: Window): () => void {
    const down = (e: KeyboardEvent) => this.down(e)
    const up = (e: KeyboardEvent) => this.up(e)
    target.addEventListener('keydown', down)
    target.addEventListener('keyup', up)
    return () => {
      target.removeEventListener('keydown', down)
      target.removeEventListener('keyup', up)
    }
  }

  private isTyping(e: KeyboardEvent): boolean {
    const el = e.target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
  }

  private down(e: KeyboardEvent): void {
    if (this.isTyping(e)) return
    if (e.code === 'Space') {
      e.preventDefault()
      this.h.onTransport?.()
      return
    }
    if (e.code === 'Minus' || e.code === 'BracketLeft') {
      this.octave = Math.max(0, this.octave - 1)
      this.h.onOctave?.(this.octave)
      return
    }
    if (e.code === 'Equal' || e.code === 'BracketRight') {
      this.octave = Math.min(8, this.octave + 1)
      this.h.onOctave?.(this.octave)
      return
    }
    const pad = PAD_KEYS.indexOf(e.code)
    if (e.shiftKey && pad >= 0) {
      e.preventDefault()
      if (e.repeat) return
      this.padKey = e.code
      this.h.onPad?.(pad, true)
      return
    }
    const semi = LAYOUT[e.code]
    if (semi === undefined || e.repeat || this.held.has(e.code)) return
    this.held.add(e.code)
    this.h.noteOn(this.octave * 12 + semi, 100)
  }

  private up(e: KeyboardEvent): void {
    if (this.padKey === e.code) {
      this.padKey = null
      this.h.onPad?.(PAD_KEYS.indexOf(e.code), false)
      return
    }
    const semi = LAYOUT[e.code]
    if (semi === undefined || !this.held.has(e.code)) return
    this.held.delete(e.code)
    this.h.noteOff(this.octave * 12 + semi)
  }
}
