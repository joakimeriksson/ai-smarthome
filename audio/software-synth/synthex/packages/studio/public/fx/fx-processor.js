// One effect chain (a track's insert slots, a return's rack, the master's
// inserts) as a single AudioWorkletNode: stereo in, the enabled effects run
// in order, stereo out. The DSP lives in fx-dsp.js; this file only hosts it.
//
// Messages (from src/lib/mixer.svelte.ts):
//   { type: 'chain', slots: [{ id, kind, params, bypass }] }
//       the whole chain in order; effects whose id and kind are unchanged
//       keep their state, so reordering or adding a slot does not cut the
//       other slots' tails
//   { type: 'param', id, name, value }
//   { type: 'bypass', id, on }
//   { type: 'tempo', bpm }
//   { type: 'pos', beat, at }
//       the song is at `beat` at context time `at` (sent each bar, ahead of
//       time); effects with syncBeat() lock their step clock to it
//
// An idle chain costs nothing: once the input has been silent for longer
// than the longest tail, the effects are not run. Every track has a chain
// and a return with no sends is silent, so this matters on the one audio
// thread all the studio's instruments share.

import { createEffect } from './fx-dsp.js'

const SILENT = 1e-9

class StudioFxProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.slots = []
    this.bpm = 120
    this.quiet = 0
    this.tailSamples = 0
    this.port.onmessage = (e) => this.onMessage(e.data)
  }

  onMessage(m) {
    switch (m.type) {
      case 'chain': {
        const old = new Map(this.slots.map(s => [s.id, s]))
        this.slots = []
        for (const spec of m.slots) {
          let slot = old.get(spec.id)
          if (!slot || slot.kind !== spec.kind) {
            const fx = createEffect(spec.kind, sampleRate)
            if (!fx) continue
            fx.setTempo(this.bpm)
            slot = { id: spec.id, kind: spec.kind, fx, bypass: false }
          }
          for (const [name, value] of Object.entries(spec.params ?? {})) slot.fx.set(name, value)
          slot.bypass = !!spec.bypass
          this.slots.push(slot)
        }
        break
      }
      case 'param': {
        const s = this.slots.find(x => x.id === m.id)
        if (s) s.fx.set(m.name, m.value)
        break
      }
      case 'bypass': {
        const s = this.slots.find(x => x.id === m.id)
        if (s) s.bypass = !!m.on
        break
      }
      case 'tempo':
        this.bpm = m.bpm
        for (const s of this.slots) s.fx.setTempo(m.bpm)
        break
      case 'pos':
        // currentTime is the start of the next block to be processed.
        for (const s of this.slots) s.fx.syncBeat?.(m.beat, (m.at - currentTime) * sampleRate)
        break
    }
    this.tailSamples = sampleRate * Math.max(0, ...this.slots.map(s => s.fx.tail()))
  }

  process(inputs, outputs) {
    const out = outputs[0]
    if (!out || !out[0]) return true
    const L = out[0], R = out[1] ?? out[0], n = L.length
    const input = inputs[0]
    if (input && input.length) {
      L.set(input[0])
      R.set(input[1] ?? input[0])
    } else {
      L.fill(0)
      R.fill(0)
    }
    if (!this.slots.length) return true

    let quiet = true
    for (let i = 0; i < n; i++) {
      if (L[i] > SILENT || L[i] < -SILENT || R[i] > SILENT || R[i] < -SILENT) { quiet = false; break }
    }
    if (quiet) {
      this.quiet += n
      if (this.quiet > this.tailSamples) {
        for (const s of this.slots) s.fx.advance?.(n)
        return true
      }
    } else {
      this.quiet = 0
    }
    for (const s of this.slots) {
      if (s.bypass) s.fx.advance?.(n)
      else s.fx.process(L, R, n)
    }
    return true
  }
}

registerProcessor('studio-fx', StudioFxProcessor)
