// WaveSynth AudioWorklet Processor — Wavestation-inspired wavetable/wave sequence synth
// All DSP runs in the audio thread
//
// Sound audit, 2026-09-24 (offline render of every factory preset at 48 kHz,
// see the notes at each fix). Measured before the fixes:
//   - The SVF (dsp-lib SVFilter, a Chamberlin loop) goes unstable above
//     ~sr/3 with low resonance and emits NaN — Bell Chime's top octave did,
//     and one NaN poisons the reverb/delay buffers for good. Replaced here by
//     a trapezoidal (TPT) SVF with the same modes and Q mapping.
//   - The master was fastTanh (compression and distortion from half scale
//     up); now a soft knee above -1 dBFS. (The chords that clipped 30-60 k
//     samples were mostly dsp-lib's Freeverb running ~28 dB hot — fixed
//     there, not here.)
//   - Band-limiting chose the table for the BOTTOM of each octave, so the
//     top half of every octave aliased; the table also jumped in brightness
//     at every C. Tables are now built for the top of their octave and
//     adjacent tables are crossfaded.
//   - Base waves had fundamentals up to 90° out of phase (triangle, half-sine,
//     pulses), so a sequence or scan crossfade rotated the fundamental's
//     phase — heard as up to 8.6 cents of pitch drift and a level dip.
//     All waves are now phase-aligned (a time shift; single waves unchanged).
//   - Voice steal / retrigger reset the filter state mid-sound (a click).
//   - A non-looping sequence crossfaded back to step 1 at its end.

import {
  Envelope,
  MoogFilter,
  Chorus,
  StereoDelay,
  Freeverb,
  TWO_PI,
} from './dsp-lib.js';

const NUM_VOICES = 8;
const WAVE_SIZE = 2048;
const NUM_WAVES = 20;
const NUM_OCTAVES = 11;
const MAX_HARMONICS = WAVE_SIZE / 2 - 1;
const BASE_FREQ = 16.3516;                         // C0: table k covers C(k)..C(k+1)
const LOG2_440_OVER_BASE = Math.log2(440 / BASE_FREQ);
const DECLICK_TAU = 0.0015;                        // s, bleed-off of a retrigger jump
const SMOOTH_TAU = 0.005;                          // s, knob de-zipper

// ─── FFT (radix-2, in place) — only used to build the wave bank ────────────

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -TWO_PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// ─── Wave Bank Generation (band-limited per octave) ─────────────────────────
// Each wave is stored as bank[waveIdx][octaveIdx] = Float32Array(WAVE_SIZE + 1)
// (one guard sample so interpolation needs no wrap mask).
//
// Table k serves C(k)..C(k+1) and is crossfaded into table k+1 across that
// octave, so it must be alias-free up to the TOP of the octave. Harmonics may
// reach sr - 20 kHz rather than sr/2: anything between folds back above
// 20 kHz, which is inaudible, and the tables stay a little brighter for it.
//
// Every table of a wave shares one gain (the full-band table's peak), so the
// fundamental keeps its level up the keyboard instead of each table being
// re-normalised to its own peak.
//
// Built with FFTs (was a direct DFT/additive loop: ~600 ms blocking the audio
// thread on node creation) and cached per sample rate for the whole worklet
// scope, so a second instance in the Studio costs nothing.

const bankCache = new Map();

function generateWaveBank(sr) {
  if (bankCache.has(sr)) return bankCache.get(sr);
  const FORMULA_SIZE = 16384;  // fine enough that the analysis itself does not alias

  function makeWave(fn, n = FORMULA_SIZE) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = fn(i / n);
    return w;
  }

  function additiveWave(harmonicAmps) {
    return makeWave(t => {
      let s = 0;
      for (let i = 0; i < harmonicAmps.length; i++) {
        if (harmonicAmps[i] !== 0) s += harmonicAmps[i] * Math.sin(TWO_PI * (i + 1) * t);
      }
      return s;
    }, 4096);
  }

  // Define all 20 base waveforms
  const baseWaves = [
    // 0: Sine
    makeWave(t => Math.sin(TWO_PI * t)),
    // 1: Triangle
    makeWave(t => t < 0.5 ? 4 * t - 1 : 3 - 4 * t),
    // 2: Saw
    makeWave(t => 1 - 2 * t),
    // 3: Square
    makeWave(t => t < 0.5 ? 1 : -1),
    // 4: Pulse 25%
    makeWave(t => t < 0.25 ? 1 : -1),
    // 5: Pulse 12%
    makeWave(t => t < 0.125 ? 1 : -1),
    // 6: Half Sine
    makeWave(t => Math.sin(Math.PI * t)),
    // 7: Rectified Sine
    makeWave(t => Math.max(0, Math.sin(TWO_PI * t))),
    // 8: Organ 1
    additiveWave([1, 0.8, 0.6, 0.4, 0, 0, 0, 0.15]),
    // 9: Organ 2 (hollow)
    additiveWave([1, 0, 0.7, 0, 0, 0.5, 0, 0, 0, 0, 0.2]),
    // 10: Organ 3 (full)
    additiveWave([1, 1, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2]),
    // 11: Brass
    additiveWave(Array.from({length: 24}, (_, i) => 1 / Math.pow(i + 1, 0.6))),
    // 12: Strings
    additiveWave(Array.from({length: 32}, (_, i) => {
      const n = i + 1;
      return (n % 2 === 0 ? 0.7 : 1) / Math.pow(n, 0.8);
    })),
    // 13: Choir (formant peaks at harmonics 4-6, 10-12)
    additiveWave(Array.from({length: 24}, (_, i) => {
      const n = i + 1;
      if (n >= 4 && n <= 6) return 0.8 / n;
      if (n >= 10 && n <= 12) return 0.5 / n;
      return 0.2 / n;
    })),
    // 14: Bell
    additiveWave(Array.from({length: 16}, (_, i) => {
      const n = i + 1;
      if (n === 1) return 1;
      if (n === 3) return 0.8;
      if (n === 5) return 0.6;
      if (n === 9) return 0.5;
      if (n === 13) return 0.3;
      return 0.05;
    })),
    // 15: Metallic (every 3rd harmonic boosted)
    additiveWave(Array.from({length: 24}, (_, i) => {
      const n = i + 1;
      return (n % 3 === 0) ? 0.8 / Math.sqrt(n) : 0.15 / n;
    })),
    // 16: Digital 1
    additiveWave(Array.from({length: 24}, (_, i) => {
      const n = i + 1;
      return ((n % 2 === 0) ? 0.3 : 1) / Math.pow(n, 0.7);
    })),
    // 17: Digital 2 (odd harmonics, flat)
    additiveWave(Array.from({length: 16}, (_, i) => (i + 1) % 2 === 0 ? 0 : 0.5)),
    // 18: FM
    makeWave(t => Math.sin(TWO_PI * t + Math.sin(TWO_PI * 3 * t) * 2)),
    // 19: Noise (frozen random, smoothed) — defined at 4096 points; the
    // smoothing passes set its spectrum, so the size is part of the sound.
    (() => {
      const w = new Float64Array(4096);
      let seed = 0xDEAD;
      for (let i = 0; i < 4096; i++) {
        seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
        w[i] = (seed & 0xFFFF) / 32768 - 1;
      }
      for (let p = 0; p < 4; p++) {
        for (let i = 1; i < 4096 - 1; i++) {
          w[i] = w[i] * 0.5 + (w[i - 1] + w[i + 1]) * 0.25;
        }
      }
      return w;
    })()
  ];

  const limitHz = Math.max(sr / 2, sr - 20000);
  const bank = new Array(NUM_WAVES);
  const re = new Float64Array(WAVE_SIZE), im = new Float64Array(WAVE_SIZE);

  for (let w = 0; w < NUM_WAVES; w++) {
    const src = baseWaves[w], N = src.length;
    const Xr = Float64Array.from(src), Xi = new Float64Array(N);
    fft(Xr, Xi);
    const maxH = Math.min(MAX_HARMONICS, N / 2 - 1);

    // Phase-align: time-shift so the fundamental is in sine phase. A shift
    // is inaudible on its own, but without it crossfading, say, triangle
    // (fundamental at -90°) into saw rotates the fundamental's phase — a
    // pitch bend and a level dip in the middle of every crossfade.
    const fr = Xr[1], fi = Xi[1];
    let shift = 0;
    if (Math.hypot(fr, fi) > 1e-6 * N) shift = (Math.atan2(fi, fr) + Math.PI / 2) / TWO_PI;

    bank[w] = new Array(NUM_OCTAVES);
    let gain = 0;
    for (let oct = 0; oct < NUM_OCTAVES; oct++) {
      const topFreq = BASE_FREQ * Math.pow(2, oct + 1);
      const H = Math.max(1, Math.min(maxH, Math.floor(limitHz / topFreq)));
      re.fill(0); im.fill(0);
      for (let h = 1; h <= H; h++) {
        // X[h]·e^{-i2πh·shift}, then conj for the inverse-by-forward trick.
        const a = -TWO_PI * h * shift, c = Math.cos(a), s = Math.sin(a);
        const zr = Xr[h] * c - Xi[h] * s, zi = Xr[h] * s + Xi[h] * c;
        re[h] = zr; im[h] = -zi;
        re[WAVE_SIZE - h] = zr; im[WAVE_SIZE - h] = zi;
      }
      fft(re, im);
      const table = new Float32Array(WAVE_SIZE + 1);
      for (let i = 0; i < WAVE_SIZE; i++) table[i] = re[i] / N;
      table[WAVE_SIZE] = table[0];
      if (oct === 0) {
        for (let i = 0; i < WAVE_SIZE; i++) gain = Math.max(gain, Math.abs(table[i]));
        gain = gain > 1e-6 ? 1 / gain : 1;
      }
      for (let i = 0; i <= WAVE_SIZE; i++) table[i] *= gain;
      bank[w][oct] = table;
    }
  }

  bankCache.set(sr, bank);
  return bank;
}

// ─── Read from wavetable ────────────────────────────────────────────────────
// bankWave = bank[waveIdx] = array of per-octave tables. `oct` is the
// pitch in octaves above C0 (fractional); the two tables either side of it
// are crossfaded so brightness is continuous in pitch.

function readWave(bankWave, phase, oct) {
  let k, t;
  if (oct <= 0) { k = 0; t = 0; }
  else if (oct >= NUM_OCTAVES - 1) { k = NUM_OCTAVES - 1; t = 0; }
  else { k = Math.floor(oct); t = oct - k; }
  const pos = phase * WAVE_SIZE;
  const i0 = pos | 0;
  const frac = pos - i0;
  const w0 = bankWave[k];
  const a = w0[i0] + frac * (w0[i0 + 1] - w0[i0]);
  if (t === 0) return a;
  const w1 = bankWave[k + 1];
  const b = w1[i0] + frac * (w1[i0 + 1] - w1[i0]);
  return a + (b - a) * t;
}

// Crossfade between two waves based on fractional position
function readWaveScan(bank, position, phase, oct) {
  const maxIdx = NUM_WAVES - 1;
  const pos = Math.max(0, Math.min(1, position)) * maxIdx;
  const idxA = Math.floor(pos);
  const idxB = Math.min(idxA + 1, maxIdx);
  const mix = pos - idxA;
  const a = readWave(bank[idxA], phase, oct);
  if (mix === 0) return a;
  const b = readWave(bank[idxB], phase, oct);
  return a + (b - a) * mix;
}

// ─── State-variable filter (12 dB) ──────────────────────────────────────────
// Trapezoidal / zero-delay-feedback SVF (Zavalishin; Simper's formulation).
// Replaces dsp-lib's Chamberlin SVFilter HERE ONLY: that loop is only
// conditionally stable (f = 2·sin(π·fc/2sr) must stay below about 2 - q), and
// with resonance 0 it diverges to NaN above ~16 kHz at 48 kHz — reachable
// with key tracking and envelope, and Bell Chime's top octave did reach it.
// Same interface, same modes, same Q mapping (k = 1/Q = 1 - 0.95·res), and
// the same bandpass peak gain (1/k); stable for every cutoff below Nyquist.

class TptSVF {
  constructor() {
    this.ic1 = 0; this.ic2 = 0;
    this.mode = 0; // 0=LP, 1=HP, 2=BP, 3=Notch
    this._k = 1; this._a1 = 1; this._a2 = 0; this._a3 = 0;
  }

  reset() { this.ic1 = 0; this.ic2 = 0; }

  setParams(cutoff, resonance, sr) {
    const fc = Math.min(cutoff, sr * 0.49);
    const g = Math.tan(Math.PI * fc / sr);
    const k = 1 - resonance * 0.95;
    this._k = k;
    this._a1 = 1 / (1 + g * (g + k));
    this._a2 = g * this._a1;
    this._a3 = g * this._a2;
  }

  process(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this._a1 * this.ic1 + this._a2 * v3;
    const v2 = this.ic2 + this._a2 * this.ic1 + this._a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    switch (this.mode) {
      case 1: return v0 - this._k * v1 - v2;
      case 2: return v1;
      case 3: return v0 - this._k * v1;
      default: return v2;
    }
  }
}

// ─── LFO ────────────────────────────────────────────────────────────────────

class LFO {
  constructor(sr) {
    this.sr = sr;
    this.phase = 0;
    this.rate = 2;
    this.waveform = 0;
    this.sync = true;
    this.value = 0;
    this._shValue = 0;
    this._shStart = 0;
    this._shTarget = 0;
    this._prevPhase = 0;
    this.delay = 0;
    this.fadeIn = 0;
    this._elapsed = 0;
    this._fadeLevel = 1;
  }

  reset() {
    if (this.sync) this.phase = 0;
    this._elapsed = 0;
    this._fadeLevel = (this.delay > 0.001 || this.fadeIn > 0.001) ? 0 : 1;
  }

  process() {
    const dt = this.rate / this.sr;
    this._prevPhase = this.phase;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;

    this._elapsed += 1 / this.sr;
    if (this._elapsed < this.delay) {
      this._fadeLevel = 0;
    } else if (this.fadeIn > 0.001) {
      this._fadeLevel = Math.min(1, (this._elapsed - this.delay) / this.fadeIn);
    } else {
      this._fadeLevel = 1;
    }

    switch (this.waveform) {
      case 0: this.value = Math.sin(TWO_PI * this.phase); break;
      case 1: this.value = this.phase < 0.5 ? 4 * this.phase - 1 : 3 - 4 * this.phase; break;
      case 2: this.value = 2 * this.phase - 1; break;
      case 3: this.value = this.phase < 0.5 ? 1 : -1; break;
      case 4: // S&H
        if (this.phase < this._prevPhase) this._shValue = Math.random() * 2 - 1;
        this.value = this._shValue;
        break;
      case 5: // Smooth random: a raised-cosine glide to a new random target
        // every cycle. (Was a fixed 0.01/sample slew — a 2 ms time constant
        // whatever the rate, i.e. S&H with the edges barely rounded.)
        if (this.phase < this._prevPhase) {
          this._shStart = this._shValue;
          this._shTarget = Math.random() * 2 - 1;
        }
        this._shValue = this._shStart +
          (this._shTarget - this._shStart) * (0.5 - 0.5 * Math.cos(Math.PI * this.phase));
        this.value = this._shValue;
        break;
    }
    this.value *= this._fadeLevel;
    return this.value;
  }
}

// ─── Wave Sequencer ─────────────────────────────────────────────────────────

class WaveSequencer {
  constructor() {
    this.steps = []; // {wave, duration (ms), crossfade (0-1)}
    this.loopMode = 0; // 0=off, 1=forward, 2=pingpong
    this.speed = 1.0;
    this.position = 0; // ms elapsed in current playback
    this.direction = 1; // 1=forward, -1=backward (for pingpong)
    this.active = false;
    this.currentStep = 0;
    this.total = 0;
    // Output of tick(), kept on the object (no per-sample allocation).
    this.waveA = 0; this.waveB = 0; this.mix = 0;
  }

  setSteps(steps) {
    this.steps = steps;
    this.total = 0;
    for (const s of steps) this.total += Math.max(0, s.duration);
  }

  reset() {
    this.position = 0;
    this.currentStep = 0;
    this.direction = 1;
  }

  _locate() {
    let accum = 0;
    const n = this.steps.length;
    for (let i = 0; i < n; i++) {
      const dur = this.steps[i].duration;
      if (this.position < accum + dur || i === n - 1) return [i, this.position - accum];
      accum += dur;
    }
    return [0, 0];
  }

  // Sets waveA / waveB / mix — two wave indices and crossfade amount
  tick(sampleRate) {
    const n = this.steps.length;
    if (!this.active || n === 0 || !(this.total > 0)) {
      this.waveA = this.waveB = n ? this.steps[0].wave : 0; this.mix = 0;
      return;
    }

    this.position += (1000 / sampleRate) * this.speed * this.direction;
    const total = this.total;
    let atEnd = false;

    if (this.position >= total || this.position < 0) {
      if (this.loopMode === 1) { // forward loop
        this.position %= total;
        if (this.position < 0) this.position += total;
      } else if (this.loopMode === 2) { // pingpong
        this.direction *= -1;
        this.position = Math.max(0, Math.min(total - 1, this.position));
      } else {
        this.position = total;
        atEnd = true;
      }
    }

    let [step, posInStep] = this._locate();
    if (atEnd) { step = n - 1; posInStep = this.steps[step].duration; }
    this.currentStep = step;

    const cur = this.steps[step];
    const waveA = cur.wave;
    // Only a forward loop wraps from the last step to the first. A one-shot
    // sequence holds its last wave, and a ping-pong turns around on it —
    // neither may fade into step 1 (the one-shot used to end on step 1).
    const next = this.loopMode === 1 ? (step + 1) % n : Math.min(step + 1, n - 1);
    const xfade = cur.crossfade;
    if (next !== step && xfade > 0.001) {
      const xfadeDur = cur.duration * xfade;
      const xfadeStart = cur.duration - xfadeDur;
      if (posInStep >= xfadeStart) {
        this.waveA = waveA;
        this.waveB = this.steps[next].wave;
        this.mix = Math.min(1, (posInStep - xfadeStart) / xfadeDur);
        return;
      }
    }
    this.waveA = waveA; this.waveB = waveA; this.mix = 0;
  }
}

// ─── Voice ──────────────────────────────────────────────────────────────────

class Voice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.note = 60;
    this.velocity = 0;
    this.currentPitch = 60;
    this.targetNote = 60;

    this.phaseA = 0;
    this.phaseB = 0;

    this.ampEnv = new Envelope(sr);
    this.filterEnv = new Envelope(sr);
    this.waveEnv = new Envelope(sr);
    this.modEnv = new Envelope(sr);

    this.moogFilter = new MoogFilter();
    this.svFilter = new TptSVF();

    this.lfo1 = new LFO(sr);
    this.lfo2 = new LFO(sr);

    this.seqA = new WaveSequencer();
    this.seqB = new WaveSequencer();
    // Wave pair each oscillator is actually playing in sequence mode; a hard
    // cut to a new pair waits for the oscillator's cycle boundary.
    this.seqPlayA = { a: 0, b: 0, mix: 0, fresh: true, wrapped: false };
    this.seqPlayB = { a: 0, b: 0, mix: 0, fresh: true, wrapped: false };

    // Retrigger declicker: the jump between the old and the new sound is
    // bled off over DECLICK_TAU instead of being played as a step.
    this.lastOut = 0;
    this.prevOut = 0;
    this.declick = 0;
    this.declickPending = false;

    // No random per-voice detune: this models a PPG-style machine, whose
    // digital oscillators were dead in tune — the analog character lived in
    // the filters, not the pitch. (Was ±2 cents of unconditional random.)
    this.detuneOffset = 0;
  }

  noteOn(note, velocity, legato = false) {
    const wasActive = this.active;
    const sounding = this.ampEnv.isActive();
    this.active = true;
    this.note = note;
    this.targetNote = note;
    this.velocity = velocity / 127;

    if (legato && wasActive) return;

    if (!wasActive) this.currentPitch = note;
    this.ampEnv.gate(true);
    this.filterEnv.gate(true);
    this.waveEnv.gate(true);
    this.modEnv.gate(true);
    this.lfo1.reset();
    this.lfo2.reset();
    this.seqA.reset();
    this.seqB.reset();
    this.seqPlayA.wrapped = false;
    this.seqPlayB.wrapped = false;
    if (sounding) {
      // Stolen / retriggered while still audible: keep the filter state
      // (zeroing it mid-note was a click) and declick whatever else jumps.
      // The restarted wave sequence cuts over at the next cycle boundary.
      this.declickPending = true;
    } else {
      this.seqPlayA.fresh = true;
      this.seqPlayB.fresh = true;
      this.moogFilter.reset();
      this.svFilter.reset();
      this.declick = 0;
    }
  }

  noteOff() {
    this.ampEnv.gate(false);
    this.filterEnv.gate(false);
    this.waveEnv.gate(false);
    this.modEnv.gate(false);
  }

  isActive() { return this.ampEnv.isActive(); }
}

// ─── Master soft limiter ────────────────────────────────────────────────────
// Transparent below -1 dBFS, soft knee above. (Was fastTanh on the whole mix:
// -0.6 dB of compression and odd harmonics already at half scale.)

function softLimit(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.89) return x;
  const y = 0.89 + 0.11 * Math.tanh((a - 0.89) / 0.11);
  return x < 0 ? -y : y;
}

// ─── Main Processor ─────────────────────────────────────────────────────────

class WSSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.bank = generateWaveBank(this.sr);
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) this.voices.push(new Voice(this.sr));

    this.params = {
      oscA: { wave: 0, mode: 0, scanPos: 0, level: 1.0 },
      oscB: { wave: 2, mode: 0, scanPos: 0, level: 0.0 },
      oscBDetune: 0,
      oscBOctave: 0,
      abMix: 0,

      filterType: 0, filterMode: 0, filterCutoff: 8000, filterResonance: 0,
      filterEnvAmount: 0, filterKeyTrack: 0,

      ampA: 0.03045, ampD: 1.382, ampS: 0.7, ampR: 2.072,
      fltA: 0.03045, fltD: 2.072, fltS: 0.3, fltR: 2.072,
      waveA: 0.03045, waveD: 3.454, waveS: 0.0, waveR: 3.454,
      waveEnvAmt: 0,
      modA: 0.03045, modD: 2.072, modS: 0, modR: 0.6908,

      lfo1Rate: 2, lfo1Waveform: 0, lfo1Sync: true, lfo1Delay: 0, lfo1FadeIn: 0,
      lfo2Rate: 0.5, lfo2Waveform: 0, lfo2Sync: true, lfo2Delay: 0, lfo2FadeIn: 0,

      mod: [
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 }
      ],

      pitchBend: 0, pitchBendRange: 2,
      portamento: false, portamentoTime: 0.1,
      masterVolume: 0.7
    };

    // Wave sequence data (shared across voices)
    this.seqDataA = { steps: [], loopMode: 0, speed: 1.0 };
    this.seqDataB = { steps: [], loopMode: 0, speed: 1.0 };

    this.chorus = new Chorus(this.sr);
    this.delay = new StereoDelay(this.sr);
    this.reverb = new Freeverb(this.sr);

    // De-zippered copies of the continuous knobs (one-pole, per sample).
    this.smoothCoeff = 1 - Math.exp(-1 / (SMOOTH_TAU * this.sr));
    this.sm = null;
    this.smBuf = {
      logCut: new Float32Array(128), scanA: new Float32Array(128), scanB: new Float32Array(128),
      levA: new Float32Array(128), levB: new Float32Array(128), vol: new Float32Array(128),
    };

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        const v = this.voices[msg.voice];
        if (!v) break;
        if (!msg.legato) {
          v.lfo1.rate = this.params.lfo1Rate;
          v.lfo1.waveform = this.params.lfo1Waveform;
          v.lfo1.sync = this.params.lfo1Sync;
          v.lfo1.delay = this.params.lfo1Delay;
          v.lfo1.fadeIn = this.params.lfo1FadeIn;
          v.lfo2.rate = this.params.lfo2Rate;
          v.lfo2.waveform = this.params.lfo2Waveform;
          v.lfo2.sync = this.params.lfo2Sync;
          v.lfo2.delay = this.params.lfo2Delay;
          v.lfo2.fadeIn = this.params.lfo2FadeIn;
        }
        v.noteOn(msg.note, msg.velocity, !!msg.legato);
        if (!msg.legato) {
          this._applyEnvParams(v);
          // Apply sequence data to voice sequencers
          this._applySeqData(v.seqA, this.seqDataA);
          this._applySeqData(v.seqB, this.seqDataB);
        }
        break;
      }
      case 'noteOff': {
        const v = this.voices[msg.voice];
        if (v) v.noteOff();
        break;
      }
      case 'param': {
        const { param, value } = msg;
        if (param.startsWith('mod.')) {
          const parts = param.split('.');
          const idx = parseInt(parts[1]);
          const field = parts[2];
          if (this.params.mod[idx]) this.params.mod[idx][field] = value;
        } else if (param.startsWith('oscA.')) {
          this.params.oscA[param.split('.')[1]] = value;
        } else if (param.startsWith('oscB.')) {
          this.params.oscB[param.split('.')[1]] = value;
        } else if (param.startsWith('fx.')) {
          this._setFxParam(param.substring(3), value);
        } else {
          this.params[param] = value;
          // Envelope TIMES reach notes already sounding (they were only
          // latched at note-on, so e.g. a longer release did nothing to a
          // held chord). Sustain stays latched: dsp-lib's Envelope jumps
          // straight to a new sustain level, which would zipper.
          if (/^(amp|flt|wave|mod)[ADR]$/.test(param)) {
            for (const v of this.voices) this._applyEnvTimes(v);
          }
        }
        break;
      }
      case 'waveSeqA': {
        this.seqDataA.steps = msg.steps || [];
        this.seqDataA.loopMode = msg.loopMode || 0;
        this.seqDataA.speed = msg.speed || 1.0;
        break;
      }
      case 'waveSeqB': {
        this.seqDataB.steps = msg.steps || [];
        this.seqDataB.loopMode = msg.loopMode || 0;
        this.seqDataB.speed = msg.speed || 1.0;
        break;
      }
      case 'preset': {
        const prevA = this.params.oscA, prevB = this.params.oscB;
        if (msg.params) Object.assign(this.params, msg.params);
        // Merge, not replace: a preset that omits a field keeps the old value
        // (replacing left e.g. level undefined -> NaN).
        if (msg.params && msg.params.oscA) this.params.oscA = { ...prevA, ...msg.params.oscA };
        if (msg.params && msg.params.oscB) this.params.oscB = { ...prevB, ...msg.params.oscB };
        if (msg.fx) {
          if (msg.fx.chorus) Object.assign(this.chorus, msg.fx.chorus);
          if (msg.fx.delay) Object.assign(this.delay, msg.fx.delay);
          if (msg.fx.reverb) Object.assign(this.reverb, msg.fx.reverb);
        }
        if (msg.seqA) this.seqDataA = msg.seqA;
        if (msg.seqB) this.seqDataB = msg.seqB;
        break;
      }
    }
  }

  _applyEnvParams(v) {
    const p = this.params;
    v.ampEnv.setParams(p.ampA, p.ampD, p.ampS, p.ampR);
    v.filterEnv.setParams(p.fltA, p.fltD, p.fltS, p.fltR);
    v.waveEnv.setParams(p.waveA, p.waveD, p.waveS, p.waveR);
    v.modEnv.setParams(p.modA, p.modD, p.modS, p.modR);
  }

  _applyEnvTimes(v) {
    const p = this.params;
    const set = (env, a, d, r) => { env.attack = a; env.decay = d; env.release = r; env._recalc(); };
    set(v.ampEnv, p.ampA, p.ampD, p.ampR);
    set(v.filterEnv, p.fltA, p.fltD, p.fltR);
    set(v.waveEnv, p.waveA, p.waveD, p.waveR);
    set(v.modEnv, p.modA, p.modD, p.modR);
  }

  _applySeqData(sequencer, data) {
    const steps = (data && data.steps) || [];
    sequencer.setSteps(steps.map(s => ({...s})));
    sequencer.loopMode = data ? data.loopMode || 0 : 0;
    sequencer.speed = data ? data.speed || 1.0 : 1.0;
    sequencer.active = steps.length > 0;
  }

  _setFxParam(key, value) {
    const [fx, param] = key.split('.');
    switch (fx) {
      case 'chorus': this.chorus[param] = value; break;
      case 'delay': this.delay[param] = value; break;
      case 'reverb': this.reverb[param] = value; break;
    }
  }

  _getModValue(src, voice) {
    switch (src) {
      case 'lfo1': return voice.lfo1.value;
      case 'lfo2': return voice.lfo2.value;
      case 'modEnv': return voice.modEnv.level;
      case 'waveEnv': return voice.waveEnv.level;
      case 'velocity': return voice.velocity;
      case 'keyFollow': return (voice.note - 60) / 60;
      default: return 0;
    }
  }

  _getOscSample(voice, osc, oscParams, seq, play, phase, oct, scanBase) {
    const mode = oscParams.mode;

    if (mode === 0) {
      // Single wave
      return readWave(this.bank[oscParams.wave | 0] || this.bank[0], phase, oct);
    } else if (mode === 1) {
      // Scan mode — wave position from scanPos + waveEnv + mods
      let pos = scanBase;
      pos += this.params.waveEnvAmt * voice.waveEnv.level;
      const dstKey = osc === 'A' ? 'wavePosA' : 'wavePosB';
      for (let m = 0; m < 4; m++) {
        const slot = this.params.mod[m];
        if (slot.src === 'off' || slot.amount === 0) continue;
        if (slot.dst === dstKey) {
          pos += this._getModValue(slot.src, voice) * slot.amount;
        }
      }
      pos = Math.max(0, Math.min(1, pos));
      return readWaveScan(this.bank, pos, phase, oct);
    } else {
      // Sequence mode. With no sequence loaded (the Studio sends presets
      // without their seqA/seqB) play the oscillator's own wave rather
      // than falling back to wave 0, a sine.
      if (!seq.active) return readWave(this.bank[oscParams.wave | 0] || this.bank[0], phase, oct);
      seq.tick(this.sr);
      const a = seq.waveA % NUM_WAVES, b = seq.waveB % NUM_WAVES, mix = seq.mix;
      if (play.fresh) {
        play.a = a; play.b = b; play.mix = mix; play.fresh = false;
      } else if (a !== play.a || b !== play.b) {
        // A new wave pair. If it continues the old sound (a crossfade just
        // completed: old B at full = new A at zero) take it now; otherwise it
        // is a hard cut, which waits for the cycle boundary — PPG-style —
        // instead of cutting the waveform mid-cycle (a click every step).
        const seamless = play.wrapped ||
          (play.b === a && play.mix > 0.98 && mix < 0.02) ||   // forward
          (play.a === b && play.mix < 0.02 && mix > 0.98);     // ping-pong, backward
        if (seamless) { play.a = a; play.b = b; play.mix = mix; }
      } else {
        play.mix = mix;
      }
      play.wrapped = false;
      const sA = readWave(this.bank[play.a], phase, oct);
      if (play.mix < 0.001) return sA;
      const sB = readWave(this.bank[play.b], phase, oct);
      return sA + (sB - sA) * play.mix;
    }
  }

  // Per-sample de-zippered knob values for this block (shared by all voices).
  _smoothBlock(n) {
    const p = this.params;
    const tgt = {
      logCut: Math.log2(Math.max(1, p.filterCutoff)),
      scanA: p.oscA.scanPos, scanB: p.oscB.scanPos,
      levA: p.oscA.level * (1 - p.abMix), levB: p.oscB.level * p.abMix,
      vol: p.masterVolume,
    };
    if (!this.sm) this.sm = { ...tgt };
    const c = this.smoothCoeff, sm = this.sm, buf = this.smBuf;
    for (const key in tgt) {
      const out = buf[key], t = tgt[key];
      let y = sm[key];
      if (Math.abs(t - y) < 1e-6) {
        y = t;
        for (let s = 0; s < n; s++) out[s] = y;
      } else {
        for (let s = 0; s < n; s++) { y += (t - y) * c; out[s] = y; }
      }
      sm[key] = y;
    }
  }

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.isActive()) return;

    const p = this.params;
    const bendSemi = p.pitchBend * p.pitchBendRange;
    const oscBSemi = p.oscBOctave + p.oscBDetune / 100;
    const portaCoeff = p.portamento && p.portamentoTime > 0.001
      ? (1 - Math.exp(-1 / (p.portamentoTime * this.sr))) : 1;
    const sm = this.smBuf;
    const declickCoeff = Math.exp(-1 / (DECLICK_TAU * this.sr));

    for (let s = 0; s < blockSize; s++) {
      // Portamento
      if (voice.currentPitch !== voice.targetNote) {
        if (portaCoeff >= 1) voice.currentPitch = voice.targetNote;
        else {
          voice.currentPitch += (voice.targetNote - voice.currentPitch) * portaCoeff;
          if (Math.abs(voice.currentPitch - voice.targetNote) < 0.001)
            voice.currentPitch = voice.targetNote;
        }
      }

      // LFOs
      voice.lfo1.process();
      voice.lfo2.process();

      // Envelopes
      const ampLevel = voice.ampEnv.process();
      const filterLevel = voice.filterEnv.process();
      voice.waveEnv.process();
      voice.modEnv.process();

      // Mod matrix accumulation
      let pitchMod = 0, cutoffMod = 0, ampMod = 0, panMod = 0;
      let lfo1RateMod = 0, lfo2RateMod = 0;

      for (let m = 0; m < 4; m++) {
        const slot = p.mod[m];
        if (slot.src === 'off' || slot.dst === 'off' || slot.amount === 0) continue;
        const val = this._getModValue(slot.src, voice) * slot.amount;
        switch (slot.dst) {
          case 'pitch': pitchMod += val * 2; break;
          case 'cutoff': cutoffMod += val; break;
          case 'amp': ampMod += val; break;
          case 'pan': panMod += val; break;
          case 'lfo1Rate': lfo1RateMod += val; break;
          case 'lfo2Rate': lfo2RateMod += val; break;
          // wavePosA/wavePosB handled in _getOscSample
        }
      }
      // Rate follows the knob live, and drops back when a slot is cleared.
      voice.lfo1.rate = lfo1RateMod ? p.lfo1Rate * Math.pow(2, lfo1RateMod * 2) : p.lfo1Rate;
      voice.lfo2.rate = lfo2RateMod ? p.lfo2Rate * Math.pow(2, lfo2RateMod * 2) : p.lfo2Rate;

      // Pitch, in semitones from A4, then octaves above C0 for table choice.
      const semiA = voice.currentPitch - 69 + voice.detuneOffset / 100 + bendSemi + pitchMod;
      const semiB = semiA + oscBSemi;
      const fA = 440 * Math.pow(2, semiA / 12);
      const fB = 440 * Math.pow(2, semiB / 12);
      const octA = semiA / 12 + LOG2_440_OVER_BASE;
      const octB = semiB / 12 + LOG2_440_OVER_BASE;

      // Oscillator A
      const oscA = (p.oscA.mode === 2 || _levNZ(sm.levA[s])) ? this._getOscSample(voice, 'A', p.oscA, voice.seqA, voice.seqPlayA, voice.phaseA, octA, sm.scanA[s]) : 0;
      voice.phaseA += fA / this.sr;
      if (voice.phaseA >= 1) { voice.phaseA -= Math.floor(voice.phaseA); voice.seqPlayA.wrapped = true; }

      // Oscillator B
      const oscB = (p.oscB.mode === 2 || _levNZ(sm.levB[s])) ? this._getOscSample(voice, 'B', p.oscB, voice.seqB, voice.seqPlayB, voice.phaseB, octB, sm.scanB[s]) : 0;
      voice.phaseB += fB / this.sr;
      if (voice.phaseB >= 1) { voice.phaseB -= Math.floor(voice.phaseB); voice.seqPlayB.wrapped = true; }

      // Mix A/B
      let sample = oscA * sm.levA[s] + oscB * sm.levB[s];

      // Filter
      const keyTrackMod = p.filterKeyTrack * (voice.currentPitch - 60) / 12;
      const envMod = p.filterEnvAmount * filterLevel;
      let effCutoff = Math.pow(2, sm.logCut[s] + keyTrackMod + envMod * 4 + cutoffMod * 4);
      effCutoff = Math.max(20, Math.min(this.sr * 0.45, effCutoff));

      if (p.filterType === 0) {
        voice.moogFilter.setParams(effCutoff, p.filterResonance, this.sr);
        sample = voice.moogFilter.process(sample);
      } else {
        voice.svFilter.mode = p.filterMode;
        voice.svFilter.setParams(effCutoff, p.filterResonance, this.sr);
        sample = voice.svFilter.process(sample);
      }

      // Amplitude
      const amp = ampLevel * voice.velocity * (1 + ampMod);
      let out = sample * amp;
      if (voice.declickPending) {
        // Jump = where the old sound was heading (linear extrapolation of
        // its last two samples) minus where the new one starts.
        voice.declick += (2 * voice.lastOut - voice.prevOut) - out;
        voice.declickPending = false;
      }
      if (voice.declick !== 0) {
        out += voice.declick;
        voice.declick *= declickCoeff;
        if (Math.abs(voice.declick) < 1e-7) voice.declick = 0;
      }
      voice.prevOut = voice.lastOut;
      voice.lastOut = out;

      const pan = Math.max(-1, Math.min(1, panMod));
      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);

      outL[s] += out * panL;
      outR[s] += out * panR;
    }
    if (!voice.isActive()) { voice.lastOut = voice.prevOut = 0; voice.declick = 0; }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;
    outL.fill(0); outR.fill(0);

    this._smoothBlock(blockSize);
    for (let i = 0; i < NUM_VOICES; i++) {
      this._processVoice(this.voices[i], outL, outR, blockSize);
    }

    const vol = this.smBuf.vol;
    for (let s = 0; s < blockSize; s++) {
      let L = outL[s] * vol[s], R = outR[s] * vol[s];
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);
      outL[s] = softLimit(L);
      outR[s] = softLimit(R);
    }

    return true;
  }
}

// An oscillator whose level is (smoothed to) zero is not computed at all —
// unless it is sequencing, whose clock must keep running.
function _levNZ(x) { return x > 1e-6 || x < -1e-6; }

registerProcessor('ws-synth-processor', WSSynthProcessor);
