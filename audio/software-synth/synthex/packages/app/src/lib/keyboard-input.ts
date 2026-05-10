// Computer-keyboard → MIDI note mapping.
// Two octaves on the home/upper rows, with z/x for octave shift.

const MAP: Record<string, number> = {
  // Lower octave (Z row)
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5,
  KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
  // Upper octave (Q row, +1 octave)
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
  Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
}

export class ComputerKeyboard {
  private octave = 4 // base; key 0 (Z) → C4 by default
  private held = new Set<string>()
  private listeners = {
    on: (_note: number, _vel: number) => {},
    off: (_note: number) => {},
    octave: (_oct: number) => {},
  }

  on(handler: (note: number, vel: number) => void): this {
    this.listeners.on = handler
    return this
  }
  off(handler: (note: number) => void): this {
    this.listeners.off = handler
    return this
  }
  onOctave(handler: (oct: number) => void): this {
    this.listeners.octave = handler
    return this
  }

  setOctave(oct: number): void {
    this.octave = Math.max(0, Math.min(8, oct))
    this.listeners.octave(this.octave)
  }

  attach(target: Window | HTMLElement = window): () => void {
    const down = (ev: Event): void => {
      const e = ev as KeyboardEvent
      if (e.repeat) return
      if (e.code === 'KeyU' && (e.metaKey || e.ctrlKey)) return // browser shortcut
      if (e.code === 'Minus') { this.setOctave(this.octave - 1); return }
      if (e.code === 'Equal') { this.setOctave(this.octave + 1); return }
      const semi = MAP[e.code]
      if (semi == null) return
      const note = this.octave * 12 + semi
      if (this.held.has(e.code)) return
      this.held.add(e.code)
      this.listeners.on(note, 1)
    }
    const up = (ev: Event): void => {
      const e = ev as KeyboardEvent
      const semi = MAP[e.code]
      if (semi == null) return
      const note = this.octave * 12 + semi
      this.held.delete(e.code)
      this.listeners.off(note)
    }
    target.addEventListener('keydown', down)
    target.addEventListener('keyup', up)
    return () => {
      target.removeEventListener('keydown', down)
      target.removeEventListener('keyup', up)
    }
  }
}
