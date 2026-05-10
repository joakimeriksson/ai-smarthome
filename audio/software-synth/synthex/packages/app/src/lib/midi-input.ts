// WebMIDI input. Optional — graceful fallback when not available.

export interface MidiOptions {
  onNoteOn(note: number, velocity: number): void
  onNoteOff(note: number): void
  onPitchBend(semitones: number): void
  onCC(controller: number, value01: number): void
}

export interface MidiAccess {
  inputs: { id: string; name: string }[]
  selectInput(id: string | null): void
  channelFilter: number | null // 1..16 or null = all
  setChannelFilter(ch: number | null): void
}

export async function initMidi(opts: MidiOptions): Promise<MidiAccess | null> {
  const nav = navigator as Navigator & {
    requestMIDIAccess?: (init?: { sysex?: boolean }) => Promise<MIDIAccess>
  }
  if (!nav.requestMIDIAccess) return null

  let access: MIDIAccess
  try {
    access = await nav.requestMIDIAccess()
  } catch {
    return null
  }

  let currentInput: MIDIInput | null = null
  let channelFilter: number | null = null

  const handle = (ev: MIDIMessageEvent): void => {
    const data = ev.data
    if (!data || data.length < 1) return
    const status = data[0]!
    const ch = (status & 0x0f) + 1
    if (channelFilter !== null && ch !== channelFilter) return
    const cmd = status & 0xf0
    switch (cmd) {
      case 0x90: { // note on
        const vel = data[2]!
        if (vel === 0) opts.onNoteOff(data[1]!)
        else opts.onNoteOn(data[1]!, vel / 127)
        return
      }
      case 0x80: opts.onNoteOff(data[1]!); return
      case 0xe0: { // pitch bend
        const lsb = data[1]!
        const msb = data[2]!
        const value = ((msb << 7) | lsb) - 8192
        opts.onPitchBend((value / 8192) * 2) // ±2 semitones default
        return
      }
      case 0xb0: { // CC
        opts.onCC(data[1]!, data[2]! / 127)
        return
      }
    }
  }

  const selectInput = (id: string | null): void => {
    if (currentInput) currentInput.onmidimessage = null
    currentInput = null
    if (!id) return
    const inp = access.inputs.get(id)
    if (!inp) return
    inp.onmidimessage = handle
    currentInput = inp
  }

  return {
    inputs: Array.from(access.inputs.values()).map(i => ({ id: i.id, name: i.name ?? i.id })),
    selectInput,
    channelFilter,
    setChannelFilter(ch) { channelFilter = ch },
  }
}
