// VA Synthesizer AudioWorklet Processor
// All DSP runs in the audio thread — single monolithic file (AudioWorklet can't use ES imports)

const NUM_VOICES = 8;
const WAVETABLE_SIZE = 2048;
const NUM_OCTAVES = 11;
const TWO_PI = 2 * Math.PI;

// ─── Fast Math Approximations ───────────────────────────────────────────────

function fastTanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

function sinc(x) {
  if (Math.abs(x) < 1e-6) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

// ─── PolyBLEP ───────────────────────────────────────────────────────────────

function polyBLEP(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1.0 - dt) {
    t = (t - 1.0) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

// ─── Wavetable Generation ───────────────────────────────────────────────────

function generateWavetables(sampleRate) {
  const tables = {
    saw: new Array(NUM_OCTAVES),
    square: new Array(NUM_OCTAVES),
    triangle: new Array(NUM_OCTAVES),
    sine: null
  };

  // Sine — single table, no aliasing concerns
  tables.sine = new Float32Array(WAVETABLE_SIZE);
  for (let i = 0; i < WAVETABLE_SIZE; i++) {
    tables.sine[i] = Math.sin(TWO_PI * i / WAVETABLE_SIZE);
  }

  for (let oct = 0; oct < NUM_OCTAVES; oct++) {
    const baseFreq = 440 * Math.pow(2, (oct * 12 - 69) / 12); // A0=oct0
    // Actually use C for each octave: C0=16.35Hz, C1=32.7, ..., C10=16744
    const octFreq = 16.3516 * Math.pow(2, oct);
    const maxHarmonic = Math.max(1, Math.floor(sampleRate / 2 / octFreq));

    // Saw
    tables.saw[oct] = new Float32Array(WAVETABLE_SIZE);
    for (let h = 1; h <= maxHarmonic; h++) {
      const sigma = sinc(h / maxHarmonic); // Lanczos sigma
      const amp = sigma * 2 / (Math.PI * h) * (h % 2 === 0 ? -1 : 1);
      for (let i = 0; i < WAVETABLE_SIZE; i++) {
        tables.saw[oct][i] += amp * Math.sin(TWO_PI * h * i / WAVETABLE_SIZE);
      }
    }

    // Square (50% duty)
    tables.square[oct] = new Float32Array(WAVETABLE_SIZE);
    for (let h = 1; h <= maxHarmonic; h += 2) {
      const sigma = sinc(h / maxHarmonic);
      const amp = sigma * 4 / (Math.PI * h);
      for (let i = 0; i < WAVETABLE_SIZE; i++) {
        tables.square[oct][i] += amp * Math.sin(TWO_PI * h * i / WAVETABLE_SIZE);
      }
    }

    // Triangle
    tables.triangle[oct] = new Float32Array(WAVETABLE_SIZE);
    for (let h = 1; h <= maxHarmonic; h += 2) {
      const sigma = sinc(h / maxHarmonic);
      const amp = sigma * 8 / (Math.PI * Math.PI * h * h) * ((h - 1) / 2 % 2 === 0 ? 1 : -1);
      for (let i = 0; i < WAVETABLE_SIZE; i++) {
        tables.triangle[oct][i] += amp * Math.sin(TWO_PI * h * i / WAVETABLE_SIZE);
      }
    }
  }

  return tables;
}

// ─── ADSR Envelope ──────────────────────────────────────────────────────────

const ENV_OFF = 0, ENV_ATTACK = 1, ENV_DECAY = 2, ENV_SUSTAIN = 3, ENV_RELEASE = 4;

class Envelope {
  constructor(sr) {
    this.sr = sr;
    this.stage = ENV_OFF;
    this.level = 0;
    this.attack = 0.01;
    this.decay = 0.2;
    this.sustain = 0.7;
    this.release = 0.3;
    this.attackCoeff = 0;
    this.decayCoeff = 0;
    this.releaseCoeff = 0;
    this._recalc();
  }

  _recalc() {
    this.attackCoeff = this.attack < 0.001 ? 1 : 1 - Math.exp(-1 / (this.attack * this.sr));
    this.decayCoeff = this.decay < 0.001 ? 1 : 1 - Math.exp(-1 / (this.decay * this.sr));
    this.releaseCoeff = this.release < 0.001 ? 1 : 1 - Math.exp(-1 / (this.release * this.sr));
  }

  setParams(a, d, s, r) {
    this.attack = a;
    this.decay = d;
    this.sustain = s;
    this.release = r;
    this._recalc();
  }

  gate(on) {
    if (on) {
      this.stage = ENV_ATTACK;
    } else {
      if (this.stage !== ENV_OFF) this.stage = ENV_RELEASE;
    }
  }

  process() {
    switch (this.stage) {
      case ENV_ATTACK:
        this.level += (1.05 - this.level) * this.attackCoeff;
        if (this.level >= 1.0) { this.level = 1.0; this.stage = ENV_DECAY; }
        break;
      case ENV_DECAY:
        this.level += (this.sustain - this.level) * this.decayCoeff;
        if (Math.abs(this.level - this.sustain) < 0.0001) {
          this.level = this.sustain;
          this.stage = ENV_SUSTAIN;
        }
        break;
      case ENV_SUSTAIN:
        this.level = this.sustain;
        break;
      case ENV_RELEASE:
        this.level += (0 - this.level) * this.releaseCoeff;
        if (this.level < 0.0001) { this.level = 0; this.stage = ENV_OFF; }
        break;
    }
    return this.level;
  }

  isActive() { return this.stage !== ENV_OFF; }
}

// ─── Moog Ladder Filter (4-pole, 24dB/oct) ─────────────────────────────────

class MoogFilter {
  constructor() {
    this.s = new Float64Array(4); // stages
    this.cutoff = 8000;
    this.resonance = 0;
    this._g = 0;
    this._k = 0;
  }

  reset() { this.s.fill(0); }

  setParams(cutoff, resonance, sr) {
    // Frequency warping for stability
    const fc = Math.min(cutoff, sr * 0.45);
    this._g = 1 - Math.exp(-TWO_PI * fc / (sr * 2)); // 2x oversampled
    this._k = resonance * 4.0;
  }

  process(input) {
    // 2× oversampling
    for (let os = 0; os < 2; os++) {
      const inp = os === 0 ? input : input; // same input for both passes
      const fb = fastTanh(this.s[3] * this._k);
      const x = inp - fb;
      this.s[0] += this._g * (fastTanh(x) - fastTanh(this.s[0]));
      this.s[1] += this._g * (fastTanh(this.s[0]) - fastTanh(this.s[1]));
      this.s[2] += this._g * (fastTanh(this.s[1]) - fastTanh(this.s[2]));
      this.s[3] += this._g * (fastTanh(this.s[2]) - fastTanh(this.s[3]));
    }
    return this.s[3];
  }
}

// ─── State Variable Filter (2-pole, 12dB/oct) ──────────────────────────────

class SVFilter {
  constructor() {
    this.low = 0;
    this.band = 0;
    this.high = 0;
    this.notch = 0;
    this.cutoff = 8000;
    this.resonance = 0;
    this.mode = 0; // 0=LP, 1=HP, 2=BP, 3=Notch
    this._f = 0;
    this._q = 0;
  }

  reset() { this.low = 0; this.band = 0; this.high = 0; this.notch = 0; }

  setParams(cutoff, resonance, sr) {
    const fc = Math.min(cutoff, sr * 0.45);
    this._f = 2 * Math.sin(Math.PI * fc / (sr * 2)); // 2x oversampled
    this._q = 1 - resonance * 0.95; // Q damping
  }

  process(input) {
    for (let os = 0; os < 2; os++) {
      this.low += this._f * this.band;
      this.high = input - this.low - this._q * this.band;
      this.band += this._f * this.high;
      this.notch = this.high + this.low;
    }
    switch (this.mode) {
      case 0: return this.low;
      case 1: return this.high;
      case 2: return this.band;
      case 3: return this.notch;
    }
    return this.low;
  }
}

// ─── LFO ────────────────────────────────────────────────────────────────────

class LFO {
  constructor(sr) {
    this.sr = sr;
    this.phase = 0;
    this.rate = 2; // Hz
    this.waveform = 0; // 0=sine, 1=tri, 2=saw, 3=square, 4=S&H, 5=random smooth
    this.sync = true; // reset phase on noteOn
    this.value = 0;
    this._shValue = 0;
    this._shTarget = 0;
    this._prevPhase = 0;
    // LFO delay/fade-in
    this.delay = 0;      // seconds before LFO starts
    this.fadeIn = 0;      // seconds to fade from 0→1
    this._elapsed = 0;    // time since noteOn
    this._fadeLevel = 1;  // current fade multiplier
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

    // Delay / fade-in
    this._elapsed += 1 / this.sr;
    if (this._elapsed < this.delay) {
      this._fadeLevel = 0;
    } else if (this.fadeIn > 0.001) {
      const fadeElapsed = this._elapsed - this.delay;
      this._fadeLevel = Math.min(1, fadeElapsed / this.fadeIn);
    } else {
      this._fadeLevel = 1;
    }

    switch (this.waveform) {
      case 0: // Sine
        this.value = Math.sin(TWO_PI * this.phase);
        break;
      case 1: // Triangle
        this.value = this.phase < 0.5 ? 4 * this.phase - 1 : 3 - 4 * this.phase;
        break;
      case 2: // Saw
        this.value = 2 * this.phase - 1;
        break;
      case 3: // Square
        this.value = this.phase < 0.5 ? 1 : -1;
        break;
      case 4: // Sample & Hold
        if (this.phase < this._prevPhase) { // wrapped
          this._shValue = Math.random() * 2 - 1;
        }
        this.value = this._shValue;
        break;
      case 5: // Random smooth
        if (this.phase < this._prevPhase) {
          this._shTarget = Math.random() * 2 - 1;
        }
        this._shValue += (this._shTarget - this._shValue) * 0.01;
        this.value = this._shValue;
        break;
    }
    this.value *= this._fadeLevel;
    return this.value;
  }
}

// ─── Voice ──────────────────────────────────────────────────────────────────

class Voice {
  constructor(sr, tables) {
    this.sr = sr;
    this.tables = tables;
    this.active = false;
    this.note = 0;
    this.velocity = 0;
    this.noteOnTime = 0;

    // Portamento state
    this.targetNote = 0;
    this.currentPitch = 0; // float MIDI note for smooth glide

    // Oscillator state
    this.phase1 = 0;
    this.phase2 = 0;
    this.subPhase = 0;
    this.noiseState = 0xACE1; // LFSR seed

    // Analog imperfections (set once)
    this.detuneOffset = (Math.random() - 0.5) * 6; // ±3 cents
    this.dcBias = (Math.random() - 0.5) * 0.01;
    this.filterCutoffVariation = 0.97 + Math.random() * 0.06;

    // Drift state
    this.driftCurrent = 0;
    this.driftTarget = 0;
    this.driftTimer = 0;
    this.driftSmoothing = 0.00005;

    // Envelopes
    this.ampEnv = new Envelope(sr);
    this.filterEnv = new Envelope(sr);
    this.modEnv = new Envelope(sr);

    // Filters
    this.moogFilter = new MoogFilter();
    this.svFilter = new SVFilter();
    this.hpfState = 0; // 1-pole HPF state

    // LFOs
    this.lfo1 = new LFO(sr);
    this.lfo2 = new LFO(sr);

    // Unison
    this.unisonPhases = new Float32Array(8);
    this.unisonDetunes = new Float32Array(8);
  }

  noteOn(note, velocity, time, legato = false) {
    const wasActive = this.active;
    this.active = true;
    this.note = note;
    this.targetNote = note;
    this.velocity = velocity / 127;
    this.noteOnTime = time;

    if (legato && wasActive) {
      // Legato: don't retrigger envelopes, just change note target
      // currentPitch keeps gliding from wherever it is
    } else {
      // Normal noteOn or first note in legato chain
      if (!wasActive) {
        this.currentPitch = note; // snap pitch on fresh voice
      }
      // else: portamento — keep currentPitch, glide to targetNote

      this.ampEnv.gate(true);
      this.filterEnv.gate(true);
      this.modEnv.gate(true);
      this.lfo1.reset();
      this.lfo2.reset();

      // Analog drift reset
      this.driftCurrent = 0;
      this.driftTarget = (Math.random() - 0.5) * 10;
      this.driftTimer = Math.random() * this.sr * 3;

      // Random DC bias on each note
      this.dcBias = (Math.random() - 0.5) * 0.01;
    }
  }

  noteOff() {
    this.ampEnv.gate(false);
    this.filterEnv.gate(false);
    this.modEnv.gate(false);
  }

  isActive() {
    return this.ampEnv.isActive();
  }
}

// ─── Effects ────────────────────────────────────────────────────────────────

class Chorus {
  constructor(sr) {
    this.sr = sr;
    this.mix = 0.3;
    this.rate = 0.5;
    this.depth = 0.005; // 5ms
    this.enabled = false;
    const maxDelay = Math.ceil(sr * 0.03); // 30ms max
    this.bufL = new Float32Array(maxDelay);
    this.bufR = new Float32Array(maxDelay);
    this.bufSize = maxDelay;
    this.writeIdx = 0;
    this.phase = 0;
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];

    this.bufL[this.writeIdx] = inL;
    this.bufR[this.writeIdx] = inR;

    const dt = this.rate / this.sr;
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;

    // Two voices, 180° apart
    const mod1 = Math.sin(TWO_PI * this.phase) * this.depth * this.sr;
    const mod2 = Math.sin(TWO_PI * this.phase + Math.PI) * this.depth * this.sr;

    const delay1 = 0.007 * this.sr + mod1; // ~7ms center
    const delay2 = 0.007 * this.sr + mod2;

    const outL = inL + this.mix * this._readInterp(this.bufL, delay1);
    const outR = inR + this.mix * this._readInterp(this.bufR, delay2);

    this.writeIdx = (this.writeIdx + 1) % this.bufSize;
    return [outL, outR];
  }

  _readInterp(buf, delay) {
    const pos = this.writeIdx - delay;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const i0 = ((idx % this.bufSize) + this.bufSize) % this.bufSize;
    const i1 = ((idx + 1) % this.bufSize + this.bufSize) % this.bufSize;
    return buf[i0] + frac * (buf[i1] - buf[i0]);
  }
}

class StereoDelay {
  constructor(sr) {
    this.sr = sr;
    this.mix = 0.3;
    this.feedback = 0.4;
    this.timeL = 0.375; // seconds
    this.timeR = 0.5;
    this.damping = 0.3;
    this.enabled = false;
    const maxSamples = Math.ceil(sr * 2); // 2s max
    this.bufL = new Float32Array(maxSamples);
    this.bufR = new Float32Array(maxSamples);
    this.bufSize = maxSamples;
    this.writeIdx = 0;
    this.lpL = 0;
    this.lpR = 0;
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];

    const dL = Math.floor(this.timeL * this.sr);
    const dR = Math.floor(this.timeR * this.sr);
    const idxL = ((this.writeIdx - dL) % this.bufSize + this.bufSize) % this.bufSize;
    const idxR = ((this.writeIdx - dR) % this.bufSize + this.bufSize) % this.bufSize;

    let tapL = this.bufL[idxL];
    let tapR = this.bufR[idxR];

    // LP in feedback path (darkening)
    this.lpL += this.damping * (tapL - this.lpL);
    this.lpR += this.damping * (tapR - this.lpR);
    tapL = this.lpL;
    tapR = this.lpR;

    // Ping-pong: L feeds R, R feeds L
    this.bufL[this.writeIdx] = inL + tapR * this.feedback;
    this.bufR[this.writeIdx] = inR + tapL * this.feedback;

    this.writeIdx = (this.writeIdx + 1) % this.bufSize;

    return [inL + tapL * this.mix, inR + tapR * this.mix];
  }
}

class Freeverb {
  constructor(sr) {
    this.sr = sr;
    this.mix = 0.2;
    this.roomSize = 0.8;
    this.damping = 0.5;
    this.enabled = false;

    // Comb filter delay lengths (from original Freeverb, scaled to sample rate)
    const scale = sr / 44100;
    const combLengths = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(
      n => Math.round(n * scale)
    );
    const apLengths = [556, 441, 341, 225].map(n => Math.round(n * scale));

    // Stereo: offset right channel
    this.combsL = combLengths.map(n => ({ buf: new Float32Array(n), idx: 0, len: n, filt: 0 }));
    this.combsR = combLengths.map(n => {
      const len = n + Math.round(23 * scale);
      return { buf: new Float32Array(len), idx: 0, len, filt: 0 };
    });
    this.apsL = apLengths.map(n => ({ buf: new Float32Array(n), idx: 0, len: n }));
    this.apsR = apLengths.map(n => {
      const len = n + Math.round(23 * scale);
      return { buf: new Float32Array(len), idx: 0, len };
    });
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];

    const input = (inL + inR) * 0.5;
    const feedback = this.roomSize * 0.28 + 0.7;
    const damp1 = this.damping * 0.4;
    const damp2 = 1 - damp1;

    let outL = 0, outR = 0;

    // Parallel comb filters
    for (let i = 0; i < 8; i++) {
      const cL = this.combsL[i];
      const sL = cL.buf[cL.idx];
      cL.filt = sL * damp2 + cL.filt * damp1;
      cL.buf[cL.idx] = input + cL.filt * feedback;
      cL.idx = (cL.idx + 1) % cL.len;
      outL += sL;

      const cR = this.combsR[i];
      const sR = cR.buf[cR.idx];
      cR.filt = sR * damp2 + cR.filt * damp1;
      cR.buf[cR.idx] = input + cR.filt * feedback;
      cR.idx = (cR.idx + 1) % cR.len;
      outR += sR;
    }

    // Series allpass filters
    for (let i = 0; i < 4; i++) {
      const aL = this.apsL[i];
      const bL = aL.buf[aL.idx];
      aL.buf[aL.idx] = outL + bL * 0.5;
      outL = bL - outL;
      aL.idx = (aL.idx + 1) % aL.len;

      const aR = this.apsR[i];
      const bR = aR.buf[aR.idx];
      aR.buf[aR.idx] = outR + bR * 0.5;
      outR = bR - outR;
      aR.idx = (aR.idx + 1) % aR.len;
    }

    const wet = this.mix;
    const dry = 1 - wet;
    return [inL * dry + outL * wet, inR * dry + outR * wet];
  }
}

class Distortion {
  constructor() {
    this.drive = 1.0;
    this.postGain = 1.0;
    this.type = 0; // 0=tanh, 1=atan
    this.enabled = false;
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    const d = this.drive;
    const pg = this.postGain;
    let outL, outR;
    if (this.type === 0) {
      outL = fastTanh(inL * d) * pg;
      outR = fastTanh(inR * d) * pg;
    } else {
      outL = (2 / Math.PI) * Math.atan(inL * d) * pg;
      outR = (2 / Math.PI) * Math.atan(inR * d) * pg;
    }
    return [outL, outR];
  }
}

class BiquadEQ {
  constructor(sr) {
    this.sr = sr;
    this.enabled = false;
    // 3 bands: low shelf 200Hz, mid peak 1kHz, high shelf 5kHz
    this.bands = [
      { freq: 200, gain: 0, type: 'lowshelf' },
      { freq: 1000, gain: 0, type: 'peaking', q: 1.0 },
      { freq: 5000, gain: 0, type: 'highshelf' }
    ];
    this.coeffs = [{}, {}, {}];
    this.stateL = [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }];
    this.stateR = [{ x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }, { x1: 0, x2: 0, y1: 0, y2: 0 }];
    this._recalcAll();
  }

  _recalcAll() {
    for (let i = 0; i < 3; i++) this._calcCoeffs(i);
  }

  _calcCoeffs(idx) {
    const b = this.bands[idx];
    const A = Math.pow(10, b.gain / 40);
    const w0 = TWO_PI * b.freq / this.sr;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);

    let a0, a1, a2, b0, b1, b2;

    if (b.type === 'lowshelf') {
      const alpha = sinw / 2 * Math.sqrt(2);
      const sqA = Math.sqrt(A);
      b0 = A * ((A + 1) - (A - 1) * cosw + 2 * sqA * alpha);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - 2 * sqA * alpha);
      a0 = (A + 1) + (A - 1) * cosw + 2 * sqA * alpha;
      a1 = -2 * ((A - 1) + (A + 1) * cosw);
      a2 = (A + 1) + (A - 1) * cosw - 2 * sqA * alpha;
    } else if (b.type === 'highshelf') {
      const alpha = sinw / 2 * Math.sqrt(2);
      const sqA = Math.sqrt(A);
      b0 = A * ((A + 1) + (A - 1) * cosw + 2 * sqA * alpha);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
      b2 = A * ((A + 1) + (A - 1) * cosw - 2 * sqA * alpha);
      a0 = (A + 1) - (A - 1) * cosw + 2 * sqA * alpha;
      a1 = 2 * ((A - 1) - (A + 1) * cosw);
      a2 = (A + 1) - (A - 1) * cosw - 2 * sqA * alpha;
    } else { // peaking
      const alpha = sinw / (2 * (b.q || 1));
      b0 = 1 + alpha * A;
      b1 = -2 * cosw;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosw;
      a2 = 1 - alpha / A;
    }

    this.coeffs[idx] = {
      b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
      a1: a1 / a0, a2: a2 / a0
    };
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    let outL = inL, outR = inR;
    for (let i = 0; i < 3; i++) {
      const c = this.coeffs[i];
      const sL = this.stateL[i];
      const yL = c.b0 * outL + c.b1 * sL.x1 + c.b2 * sL.x2 - c.a1 * sL.y1 - c.a2 * sL.y2;
      sL.x2 = sL.x1; sL.x1 = outL; sL.y2 = sL.y1; sL.y1 = yL;
      outL = yL;

      const sR = this.stateR[i];
      const yR = c.b0 * outR + c.b1 * sR.x1 + c.b2 * sR.x2 - c.a1 * sR.y1 - c.a2 * sR.y2;
      sR.x2 = sR.x1; sR.x1 = outR; sR.y2 = sR.y1; sR.y1 = yR;
      outR = yR;
    }
    return [outL, outR];
  }
}

// ─── Main Processor ─────────────────────────────────────────────────────────

class VASynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.tables = generateWavetables(this.sr);
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) {
      this.voices.push(new Voice(this.sr, this.tables));
    }

    // Global params
    this.params = {
      // Oscillator
      osc1Waveform: 0,   // 0=saw, 1=square, 2=tri, 3=sine, 4=noise
      osc2Waveform: 0,
      osc1Level: 1.0,
      osc2Level: 0.0,
      osc2Detune: 0,     // cents
      osc2Octave: 0,     // semitones (0, -12, +12, etc.)
      pulseWidth: 0.5,
      subLevel: 0,
      oscSync: false,
      ringMod: false,

      // Filter
      filterType: 0,     // 0=Moog, 1=SVF
      filterMode: 0,     // SVF mode: 0=LP, 1=HP, 2=BP, 3=Notch
      filterCutoff: 8000,
      filterResonance: 0,
      filterEnvAmount: 0,
      filterKeyTrack: 0,

      // Amp Envelope
      ampAttack: 0.01,
      ampDecay: 0.2,
      ampSustain: 0.7,
      ampRelease: 0.3,

      // Filter Envelope
      filterAttack: 0.01,
      filterDecay: 0.3,
      filterSustain: 0.3,
      filterRelease: 0.3,

      // Mod Envelope
      modAttack: 0.01,
      modDecay: 0.3,
      modSustain: 0,
      modRelease: 0.1,

      // LFO 1
      lfo1Rate: 2,
      lfo1Waveform: 0,
      lfo1Sync: true,

      // LFO 2
      lfo2Rate: 0.5,
      lfo2Waveform: 0,
      lfo2Sync: true,

      // Mod Matrix (4 slots)
      mod: [
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 },
        { src: 'off', dst: 'off', amount: 0 }
      ],

      // Analog warmth
      driftAmount: 0.3,
      saturationDrive: 1.0,

      // Unison
      unisonCount: 1,
      unisonDetune: 10,  // cents spread
      unisonSpread: 0.5, // stereo

      // Pitch Bend
      pitchBend: 0,        // -1 to +1
      pitchBendRange: 2,   // semitones

      // Portamento
      portamento: false,
      portamentoTime: 0.1, // seconds

      // Cross-modulation (osc2 → osc1 FM)
      crossModAmount: 0,

      // High-pass filter (pre-VCF)
      hpfCutoff: 20,       // Hz (20-2000)

      // Noise mixer (independent of osc waveform)
      noiseLevel: 0,

      // LFO delay/fade-in
      lfo1Delay: 0,
      lfo1FadeIn: 0,
      lfo2Delay: 0,
      lfo2FadeIn: 0,

      // Master
      masterVolume: 0.7,
      masterPan: 0
    };

    // Effects chain
    this.distortion = new Distortion();
    this.eq = new BiquadEQ(this.sr);
    this.chorus = new Chorus(this.sr);
    this.delay = new StereoDelay(this.sr);
    this.reverb = new Freeverb(this.sr);

    // Message handling
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        const v = this.voices[msg.voice];
        if (v) {
          if (!msg.legato) {
            // Set LFO params BEFORE noteOn so reset() sees correct delay/fadeIn
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
          v.noteOn(msg.note, msg.velocity, currentTime, !!msg.legato);
          if (!msg.legato) {
            // Apply current envelope params with analog jitter
            const jitter = () => 0.95 + Math.random() * 0.1;
            v.ampEnv.setParams(
              this.params.ampAttack * jitter(),
              this.params.ampDecay * jitter(),
              this.params.ampSustain,
              this.params.ampRelease * jitter()
            );
            v.filterEnv.setParams(
              this.params.filterAttack * jitter(),
              this.params.filterDecay * jitter(),
              this.params.filterSustain,
              this.params.filterRelease * jitter()
            );
            v.modEnv.setParams(
              this.params.modAttack, this.params.modDecay,
              this.params.modSustain, this.params.modRelease
            );
            // Randomize unison phases
            for (let u = 0; u < 8; u++) {
              v.unisonPhases[u] = Math.random();
              const spread = this.params.unisonDetune;
              v.unisonDetunes[u] = (u / (Math.max(1, this.params.unisonCount - 1)) - 0.5) * spread;
            }
            v.moogFilter.reset();
            v.svFilter.reset();
          }
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
          // e.g. mod.0.src, mod.1.dst, mod.2.amount
          const parts = param.split('.');
          const idx = parseInt(parts[1]);
          const field = parts[2];
          if (this.params.mod[idx]) {
            this.params.mod[idx][field] = value;
          }
        } else if (param.startsWith('eq.')) {
          const parts = param.split('.');
          const band = parseInt(parts[1]);
          this.eq.bands[band].gain = value;
          this.eq._calcCoeffs(band);
        } else if (param.startsWith('fx.')) {
          this._setFxParam(param.substring(3), value);
        } else {
          this.params[param] = value;
        }
        break;
      }
      case 'preset': {
        Object.assign(this.params, msg.params);
        if (msg.fx) {
          if (msg.fx.distortion) Object.assign(this.distortion, msg.fx.distortion);
          if (msg.fx.chorus) Object.assign(this.chorus, msg.fx.chorus);
          if (msg.fx.delay) Object.assign(this.delay, msg.fx.delay);
          if (msg.fx.reverb) Object.assign(this.reverb, msg.fx.reverb);
          if (msg.fx.eq) {
            this.eq.enabled = msg.fx.eq.enabled;
            if (msg.fx.eq.bands) {
              msg.fx.eq.bands.forEach((b, i) => Object.assign(this.eq.bands[i], b));
              this.eq._recalcAll();
            }
          }
        }
        break;
      }
    }
  }

  _setFxParam(key, value) {
    const parts = key.split('.');
    const fx = parts[0];
    const param = parts[1];
    switch (fx) {
      case 'dist': this.distortion[param] = value; break;
      case 'chorus': this.chorus[param] = value; break;
      case 'delay': this.delay[param] = value; break;
      case 'reverb': this.reverb[param] = value; break;
      case 'eq': this.eq[param] = value; break;
    }
  }

  _getModValue(src, voice) {
    switch (src) {
      case 'lfo1': return voice.lfo1.value;
      case 'lfo2': return voice.lfo2.value;
      case 'modEnv': return voice.modEnv.level;
      case 'velocity': return voice.velocity;
      case 'keyFollow': return (voice.note - 60) / 60; // normalized around C4
      default: return 0;
    }
  }

  _readWavetable(tables, phase, freq) {
    // Select octave table based on frequency
    const octIdx = Math.max(0, Math.min(NUM_OCTAVES - 1,
      Math.floor(Math.log2(Math.max(1, freq) / 16.3516))
    ));
    const table = tables[octIdx];
    const pos = phase * WAVETABLE_SIZE;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const i0 = idx % WAVETABLE_SIZE;
    const i1 = (idx + 1) % WAVETABLE_SIZE;
    return table[i0] + frac * (table[i1] - table[i0]);
  }

  _oscillator(voice, freq, phase, waveform, pw) {
    const dt = freq / this.sr;

    switch (waveform) {
      case 0: { // Saw — wavetable + polyBLEP residual
        let out = this._readWavetable(this.tables.saw, phase, freq);
        // Minor polyBLEP correction on top of wavetable
        out -= polyBLEP(phase, dt) * 0.05;
        return out;
      }
      case 1: { // Square/Pulse — wavetable + polyBLEP for PWM
        if (Math.abs(pw - 0.5) < 0.01) {
          return this._readWavetable(this.tables.square, phase, freq);
        }
        // PWM: two offset saws
        let out = (phase < pw) ? 1 : -1;
        out += polyBLEP(phase, dt);
        out -= polyBLEP((phase + 1 - pw) % 1, dt);
        return out;
      }
      case 2: // Triangle
        return this._readWavetable(this.tables.triangle, phase, freq);
      case 3: // Sine
        return this.tables.sine[Math.floor(phase * WAVETABLE_SIZE) % WAVETABLE_SIZE];
      case 4: { // White noise (LFSR)
        voice.noiseState ^= voice.noiseState << 13;
        voice.noiseState ^= voice.noiseState >> 17;
        voice.noiseState ^= voice.noiseState << 5;
        return (voice.noiseState & 0xFFFF) / 32768 - 1;
      }
      default: return 0;
    }
  }

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.isActive()) return;

    const p = this.params;

    // Pitch bend multiplier (applied to all frequencies)
    const bendMult = p.pitchBend !== 0 ? Math.pow(2, p.pitchBend * p.pitchBendRange / 12) : 1;

    // Portamento rate coefficient (per-sample)
    const portaCoeff = p.portamento && p.portamentoTime > 0.001
      ? (1 - Math.exp(-1 / (p.portamentoTime * this.sr))) : 1;

    const uniCount = Math.max(1, Math.min(8, p.unisonCount));

    for (let s = 0; s < blockSize; s++) {
      // Portamento: glide currentPitch toward targetNote
      if (voice.currentPitch !== voice.targetNote) {
        if (portaCoeff >= 1) {
          voice.currentPitch = voice.targetNote;
        } else {
          voice.currentPitch += (voice.targetNote - voice.currentPitch) * portaCoeff;
          if (Math.abs(voice.currentPitch - voice.targetNote) < 0.001) {
            voice.currentPitch = voice.targetNote;
          }
        }
      }

      const effNote = voice.currentPitch;
      const baseFreq1 = 440 * Math.pow(2, (effNote - 69 + voice.detuneOffset / 100) / 12) * bendMult;
      const osc2Semi = p.osc2Octave + p.osc2Detune / 100;
      const baseFreq2 = 440 * Math.pow(2, (effNote - 69 + osc2Semi + voice.detuneOffset / 100) / 12) * bendMult;

      // Drift
      voice.driftTimer--;
      if (voice.driftTimer <= 0) {
        voice.driftTarget = (Math.random() - 0.5) * 10 * p.driftAmount;
        voice.driftTimer = Math.floor(this.sr * (1 + Math.random() * 4));
      }
      voice.driftCurrent += (voice.driftTarget - voice.driftCurrent) * voice.driftSmoothing;

      // LFOs
      const lfo1Val = voice.lfo1.process();
      const lfo2Val = voice.lfo2.process();

      // Envelopes
      const ampLevel = voice.ampEnv.process();
      const filterLevel = voice.filterEnv.process();
      const modLevel = voice.modEnv.process();

      // Mod matrix accumulation
      let pitchMod = 0, osc2PitchMod = 0, cutoffMod = 0, pwMod = 0, ampMod = 0, panMod = 0;

      for (let m = 0; m < 4; m++) {
        const slot = p.mod[m];
        if (slot.src === 'off' || slot.dst === 'off' || slot.amount === 0) continue;
        const val = this._getModValue(slot.src, voice) * slot.amount;
        switch (slot.dst) {
          case 'pitch': pitchMod += val * 2; break; // ±2 semitones
          case 'osc2Pitch': osc2PitchMod += val * 24; break; // ±24 semitones
          case 'cutoff': cutoffMod += val; break;
          case 'pwm': pwMod += val * 0.4; break;
          case 'amp': ampMod += val; break;
          case 'pan': panMod += val; break;
          case 'lfo1Rate': voice.lfo1.rate = p.lfo1Rate * Math.pow(2, val * 2); break;
          case 'lfo2Rate': voice.lfo2.rate = p.lfo2Rate * Math.pow(2, val * 2); break;
          case 'resonance': break; // applied below
        }
      }

      // Apply drift to frequency
      const driftMult = Math.pow(2, voice.driftCurrent / 1200);
      const pitchMultMod = Math.pow(2, pitchMod / 12);
      const osc2PitchMult = osc2PitchMod !== 0 ? Math.pow(2, osc2PitchMod / 12) : 1;
      const freq1 = baseFreq1 * driftMult * pitchMultMod;
      const freq2 = baseFreq2 * driftMult * pitchMultMod * osc2PitchMult;
      const pw = Math.max(0.05, Math.min(0.95, p.pulseWidth + pwMod));

      let sample = 0;

      if (uniCount <= 1) {
        // Standard dual-oscillator with cross-mod support
        // Compute osc2 first so it can modulate osc1 (cross-mod / FM)
        let osc2 = 0;
        if (p.osc2Level > 0.001 || p.crossModAmount > 0.001) {
          const dt2 = freq2 / this.sr;
          if (p.oscSync && voice.phase1 < (freq1 / this.sr)) {
            voice.phase2 = voice.phase1 * (freq2 / freq1); // hard sync
          }
          osc2 = this._oscillator(voice, freq2, voice.phase2, p.osc2Waveform, pw);
          voice.phase2 += dt2;
          if (voice.phase2 >= 1) voice.phase2 -= 1;
        }

        // Oscillator 1 with optional cross-mod from osc2
        let osc1Freq = freq1;
        if (p.crossModAmount > 0.001 && osc2 !== 0) {
          osc1Freq = freq1 * (1 + osc2 * p.crossModAmount * 4);
        }
        const dt1 = osc1Freq / this.sr;
        let osc1 = this._oscillator(voice, osc1Freq, voice.phase1, p.osc1Waveform, pw);
        voice.phase1 += dt1;
        if (voice.phase1 >= 1) voice.phase1 -= 1;

        // Ring mod
        if (p.ringMod && p.osc2Level > 0.001) {
          sample = osc1 * osc2;
        } else {
          sample = osc1 * p.osc1Level + osc2 * p.osc2Level;
        }

        // Sub oscillator
        if (p.subLevel > 0.001) {
          const subFreq = freq1 * 0.5;
          let sub = (voice.subPhase < 0.5) ? 1 : -1; // square sub
          voice.subPhase += subFreq / this.sr;
          if (voice.subPhase >= 1) voice.subPhase -= 1;
          sample += sub * p.subLevel;
        }

        // Noise mixer (independent of osc waveform selection)
        if (p.noiseLevel > 0.001) {
          voice.noiseState ^= voice.noiseState << 13;
          voice.noiseState ^= voice.noiseState >> 17;
          voice.noiseState ^= voice.noiseState << 5;
          const noise = (voice.noiseState & 0xFFFF) / 32768 - 1;
          sample += noise * p.noiseLevel;
        }
      } else {
        // Unison mode
        let sumL = 0, sumR = 0;
        for (let u = 0; u < uniCount; u++) {
          const detuneCents = voice.unisonDetunes[u];
          const uFreq = freq1 * Math.pow(2, detuneCents / 1200);
          const dt = uFreq / this.sr;
          const osc = this._oscillator(voice, uFreq, voice.unisonPhases[u], p.osc1Waveform, pw);
          voice.unisonPhases[u] += dt;
          if (voice.unisonPhases[u] >= 1) voice.unisonPhases[u] -= 1;

          const pan = (u / (uniCount - 1) - 0.5) * p.unisonSpread;
          sumL += osc * (0.5 - pan);
          sumR += osc * (0.5 + pan);
        }
        const norm = 1 / Math.sqrt(uniCount);
        // Write directly to stereo later (handled below via panMod)
        sample = (sumL + sumR) * 0.5 * norm;
      }

      // DC bias
      sample += voice.dcBias;

      // Pre-filter saturation
      if (p.saturationDrive > 1.001) {
        sample = fastTanh(sample * p.saturationDrive);
      }

      // High-pass filter (pre-VCF, like Jupiter-8's HPF)
      if (p.hpfCutoff > 25) {
        const hpfCoeff = Math.exp(-TWO_PI * p.hpfCutoff / this.sr);
        const hpfIn = sample;
        sample = sample - voice.hpfState;
        voice.hpfState = hpfIn * (1 - hpfCoeff) + voice.hpfState * hpfCoeff;
      }

      // Filter
      const baseCutoff = p.filterCutoff * voice.filterCutoffVariation;
      const keyTrackMod = p.filterKeyTrack * (voice.note - 60) / 12;
      const envMod = p.filterEnvAmount * filterLevel;
      let effCutoff = baseCutoff * Math.pow(2, keyTrackMod + envMod * 4 + cutoffMod * 4);
      effCutoff = Math.max(20, Math.min(this.sr * 0.45, effCutoff));

      const resMod = p.mod.reduce((acc, slot) => {
        if (slot.dst === 'resonance' && slot.src !== 'off') {
          return acc + this._getModValue(slot.src, voice) * slot.amount * 0.3;
        }
        return acc;
      }, 0);
      const effRes = Math.max(0, Math.min(1, p.filterResonance + resMod));

      if (p.filterType === 0) {
        voice.moogFilter.setParams(effCutoff, effRes, this.sr);
        sample = voice.moogFilter.process(sample);
      } else {
        voice.svFilter.mode = p.filterMode;
        voice.svFilter.setParams(effCutoff, effRes, this.sr);
        sample = voice.svFilter.process(sample);
      }

      // Amplitude
      const vel = voice.velocity;
      const amp = ampLevel * vel * (1 + ampMod);

      // Pan
      const pan = Math.max(-1, Math.min(1, p.masterPan + panMod));
      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);

      outL[s] += sample * amp * panL;
      outR[s] += sample * amp * panR;
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;

    const outL = output[0];
    const outR = output[1];
    const blockSize = outL.length;

    // Zero output
    outL.fill(0);
    outR.fill(0);

    // Process voices
    for (let i = 0; i < NUM_VOICES; i++) {
      this._processVoice(this.voices[i], outL, outR, blockSize);
    }

    // Master volume
    const vol = this.params.masterVolume;

    // Effects chain: Distortion → EQ → Chorus → Delay → Reverb
    for (let s = 0; s < blockSize; s++) {
      let L = outL[s] * vol;
      let R = outR[s] * vol;

      [L, R] = this.distortion.process(L, R);
      [L, R] = this.eq.process(L, R);
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);

      // Soft clip output
      outL[s] = fastTanh(L);
      outR[s] = fastTanh(R);
    }

    return true;
  }
}

registerProcessor('va-synth-processor', VASynthProcessor);
