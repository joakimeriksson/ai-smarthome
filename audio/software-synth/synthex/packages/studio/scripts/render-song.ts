// Render a studio project offline, the way the studio would play it.
//
//   node --experimental-transform-types scripts/render-song.ts [--demo hi-score] [--loops 2] [--out song.wav] [--stems dir]
//
// (--out defaults to demo-song.wav in the system temp directory.)
//
// Renders a built-in demo song (src/lib/demos.ts) through the real processors in
// ../../../js, with the same presets (public/synths/*.json, applied by
// src/lib/preset-apply.ts), the same voice allocation as WorkletInstrument,
// the same step timing and swing as Transport, and the same mixer as Track,
// Bus and Studio: inserts -> mute -> fader -> pan, pre/post sends into the
// return buses (each its own effect chain, fader and pan), the master's
// inserts and fader, then the limiter. The effects are public/fx/fx-dsp.js,
// the file the studio's worklet runs, driven the way fx-processor.js drives
// it (128-sample blocks, idle once silent past the longest tail). Then it
// prints what a listener would notice first: per-track level and peak, how
// hard the master limiter works, and the mix's spectral balance.
//
// The one approximation is the master limiter: a feed-forward model of
// Chrome's DynamicsCompressor with the studio's settings, without its
// look-ahead and makeup gain. Its gain-reduction numbers are a guide.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { DEMOS } from '../src/lib/demos.ts'
import { applyPresetEntry } from '../src/lib/preset-apply.ts'
import { PRESSURE_AT, PRESSURE_RISE, SCOOP_TIME, BEND_AT, BEND_RISE } from '../src/lib/expression.ts'
import type { Project, ProjectTrack } from '../src/lib/project.ts'
import type { PresetEntry } from '../src/lib/synth-data.ts'
import type { InstrumentKind } from '../src/lib/instruments.ts'
import { defaultReturns, resolveParams, sendOf, type FxContext, type FxSlotSpec } from '../src/lib/fx.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const JS = resolve(HERE, '../../../../js')
const SYNTHS = resolve(HERE, '../public/synths')
const SR = 48000
const BLOCK = 128
/** Lead-in before step 0, as Transport.start() schedules it. */
const START = 0.06

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback
}

// ── Worklet globals, then the processors ──────────────────────────────────

interface Proc {
  port: { onmessage: ((e: { data: unknown }) => void) | null }
  process(inputs: unknown[], outputs: Float32Array[][]): boolean
}
const registry: Record<string, new () => Proc> = {}
const g = globalThis as unknown as Record<string, unknown>
g['sampleRate'] = SR
g['currentTime'] = 0
g['AudioWorkletProcessor'] = class { port = { onmessage: null, postMessage() { /* host */ } } }
g['registerProcessor'] = (name: string, cls: new () => Proc) => { registry[name] = cls }

const FILES: Partial<Record<InstrumentKind, [string, string]>> = {
  va: ['va-processor.js', 'va-synth-processor'],
  ws: ['ws-processor.js', 'ws-synth-processor'],
  sid: ['sid-processor.js', 'sid-synth-processor'],
  fm: ['fm-processor.js', 'fm-synth-processor'],
  pm: ['pm-processor.js', 'pm-synth-processor'],
  drum: ['drum-processor.js', 'drum-machine-processor'],
}
const POLYPHONY: Partial<Record<InstrumentKind, number>> = { va: 8, ws: 8, sid: 3, fm: 8, pm: 8 }

// ── Effect chains: fx-processor.js, offline ───────────────────────────────

interface Effect {
  set(name: string, value: number): boolean
  setTempo(bpm: number): void
  process(L: Float32Array, R: Float32Array, n: number): void
  tail(): number
  syncBeat?(beat: number, offsetSamples: number): void
  advance?(n: number): void
}
const fxdsp = await import(resolve(HERE, '../public/fx/fx-dsp.js')) as {
  createEffect(kind: string, sr: number): Effect | null
}

class OfflineChain {
  private slots: { fx: Effect; bypass: boolean }[] = []
  cpuMs = 0
  constructor(specs: FxSlotSpec[] | undefined, context: FxContext, bpm: number) {
    for (const spec of specs ?? []) {
      const fx = fxdsp.createEffect(spec.kind, SR)
      if (!fx) throw new Error(`no effect "${spec.kind}"`)
      fx.setTempo(bpm)
      for (const [k, v] of Object.entries(resolveParams(spec, context))) fx.set(k, v)
      // The song's first step is scheduled START seconds in (as Transport does).
      fx.syncBeat?.(0, Math.round(START * SR))
      this.slots.push({ fx, bypass: !!spec.bypass })
    }
  }
  /** In place, in worklet-sized blocks, with the worklet's idle rule. */
  process(L: Float64Array, R: Float64Array): void {
    if (!this.slots.length) return
    const tail = SR * Math.max(0, ...this.slots.map(s => s.fx.tail()))
    const bl = new Float32Array(BLOCK), br = new Float32Array(BLOCK)
    let quiet = 0
    for (let i = 0; i < L.length; i += BLOCK) {
      const n = Math.min(BLOCK, L.length - i)
      let silent = true
      for (let k = 0; k < n; k++) {
        bl[k] = L[i + k]!; br[k] = R[i + k]!
        if (Math.abs(bl[k]!) > 1e-9 || Math.abs(br[k]!) > 1e-9) silent = false
      }
      if (silent) {
        quiet += n
        if (quiet > tail) { for (const s of this.slots) s.fx.advance?.(n); continue }
      } else quiet = 0
      const t0 = performance.now()
      for (const s of this.slots) { if (s.bypass) s.fx.advance?.(n); else s.fx.process(bl, br, n) }
      this.cpuMs += performance.now() - t0
      for (let k = 0; k < n; k++) { L[i + k] = bl[k]!; R[i + k] = br[k]! }
    }
  }
}

/** StereoPannerNode's equal-power law for a stereo input, with a gain, in place. */
function pan(L: Float64Array, R: Float64Array, gain: number, p: number): void {
  const x = p <= 0 ? p + 1 : p
  const c = Math.cos(x * Math.PI / 2), sn = Math.sin(x * Math.PI / 2)
  for (let i = 0; i < L.length; i++) {
    const a = L[i]! * gain, b = R[i]! * gain
    if (p <= 0) { L[i] = a + b * c; R[i] = b * sn } else { L[i] = a * c; R[i] = b + a * sn }
  }
}

// ── One track: processor + WorkletInstrument's voice allocation ────────────

class OfflineTrack {
  readonly proc: Proc
  readonly L: Float64Array
  readonly R: Float64Array
  private queue: { at: number; msg: unknown }[] = []
  private noteToVoice = new Map<number, number>()
  private voiceNote: (number | null)[]
  private voiceAge: number[]
  private counter = 0
  private serial = 0
  private sounding = new Map<number, number>()   // Track's note-off tokens
  readonly instrument = { post: (m: unknown) => this.send(m) }

  constructor(readonly spec: ProjectTrack, total: number) {
    const [, name] = FILES[spec.kind]!
    this.proc = new registry[name]!()
    this.L = new Float64Array(total)
    this.R = new Float64Array(total)
    const n = POLYPHONY[spec.kind] ?? 8
    this.voiceNote = new Array<number | null>(n).fill(null)
    this.voiceAge = new Array<number>(n).fill(0)
  }

  get kind(): InstrumentKind { return this.spec.kind }
  send(msg: unknown): void { this.proc.port.onmessage!({ data: msg }) }
  at(sample: number, msg: unknown): void { this.queue.push({ at: sample, msg }) }

  loadPreset(_name: string, params: Record<string, unknown>, fx: Record<string, unknown> = {},
    extras: Record<string, unknown> = {}): void {
    this.send({ type: 'preset', params, fx, ...extras })
  }

  // WorkletInstrument.alloc/noteOn/noteOff, verbatim in behaviour. Runs at
  // the moment the event is due (from render()), as the studio's timers do.
  private noteOn(note: number, velocity: number): void {
    let voice = this.noteToVoice.get(note)
    if (voice === undefined) {
      let best = 0, bestAge = Infinity
      for (let i = 0; i < this.voiceNote.length; i++) {
        if (this.voiceNote[i] === null) { best = i; break }
        if (this.voiceAge[i]! < bestAge) { bestAge = this.voiceAge[i]!; best = i }
      }
      const stolen = this.voiceNote[best]
      if (stolen !== null && stolen !== undefined) this.noteToVoice.delete(stolen)
      voice = best
    }
    this.voiceNote[voice] = note
    this.voiceAge[voice] = ++this.counter
    this.noteToVoice.set(note, voice)
    this.send({ type: 'noteOn', voice, note, velocity })
  }
  noteOff(sample: number, note: number, token: number): void {
    // Allocation happens in time order, so resolve the voice when the event
    // is due, not when it is scheduled (render() calls these in order).
    this.at(sample, { type: 'noteOffNote', note, token })
  }
  /** Track.scheduleStep's aftertouch: only while its own note-on still owns the note. */
  press(sample: number, note: number, token: number, value: number, seconds: number): void {
    this.at(sample, { type: 'pressureNote', note, token, value, seconds })
  }
  /** Track.scheduleStep's per-note bend, under the same ownership rule. */
  bend(sample: number, note: number, token: number, value: number, seconds: number): void {
    this.at(sample, { type: 'bendNote', note, token, value, seconds })
  }
  /** Track.scheduleStep's token: a note-off releases only its own note-on. */
  strike(sample: number, note: number, velocity: number): number {
    const token = ++this.serial
    this.at(sample, { type: 'noteOnNote', note, velocity, token })
    return token
  }

  /** Wall-clock ms spent in process(), for the CPU report. */
  cpuMs = 0

  render(): void {
    this.queue.sort((a, b) => a.at - b.at)
    const l = new Float32Array(BLOCK), r = new Float32Array(BLOCK)
    let qi = 0
    for (let i = 0; i < this.L.length; i += BLOCK) {
      // The studio posts with setTimeout; a message lands at the next block.
      while (qi < this.queue.length && this.queue[qi]!.at < i + BLOCK) {
        const m = this.queue[qi++]!.msg as { type: string; note?: number; velocity?: number; token?: number; value?: number; seconds?: number }
        if (m.type === 'pressureNote' || m.type === 'bendNote') {
          const v = this.noteToVoice.get(m.note!)
          if (this.sounding.get(m.note!) === m.token && v !== undefined) {
            this.send({ type: m.type === 'bendNote' ? 'bend' : 'pressure', voice: v, value: m.value, time: m.seconds })
          }
          continue
        }
        if (m.type === 'noteOnNote') {
          this.sounding.set(m.note!, m.token!)
          this.noteOn(m.note!, m.velocity!)
          continue
        }
        if (m.type === 'noteOffNote') {
          if (this.sounding.get(m.note!) !== m.token) continue
          this.sounding.delete(m.note!)
          const v = this.noteToVoice.get(m.note!)
          if (v === undefined) continue
          this.noteToVoice.delete(m.note!)
          this.voiceNote[v] = null
          this.send({ type: 'noteOff', voice: v })
        } else this.send(m)
      }
      l.fill(0); r.fill(0)
      const t0 = performance.now()
      this.proc.process([], [[l, r]])
      this.cpuMs += performance.now() - t0
      for (let k = 0; k < BLOCK && i + k < this.L.length; k++) { this.L[i + k] = l[k]!; this.R[i + k] = r[k]! }
    }
  }
}

// ── Song → events (Transport + Track.scheduleStep) ─────────────────────────

function trackLength(t: ProjectTrack): number {
  return t.kind === 'drum' ? (t.drumGrid[0]?.length ?? 16) : t.steps.length
}

export async function renderProject(p: Project, loops: number) {
  for (const k of new Set(p.tracks.map(t => t.kind))) {
    const f = FILES[k]
    if (!f) throw new Error(`no offline processor for ${k}`)
    if (!registry[f[1]]) await import(resolve(JS, f[0]))
  }
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  let song = 16
  for (const t of p.tracks) song = (song * trackLength(t)) / gcd(song, trackLength(t))
  const stepDur = 60 / p.bpm / 4
  const tail = 3
  const total = Math.ceil((song * loops * stepDur + tail) * SR / BLOCK) * BLOCK

  const tracks = p.tracks.map(spec => new OfflineTrack(spec, total))
  for (const t of tracks) {
    const spec = t.spec
    if (spec.presetName) {
      const bank = JSON.parse(readFileSync(resolve(SYNTHS, `${spec.kind}.json`), 'utf8')) as { presets: PresetEntry[] }
      const preset = bank.presets.find(x => x.name === spec.presetName)
      if (!preset) throw new Error(`${spec.name}: no ${spec.kind} preset "${spec.presetName}"`)
      applyPresetEntry(t, preset)
    }
    for (const [k, v] of Object.entries(spec.params ?? {})) t.send({ type: 'param', param: k, value: v })
  }

  for (let n = 0; n < song * loops; n++) {
    const step = n % song
    const swung = step % 2 === 1 ? p.swing * stepDur * 0.5 : 0
    const at = Math.round((START + n * stepDur + swung) * SR)
    for (const t of tracks) {
      const spec = t.spec
      if (spec.muted) continue
      if (spec.kind === 'drum') {
        const i = step % trackLength(spec)
        spec.drumGrid.forEach((row, ch) => {
          const v = row[i] ?? 0
          if (v > 0) t.at(at, { type: 'trigger', channel: ch, velocity: v / 127 })
        })
        continue
      }
      const s = spec.steps[step % spec.steps.length]
      if (!s || s.note === null) continue
      const root = s.note + spec.transpose
      const notes = [root, ...(s.chord ?? []).map(iv => root + iv)]
      const off = at + Math.round((s.length ?? spec.gate) * stepDur * SR)
      const hold = Math.round((s.length ?? spec.gate) * stepDur * SR)
      for (const nn of notes) {
        const token = t.strike(at, nn, s.velocity)
        if (s.scoop && spec.kind === 'va') {
          t.bend(at, nn, token, -s.scoop, 0)
          t.bend(at, nn, token, 0, SCOOP_TIME)
        }
        if (s.bendUp && spec.kind === 'va') {
          t.bend(at + Math.round(hold * BEND_AT), nn, token, s.bendUp, hold * BEND_RISE / SR)
        }
        if (s.pressure && spec.kind === 'va') {
          t.press(at + Math.round(hold * (s.pressureAt ?? PRESSURE_AT)), nn, token, s.pressure, hold * PRESSURE_RISE / SR)
        }
        t.noteOff(off, nn, token)
      }
    }
  }
  for (const t of tracks) t.render()

  // Mixer. Track: inserts -> mute/solo -> fader -> pan; sends tap before
  // the fader (pre) or after the pan (post). Returns are solo-safe.
  const L = new Float64Array(total), R = new Float64Array(total)
  const busSpecs = p.buses ?? defaultReturns()
  const busIn = new Map(busSpecs.map(b => [b.id, { L: new Float64Array(total), R: new Float64Array(total) }]))
  const anySoloed = p.tracks.some(t => t.soloed)
  const stems = tracks.map(t => {
    const spec = t.spec
    const sl = t.L.slice(), sr = t.R.slice()
    const chain = new OfflineChain(spec.inserts, 'insert', p.bpm)
    chain.process(sl, sr)
    if (spec.muted || (anySoloed && !spec.soloed)) { sl.fill(0); sr.fill(0) }
    const preL = sl.slice(), preR = sr.slice()
    pan(sl, sr, spec.level, spec.pan)
    for (const [id, raw] of Object.entries(spec.sends ?? {})) {
      const send = sendOf(raw), dest = busIn.get(id)
      if (!dest || send.level <= 0) continue
      const [fromL, fromR] = send.pre ? [preL, preR] : [sl, sr]
      for (let i = 0; i < total; i++) { dest.L[i] += fromL[i]! * send.level; dest.R[i] += fromR[i]! * send.level }
    }
    for (let i = 0; i < total; i++) { L[i] += sl[i]!; R[i] += sr[i]! }
    return { name: spec.name, L: sl, R: sr, cpu: (t.cpuMs + chain.cpuMs) / (1000 * total / SR) }
  })
  const returns = busSpecs.map(b => {
    const x = busIn.get(b.id)!
    const chain = new OfflineChain(b.inserts, 'return', p.bpm)
    chain.process(x.L, x.R)
    if (b.muted) { x.L.fill(0); x.R.fill(0) }
    pan(x.L, x.R, b.level, b.pan)
    for (let i = 0; i < total; i++) { L[i] += x.L[i]!; R[i] += x.R[i]! }
    return { name: `${b.id} ${b.name}`, L: x.L, R: x.R, cpu: chain.cpuMs / (1000 * total / SR) }
  })
  const master = new OfflineChain(p.masterInserts, 'insert', p.bpm)
  master.process(L, R)
  for (let i = 0; i < total; i++) { L[i] *= p.masterLevel; R[i] *= p.masterLevel }
  const preLimiter = { L: L.slice(), R: R.slice() }

  // Master limiter: threshold -3 dB, knee 6, ratio 12, attack 3 ms, release 150 ms.
  const aA = Math.exp(-1 / (0.003 * SR)), aR = Math.exp(-1 / (0.15 * SR))
  let env = 0, grMax = 0, grSum = 0, grSamples = 0
  const curve = (db: number) => {
    const T = -3, K = 6, Rt = 12
    if (db < T - K / 2) return db
    if (db > T + K / 2) return T + (db - T) / Rt
    return db + ((1 / Rt - 1) * (db - T + K / 2) ** 2) / (2 * K)
  }
  for (let i = 0; i < total; i++) {
    const lvl = Math.max(Math.abs(L[i]!), Math.abs(R[i]!))
    env = lvl > env ? aA * env + (1 - aA) * lvl : aR * env + (1 - aR) * lvl
    const db = 20 * Math.log10(env + 1e-12)
    const gr = db - curve(db)
    if (gr > 0.1) { grSum += gr; grSamples++ }
    grMax = Math.max(grMax, gr)
    const gain = 10 ** (-gr / 20)
    L[i] *= gain; R[i] *= gain
  }
  return { L, R, stems, returns, masterCpu: master.cpuMs / (1000 * total / SR), preLimiter, total, songSteps: song, stepDur,
    limiter: { grMax, grMeanWhenActive: grSamples ? grSum / grSamples : 0, activeShare: grSamples / total } }
}

// ── Analysis ───────────────────────────────────────────────────────────────

const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9))
function stats(L: Float64Array, R: Float64Array, from = 0, to = L.length) {
  let pk = 0, s = 0
  for (let i = from; i < to; i++) { const a = Math.max(Math.abs(L[i]!), Math.abs(R[i]!)); if (a > pk) pk = a; s += (L[i]! ** 2 + R[i]! ** 2) / 2 }
  return { peak: pk, rms: Math.sqrt(s / Math.max(1, to - from)) }
}
/** In-place radix-2 FFT (re, im of length 2^k). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b]! * cr - im[b]! * ci, ti = re[b]! * ci + im[b]! * cr
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

/**
 * Energy per octave band (63 Hz..16 kHz): Welch-averaged power spectrum
 * (8192-point Hann frames, half overlap), every bin summed into its band.
 * An earlier version probed single frequencies over the whole render, which
 * on tonal music mostly fell between the partials and read tonal parts as
 * 10-20 dB darker than they are.
 */
function bands(x: Float64Array, from: number, len: number): number[] {
  const N = 8192, hop = N / 2, psd = new Float64Array(N / 2)
  const win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  const re = new Float64Array(N), im = new Float64Array(N)
  let frames = 0
  for (let s = from; s + N <= from + len; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[s + i]! * win[i]!; im[i] = 0 }
    fft(re, im)
    for (let k = 0; k < N / 2; k++) psd[k] += re[k]! * re[k]! + im[k]! * im[k]!
    frames++
  }
  return [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map(fc => {
    const lo = Math.ceil(fc / Math.SQRT2 * N / SR), hi = Math.floor(fc * Math.SQRT2 * N / SR)
    let e = 0
    for (let k = lo; k <= hi && k < N / 2; k++) e += psd[k]!
    return 10 * Math.log10(e / Math.max(1, frames) + 1e-30)
  })
}

function writeWav(path: string, L: Float64Array, R: Float64Array): void {
  const n = L.length, buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i]!)) * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i]!)) * 32767), 46 + i * 4)
  }
  writeFileSync(path, buf)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const loops = Number(arg('--loops', '2'))
  const out = arg('--out', resolve(tmpdir(), 'demo-song.wav'))
  const id = arg('--demo', DEMOS[0]!.id)
  const demo = DEMOS.find(d => d.id === id)
  if (!demo) throw new Error(`no demo "${id}" (have: ${DEMOS.map(d => d.id).join(', ')})`)
  const project = demo.build()
  const r = await renderProject(project, loops)
  const bodyEnd = Math.round(r.songSteps * loops * r.stepDur * SR)
  const mix = stats(r.preLimiter.L, r.preLimiter.R, 0, bodyEnd)
  console.log(`${project.name}: ${project.bpm} BPM, ${r.songSteps / 16} bars x ${loops}, ${(r.total / SR).toFixed(1)} s`)
  // CPU: share of real time each processor needs (Node, one core). Every
  // worklet in the studio shares ONE audio thread, so the column's sum is
  // what has to fit — past ~50 % the browser starts dropping blocks, which
  // is heard as clicks.
  // Track rows are post-fader (their dry part of the mix); return rows are
  // what each return adds. A return nobody sends to is idle and costs nothing.
  console.log('\ntrack            rms dB  peak dB   cpu')
  let cpuSum = r.masterCpu
  const row = (s: { name: string; L: Float64Array; R: Float64Array; cpu: number }) => {
    const st = stats(s.L, s.R, 0, bodyEnd)
    cpuSum += s.cpu
    const level = st.peak > 1e-6 ? `${db(st.rms).toFixed(1).padStart(7)} ${db(st.peak).toFixed(1).padStart(8)}` : '     (no sends)'
    console.log(`${s.name.padEnd(15)} ${level} ${(s.cpu * 100).toFixed(1).padStart(5)}%`)
  }
  for (const s of r.stems) row(s)
  for (const s of r.returns) row({ ...s, name: `↩ ${s.name}` })
  console.log(`${'all tracks + returns'.padEnd(32)} ${(cpuSum * 100).toFixed(1).padStart(5)}%  of one core, real time`)
  console.log(`\nmix before limiter: rms ${db(mix.rms).toFixed(1)} dB, peak ${db(mix.peak).toFixed(1)} dB`)
  console.log(`limiter: max ${r.limiter.grMax.toFixed(1)} dB, mean ${r.limiter.grMeanWhenActive.toFixed(1)} dB while active, active ${(r.limiter.activeShare * 100).toFixed(1)}% of the time`)
  const mono = new Float64Array(bodyEnd)
  for (let i = 0; i < bodyEnd; i++) mono[i] = (r.L[i]! + r.R[i]!) / 2
  const b = bands(mono, 0, bodyEnd)
  const top = Math.max(...b)
  const head = ['63', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'].map(s => s.padStart(6)).join('')
  console.log(`\nbalance (dB rel. loudest band)   ${head}`)
  console.log(`${'mix'.padEnd(32)} ${b.map(v => (v - top).toFixed(1).padStart(6)).join('')}`)
  // Each track's contribution per band, on the same scale: which part fills
  // (or leaves empty) a region of the spectrum.
  const heard = r.returns.filter(x => stats(x.L, x.R, 0, bodyEnd).peak > 1e-6)
  for (const st of [...r.stems, ...heard.map(x => ({ ...x, name: `↩ ${x.name}` }))]) {
    const m = new Float64Array(bodyEnd)
    for (let i = 0; i < bodyEnd; i++) m[i] = (st.L[i]! + st.R[i]!) / 2 * project.masterLevel
    console.log(`  ${st.name.padEnd(30)} ${bands(m, 0, bodyEnd).map(v => (v - top).toFixed(1).padStart(6)).join('')}`)
  }
  writeWav(out, r.L, r.R)
  console.log(`\nwrote ${out}`)
  const stemDir = arg('--stems', '')
  if (stemDir) {
    mkdirSync(stemDir, { recursive: true })
    for (const s of r.stems) writeWav(resolve(stemDir, `${s.name.replace(/\W+/g, '_')}.wav`), s.L, s.R)
    console.log(`stems -> ${stemDir}`)
  }
}
