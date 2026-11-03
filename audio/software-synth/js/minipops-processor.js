// Korg Mini Pops 7 — AudioWorklet processor.
//
// Keio/Korg, 1973; sold in the US as the Univox SR-95. A preset rhythm box:
// ten keys, each carrying two rhythms selected by an A/B lever, and the
// keys can be pressed together to combine rhythms. There is no step grid on
// the machine — the patterns are diode matrices — so this processor is a
// rhythm box too: it runs its own clock and plays whatever keys are down.
//
// Everything here is taken from the SR-95 service manual (Unicord, 1973),
// which documents the Mini Pops 7 circuit under the Univox name:
//
//   - pp. 6-7, "Pulse generator rhythm pattern": the 30 pulse outputs on a
//     16-column grid. The grid is TWO BARS OF EIGHTH NOTES (Rock 1's snare
//     falls on columns 3, 7, 11, 15 — beats 2 and 4 of each bar), which is
//     how every grid agrees with the notation on p. 3. Swing's ride hits sit
//     between columns, a third of a step late; the rumba hi-hat has one
//     sixteenth. The 12-step rhythms (the waltzes in 3/4, slow rock and
//     march 6/8 in 12/8) are transcribed from the notation.
//   - p. 8, "Output level": for every sound its resonance frequency, its
//     output voltage and the time for the envelope to fall to a tenth
//     (-20 dB). The voices below are those numbers made audible: a drum is
//     a resonator struck once, a snare or cymbal is white noise through a
//     resonance with that decay, the guiro a 65 Hz pulse train gated into a
//     4.1 kHz resonance, the quijada a 25 Hz rattle into 2.7 kHz.
//
// Protocol (same family as the other synths in js/):
//   { type: 'param', param, value }   key.0..9 (bool), section (0 = A, 1 = B),
//                                     tempo (bpm), volume, balance,
//                                     quijada / guiro / tambourine (0..1),
//                                     trim.<voice>, quijadaPitch, guiroPitch
//   { type: 'preset', params }        a rhythm selection + slider positions
//   { type: 'play', bpm?, startTime? } start the clock (at an AudioContext time)
//   { type: 'stop' }
//   { type: 'trigger', voice, velocity }   audition one sound
//   { type: 'noteOn', note, velocity }     keyboard play: notes map onto voices
// It posts { type: 'step', step, len, div } at every step and
// { type: 'hits', mask } for the voices struck in a block.

import { fastTanh } from './dsp-lib.js';

const TWO_PI = 2 * Math.PI;
const LN10 = Math.log(10);

// ─── Voices ─────────────────────────────────────────────────────────────────

export const VOICE_NAMES = ['BD', 'SD1', 'SD2', 'HH', 'CY1', 'CY2', 'CB', 'CO', 'LB', 'SB', 'CL', 'QU', 'GU', 'TA'];
export const VOICE_LABELS = ['Bass drum', 'Snare 1', 'Snare 2', 'Hi-hat', 'Cymbal 1', 'Cymbal 2',
  'Cow bell', 'Conga', 'Large bongo', 'Small bongo', 'Claves', 'Quijada', 'Guiro', 'Tambourine'];
const V = {};
VOICE_NAMES.forEach((n, i) => { V[n] = i; });

/**
 * The tone generator, as the service manual's output-level table gives it.
 * `f` is the frequency or resonance in Hz, `t20` the seconds to fall 20 dB,
 * `out` the output in volts (the loudest, the claves, is the reference).
 *
 *   drum    — a struck resonator (the bridged-T networks of the drums)
 *   bell    — the cow bell: an 860 Hz fundamental plus its 4.6 kHz tone
 *   noise   — white noise through a resonance, with the decay on the noise
 *   ratchet — a pulse train into a resonance: the guiro while its gate is
 *             open, the quijada for a 300 ms rattle
 *
 * What the table does not give (the width of each noise resonance, the
 * cow bell's tone mix, the claves' 400 Hz body, the real decay of the bongo)
 * was fitted against recordings of the machine: the eight voices the O2
 * Minipops clone carries as 8-bit, 20 kHz samples (bass drum, large bongo,
 * claves, cow bell, cymbal 1, hi-hat, guiro, quijada). After the fit those
 * eight sit within 0.1-3 dB per third-octave band of the recordings; the
 * snares, conga, small bongo, cymbal 2 and tambourine have no recording
 * and follow the table alone.
 */
export const SPEC = {
  BD:  { kind: 'drum',    f: 65,   t20: 0.065, out: 1.6,  drive: 0.8, click: 0.12 },
  CO:  { kind: 'drum',    f: 194,  t20: 0.270, out: 1.6,  drive: 1.1, click: 0.05 },
  LB:  { kind: 'drum',    f: 400,  t20: 0.030, out: 1.26, drive: 1.0, click: 0.05 },
  SB:  { kind: 'drum',    f: 600,  t20: 0.040, out: 1.5,  drive: 1.1, click: 0.05 },
  CL:  { kind: 'drum',    f: 2200, t20: 0.020, out: 5.3,  drive: 1.0, click: 0.0, body: 400, bodyMix: 1.8 },
  CB:  { kind: 'bell',    f: 860,  f2: 4600, t20: 0.055, out: 3.35, mix2: 0.15, drive: 0.8 },
  HH:  { kind: 'noise',   f: 8150, t20: 0.030, out: 1.2,  q: 0.8 },
  SD1: { kind: 'noise',   f: 5500, t20: 0.170, out: 2.5,  q: 5, body: 190 },
  SD2: { kind: 'noise',   f: 5000, t20: 0.140, out: 2.0,  q: 5, body: 230 },
  CY1: { kind: 'noise',   f: 5600, t20: 0.400, out: 2.0,  q: 2.5 },
  CY2: { kind: 'noise',   f: 5600, t20: 0.160, out: 1.2,  q: 2.5 },
  TA:  { kind: 'noise',   f: 4600, t20: 0.090, out: 3.0,  q: 4 },
  GU:  { kind: 'ratchet', f: 4100, rate: 65,   t20: 0,     out: 4, q: 4 },
  QU:  { kind: 'ratchet', f: 2600, rate: 22.5, t20: 0.300, out: 5, q: 9, jitter: 0.25, tickLp: 3200 },
};

/**
 * Peak of each voice at unit level, measured by rendering one hit in Node
 * (the harness in synthex/packages/studio/tests/minipops-sound.test.ts checks
 * them). Dividing by it makes `out` the actual peak ratio between the voices,
 * as on the machine.
 */
const CAL = {
  BD: 0.570, SD1: 2.422, SD2: 2.385, HH: 0.582, CY1: 1.551, CY2: 1.503, CB: 0.617,
  CO: 0.846, LB: 0.742, SB: 0.800, CL: 2.361, QU: 0.217, GU: 0.388, TA: 1.704,
};
const OUT_REF = 5.3;

// ─── Rhythms ────────────────────────────────────────────────────────────────

/**
 * The twenty rhythms, by key (0-9) and section (A upper, B lower), as hit
 * positions in steps. A step is an eighth note; `len` 16 is two bars of 4/4,
 * `len` 12 with `div` 2 is two bars of 3/4 and with `div` 3 one bar of 12/8
 * (`div` = steps per beat). A fractional position is a hit between steps:
 * .33 is the late triplet eighth of swing, .5 a sixteenth.
 */
const all16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const all12 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const RIDE = [0, 2, 3.33, 4, 6, 7.33, 8, 10, 11.33, 12, 14, 15.33];       // the swing ride
const HH16TH = [0, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 9, 9.5, 10, 11, 12, 13, 14, 15];

export const RHYTHMS = {
  a: [
    { name: 'Waltz', len: 12, div: 2,
      parts: { CY1: [0, 6], SD1: [2, 4, 8, 10], BD: [0, 6] } },
    { name: 'Samba', len: 16, div: 2,
      parts: { HH: all16, CB: [0, 2, 4, 5, 7, 9, 11, 13, 14], CO: [6, 14], BD: [0, 4, 8, 12] } },
    { name: 'Mambo', len: 16, div: 2,
      parts: { HH: all16, CB: [0, 2, 4, 6, 8, 10, 12, 14], CO: [6, 7, 14, 15], BD: [0, 3, 4, 6, 8, 11, 12, 14] } },
    { name: 'Rumba', len: 16, div: 2,
      parts: { HH: HH16TH, CL: [0, 3, 6, 10, 12], SB: [2, 5, 10, 13], LB: [0, 3, 4, 8, 11, 12],
        CO: [6, 7, 14, 15], BD: [0, 4, 6, 8, 12, 14] } },
    { name: 'Tango', len: 16, div: 2,
      parts: { CY1: [7, 15], SD2: [7, 15], HH: [0, 2, 4, 6, 8, 10, 12, 14], BD: [0, 2, 4, 6, 8, 10, 12, 14] } },
    { name: 'Bossanova', len: 16, div: 2,
      parts: { HH: all16, CB: [0, 3, 6, 10, 13], BD: [0, 3, 4, 7, 8, 11, 12, 15] } },
    { name: 'Rock 1', len: 16, div: 2,
      parts: { HH: all16, SD1: [2, 6, 10, 14], BD: [0, 3, 4, 7, 8, 11, 12, 15] } },
    { name: 'Rock 3', len: 16, div: 2,
      parts: { HH: all16, SD1: [2, 6, 10, 14], SD2: [3, 4, 11, 12], BD: [0, 3, 4, 5, 7, 8, 11, 12, 13, 15] } },
    { name: 'March 2/4', len: 16, div: 2,
      parts: { SD2: [2, 6, 10, 14], BD: [0, 4, 8, 12] } },
    { name: 'Swing', len: 16, div: 2,
      parts: { CY2: RIDE, SD2: [2, 6, 10, 14], BD: [0, 2, 4, 6, 8, 10, 12, 14] } },
  ],
  b: [
    { name: 'Jazz Waltz', len: 12, div: 2,
      parts: { CY1: [0, 6], SD1: [1, 2, 4, 7, 8, 10], BD: [0, 6] } },
    { name: 'Meringue', len: 16, div: 2,
      parts: { HH: all16, CB: [0, 3, 4, 8, 9, 11, 12], CO: [6, 14], BD: [0, 3, 4, 8, 11, 12] } },
    { name: 'Cha-cha', len: 16, div: 2,
      parts: { HH: all16, CB: [0, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14], CO: [6, 7, 14, 15], BD: [0, 3, 4, 6, 8, 11, 12, 14] } },
    { name: 'Beguine', len: 16, div: 2,
      parts: { HH: HH16TH, CL: [0, 3, 6, 10, 12], SB: [1, 3, 5, 7, 9, 11, 13, 15], LB: [0, 4, 6, 8, 12, 14],
        CO: [6, 7, 14, 15], BD: [0, 4, 6, 8, 12, 14] } },
    { name: 'Habanera', len: 16, div: 2,
      parts: { CY1: [0, 8], HH: [0, 3, 4, 6, 8, 11, 12, 14], BD: [0, 3, 4, 6, 8, 11, 12, 14] } },
    { name: 'Slow Rock', len: 12, div: 3,
      parts: { HH: all12, CB: [3, 9], BD: [0, 5, 6, 11] } },
    { name: 'Rock 2', len: 16, div: 2,
      parts: { HH: all16, SD1: [2, 5, 10, 13], BD: [0, 3, 4, 7, 8, 11, 12, 15] } },
    { name: 'Rock 4', len: 16, div: 2,
      parts: { HH: all16, SD1: [2, 5, 10, 13], SD2: [3, 7, 11, 15], BD: [0, 4, 6, 7, 8, 12, 14, 15] } },
    { name: 'March 6/8', len: 12, div: 3,
      parts: { CY2: [0, 2, 3, 5, 6, 8, 9, 11], BD: [0, 3, 6, 9] } },
    { name: 'Latin Swing', len: 16, div: 2,
      parts: { CY2: RIDE, SB: [2, 10], CO: [6, 7.33, 14, 15.33], BD: [0, 4, 6, 8, 12, 14] } },
  ],
};

/**
 * The three "additional rhythms" the front-panel sliders blend in, on top
 * of whatever is playing (p. 3: tambourine on every eighth, guiro a long
 * scrape on the beat and two short ones after, quijada on the backbeat).
 * Keyed by the running pattern's length and division; the guiro carries a
 * gate length in steps.
 */
const EXTRA = {
  '16/2': { TA: all16, QU: [2, 6, 10, 14],
    GU: [[0, 1.5], [2, 0.6], [3, 0.6], [4, 1.5], [6, 0.6], [7, 0.6], [8, 1.5], [10, 0.6], [11, 0.6], [12, 1.5], [14, 0.6], [15, 0.6]] },
  '12/2': { TA: all12, QU: [2, 8],
    GU: [[0, 1.5], [2, 0.6], [3, 0.6], [4, 0.6], [5, 0.6], [6, 1.5], [8, 0.6], [9, 0.6], [10, 0.6], [11, 0.6]] },
  '12/3': { TA: all12, QU: [3, 9],
    GU: [[0, 2], [3, 0.6], [4, 0.6], [5, 0.6], [6, 2], [9, 0.6], [10, 0.6], [11, 0.6]] },
};

// ─── DSP building blocks ────────────────────────────────────────────────────

/** Two-pole resonator: an impulse rings at `freq`, falling to 1/e in `tau` s. */
class Resonator {
  constructor(sr) { this.sr = sr; this.y1 = 0; this.y2 = 0; this.a1 = 0; this.a2 = 0; this.gain = 1; }
  set(freq, tau) {
    const w = TWO_PI * Math.min(freq, this.sr * 0.45) / this.sr;
    const r = Math.exp(-1 / (Math.max(0.0005, tau) * this.sr));
    this.a1 = 2 * r * Math.cos(w);
    this.a2 = -r * r;
    this.gain = Math.sin(w);          // unit-ish peak whatever the frequency
  }
  reset() { this.y1 = 0; this.y2 = 0; }
  process(x) {
    const y = x * this.gain + this.a1 * this.y1 + this.a2 * this.y2;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Topology-preserving SVF, bandpass output; stable up to the hi-hat's 8 kHz. */
class BandPass {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; }
  set(sr, freq, q) {
    const g = Math.tan(Math.PI * Math.min(Math.max(freq, 10), sr * 0.45) / sr);
    this.k = 1 / Math.max(0.5, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  reset() { this.ic1 = 0; this.ic2 = 0; }
  process(x) {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v1;
  }
}

// ─── A voice ────────────────────────────────────────────────────────────────

class Voice {
  constructor(sr, name) {
    this.sr = sr;
    this.name = name;
    this.spec = SPEC[name];
    this.res = new Resonator(sr);
    this.res2 = new Resonator(sr);
    this.bp = new BandPass();
    this.bp2 = new BandPass();
    this.active = false;
    this.n = 0;
    this.life = 0;            // samples until the voice is retired
    this.env = 0;
    this.envMul = 1;
    this.vel = 0;
    this.gate = 0;            // guiro: samples the scrape still lasts
    this.pulse = 0;           // ratchets: samples until the next tick
    this.period = 1;
    this.seed = 0x2545F491 ^ (name.length * 7919);
    this.lp = 0;              // click low-pass
    this.dcX = 0; this.dcY = 0;
    this.trim = 1;
    this.pitch = 1;
    this.tickK = 1;           // service trim: quijada / guiro resonance
    this.retune();
  }

  retune() {
    const s = this.spec, tau = s.t20 / LN10;
    switch (s.kind) {
      case 'drum':
        this.res.set(s.f, tau);
        if (s.body) this.res2.set(s.body, (s.bodyT20 || s.t20) / LN10);
        this.life = Math.round((tau * 7 + 0.01) * this.sr);
        break;
      case 'bell':
        this.res.set(s.f, tau);
        this.res2.set(s.f2, tau * (s.t2 || 0.4));
        this.life = Math.round((tau * 7 + 0.01) * this.sr);
        break;
      case 'noise':
        this.bp.set(this.sr, s.f, s.q);
        if (s.f2) this.bp2.set(this.sr, s.f2, s.q2 || s.q);
        if (s.body) this.res.set(s.body, s.bodyT20 ? s.bodyT20 / LN10 : 0.012);
        this.envMul = Math.exp(-1 / (tau * this.sr));
        this.life = Math.round(tau * 7 * this.sr);
        break;
      case 'ratchet':
        // A bandpass rather than a struck resonator: the recordings have no
        // low end under the ticks, and a two-pole lets the pulse train's own
        // 65 Hz harmonics through at -22 dB.
        this.bp.set(this.sr, s.f * this.pitch, s.q || 4);
        this.tickK = s.tickLp ? 1 - Math.exp(-TWO_PI * s.tickLp / this.sr) : 1;
        this.period = Math.max(1, Math.round(this.sr / s.rate));
        this.envMul = tau > 0 ? Math.exp(-1 / (tau * this.sr)) : 1;
        this.life = tau > 0 ? Math.round(tau * 7 * this.sr) : 0;
        break;
    }
  }

  /** Strike. `gateSteps` in samples is the guiro's scrape length. */
  trigger(vel, gateSamples = 0) {
    this.active = true;
    this.n = 0;
    this.vel = vel;
    this.env = 1;
    this.gate = gateSamples;
    this.pulse = 0;
    this.lp = 0;
    // The resonators are NOT reset: a drum struck while still ringing adds
    // the new hit to the old one, as a circuit would.
  }

  noise() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  process() {
    if (!this.active) return 0;
    const s = this.spec;
    const imp = this.n === 0 ? 1 : 0;
    let out = 0;
    switch (s.kind) {
      case 'drum': {
        const y = this.res.process(imp);
        // The transistor stage after the network clips one half harder: a
        // little second harmonic, and a DC term the blocker removes.
        let sat = fastTanh(y * s.drive + y * y * 0.3 * (s.drive - 1));
        if (s.body) sat += this.res2.process(imp) * (s.bodyMix || 0.5);
        const blocked = sat - this.dcX + 0.998 * this.dcY;
        this.dcX = sat; this.dcY = blocked;
        // The trigger pulse itself leaks through as a short tick.
        this.lp += (imp - this.lp) * 0.25;
        out = blocked + this.lp * s.click;
        break;
      }
      case 'bell': {
        const y = this.res.process(imp) * 0.75 + this.res2.process(imp) * (s.mix2 || 0.45);
        out = fastTanh(y * (s.drive || 1.6));
        break;
      }
      case 'noise': {
        const x = this.noise() * this.env;
        out = this.bp.process(x);
        if (s.f2) out += this.bp2.process(x) * s.mix2;
        if (s.body) out += this.res.process(imp) * (s.bodyMix || 0.28);
        this.env *= this.envMul;
        break;
      }
      case 'ratchet': {
        let tick = 0;
        const running = s.t20 > 0 ? true : this.gate > 0;
        if (running && this.pulse <= 0) {
          tick = this.env;
          // A jawbone's rattle is not a metronome: the recording's ticks
          // wander by a third of their spacing. Deterministic per voice.
          this.pulse = s.jitter ? Math.round(this.period * (1 + s.jitter * this.noise())) : this.period;
        }
        this.pulse--;
        if (this.gate > 0) this.gate--;
        // The tick itself is softer than a one-sample impulse: round it off.
        this.lp += (tick - this.lp) * this.tickK;
        out = this.bp.process(s.tickLp ? this.lp : tick);
        this.env *= this.envMul;
        break;
      }
    }
    this.n++;
    const end = s.kind === 'ratchet' && s.t20 === 0
      ? this.gate <= 0 && this.n > this.period * 2 && this.pulse < -this.sr * 0.02
      : this.n > this.life;
    if (end) { this.active = false; }
    return out * this.vel * this.trim * (s.out / OUT_REF) / CAL[this.name];
  }
}

// ─── The rhythm box ─────────────────────────────────────────────────────────

const NUM_KEYS = 10;
const MAX_PENDING = 64;

class MiniPopsProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.sr = sr;
    this.voices = VOICE_NAMES.map(n => new Voice(sr, n));

    this.keys = new Uint8Array(NUM_KEYS);
    this.section = 0;
    this.tempo = 120;
    this.volume = 0.8;
    this.balance = 0.5;
    this.extra = { QU: 0, GU: 0, TA: 0 };

    // The merged pattern of the keys that are down.
    this.len = 16;
    this.div = 2;
    this.parts = [];          // { voice, pos: number[], gate: number[] | null }
    this.samplesPerStep = 0;
    this._timing();

    this.playing = false;
    this.step = 0;
    this.counter = 0;         // samples until the next step
    this.startDelay = 0;      // samples until the clock may start
    this.pendVoice = new Uint8Array(MAX_PENDING);
    this.pendAt = new Int32Array(MAX_PENDING);
    this.pendGate = new Int32Array(MAX_PENDING);
    this.pendCount = 0;
    this.hitMask = 0;

    this.balLp = 0;
    this.port.onmessage = (e) => this._handle(e.data);
  }

  _timing() {
    this.samplesPerStep = this.sr * 60 / (this.tempo * this.div);
  }

  /**
   * Merge the rhythms of every key that is down into one part list. Keys
   * pressed together OR their pulses, as the diode matrix does; a 12-step
   * key puts the counter in 12-step mode for all of them.
   */
  _rebuild() {
    const sel = [];
    const row = RHYTHMS[this.section === 1 ? 'b' : 'a'];
    for (let k = 0; k < NUM_KEYS; k++) if (this.keys[k]) sel.push(row[k]);
    let len = 16, div = 2;
    for (const r of sel) { if (r.len === 12) len = 12; if (r.div === 3) div = 3; }
    const parts = [];
    const add = (voice, pos, gate) => {
      let p = parts.find(x => x.voice === voice && !!x.gate === !!gate);
      if (!p) { p = { voice, pos: [], gate: gate ? [] : null }; parts.push(p); }
      for (let i = 0; i < pos.length; i++) {
        if (pos[i] >= len || p.pos.includes(pos[i])) continue;
        p.pos.push(pos[i]);
        if (gate) p.gate.push(gate[i]);
      }
    };
    for (const r of sel) for (const name in r.parts) add(V[name], r.parts[name], null);
    const ex = EXTRA[`${len}/${div}`];
    add(V.TA, ex.TA, null);
    add(V.QU, ex.QU, null);
    add(V.GU, ex.GU.map(g => g[0]), ex.GU.map(g => g[1]));
    this.parts = parts;
    this.len = len;
    this.div = div;
    this._timing();
    if (this.step >= len) this.step = 0;
  }

  _hit(voice, gateSamples = 0) {
    // The additional rhythms play at their slider's level; at zero they are off.
    const name = VOICE_NAMES[voice];
    let vel = 1;
    if (name === 'QU' || name === 'GU' || name === 'TA') {
      vel = this.extra[name];
      if (vel <= 0.001) return;
    }
    this.voices[voice].trigger(vel, gateSamples);
    this.hitMask |= 1 << voice;
  }

  /** Fire this step's hits; hits between steps go into the pending list. */
  _stepHits() {
    const sps = this.samplesPerStep;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      for (let j = 0; j < p.pos.length; j++) {
        const pos = p.pos[j];
        const whole = Math.floor(pos);
        if (whole !== this.step) continue;
        const gate = p.gate ? Math.round(p.gate[j] * sps) : 0;
        const frac = pos - whole;
        if (frac === 0) this._hit(p.voice, gate);
        else if (this.pendCount < MAX_PENDING) {
          const k = this.pendCount++;
          this.pendVoice[k] = p.voice;
          this.pendAt[k] = Math.round(frac * sps);
          this.pendGate[k] = gate;
        }
      }
    }
  }

  _handle(msg) {
    switch (msg.type) {
      case 'param': this._param(msg.param, msg.value); break;
      case 'preset': {
        const p = msg.params || {};
        if (Object.keys(p).some(k => k.startsWith('key.'))) this.keys.fill(0);
        for (const k in p) this._param(k, p[k]);
        this._rebuild();
        break;
      }
      case 'play': {
        if (typeof msg.bpm === 'number') { this.tempo = msg.bpm; this._timing(); }
        const now = typeof currentTime === 'number' ? currentTime : 0;
        this.startDelay = typeof msg.startTime === 'number'
          ? Math.max(0, Math.round((msg.startTime - now) * this.sr)) : 0;
        this.playing = true;
        this.step = 0;
        this.counter = 0;
        this.pendCount = 0;
        break;
      }
      case 'stop': this.playing = false; this.pendCount = 0; break;
      case 'trigger': {
        const v = typeof msg.voice === 'string' ? V[msg.voice] : msg.voice;
        if (v >= 0 && v < VOICE_NAMES.length) {
          const name = VOICE_NAMES[v];
          const gate = name === 'GU' ? Math.round(this.sr * 0.25) : 0;
          this.voices[v].trigger(msg.velocity ?? 1, gate);
          this.hitMask |= 1 << v;
        }
        break;
      }
      case 'noteOn': {
        const n = VOICE_NAMES.length;
        const v = (((msg.note ?? 36) - 36) % n + n) % n;
        const gate = VOICE_NAMES[v] === 'GU' ? Math.round(this.sr * 0.25) : 0;
        this.voices[v].trigger(Math.min(1, (msg.velocity ?? 100) / 100), gate);
        this.hitMask |= 1 << v;
        break;
      }
      case 'noteOff': break;
    }
  }

  _param(name, value) {
    if (name.startsWith('key.')) {
      const k = parseInt(name.slice(4), 10);
      if (k >= 0 && k < NUM_KEYS) { this.keys[k] = value ? 1 : 0; this._rebuild(); }
    } else if (name === 'section') {
      this.section = value === 1 || value === '1' || value === 'b' || value === true ? 1 : 0;
      this._rebuild();
    } else if (name === 'tempo') { this.tempo = Math.max(20, Math.min(300, +value)); this._timing(); }
    else if (name === 'volume') this.volume = +value;
    else if (name === 'balance') this.balance = +value;
    else if (name === 'quijada') this.extra.QU = +value;
    else if (name === 'guiro') this.extra.GU = +value;
    else if (name === 'tambourine') this.extra.TA = +value;
    else if (name.startsWith('trim.')) {
      const v = V[name.slice(5)];
      if (v !== undefined) this.voices[v].trim = +value;
    } else if (name === 'quijadaPitch') { this.voices[V.QU].pitch = +value; this.voices[V.QU].retune(); }
    else if (name === 'guiroPitch') { this.voices[V.GU].pitch = +value; this.voices[V.GU].retune(); }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    const voices = this.voices;
    // Tone balance: a one-pole split at 800 Hz, lows down and highs up as the
    // slider rises; centre is flat.
    const kBal = 1 - Math.exp(-TWO_PI * 800 / this.sr);
    const loG = 1.3 - 0.6 * this.balance, hiG = 0.4 + 1.2 * this.balance;
    const vol = this.volume * 0.55;

    for (let i = 0; i < n; i++) {
      // Hits booked for between the steps. Counted down before this
      // sample's step is read, so a hit booked N samples ahead lands N
      // samples later, not N - 1.
      for (let k = 0; k < this.pendCount; k++) {
        if (--this.pendAt[k] <= 0) {
          this._hit(this.pendVoice[k], this.pendGate[k]);
          const last = --this.pendCount;
          this.pendVoice[k] = this.pendVoice[last];
          this.pendAt[k] = this.pendAt[last];
          this.pendGate[k] = this.pendGate[last];
          k--;
        }
      }
      if (this.playing) {
        if (this.startDelay > 0) this.startDelay--;
        else {
          if (this.counter <= 1e-6) {
            this._stepHits();
            this.port.postMessage({ type: 'step', step: this.step, len: this.len, div: this.div });
            this.counter += this.samplesPerStep;
            this.step = (this.step + 1) % this.len;
          }
          this.counter--;
        }
      }

      let mix = 0;
      for (let v = 0; v < voices.length; v++) mix += voices[v].process();

      this.balLp += (mix - this.balLp) * kBal;
      const y = this.balLp * loG + (mix - this.balLp) * hiG;
      // The machine is mono; the output stage rounds the loudest peaks.
      const s = fastTanh(y * vol);
      L[i] = s; R[i] = s;
    }
    if (this.hitMask) { this.port.postMessage({ type: 'hits', mask: this.hitMask }); this.hitMask = 0; }
    return true;
  }
}

registerProcessor('minipops-processor', MiniPopsProcessor);
