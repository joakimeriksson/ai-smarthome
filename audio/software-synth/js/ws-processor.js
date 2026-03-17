// WaveSynth AudioWorklet Processor — Wavestation-inspired wavetable/wave sequence synth
// All DSP runs in the audio thread

const NUM_VOICES = 8;
const WAVE_SIZE = 2048;
const NUM_WAVES = 20;
const NUM_OCTAVES = 11;
const MAX_SEQ_STEPS = 16;
const MAX_HARMONICS = 256;
const TWO_PI = 2 * Math.PI;

// ─── Fast Math ──────────────────────────────────────────────────────────────

function fastTanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

// ─── Wave Bank Generation (band-limited per octave) ─────────────────────────
// Each wave is stored as bank[waveIdx][octaveIdx] = Float32Array(WAVE_SIZE)
// Higher octaves have fewer harmonics to prevent aliasing.

function generateWaveBank(sr) {
  const ANALYSIS_SIZE = 4096;
  const bank = new Array(NUM_WAVES);

  // Generate a single cycle from a formula at high resolution
  function makeWave(fn) {
    const w = new Float64Array(ANALYSIS_SIZE);
    for (let i = 0; i < ANALYSIS_SIZE; i++) w[i] = fn(i / ANALYSIS_SIZE);
    return w;
  }

  // DFT: extract amplitude + phase for harmonics 1..maxH
  function analyze(wave) {
    const N = wave.length;
    const result = [];
    for (let h = 1; h <= MAX_HARMONICS; h++) {
      let s = 0, c = 0;
      for (let i = 0; i < N; i++) {
        const a = TWO_PI * h * i / N;
        s += wave[i] * Math.sin(a);
        c += wave[i] * Math.cos(a);
      }
      s *= 2 / N; c *= 2 / N;
      result.push({ amp: Math.sqrt(s * s + c * c), phase: Math.atan2(c, s) });
    }
    return result;
  }

  // Synthesize a band-limited wavetable from harmonics
  function synthesize(harmonics, maxHarmonic) {
    const wave = new Float32Array(WAVE_SIZE);
    const limit = Math.min(harmonics.length, maxHarmonic);
    for (let h = 0; h < limit; h++) {
      if (harmonics[h].amp < 0.0001) continue;
      const amp = harmonics[h].amp, ph = harmonics[h].phase;
      for (let i = 0; i < WAVE_SIZE; i++) {
        wave[i] += amp * Math.sin(TWO_PI * (h + 1) * i / WAVE_SIZE + ph);
      }
    }
    let max = 0;
    for (let i = 0; i < WAVE_SIZE; i++) max = Math.max(max, Math.abs(wave[i]));
    if (max > 0.001) for (let i = 0; i < WAVE_SIZE; i++) wave[i] /= max;
    return wave;
  }

  // Helper for additive-synthesis formulas
  function additiveWave(harmonicAmps) {
    return makeWave(t => {
      let s = 0;
      for (let i = 0; i < harmonicAmps.length; i++) {
        if (harmonicAmps[i] !== 0) s += harmonicAmps[i] * Math.sin(TWO_PI * (i + 1) * t);
      }
      return s;
    });
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
    // 19: Noise (frozen random, smoothed)
    (() => {
      const w = new Float64Array(ANALYSIS_SIZE);
      let seed = 0xDEAD;
      for (let i = 0; i < ANALYSIS_SIZE; i++) {
        seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
        w[i] = (seed & 0xFFFF) / 32768 - 1;
      }
      for (let p = 0; p < 4; p++) {
        for (let i = 1; i < ANALYSIS_SIZE - 1; i++) {
          w[i] = w[i] * 0.5 + (w[i - 1] + w[i + 1]) * 0.25;
        }
      }
      return w;
    })()
  ];

  // Analyze each base waveform into harmonics, then build per-octave tables
  const allHarmonics = baseWaves.map(w => analyze(w));

  for (let w = 0; w < NUM_WAVES; w++) {
    bank[w] = new Array(NUM_OCTAVES);
    for (let oct = 0; oct < NUM_OCTAVES; oct++) {
      const octFreq = 16.3516 * Math.pow(2, oct);
      const maxH = Math.max(1, Math.floor(sr / 2 / octFreq));
      bank[w][oct] = synthesize(allHarmonics[w], maxH);
    }
  }

  return bank;
}

// ─── Read from wavetable with linear interpolation ──────────────────────────
// bankWave = bank[waveIdx] = array of per-octave Float32Arrays

function readWave(bankWave, phase, freq) {
  const octIdx = Math.max(0, Math.min(NUM_OCTAVES - 1,
    Math.floor(Math.log2(Math.max(16, freq) / 16.3516))
  ));
  const wave = bankWave[octIdx];
  const pos = phase * WAVE_SIZE;
  const idx = Math.floor(pos);
  const frac = pos - idx;
  const i0 = idx & (WAVE_SIZE - 1);
  const i1 = (idx + 1) & (WAVE_SIZE - 1);
  return wave[i0] + frac * (wave[i1] - wave[i0]);
}

// Crossfade between two waves based on fractional position
function readWaveScan(bank, position, phase, freq) {
  const maxIdx = NUM_WAVES - 1;
  const pos = Math.max(0, Math.min(1, position)) * maxIdx;
  const idxA = Math.floor(pos);
  const idxB = Math.min(idxA + 1, maxIdx);
  const mix = pos - idxA;
  const a = readWave(bank[idxA], phase, freq);
  const b = readWave(bank[idxB], phase, freq);
  return a + (b - a) * mix;
}

// ─── ADSR Envelope ──────────────────────────────────────────────────────────

const ENV_OFF = 0, ENV_ATTACK = 1, ENV_DECAY = 2, ENV_SUSTAIN = 3, ENV_RELEASE = 4;

class Envelope {
  constructor(sr) {
    this.sr = sr;
    this.stage = ENV_OFF;
    this.level = 0;
    this.attack = 0.01; this.decay = 0.2; this.sustain = 0.7; this.release = 0.3;
    this.attackCoeff = 0; this.decayCoeff = 0; this.releaseCoeff = 0;
    this._recalc();
  }

  _recalc() {
    this.attackCoeff = this.attack < 0.001 ? 1 : 1 - Math.exp(-1 / (this.attack * this.sr));
    this.decayCoeff = this.decay < 0.001 ? 1 : 1 - Math.exp(-1 / (this.decay * this.sr));
    this.releaseCoeff = this.release < 0.001 ? 1 : 1 - Math.exp(-1 / (this.release * this.sr));
  }

  setParams(a, d, s, r) {
    this.attack = a; this.decay = d; this.sustain = s; this.release = r;
    this._recalc();
  }

  gate(on) {
    if (on) this.stage = ENV_ATTACK;
    else if (this.stage !== ENV_OFF) this.stage = ENV_RELEASE;
  }

  process() {
    switch (this.stage) {
      case ENV_ATTACK:
        this.level += (1.05 - this.level) * this.attackCoeff;
        if (this.level >= 1.0) { this.level = 1.0; this.stage = ENV_DECAY; }
        break;
      case ENV_DECAY:
        this.level += (this.sustain - this.level) * this.decayCoeff;
        if (Math.abs(this.level - this.sustain) < 0.0001) { this.level = this.sustain; this.stage = ENV_SUSTAIN; }
        break;
      case ENV_SUSTAIN:
        this.level = this.sustain;
        break;
      case ENV_RELEASE:
        this.level += -this.level * this.releaseCoeff;
        if (this.level < 0.0001) { this.level = 0; this.stage = ENV_OFF; }
        break;
    }
    return this.level;
  }

  isActive() { return this.stage !== ENV_OFF; }
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
      case 5: // Smooth random
        if (this.phase < this._prevPhase) this._shTarget = Math.random() * 2 - 1;
        this._shValue += (this._shTarget - this._shValue) * 0.01;
        this.value = this._shValue;
        break;
    }
    this.value *= this._fadeLevel;
    return this.value;
  }
}

// ─── Moog Ladder Filter (24dB) ─────────────────────────────────────────────

class MoogFilter {
  constructor() {
    this.s = new Float64Array(4);
    this._g = 0; this._k = 0;
  }
  reset() { this.s.fill(0); }
  setParams(cutoff, resonance, sr) {
    const fc = Math.min(cutoff, sr * 0.45);
    this._g = 1 - Math.exp(-TWO_PI * fc / (sr * 2));
    this._k = resonance * 4.0;
  }
  process(input) {
    for (let os = 0; os < 2; os++) {
      const fb = fastTanh(this.s[3] * this._k);
      const x = input - fb;
      this.s[0] += this._g * (fastTanh(x) - fastTanh(this.s[0]));
      this.s[1] += this._g * (fastTanh(this.s[0]) - fastTanh(this.s[1]));
      this.s[2] += this._g * (fastTanh(this.s[1]) - fastTanh(this.s[2]));
      this.s[3] += this._g * (fastTanh(this.s[2]) - fastTanh(this.s[3]));
    }
    return this.s[3];
  }
}

// ─── SVF Filter (12dB) ─────────────────────────────────────────────────────

class SVFilter {
  constructor() {
    this.low = 0; this.band = 0; this.high = 0; this.notch = 0;
    this.mode = 0; this._f = 0; this._q = 0;
  }
  reset() { this.low = 0; this.band = 0; this.high = 0; this.notch = 0; }
  setParams(cutoff, resonance, sr) {
    const fc = Math.min(cutoff, sr * 0.45);
    this._f = 2 * Math.sin(Math.PI * fc / (sr * 2));
    this._q = 1 - resonance * 0.95;
  }
  process(input) {
    for (let os = 0; os < 2; os++) {
      this.low += this._f * this.band;
      this.high = input - this.low - this._q * this.band;
      this.band += this._f * this.high;
      this.notch = this.high + this.low;
    }
    return [this.low, this.high, this.band, this.notch][this.mode] || this.low;
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
  }

  reset() {
    this.position = 0;
    this.currentStep = 0;
    this.direction = 1;
  }

  // Returns {waveA, waveB, mix} — two wave indices and crossfade amount
  tick(sampleRate) {
    if (!this.active || this.steps.length === 0) {
      return { waveA: 0, waveB: 0, mix: 0 };
    }

    // Advance position
    const msPerSample = 1000 / sampleRate;
    this.position += msPerSample * this.speed * this.direction;

    // Find current step and position within it
    let accum = 0;
    let step = -1;
    let posInStep = 0;

    for (let i = 0; i < this.steps.length; i++) {
      const dur = this.steps[i].duration;
      if (this.position < accum + dur || i === this.steps.length - 1) {
        step = i;
        posInStep = this.position - accum;
        break;
      }
      accum += dur;
    }

    const totalDuration = this.steps.reduce((s, st) => s + st.duration, 0);

    // Handle end of sequence
    if (this.position >= totalDuration || this.position < 0) {
      if (this.loopMode === 1) { // forward loop
        this.position = this.position % totalDuration;
        if (this.position < 0) this.position += totalDuration;
        // Recalculate step
        accum = 0;
        for (let i = 0; i < this.steps.length; i++) {
          if (this.position < accum + this.steps[i].duration || i === this.steps.length - 1) {
            step = i;
            posInStep = this.position - accum;
            break;
          }
          accum += this.steps[i].duration;
        }
      } else if (this.loopMode === 2) { // pingpong
        this.direction *= -1;
        this.position = Math.max(0, Math.min(totalDuration - 1, this.position));
        accum = 0;
        for (let i = 0; i < this.steps.length; i++) {
          if (this.position < accum + this.steps[i].duration || i === this.steps.length - 1) {
            step = i;
            posInStep = this.position - accum;
            break;
          }
          accum += this.steps[i].duration;
        }
      } else {
        // No loop — stay on last step
        step = this.steps.length - 1;
        posInStep = this.steps[step].duration;
      }
    }

    if (step < 0) step = 0;
    this.currentStep = step;

    const currentDur = this.steps[step].duration;
    const xfade = this.steps[step].crossfade;
    const xfadeStart = currentDur * (1 - xfade);
    const waveA = this.steps[step].wave;

    if (posInStep >= xfadeStart && xfade > 0.001) {
      // In crossfade zone
      const nextStep = (step + 1) % this.steps.length;
      const waveB = this.steps[nextStep].wave;
      const xfadeDur = currentDur * xfade;
      const mix = Math.min(1, (posInStep - xfadeStart) / xfadeDur);
      return { waveA, waveB, mix };
    }

    return { waveA, waveB: waveA, mix: 0 };
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
    this.svFilter = new SVFilter();

    this.lfo1 = new LFO(sr);
    this.lfo2 = new LFO(sr);

    this.seqA = new WaveSequencer();
    this.seqB = new WaveSequencer();

    this.detuneOffset = (Math.random() - 0.5) * 4;
  }

  noteOn(note, velocity, legato = false) {
    const wasActive = this.active;
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
    this.moogFilter.reset();
    this.svFilter.reset();
  }

  noteOff() {
    this.ampEnv.gate(false);
    this.filterEnv.gate(false);
    this.waveEnv.gate(false);
    this.modEnv.gate(false);
  }

  isActive() { return this.ampEnv.isActive(); }
}

// ─── Effects ────────────────────────────────────────────────────────────────

class Chorus {
  constructor(sr) {
    this.sr = sr; this.mix = 0.3; this.rate = 0.5; this.depth = 0.005; this.enabled = false;
    const maxDelay = Math.ceil(sr * 0.03);
    this.bufL = new Float32Array(maxDelay); this.bufR = new Float32Array(maxDelay);
    this.bufSize = maxDelay; this.writeIdx = 0; this.phase = 0;
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    this.bufL[this.writeIdx] = inL; this.bufR[this.writeIdx] = inR;
    this.phase += this.rate / this.sr;
    if (this.phase >= 1) this.phase -= 1;
    const mod1 = Math.sin(TWO_PI * this.phase) * this.depth * this.sr;
    const mod2 = Math.sin(TWO_PI * this.phase + Math.PI) * this.depth * this.sr;
    const d1 = 0.007 * this.sr + mod1, d2 = 0.007 * this.sr + mod2;
    const outL = inL + this.mix * this._read(this.bufL, d1);
    const outR = inR + this.mix * this._read(this.bufR, d2);
    this.writeIdx = (this.writeIdx + 1) % this.bufSize;
    return [outL, outR];
  }
  _read(buf, delay) {
    const pos = this.writeIdx - delay;
    const idx = Math.floor(pos), frac = pos - idx;
    const i0 = ((idx % this.bufSize) + this.bufSize) % this.bufSize;
    const i1 = ((idx + 1) % this.bufSize + this.bufSize) % this.bufSize;
    return buf[i0] + frac * (buf[i1] - buf[i0]);
  }
}

class StereoDelay {
  constructor(sr) {
    this.sr = sr; this.mix = 0.3; this.feedback = 0.4;
    this.timeL = 0.375; this.timeR = 0.5; this.damping = 0.3; this.enabled = false;
    const max = Math.ceil(sr * 2);
    this.bufL = new Float32Array(max); this.bufR = new Float32Array(max);
    this.bufSize = max; this.writeIdx = 0; this.lpL = 0; this.lpR = 0;
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    const dL = Math.floor(this.timeL * this.sr), dR = Math.floor(this.timeR * this.sr);
    const idxL = ((this.writeIdx - dL) % this.bufSize + this.bufSize) % this.bufSize;
    const idxR = ((this.writeIdx - dR) % this.bufSize + this.bufSize) % this.bufSize;
    let tapL = this.bufL[idxL], tapR = this.bufR[idxR];
    this.lpL += this.damping * (tapL - this.lpL); this.lpR += this.damping * (tapR - this.lpR);
    tapL = this.lpL; tapR = this.lpR;
    this.bufL[this.writeIdx] = inL + tapR * this.feedback;
    this.bufR[this.writeIdx] = inR + tapL * this.feedback;
    this.writeIdx = (this.writeIdx + 1) % this.bufSize;
    return [inL + tapL * this.mix, inR + tapR * this.mix];
  }
}

class Freeverb {
  constructor(sr) {
    this.sr = sr; this.mix = 0.2; this.roomSize = 0.8; this.damping = 0.5; this.enabled = false;
    const scale = sr / 44100;
    const cL = [1116,1188,1277,1356,1422,1491,1557,1617].map(n => Math.round(n * scale));
    const aL = [556,441,341,225].map(n => Math.round(n * scale));
    this.combsL = cL.map(n => ({ buf: new Float32Array(n), idx: 0, len: n, filt: 0 }));
    this.combsR = cL.map(n => { const len = n + Math.round(23*scale); return { buf: new Float32Array(len), idx:0, len, filt:0 }; });
    this.apsL = aL.map(n => ({ buf: new Float32Array(n), idx: 0, len: n }));
    this.apsR = aL.map(n => { const len = n + Math.round(23*scale); return { buf: new Float32Array(len), idx:0, len }; });
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    const input = (inL + inR) * 0.5;
    const fb = this.roomSize * 0.28 + 0.7;
    const d1 = this.damping * 0.4, d2 = 1 - d1;
    let oL = 0, oR = 0;
    for (let i = 0; i < 8; i++) {
      const cL = this.combsL[i]; const sL = cL.buf[cL.idx];
      cL.filt = sL * d2 + cL.filt * d1; cL.buf[cL.idx] = input + cL.filt * fb;
      cL.idx = (cL.idx + 1) % cL.len; oL += sL;
      const cR = this.combsR[i]; const sR = cR.buf[cR.idx];
      cR.filt = sR * d2 + cR.filt * d1; cR.buf[cR.idx] = input + cR.filt * fb;
      cR.idx = (cR.idx + 1) % cR.len; oR += sR;
    }
    for (let i = 0; i < 4; i++) {
      const aL = this.apsL[i]; const bL = aL.buf[aL.idx];
      aL.buf[aL.idx] = oL + bL * 0.5; oL = bL - oL; aL.idx = (aL.idx + 1) % aL.len;
      const aR = this.apsR[i]; const bR = aR.buf[aR.idx];
      aR.buf[aR.idx] = oR + bR * 0.5; oR = bR - oR; aR.idx = (aR.idx + 1) % aR.len;
    }
    const wet = this.mix, dry = 1 - wet;
    return [inL * dry + oL * wet, inR * dry + oR * wet];
  }
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

      ampA: 0.01, ampD: 0.2, ampS: 0.7, ampR: 0.3,
      fltA: 0.01, fltD: 0.3, fltS: 0.3, fltR: 0.3,
      waveA: 0.01, waveD: 0.5, waveS: 0.0, waveR: 0.5,
      waveEnvAmt: 0,
      modA: 0.01, modD: 0.3, modS: 0, modR: 0.1,

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
          v.ampEnv.setParams(this.params.ampA, this.params.ampD, this.params.ampS, this.params.ampR);
          v.filterEnv.setParams(this.params.fltA, this.params.fltD, this.params.fltS, this.params.fltR);
          v.waveEnv.setParams(this.params.waveA, this.params.waveD, this.params.waveS, this.params.waveR);
          v.modEnv.setParams(this.params.modA, this.params.modD, this.params.modS, this.params.modR);
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
        if (msg.params) Object.assign(this.params, msg.params);
        if (msg.params && msg.params.oscA) Object.assign(this.params.oscA, msg.params.oscA);
        if (msg.params && msg.params.oscB) Object.assign(this.params.oscB, msg.params.oscB);
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

  _applySeqData(sequencer, data) {
    sequencer.steps = data.steps.map(s => ({...s}));
    sequencer.loopMode = data.loopMode;
    sequencer.speed = data.speed;
    sequencer.active = data.steps.length > 0;
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

  _getOscSample(voice, osc, oscParams, seq, phase, freq) {
    const mode = oscParams.mode;

    if (mode === 0) {
      // Single wave
      return readWave(this.bank[oscParams.wave], phase, freq);
    } else if (mode === 1) {
      // Scan mode — wave position from scanPos + waveEnv + mods
      let pos = oscParams.scanPos;
      pos += this.params.waveEnvAmt * voice.waveEnv.level;
      for (let m = 0; m < 4; m++) {
        const slot = this.params.mod[m];
        if (slot.src === 'off' || slot.amount === 0) continue;
        const dstKey = osc === 'A' ? 'wavePosA' : 'wavePosB';
        if (slot.dst === dstKey) {
          pos += this._getModValue(slot.src, voice) * slot.amount;
        }
      }
      pos = Math.max(0, Math.min(1, pos));
      return readWaveScan(this.bank, pos, phase, freq);
    } else {
      // Sequence mode
      const { waveA, waveB, mix } = seq.tick(this.sr);
      const sA = readWave(this.bank[waveA % NUM_WAVES], phase, freq);
      if (mix < 0.001) return sA;
      const sB = readWave(this.bank[waveB % NUM_WAVES], phase, freq);
      return sA + (sB - sA) * mix;
    }
  }

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.isActive()) return;

    const p = this.params;
    const bendMult = p.pitchBend !== 0 ? Math.pow(2, p.pitchBend * p.pitchBendRange / 12) : 1;
    const portaCoeff = p.portamento && p.portamentoTime > 0.001
      ? (1 - Math.exp(-1 / (p.portamentoTime * this.sr))) : 1;

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

      const note = voice.currentPitch;
      const freqA = 440 * Math.pow(2, (note - 69 + voice.detuneOffset / 100) / 12) * bendMult;
      const osc2Semi = p.oscBOctave + p.oscBDetune / 100;
      const freqB = 440 * Math.pow(2, (note - 69 + osc2Semi + voice.detuneOffset / 100) / 12) * bendMult;

      // LFOs
      const lfo1Val = voice.lfo1.process();
      const lfo2Val = voice.lfo2.process();

      // Envelopes
      const ampLevel = voice.ampEnv.process();
      const filterLevel = voice.filterEnv.process();
      const waveLevel = voice.waveEnv.process();
      const modLevel = voice.modEnv.process();

      // Mod matrix accumulation
      let pitchMod = 0, cutoffMod = 0, ampMod = 0, panMod = 0;

      for (let m = 0; m < 4; m++) {
        const slot = p.mod[m];
        if (slot.src === 'off' || slot.dst === 'off' || slot.amount === 0) continue;
        const val = this._getModValue(slot.src, voice) * slot.amount;
        switch (slot.dst) {
          case 'pitch': pitchMod += val * 2; break;
          case 'cutoff': cutoffMod += val; break;
          case 'amp': ampMod += val; break;
          case 'pan': panMod += val; break;
          case 'lfo1Rate': voice.lfo1.rate = p.lfo1Rate * Math.pow(2, val * 2); break;
          case 'lfo2Rate': voice.lfo2.rate = p.lfo2Rate * Math.pow(2, val * 2); break;
          // wavePosA/wavePosB handled in _getOscSample
        }
      }

      const pitchMult = pitchMod !== 0 ? Math.pow(2, pitchMod / 12) : 1;
      const fA = freqA * pitchMult;
      const fB = freqB * pitchMult;
      const dtA = fA / this.sr;
      const dtB = fB / this.sr;

      // Oscillator A
      const oscA = this._getOscSample(voice, 'A', p.oscA, voice.seqA, voice.phaseA, fA);
      voice.phaseA += dtA;
      if (voice.phaseA >= 1) voice.phaseA -= 1;

      // Oscillator B
      const oscB = this._getOscSample(voice, 'B', p.oscB, voice.seqB, voice.phaseB, fB);
      voice.phaseB += dtB;
      if (voice.phaseB >= 1) voice.phaseB -= 1;

      // Mix A/B
      const mix = p.abMix;
      let sample = oscA * p.oscA.level * (1 - mix) + oscB * p.oscB.level * mix;

      // Filter
      const baseCutoff = p.filterCutoff;
      const keyTrackMod = p.filterKeyTrack * (voice.note - 60) / 12;
      const envMod = p.filterEnvAmount * filterLevel;
      let effCutoff = baseCutoff * Math.pow(2, keyTrackMod + envMod * 4 + cutoffMod * 4);
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
      const pan = Math.max(-1, Math.min(1, panMod));
      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);

      outL[s] += sample * amp * panL;
      outR[s] += sample * amp * panR;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;
    outL.fill(0); outR.fill(0);

    for (let i = 0; i < NUM_VOICES; i++) {
      this._processVoice(this.voices[i], outL, outR, blockSize);
    }

    const vol = this.params.masterVolume;
    for (let s = 0; s < blockSize; s++) {
      let L = outL[s] * vol, R = outR[s] * vol;
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);
      outL[s] = fastTanh(L);
      outR[s] = fastTanh(R);
    }

    return true;
  }
}

registerProcessor('ws-synth-processor', WSSynthProcessor);
