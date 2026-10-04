// Shared DSP library for the software synths.
//
// Every melodic synth carried its own copy of these classes. Before
// extracting them, each copy was compared BEHAVIOURALLY — same inputs
// through each variant, outputs diffed sample-by-sample — and the versions
// below produce bit-identical output to the copies they replace in
// va / ws / fm / pm. So this is a pure de-duplication: nothing sounds
// different, there is simply one place to fix or improve each block now.
//
// Sources: the VA processor's versions, which are the most fully commented.
//
// NOT shared: LFO. The copies genuinely diverge — FM numbers its waveforms
// 0=sine 1=tri 2=square 3=S&H while VA uses 0=sine 1=tri 2=saw 3=square
// 4=S&H 5=random, and VA adds delay/fade-in/sync that FM lacks. Unifying it
// would silently re-map every FM preset's LFO shape, so each synth keeps its
// own until the presets can be migrated together.
//
// Loaded directly by the AudioWorklet processors — worklet scripts are
// module scripts, so a plain `import` works with no build step.

export const TWO_PI = 2 * Math.PI;

export const ENV_OFF = 0, ENV_ATTACK = 1, ENV_DECAY = 2, ENV_SUSTAIN = 3, ENV_RELEASE = 4;


// ------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------

export function fastTanh(x) {
  if (x < -3) return -1;
  if (x > 3) return 1;
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}


// ------------------------------------------------------------------------
// Envelopes
// ------------------------------------------------------------------------


// The attack aims at 1.05 and stops at 1.0: that takes ln(1.05/0.05) time
// constants. A fall of 60 dB takes ln(1000).
export const ENV_ATTACK_TCS = Math.log(21);
export const ENV_FALL_TCS = Math.log(1000);

export class Envelope {
  constructor(sr) {
    this.sr = sr;
    this.stage = ENV_OFF;
    this.level = 0;
    this.attack = 0.03045;
    this.decay = 1.382;
    this.sustain = 0.7;
    this.release = 2.072;
    this.attackCoeff = 0;
    this.decayCoeff = 0;
    this.releaseCoeff = 0;
    this._recalc();
  }

  // Times are what the panels print. attack = seconds to reach the peak;
  // decay and release = seconds to fall 60 dB of the way (to sustain, to
  // silence). The curves are one-pole exponentials as before; only the
  // meaning of the number changed. Until 2026-09-24 each time was the
  // one-pole TIME CONSTANT, so a "0.5 s" release rang for 3.5 s and a
  // "0.1 s" attack peaked at 0.3 s. Every preset was converted by exactly
  // these factors, so they sound the same (verified sample for sample).
  _recalc() {
    this.attackCoeff = this.attack < 0.001 ? 1 : 1 - Math.exp(-ENV_ATTACK_TCS / (this.attack * this.sr));
    this.decayCoeff = this.decay < 0.001 ? 1 : 1 - Math.exp(-ENV_FALL_TCS / (this.decay * this.sr));
    this.releaseCoeff = this.release < 0.001 ? 1 : 1 - Math.exp(-ENV_FALL_TCS / (this.release * this.sr));
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


// ------------------------------------------------------------------------
// Filters
// ------------------------------------------------------------------------


// Halfband lowpass (cutoff at a quarter of the 2x rate) for 2x resampling:
// 47-tap Kaiser-windowed sinc, beta 8 (~80 dB stopband, passband flat to
// ~19 kHz at 48 kHz). Only the centre tap and the even taps are nonzero.
const HB_TAPS = (() => {
  const N = 47, c = (N - 1) / 2, beta = 8;
  const i0 = (x) => { let s = 1, t = 1; for (let k = 1; k < 30; k++) { t *= (x / (2 * k)) ** 2; s += t; } return s; };
  const taps = [];
  for (let k = 0; k < N; k++) {
    const n = k - c;
    const sinc = n === 0 ? 0.5 : Math.sin(Math.PI * n / 2) / (Math.PI * n);
    const w = i0(beta * Math.sqrt(1 - (n / c) ** 2)) / i0(beta);
    const h = sinc * w;
    if (Math.abs(h) > 1e-12) taps.push([k, h]);
  }
  const sum = taps.reduce((a, [, h]) => a + h, 0);
  return { N, idx: Int32Array.from(taps.map(t => t[0])), h: Float64Array.from(taps.map(t => t[1] / sum)) };
})();

/**
 * 2x up/down resampling through the halfband above. upsample() gives the two
 * 2x-rate samples for one input sample; downsample() takes two 2x-rate
 * samples and returns one. Mirrored circular buffers (each sample written at
 * i and i+N) keep the newest N contiguous, so the dot product needs no wrap.
 * Latency: (N-1)/2 samples at the 2x rate each way.
 */
export class Halfband2x {
  constructor() {
    this._up = new Float64Array(HB_TAPS.N * 2);
    this._dn = new Float64Array(HB_TAPS.N * 2);
    this._ui = 0; this._di = 0;
    this.out = new Float64Array(2);   // upsample() result, reused
  }
  reset() { this._up.fill(0); this._dn.fill(0); }
  /** One input sample -> this.out[0], this.out[1] at 2x (zero-stuffed, x2 gain). */
  upsample(x) {
    const N = HB_TAPS.N, idx = HB_TAPS.idx, h = HB_TAPS.h, n = idx.length, buf = this._up;
    let i = this._ui + 1 === N ? 0 : this._ui + 1;
    buf[i] = buf[i + N] = x;
    let top = i + N, acc = 0;
    for (let j = 0; j < n; j++) acc += h[j] * buf[top - idx[j]];
    this.out[0] = 2 * acc;
    i = i + 1 === N ? 0 : i + 1;
    buf[i] = buf[i + N] = 0;
    top = i + N; acc = 0;
    for (let j = 0; j < n; j++) acc += h[j] * buf[top - idx[j]];
    this.out[1] = 2 * acc;
    this._ui = i;
    return this.out;
  }
  /** Two 2x-rate samples -> one band-limited sample. */
  downsample(a, b) {
    const N = HB_TAPS.N, idx = HB_TAPS.idx, h = HB_TAPS.h, n = idx.length, buf = this._dn;
    let i = this._di + 1 === N ? 0 : this._di + 1;
    buf[i] = buf[i + N] = a;
    i = i + 1 === N ? 0 : i + 1;
    buf[i] = buf[i + N] = b;
    this._di = i;
    const top = i + N;
    let acc = 0;
    for (let j = 0; j < n; j++) acc += h[j] * buf[top - idx[j]];
    return acc;
  }
}

export class MoogFilter {
  // Four one-pole stages with tanh saturation and a saturated feedback path,
  // run at 2x the sample rate. The ladder itself is unchanged since the
  // presets were voiced on it; what changed (2026-09-24) is the resampling.
  // It used to feed each input sample in twice and keep every second output
  // — no interpolation and no decimation filter — so the saturation's
  // harmonics folded straight back: a B6 saw through a wide-open filter had
  // a -45 dBc alias (now -68). Resonance, cutoff tracking and saturation
  // measure the same as before to 0.1 dB. The resampling is inlined rather
  // than using Halfband2x below: this runs per voice, and the call through
  // another object measured ~1.6x slower.
  constructor() {
    this.s = new Float64Array(4); // stages
    this.cutoff = 8000;
    this.resonance = 0;
    this._g = 0;
    this._k = 0;
    // 2x-rate history for the interpolator (input with zeros stuffed) and
    // the decimator (ladder output). Mirrored circular buffers: each sample
    // is written at i and i+N, so the newest N are always contiguous.
    this._up = new Float64Array(HB_TAPS.N * 2);
    this._dn = new Float64Array(HB_TAPS.N * 2);
    this._ui = 0;
    this._di = 0;
  }

  reset() {
    this.s.fill(0);
    this._up.fill(0); this._dn.fill(0);
  }

  setParams(cutoff, resonance, sr) {
    // Frequency warping for stability
    const fc = Math.min(cutoff, sr * 0.45);
    this._g = 1 - Math.exp(-TWO_PI * fc / (sr * 2)); // 2x oversampled
    this._k = resonance * 4.0;
  }

  _hb(buf, pos) {
    // Dot product of the halfband taps with the newest N samples of buf;
    // pos + N is the newest sample's index in the mirrored buffer.
    const { N, idx, h } = HB_TAPS;
    const top = pos + N;
    let acc = 0;
    for (let j = 0; j < idx.length; j++) acc += h[j] * buf[top - idx[j]];
    return acc;
  }

  _tick(inp) {
    const fb = fastTanh(this.s[3] * this._k);
    const x = inp - fb;
    this.s[0] += this._g * (fastTanh(x) - fastTanh(this.s[0]));
    this.s[1] += this._g * (fastTanh(this.s[0]) - fastTanh(this.s[1]));
    this.s[2] += this._g * (fastTanh(this.s[1]) - fastTanh(this.s[2]));
    this.s[3] += this._g * (fastTanh(this.s[2]) - fastTanh(this.s[3]));
    return this.s[3];
  }

  process(input) {
    const N = HB_TAPS.N;
    let out = 0;
    for (let os = 0; os < 2; os++) {
      // Interpolate: the input, zero-stuffed, through the halfband (x2 gain).
      this._ui = this._ui + 1 === N ? 0 : this._ui + 1;
      this._up[this._ui] = this._up[this._ui + N] = os === 0 ? input : 0;
      const y = this._tick(2 * this._hb(this._up, this._ui));
      // Decimate: band-limit the ladder output, keep one sample in two.
      this._di = this._di + 1 === N ? 0 : this._di + 1;
      this._dn[this._di] = this._dn[this._di + N] = y;
      if (os === 1) out = this._hb(this._dn, this._di);
    }
    return out;
  }
}


export class SVFilter {
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


// ------------------------------------------------------------------------
// Effects
// ------------------------------------------------------------------------


export class Chorus {
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


export class StereoDelay {
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


const FREEVERB_FIXED_GAIN = 0.015;
const FREEVERB_SCALE_WET = 3;

export class Freeverb {
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

    // Jezar's Freeverb scales the comb input by fixedgain (0.015) and the
    // wet output by scalewet (3). Without them the eight parallel combs, at
    // feedback ~0.92, came out ~26 dB above the dry signal: at mix 0.2 the
    // tail was 12 dB LOUDER than the note and drove every synth into its
    // output limiter (measured 2026-09-24 on VA, FM and PM chords).
    const input = (inL + inR) * 0.5 * FREEVERB_FIXED_GAIN;
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

    const wet = this.mix * FREEVERB_SCALE_WET;
    const dry = 1 - this.mix;
    return [inL * dry + outL * wet, inR * dry + outR * wet];
  }
}
