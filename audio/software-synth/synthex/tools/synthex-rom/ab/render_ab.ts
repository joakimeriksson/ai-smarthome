// Render the ROM presets on the notes transcribed from Per Kristian's run-through, for score_ab.py.
//   node --experimental-transform-types render_ab.ts DATA OUT [--set stretch|solo] [--slots 10,11] [--mod FILE.mjs]
// DATA is the A/B folder (N-hw.wav and notes/N.txt for the 3 s stretches; full/N-hw.wav and full/N-solo.txt
// for the notes that sound alone in the whole passage). A note file is "t:note:dur,..." in seconds from the
// start of the hardware clip. One VoiceCore per note, summed, the chorus as the app plays it; mono 44.1 kHz.
// The voices share the layer's LFO as in the app: strobed by the keys that find no other held.
// --notes DIR reads the note files from DIR; --stems writes one file per note (N-k.wav, at a fixed gain of
// 0.1) so that a subset can be mixed afterwards.
// --mod names a module whose default export (layer, slot, raw) edits the layer patch in place before the
// render (raw = the preset's 40 decoded bytes): a candidate mapping is tried without regenerating the bank.
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { render } from '../../compare/render.ts'
import { writeWav } from '../../compare/io.ts'
import { PRESETS } from '../../../packages/engine/src/presets/factory.ts'

const args = process.argv.slice(2)
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i < 0 ? undefined : args.splice(i, 2)[1] }
const set = opt('--set') ?? 'stretch'
const only = opt('--slots')?.split(',').map(Number)
const modPath = opt('--mod')
const notesDir = opt('--notes')          // other note files than DATA/notes (a corrected transcription)
const stems = args.includes('--stems') ? (args.splice(args.indexOf('--stems'), 1), true) : false
const [data, out] = args
if (!data || !out) { console.error('usage: DATA OUT [--set stretch|solo] [--slots ..] [--mod FILE.mjs]'); process.exit(2) }
const here = dirname(fileURLToPath(import.meta.url))
const raw: number[][] = JSON.parse(readFileSync(join(here, '../data/rom_presets_raw.json'), 'utf8'))
const mod = modPath ? (await import(pathToFileURL(resolve(modPath)).href)).default : undefined
mkdirSync(out, { recursive: true })
const sr = 44100
for (const slot of PRESETS) {
  if (only && !only.includes(slot.address)) continue
  const nf = set === 'solo' ? join(data, 'full', `${slot.address}-solo.txt`) : join(notesDir ?? join(data, 'notes'), `${slot.address}.txt`)
  if (!existsSync(nf)) continue
  const text = readFileSync(nf, 'utf8').trim()
  if (!text) continue
  const notes = text.split(',').map(s => s.split(':').map(Number) as [number, number, number])
  const layer = JSON.parse(JSON.stringify(slot.patch.upper))
  if (mod) mod(layer, slot.address, raw[slot.address - 10])
  if (set === 'solo') {
    // each solo note on its own, 0.1 s of lead-in, up to 3 s of the note and 1 s after it
    notes.forEach(([, note, d], k) => {
      const hold = Math.min(d, 3)
      const buf = render({ patch: layer, durationSec: 0.1 + hold + 1, sampleRate: sr,
        events: [{ kind: 'on', t: 0.1, note, velocity: 100 }, { kind: 'off', t: 0.1 + hold, note }],
        fx: { chorus: slot.patch.fx.chorus } })
      writeWav(join(out, `${slot.address}-${k}.wav`), norm(buf), sr)
    })
    continue
  }
  const dur = Math.max(...notes.map(([t, , d]) => t + d)) + 1.5
  // The layer's LFO strobes: a key that goes down while no other is held, on a patch with an LFO delay.
  const lfoSync: number[] = []
  let heldUntil = -Infinity
  for (const [t, , d] of [...notes].sort((a, b) => a[0] - b[0])) {
    if (t >= heldUntil && layer.lfo1.delay > 0) lfoSync.push(t)
    heldUntil = Math.max(heldUntil, t + d)
  }
  const mix = new Float32Array(Math.floor(dur * sr))
  for (const [t, note, d] of notes) {
    const buf = render({ patch: layer, durationSec: dur, sampleRate: sr,
      events: [{ kind: 'on', t, note, velocity: 100 }, { kind: 'off', t: t + d, note }],
      fx: { chorus: slot.patch.fx.chorus }, lfoSync })
    if (stems) { writeWav(join(out, `${slot.address}-${notes.findIndex(n => n[0] === t && n[1] === note && n[2] === d)}.wav`), buf.map(v => v * 0.1), sr); continue }
    for (let i = 0; i < mix.length; i++) mix[i]! += buf[i]!
  }
  if (stems) continue
  writeWav(join(out, `${slot.address}.wav`), norm(mix), sr)
}
function norm(x: Float32Array): Float32Array {
  let pk = 0
  for (const v of x) pk = Math.max(pk, Math.abs(v))
  if (pk > 0) for (let i = 0; i < x.length; i++) x[i]! *= 0.5 / pk
  return x
}
