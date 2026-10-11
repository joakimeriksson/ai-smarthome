// VA Synthesizer AudioWorklet Processor
// All DSP runs in the audio thread — single monolithic file (AudioWorklet can't use ES imports)

import {
  Envelope,
  MoogFilter,
  SVFilter,
  Chorus,
  StereoDelay,
  Freeverb,
  Halfband2x,
  fastTanh,
  TWO_PI,
} from './dsp-lib.js';

const NUM_VOICES = 8;
const WAVETABLE_SIZE = 4096;          // 4x the highest harmonic kept, so linear
                                      // interpolation adds no audible images
const MAX_HARMONICS = 1024;
const TABLES_PER_OCTAVE = 2;          // one band-limited table per half octave
const NUM_TABLES = 11 * TABLES_PER_OCTAVE;
const TABLE_BASE_FREQ = 16.3516;      // C0
const MAX_UNISON = 8;

// Per-voice output gain. See the headroom note in process().
const VOICE_GAIN = 0.5;

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
//
// Table i serves fundamentals in [F_i, F_i * 2^(1/2)), F_i = C0 * 2^(i/2).
// Its harmonic count is chosen for the TOP of that range, so nothing a table
// is used for can put energy where it folds back into the audible band: a
// harmonic may sit between Nyquist and (sr - 20 kHz) — it then aliases to
// above 20 kHz — but never higher. At the bottom of the range the table still
// reaches ~20 kHz at 48 kHz, so there is no brightness step between tables.
//
// (Before 2026-09-24 there was one table per octave built for the octave's
// LOWEST note, so the upper half of each octave aliased: a saw at B5 had a
// -42 dBc spur, at B7 -32 dBc.)

function tableIndex(freq) {
  const i = Math.floor(TABLES_PER_OCTAVE * Math.log2(Math.abs(freq) / TABLE_BASE_FREQ + 1e-9));
  return i < 0 ? 0 : (i >= NUM_TABLES ? NUM_TABLES - 1 : i);
}

function generateWavetables(sampleRate) {
  const N = WAVETABLE_SIZE;
  const sin = new Float64Array(N);
  for (let i = 0; i < N; i++) sin[i] = Math.sin(TWO_PI * i / N);

  const tables = { saw: new Array(NUM_TABLES), triangle: new Array(NUM_TABLES), sine: new Float32Array(N + 1) };
  for (let i = 0; i <= N; i++) tables.sine[i] = sin[i % N];

  // Highest frequency a harmonic may have: folds to >= 20 kHz. At low sample
  // rates, fall back to Nyquist.
  const fLimit = Math.max(sampleRate / 2, sampleRate - 20000);

  for (let t = 0; t < NUM_TABLES; t++) {
    const top = TABLE_BASE_FREQ * Math.pow(2, (t + 1) / TABLES_PER_OCTAVE);
    const maxH = Math.max(1, Math.min(MAX_HARMONICS, Math.floor(fLimit / top)));
    // Gentle raised-cosine taper over the top quarter of the harmonics only,
    // to tame Gibbs ringing without dulling the audible band.
    const taper = (h) => {
      const x = (h - 0.75 * maxH) / (0.25 * maxH + 1);
      return x <= 0 ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, x));
    };
    const saw = new Float64Array(N), tri = new Float64Array(N);
    for (let h = 1; h <= maxH; h++) {
      const g = taper(h);
      const aSaw = g * 2 / (Math.PI * h) * (h % 2 === 0 ? -1 : 1);
      const aTri = (h % 2 === 1) ? g * 8 / (Math.PI * Math.PI * h * h) * ((h - 1) / 2 % 2 === 0 ? 1 : -1) : 0;
      for (let i = 0, k = 0; i < N; i++, k = (k + h) & (N - 1)) {
        saw[i] += aSaw * sin[k];
        if (aTri !== 0) tri[i] += aTri * sin[k];
      }
    }
    // One guard sample so the reader never has to wrap the index.
    tables.saw[t] = new Float32Array(N + 1); tables.saw[t].set(saw); tables.saw[t][N] = saw[0];
    tables.triangle[t] = new Float32Array(N + 1); tables.triangle[t].set(tri); tables.triangle[t][N] = tri[0];
  }

  return tables;
}

// Soft-knee output clipper: identity up to CLIP_KNEE, then a tanh curve
// with matching slope that approaches +/-1.
const CLIP_KNEE = 0.5;
function softClip(x) {
  const a = x < 0 ? -x : x;
  if (a <= CLIP_KNEE) return x;
  const y = CLIP_KNEE + (1 - CLIP_KNEE) * Math.tanh((a - CLIP_KNEE) / (1 - CLIP_KNEE));
  return x < 0 ? -y : y;
}

// Linear-interpolated read of a table with a guard sample; phase in [0, 1).
function readTable(table, phase) {
  const pos = phase * WAVETABLE_SIZE;
  const idx = pos | 0;
  const frac = pos - idx;
  return table[idx] + frac * (table[idx + 1] - table[idx]);
}

// ─── ADSR Envelope ──────────────────────────────────────────────────────────


// ─── Moog Ladder Filter (4-pole, 24dB/oct) ─────────────────────────────────

// ─── State Variable Filter (2-pole, 12dB/oct) ──────────────────────────────

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
        // Glide toward each new target with a time constant of a quarter
        // period. (It was a fixed 0.01/sample - a 2 ms slew whatever the
        // rate - which made "smooth" random a clicky sample & hold.)
        this._shValue += (this._shTarget - this._shValue) * Math.min(1, 4 * this.rate / this.sr);
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
    this.subPhase = 0;
    this.noiseState = 0xACE1; // LFSR seed

    // Analog imperfections (set once). The static per-voice detune is scaled
    // by driftAmount at the use site — a real poly autotunes to within a cent
    // or two, and with the drift knob at zero this synth should be in tune.
    this.detuneOffset = (Math.random() - 0.5) * 6; // up to ±3 cents at full drift
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

    // Filters. The R-side pair is only used while unison is spread in
    // stereo: each side then gets its own filter, as two voice cards would.
    this.moogFilter = new MoogFilter();
    this.svFilter = new SVFilter();
    this.moogFilterR = new MoogFilter();
    this.svFilterR = new SVFilter();
    this.hpfState = 0; // 1-pole HPF state
    this.hpfStateR = 0;

    // LFOs
    // Key pressure (aftertouch), 0..1, a mod-matrix source. It glides to its
    // target linearly (pressureStep per sample) and starts at 0 on every new
    // key press, as a CS-80 player's pressure does.
    this.pressure = 0;
    this.pressureTarget = 0;
    this.pressureStep = 0;
    // Per-voice pitch bend in semitones, gliding like pressure: a player's
    // scoop up into a note or a guitar-style bend on a held one. Separate
    // from the pitch wheel (params.pitchBend), which moves every voice.
    this.bend = 0;
    this.bendTarget = 0;
    this.bendStep = 0;
    this.lfo1 = new LFO(sr);
    this.lfo2 = new LFO(sr);

    // Oscillator phases per unison voice (index 0 is the only one used when
    // unison is off). Float64: a Float32 phase accumulator drifts in pitch.
    this.phases1 = new Float64Array(MAX_UNISON);
    this.phases2 = new Float64Array(MAX_UNISON);
  }

  resetFilters() {
    this.moogFilter.reset(); this.svFilter.reset();
    this.moogFilterR.reset(); this.svFilterR.reset();
    this.hpfState = 0; this.hpfStateR = 0;
  }

  noteOn(note, velocity, time, legato = false, driftAmount = 0.3) {
    const wasActive = this.active;
    if (!legato) {
      this.pressure = 0; this.pressureTarget = 0; this.pressureStep = 0;
      this.bend = 0; this.bendTarget = 0; this.bendStep = 0;
    }
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

      // Analog drift reset. The seed target must honour driftAmount like the
      // running walk does — unscaled, it detuned notes by cents even with the
      // drift knob at zero.
      this.driftCurrent = 0;
      this.driftTarget = (Math.random() - 0.5) * 10 * driftAmount;
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

// Waveshaping distortion, run at 4x through two halfband stages and
// loudness-matched. Until 2026-09-24 it shaped at the base rate with
// fastTanh (which has a hard corner at +-3) and no makeup gain: any drive
// made the patch 4-14 dB louder and pinned it near +-1 (Deep Sub, Wobble Bass
// lived in the output limiter), and on a bright saw it aliased at -36..-56 dBc.
const DIST_REF = 0.25;    // a -12 dBFS sine keeps its RMS at every drive

class Distortion {
  constructor() {
    this.drive = 1.0;
    this.postGain = 1.0;
    this.type = 0; // 0=tanh, 1=atan
    this.enabled = false;
    this._stages = [[new Halfband2x(), new Halfband2x()], [new Halfband2x(), new Halfband2x()]];
    this._makeupFor = null;
    this._makeup = 1;
  }

  _shape(x) {
    const d = this.drive;
    return this.type === 0 ? Math.tanh(x * d) : (2 / Math.PI) * Math.atan(x * d);
  }

  _updateMakeup() {
    const key = this.drive + ':' + this.type;
    if (key === this._makeupFor) return;
    this._makeupFor = key;
    // RMS of the shaped reference sine over one period, against the input's.
    let sum = 0; const n = 256;
    for (let i = 0; i < n; i++) sum += this._shape(DIST_REF * Math.sin(2 * Math.PI * i / n)) ** 2;
    const rmsOut = Math.sqrt(sum / n) || 1e-9;
    this._makeup = (DIST_REF / Math.SQRT2) / rmsOut;
  }

  _channel(x, [outer, inner]) {
    const u = outer.upsample(x); const u0 = u[0], u1 = u[1];
    const a = inner.upsample(u0); const a0 = this._shape(a[0]), a1 = this._shape(a[1]);
    const b = inner.upsample(u1); const b0 = this._shape(b[0]), b1 = this._shape(b[1]);
    return outer.downsample(inner.downsample(a0, a1), inner.downsample(b0, b1));
  }

  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    this._updateMakeup();
    const g = this._makeup * this.postGain;
    return [this._channel(inL, this._stages[0]) * g, this._channel(inR, this._stages[1]) * g];
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
      ampAttack: 0.03045,
      ampDecay: 1.382,
      ampSustain: 0.7,
      ampRelease: 2.072,

      // Filter Envelope
      filterAttack: 0.03045,
      filterDecay: 2.072,
      filterSustain: 0.3,
      filterRelease: 2.072,

      // Mod Envelope
      modAttack: 0.03045,
      modDecay: 2.072,
      modSustain: 0,
      modRelease: 0.6908,

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

    // Unison scratch (per block)
    this._uRatio = new Float64Array(MAX_UNISON);
    this._uGainL = new Float64Array(MAX_UNISON);
    this._uGainR = new Float64Array(MAX_UNISON);

    // Output DC blocker (one-pole high-pass at ~5 Hz) state
    this._dcR = 1 - TWO_PI * 5 / this.sr;
    this._dcXL = 0; this._dcYL = 0; this._dcXR = 0; this._dcYR = 0;

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
          // A voice that is still sounding (retrigger, steal, portamento)
          // must keep its oscillator and filter state: zeroing a filter that
          // is carrying signal is a step in the output.
          const wasSounding = v.isActive();
          v.noteOn(msg.note, msg.velocity, currentTime, !!msg.legato, this.params.driftAmount);
          if (!msg.legato) {
            // Apply current envelope params with analog jitter. Times are
            // floored at 1 ms after the jitter: below that the shared
            // Envelope jumps in a single sample, and a 1 ms preset landed
            // there about half the time.
            const jitter = () => 0.95 + Math.random() * 0.1;
            const t = (x) => Math.max(0.001, x);
            v.ampEnv.setParams(
              t(this.params.ampAttack * jitter()),
              t(this.params.ampDecay * jitter()),
              this.params.ampSustain,
              t(this.params.ampRelease * jitter())
            );
            v.filterEnv.setParams(
              t(this.params.filterAttack * jitter()),
              t(this.params.filterDecay * jitter()),
              this.params.filterSustain,
              t(this.params.filterRelease * jitter())
            );
            v.modEnv.setParams(
              t(this.params.modAttack), t(this.params.modDecay),
              this.params.modSustain, t(this.params.modRelease)
            );
            if (!wasSounding) {
              // Free-running oscillators; stacked unison voices start at
              // random phases so the stack does not begin phase-locked.
              if (this.params.unisonCount > 1) {
                for (let u = 0; u < MAX_UNISON; u++) {
                  v.phases1[u] = Math.random();
                  v.phases2[u] = Math.random();
                }
              }
              v.resetFilters();
            }
          }
        }
        break;
      }
      case 'noteOff': {
        const v = this.voices[msg.voice];
        if (v) v.noteOff();
        break;
      }
      case 'bend': {
        // One voice's pitch: glide to `value` semitones over `time` s.
        const v = this.voices[msg.voice];
        if (v) {
          v.bendTarget = msg.value;
          const n = (msg.time || 0) * sampleRate;
          if (n < 1) { v.bend = v.bendTarget; v.bendStep = 0; }
          else v.bendStep = (v.bendTarget - v.bend) / n;
        }
        break;
      }
      case 'pressure': {
        // Aftertouch for one voice: glide to `value` (0..1) over `time` s.
        const v = this.voices[msg.voice];
        if (v) {
          v.pressureTarget = Math.max(0, Math.min(1, msg.value));
          const n = Math.max(1, (msg.time || 0) * sampleRate);
          v.pressureStep = (v.pressureTarget - v.pressure) / n;
        }
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
      case 'eq':
        // 'eq.<band>.gain' - the page's EQ sliders. Before 2026-09-24 this
        // wrote eq['0'] etc. and the band gains never reached the filter.
        if (parts.length === 3 && this.eq.bands[+param]) {
          this.eq.bands[+param][parts[2]] = value;
          this.eq._calcCoeffs(+param);
        } else {
          this.eq[param] = value;
        }
        break;
    }
  }

  _getModValue(src, voice) {
    switch (src) {
      case 'lfo1': return voice.lfo1.value;
      case 'lfo2': return voice.lfo2.value;
      case 'modEnv': return voice.modEnv.level;
      case 'pressure': return voice.pressure;
      case 'velocity': return voice.velocity;
      case 'keyFollow': return (voice.note - 60) / 60; // normalized around C4
      default: return 0;
    }
  }

  // One oscillator sample. `ti` is the band-limited table for this pitch,
  // `dt` the phase increment (only the pulse's PolyBLEP-free path and noise
  // ignore it).
  _oscillator(voice, ti, phase, waveform, pw) {
    const t = this.tables;
    switch (waveform) {
      case 0: // Saw
        return readTable(t.saw[ti], phase);
      case 1: { // Square / pulse: difference of two band-limited saws. High
        // for a fraction `pw` of the cycle, DC-free at every width, and the
        // same alias-free source as the saw. (It used to be a naive pulse
        // with PolyBLEP carrying a DC offset of 2*pw-1 - PWM Strings sat at
        // -0.4 DC per voice and its chords drove the output clipper flat.)
        let ph2 = phase - pw; if (ph2 < 0) ph2 += 1;
        return readTable(t.saw[ti], ph2) - readTable(t.saw[ti], phase);
      }
      case 2: // Triangle
        return readTable(t.triangle[ti], phase);
      case 3: // Sine
        return readTable(t.sine, phase);
      case 4: { // White noise (xorshift)
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
    const sr = this.sr;

    // Pitch bend multiplier (applied to all frequencies)
    const bendMult = p.pitchBend !== 0 ? Math.pow(2, p.pitchBend * p.pitchBendRange / 12) : 1;

    // Portamento rate coefficient (per-sample)
    const portaCoeff = p.portamento && p.portamentoTime > 0.001
      ? (1 - Math.exp(-1 / (p.portamentoTime * sr))) : 1;

    // LFO rate and shape follow the knobs while a note is held (they used to
    // be latched at note-on, so turning them did nothing until the next key).
    voice.lfo1.rate = p.lfo1Rate; voice.lfo1.waveform = p.lfo1Waveform;
    voice.lfo2.rate = p.lfo2Rate; voice.lfo2.waveform = p.lfo2Waveform;

    // Unison: n stacked copies of the whole oscillator section, detuned
    // across +/- unisonDetune/2 cents and panned across unisonSpread.
    const n = Math.max(1, Math.min(MAX_UNISON, p.unisonCount | 0));
    const uRatio = this._uRatio, uGainL = this._uGainL, uGainR = this._uGainR;
    for (let u = 0; u < n; u++) {
      const pos = n > 1 ? u / (n - 1) - 0.5 : 0;           // -0.5 .. +0.5
      uRatio[u] = Math.pow(2, pos * p.unisonDetune / 1200);
      const pan = pos * p.unisonSpread;                    // -0.5 .. +0.5
      uGainL[u] = Math.sqrt(1 - 2 * pan);                  // equal power:
      uGainR[u] = Math.sqrt(1 + 2 * pan);                  // L^2 + R^2 = 2
    }
    // Detuned copies add in power, so 1/sqrt(n) keeps the level of a single
    // voice. (It was 0.5/sqrt(n): unison was 6 dB quieter than no unison.)
    const uNorm = 1 / Math.sqrt(n);
    const stereo = n > 1 && p.unisonSpread > 0.001;

    const useOsc2 = p.osc2Level > 0.001 || p.crossModAmount > 0.001 || (p.ringMod && p.osc2Level > 0.001);
    const osc2Semi = p.osc2Octave + p.osc2Detune / 100;
    const osc2Ratio = Math.pow(2, osc2Semi / 12);
    const vDetune = voice.detuneOffset * p.driftAmount / 100;

    // SVF stability: the Chamberlin core (dsp-lib, 2x oversampled) diverges
    // once f = 2 sin(pi fc / 2sr) exceeds sqrt(q^2 + 4) - q. At low resonance
    // that is ~20 kHz, below the generic 0.45*sr clamp, and the filter
    // produced NaN with the cutoff knob at max. Keep 5% margin.
    let svfMax = sr * 0.45;
    if (p.filterType !== 0) {
      const res = Math.max(0, Math.min(1, p.filterResonance));
      const q = 1 - res * 0.95;
      const fMax = 0.95 * (Math.sqrt(q * q + 4) - q);
      svfMax = Math.min(svfMax, (2 * sr / Math.PI) * Math.asin(Math.min(1, fMax / 2)));
    }

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

      if (voice.bendStep !== 0) {
        voice.bend += voice.bendStep;
        if ((voice.bendStep > 0) === (voice.bend >= voice.bendTarget)) {
          voice.bend = voice.bendTarget; voice.bendStep = 0;
        }
      }
      const baseFreq1 = 440 * Math.pow(2, (voice.currentPitch + voice.bend - 69 + vDetune) / 12) * bendMult;

      // Drift
      voice.driftTimer--;
      if (voice.driftTimer <= 0) {
        voice.driftTarget = (Math.random() - 0.5) * 10 * p.driftAmount;
        voice.driftTimer = Math.floor(sr * (1 + Math.random() * 4));
      }
      voice.driftCurrent += (voice.driftTarget - voice.driftCurrent) * voice.driftSmoothing;

      // LFOs
      if (voice.pressureStep !== 0) {
        voice.pressure += voice.pressureStep;
        if ((voice.pressureStep > 0) === (voice.pressure >= voice.pressureTarget)) {
          voice.pressure = voice.pressureTarget; voice.pressureStep = 0;
        }
      }
      voice.lfo1.process();
      voice.lfo2.process();

      // Envelopes
      const ampLevel = voice.ampEnv.process();
      const filterLevel = voice.filterEnv.process();
      voice.modEnv.process();

      // Mod matrix accumulation
      let pitchMod = 0, osc2PitchMod = 0, cutoffMod = 0, pwMod = 0, ampMod = 0, panMod = 0, resMod = 0;

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
          case 'resonance': resMod += val * 0.3; break;
        }
      }

      // Apply drift to frequency
      const driftMult = Math.pow(2, voice.driftCurrent / 1200);
      const pitchMultMod = pitchMod !== 0 ? Math.pow(2, pitchMod / 12) : 1;
      const osc2PitchMult = osc2PitchMod !== 0 ? Math.pow(2, osc2PitchMod / 12) : 1;
      const freq1 = baseFreq1 * driftMult * pitchMultMod;
      const freq2 = freq1 * osc2Ratio * osc2PitchMult;
      const pw = Math.max(0.05, Math.min(0.95, p.pulseWidth + pwMod));
      const ti1 = tableIndex(freq1), ti2 = tableIndex(freq2);
      const dt1Base = freq1 / sr, dt2Base = freq2 / sr;

      // Oscillator section, once per unison copy.
      let sumL = 0, sumR = 0;
      for (let u = 0; u < n; u++) {
        const r = uRatio[u];
        const dt1 = dt1Base * r, dt2 = dt2Base * r;
        let ph1 = voice.phases1[u], ph2 = voice.phases2[u];

        // Osc 2 first so it can modulate osc 1.
        let osc2 = 0;
        if (useOsc2) {
          if (p.oscSync && ph1 < dt1) {
            ph2 = ph1 * (dt2 / dt1); // hard sync to osc 1's last wrap
          }
          osc2 = this._oscillator(voice, ti2, ph2, p.osc2Waveform, pw);
          ph2 += dt2;
          if (ph2 >= 1) ph2 -= Math.floor(ph2);
        }

        // Osc 1, optionally frequency-modulated by osc 2. The deviation can
        // exceed the carrier (osc2 * amount * 4 > 1): the frequency then goes
        // through zero, so the phase must wrap in both directions. It used
        // to wrap only upward - a negative phase indexed the table out of
        // range and the voice produced NaN from cross-mod 0.5 up.
        let dt1Eff = dt1, ti = ti1;
        if (p.crossModAmount > 0.001 && osc2 !== 0) {
          dt1Eff = dt1 * (1 + osc2 * p.crossModAmount * 4);
          ti = tableIndex(dt1Eff * sr);
        }
        const osc1 = this._oscillator(voice, ti, ph1, p.osc1Waveform, pw);
        ph1 += dt1Eff;
        if (ph1 >= 1 || ph1 < 0) ph1 -= Math.floor(ph1);

        voice.phases1[u] = ph1; voice.phases2[u] = ph2;

        const x = (p.ringMod && p.osc2Level > 0.001)
          ? osc1 * osc2
          : osc1 * p.osc1Level + osc2 * p.osc2Level;
        sumL += x * uGainL[u];
        sumR += x * uGainR[u];
      }
      sumL *= uNorm; sumR *= uNorm;

      // Sub oscillator: square an octave below osc 1, PolyBLEP-corrected
      // (it was a naive square, aliasing across the whole band).
      let common = 0;
      if (p.subLevel > 0.001) {
        const dtS = dt1Base * 0.5;
        const sp = voice.subPhase;
        let sub = sp < 0.5 ? 1 : -1;
        sub += polyBLEP(sp, dtS);
        let sp2 = sp + 0.5; if (sp2 >= 1) sp2 -= 1;
        sub -= polyBLEP(sp2, dtS);
        voice.subPhase += dtS;
        if (voice.subPhase >= 1) voice.subPhase -= 1;
        common += sub * p.subLevel;
      }

      // Noise mixer (independent of osc waveform selection)
      if (p.noiseLevel > 0.001) {
        voice.noiseState ^= voice.noiseState << 13;
        voice.noiseState ^= voice.noiseState >> 17;
        voice.noiseState ^= voice.noiseState << 5;
        common += ((voice.noiseState & 0xFFFF) / 32768 - 1) * p.noiseLevel;
      }

      // Filter settings (shared by both sides)
      const baseCutoff = p.filterCutoff * voice.filterCutoffVariation;
      const keyTrackMod = p.filterKeyTrack * (voice.note - 60) / 12;
      const envMod = p.filterEnvAmount * filterLevel;
      let effCutoff = baseCutoff * Math.pow(2, keyTrackMod + envMod * 4 + cutoffMod * 4);
      effCutoff = Math.max(20, Math.min(p.filterType === 0 ? sr * 0.45 : svfMax, effCutoff));
      const effRes = Math.max(0, Math.min(1, p.filterResonance + resMod));

      let sampleL = this._voiceChannel(voice, sumL + common + voice.dcBias, effCutoff, effRes, false);
      let sampleR = stereo
        ? this._voiceChannel(voice, sumR + common + voice.dcBias, effCutoff, effRes, true)
        : sampleL;

      // Amplitude
      const amp = ampLevel * voice.velocity * (1 + ampMod) * VOICE_GAIN;

      // Pan
      const pan = Math.max(-1, Math.min(1, p.masterPan + panMod));
      const panL = Math.cos((pan + 1) * Math.PI / 4);
      const panR = Math.sin((pan + 1) * Math.PI / 4);

      outL[s] += sampleL * amp * panL;
      outR[s] += sampleR * amp * panR;
    }
  }

  // Saturation -> HPF -> VCF for one side of a voice.
  _voiceChannel(voice, sample, cutoff, res, right) {
    const p = this.params;
    if (p.saturationDrive > 1.001) {
      sample = fastTanh(sample * p.saturationDrive);
    }
    // High-pass filter (pre-VCF, like Jupiter-8's HPF)
    if (p.hpfCutoff > 25) {
      const c = Math.exp(-TWO_PI * p.hpfCutoff / this.sr);
      const st = right ? voice.hpfStateR : voice.hpfState;
      const lp = sample * (1 - c) + st * c;
      if (right) voice.hpfStateR = lp; else voice.hpfState = lp;
      sample -= st;
    }
    if (p.filterType === 0) {
      const f = right ? voice.moogFilterR : voice.moogFilter;
      f.setParams(cutoff, res, this.sr);
      return f.process(sample);
    }
    const f = right ? voice.svFilterR : voice.svFilter;
    f.mode = p.filterMode;
    f.setParams(cutoff, res, this.sr);
    return f.process(sample);
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
    const dcR = this._dcR;
    for (let s = 0; s < blockSize; s++) {
      // DC blocker ahead of the effects: the per-note dcBias, the filter's
      // asymmetric saturation and asymmetric waveforms otherwise sum across
      // voices into an offset that pushes the output clipper off-centre.
      const xl = outL[s], xr = outR[s];
      this._dcYL = xl - this._dcXL + dcR * this._dcYL; this._dcXL = xl;
      this._dcYR = xr - this._dcXR + dcR * this._dcYR; this._dcXR = xr;
      let L = this._dcYL * vol;
      let R = this._dcYR * vol;

      [L, R] = this.distortion.process(L, R);
      [L, R] = this.eq.process(L, R);
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);

      // Output protection: linear below the knee, tanh-shaped above it.
      // (A plain fastTanh here bent every sample, however quiet - ~1% third
      // harmonic at -8 dBFS - and that distortion folded back as aliasing:
      // it, not the oscillators, set the spur floor of a bare saw.)
      outL[s] = softClip(L);
      outR[s] = softClip(R);
    }

    return true;
  }
}

registerProcessor('va-synth-processor', VASynthProcessor);
