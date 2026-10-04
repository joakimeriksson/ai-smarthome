// Physical Modeling Synth AudioWorklet Processor
//
// Extended Karplus-Strong (Jaffe & Smith 1983) for plucked, struck and
// hammered strings, and a bowed string after the STK Bowed model (McIntyre,
// Schumacher & Woodhouse friction curve, Smith's two-delay waveguide).
//
// The string loop, per sample:
//
//   delay[N] -> averaging filter (Brightness) -> one-pole lowpass (Damping)
//            -> dispersion allpasses (Inharm) -> tuning allpass -> gain -> delay
//
// Every filter in the loop adds phase delay at the fundamental, so the
// integer length N and the tuning allpass are recomputed each block from the
// filters' ACTUAL phase delays at f0 — that is what keeps the string in tune
// whatever the knobs do. The loop gain is likewise solved from the filters'
// magnitude at f0, so Decay is the fundamental's true T60 in seconds.
//
// Measured before this rewrite (offline render of every factory preset):
// decay was applied per trip but computed per sample, so notes rang ~N times
// too long (180x at C4); the "body" was a pitch-tracking comb whose resonance
// sat off the harmonic series and dominated the output (Acoustic Guitar C4's
// loudest partials were 7.96x and 15.03x f0); Inharm was never read; key-up
// did nothing; and 8 of 12 presets hard-clipped on a chord.

import {
  Chorus,
  StereoDelay,
  Freeverb,
} from './dsp-lib.js';

const NUM_VOICES = 8;
const MAX_DELAY = 4096;          // ~12 Hz at 48 kHz
const DISP_STAGES = 8;           // stiffness allpasses in the loop
const VOICE_GAIN = 0.2;
const SILENCE = 2e-5;            // block peak below which a released voice stops

// ─── Filter helpers (all evaluated at the fundamental, w0 rad/sample) ──────

/** Phase delay, in samples, of the two-tap filter b0 + b1·z⁻¹ at w. */
function phaseDelay2tap(b0, b1, w) {
  const phi = Math.atan2(-b1 * Math.sin(w), b0 + b1 * Math.cos(w));
  return -phi / w;
}
function mag2tap(b0, b1, w) {
  return Math.sqrt(b0 * b0 + b1 * b1 + 2 * b0 * b1 * Math.cos(w));
}

/** One-pole lowpass y = (1-p)x + p·y[-1]: phase delay and magnitude at w. */
function phaseDelayOnePole(p, w) {
  return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w;
}
function magOnePole(p, w) {
  return (1 - p) / Math.sqrt(1 - 2 * p * Math.cos(w) + p * p);
}

/** Phase delay of the first-order allpass (C + z⁻¹)/(1 + C·z⁻¹) at w. */
function phaseDelayAllpass(C, w) {
  const phi = Math.atan2(-Math.sin(w), C + Math.cos(w)) -
              Math.atan2(-C * Math.sin(w), 1 + C * Math.cos(w));
  return -phi / w;
}

/**
 * Allpass coefficient whose PHASE DELAY at w equals `d` samples. The usual
 * C = (1-d)/(1+d) is only the DC limit; solving at the fundamental keeps the
 * top of the keyboard in tune too. Delay falls monotonically with C.
 */
function allpassCoefFor(d, w) {
  let lo = -0.98, hi = 0.98;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (phaseDelayAllpass(mid, w) > d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Bowed-string friction: reflection falls off as the bow slips. */
function bowTable(dv, slope) {
  const s = Math.abs(dv * slope) + 0.75;
  const r = 1 / (s * s * s * s);
  return r > 1 ? 1 : r;
}

// ─── String voice ───────────────────────────────────────────────────────────

class KSVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.released = false;
    this.note = 0;
    this.velocity = 0;
    this.freq = 440;
    this.bowed = false;

    this.delay = new Float32Array(MAX_DELAY);
    this.delayLen = 100;
    this.writeIdx = 0;

    this.lpY = 0;                                  // damping lowpass state
    this.dispX = new Float64Array(DISP_STAGES);    // stiffness allpass states
    this.dispY = new Float64Array(DISP_STAGES);
    this.apX = 0; this.apY = 0;                    // tuning allpass
    this.dcX = 0; this.dcY = 0;                    // DC blocker

    // Bowed string: nut side and bridge side of the bow.
    this.neck = new Float32Array(MAX_DELAY);
    this.bridge = new Float32Array(MAX_DELAY);
    this.neckIdx = 0; this.bridgeIdx = 0;
    this.neckOut = 0; this.bridgeOut = 0;
    this.bowFilt = 0;
    this.bowVel = 0;
    this.time = 0;
  }

  noteOn(note, velocity, p) {
    const wasActive = this.active;
    this.active = true;
    this.released = false;
    this.note = note;
    this.velocity = velocity / 127;
    this.freq = 440 * Math.pow(2, (note - 69) / 12);
    this.bowed = (p.exciter | 0) === 2;
    this.time = 0;
    this.quiet = 0;

    if (this.bowed) {
      this.neck.fill(0); this.bridge.fill(0);
      this.neckIdx = 0; this.bridgeIdx = 0;
      this.neckOut = 0; this.bridgeOut = 0;
      this.bowFilt = 0; this.bowVel = 0;
      this.dcX = 0; this.dcY = 0;
      return;
    }

    // Loop length for the current settings; refined every block.
    this.delayLen = Math.max(2, Math.min(MAX_DELAY - 2, Math.floor(this.sr / this.freq) - 1));
    const N = this.delayLen;

    // A retriggered string keeps a little of what it was doing — clearing
    // the loop outright is an audible click.
    if (wasActive) for (let i = 0; i < MAX_DELAY; i++) this.delay[i] *= 0.25;
    else {
      this.delay.fill(0);
      this.lpY = 0; this.apX = 0; this.apY = 0; this.dcX = 0; this.dcY = 0;
      this.dispX.fill(0); this.dispY.fill(0);
    }

    // Harder playing is brighter, as on any real string.
    const color = Math.min(1, Math.max(0, (p.color ?? 0.5) + (this.velocity - 0.6) * 0.4));
    const exc = new Float32Array(N);
    const type = p.exciter | 0;
    if (type === 0) {
      // Pluck: a period of noise, lowpassed by Color.
      const a = 0.08 + 0.92 * color * color;
      let y = 0;
      for (let i = 0; i < N; i++) { y += a * ((Math.random() * 2 - 1) - y); exc[i] = y; }
    } else {
      // Strike (mallet) and Hammer (felt): a raised-cosine force pulse whose
      // width is the contact time — short = hard and bright, long = soft.
      const hammer = type === 3;
      const maxW = this.sr * (hammer ? 0.008 : 0.005);
      const minW = this.sr * (hammer ? 0.0015 : 0.0003);
      const W = Math.max(2, Math.min(N, Math.round(maxW + (minW - maxW) * color)));
      for (let i = 0; i < W; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / W);
        exc[i] = w + (hammer ? (Math.random() * 2 - 1) * 0.15 * w : 0);
      }
    }
    // No DC into the loop (it would thump and then sit there), and a fixed
    // RMS so every exciter and every note starts at the same loudness.
    let mean = 0; for (let i = 0; i < N; i++) mean += exc[i]; mean /= N;
    let rms = 0; for (let i = 0; i < N; i++) { exc[i] -= mean; rms += exc[i] * exc[i]; }
    rms = Math.sqrt(rms / N) || 1;
    const gain = 0.5 * this.velocity / rms;
    for (let i = 0; i < N; i++) this.delay[i] += exc[i] * gain;
    // The first read, N samples from now, is the start of the excitation.
    this.writeIdx = N;
  }

  noteOff() { this.released = true; }
}

// ─── Body: fixed resonances, like a real soundboard ───────────────────────

// Bandpass biquad (RBJ, 0 dB peak).
class Resonator {
  constructor() { this.b0 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; }
  set(sr, f, q) {
    const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, alpha = Math.sin(w) / (2 * q), a0 = 1 + alpha;
    this.b0 = alpha / a0; this.a1 = -2 * Math.cos(w) / a0; this.a2 = (1 - alpha) / a0;
  }
  tick(x) {
    const y = this.b0 * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// Mode frequencies and weights of a small acoustic body (air mode, top-plate
// modes, a brighter plate mode); Size scales them over about 1.6 octaves.
const BODY_MODES = [[100, 1.0, 9], [205, 0.8, 11], [390, 0.55, 10], [800, 0.35, 7], [2400, 0.2, 4]];

class Body {
  constructor(sr) {
    this.sr = sr;
    this.modes = BODY_MODES.map(() => new Resonator());
    this.size = -1;
  }
  setSize(size) {
    if (size === this.size) return;
    this.size = size;
    const scale = Math.pow(2, (0.5 - size) * 1.6);
    this.modes.forEach((m, i) => m.set(this.sr, BODY_MODES[i][0] * scale, BODY_MODES[i][2]));
  }
  tick(x) {
    let y = 0;
    for (let i = 0; i < this.modes.length; i++) y += this.modes[i].tick(x) * BODY_MODES[i][1];
    return y;
  }
}

// ─── Main Processor ─────────────────────────────────────────────────────────

class PMSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) this.voices.push(new KSVoice(this.sr));

    this.params = {
      exciter: 0,      // 0=pluck, 1=strike, 2=bow, 3=hammer
      color: 0.5,      // exciter brightness 0-1
      brightness: 0.5, // loop averaging filter: 0=dark, 1=bright
      decay: 0.7,      // fundamental T60, 0.1..8.1 s
      damping: 0.3,    // how much faster the highs die than the fundamental
      release: 0.3,    // ring after key-up, 0.05..3 s (never longer than decay)
      bodyAmount: 0.0, // body resonance mix 0-1
      bodySize: 0.5,   // body resonator size
      pickup: 0.13,    // pickup position along string (0-0.5)
      inharm: 0.0,     // string stiffness: upper partials go sharp
      stereoWidth: 0.3,
      masterVolume: 0.8,
      pitchBend: 0, pitchBendRange: 2,
    };

    this.bodyL = new Body(this.sr);
    this.bodyR = new Body(this.sr);
    this.chorus = new Chorus(this.sr);
    this.delay = new StereoDelay(this.sr);
    this.reverb = new Freeverb(this.sr);
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        const v = this.voices[msg.voice];
        if (v) v.noteOn(msg.note, msg.velocity, this.params);
        break;
      }
      case 'noteOff': {
        const v = this.voices[msg.voice];
        if (v) v.noteOff();
        break;
      }
      case 'param': {
        const { param, value } = msg;
        if (param.startsWith('fx.')) {
          const [, fx, p] = param.split('.');
          if (fx === 'chorus') this.chorus[p] = value;
          else if (fx === 'delay') this.delay[p] = value;
          else if (fx === 'reverb') this.reverb[p] = value;
        } else {
          this.params[param] = value;
        }
        break;
      }
      case 'preset': {
        if (msg.params) Object.assign(this.params, msg.params);
        if (msg.fx) {
          if (msg.fx.chorus) Object.assign(this.chorus, msg.fx.chorus);
          if (msg.fx.delay) Object.assign(this.delay, msg.fx.delay);
          if (msg.fx.reverb) Object.assign(this.reverb, msg.fx.reverb);
        }
        break;
      }
    }
  }

  /** T60 in seconds the string should currently decay with. */
  _t60(voice) {
    const p = this.params;
    const held = 0.1 + p.decay * 8;
    if (!voice.released) return held;
    return Math.min(held, 0.05 + (p.release ?? 0.3) * 3);
  }

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.active) return;
    if (voice.bowed) this._processBowed(voice, outL, outR, blockSize);
    else this._processString(voice, outL, outR, blockSize);
  }

  _processString(voice, outL, outR, blockSize) {
    const p = this.params;
    const bend = Math.pow(2, (p.pitchBend || 0) * (p.pitchBendRange || 2) / 12);
    const target = this.sr / (voice.freq * bend);          // loop delay wanted
    const w0 = 2 * Math.PI / target;

    // Loop filters and their delay / gain at the fundamental.
    const avgMix = 1 - p.brightness * 0.9;
    const b0 = 1 - avgMix * 0.5, b1 = avgMix * 0.5;
    const lpP = Math.min(0.85, Math.max(0, p.damping) * 0.75);
    // Stiffness: allpasses with C < 0 delay low frequencies more than high
    // ones, so upper partials come round sooner and go sharp, as on a piano
    // wire or a metal bar. sqrt spreads the knob's useful range; the cap
    // keeps the dispersion's delay inside the loop at the top of the keyboard.
    let dispC = -0.9 * Math.sqrt(Math.min(1, Math.max(0, p.inharm)));
    const dispMax = (target * 0.6) / DISP_STAGES;          // per-stage DC delay cap
    const cMin = (1 - dispMax) / (1 + dispMax);            // C giving that delay
    if (dispC < cMin) dispC = Math.min(0, cMin);
    // The averaging filter's second tap reads one sample NEWER, so it
    // SHORTENS the loop by its phase delay; the others lengthen it.
    const filterDelay = -phaseDelay2tap(b0, b1, w0) + phaseDelayOnePole(lpP, w0) +
      (dispC !== 0 ? DISP_STAGES * phaseDelayAllpass(dispC, w0) : 0);
    // Integer part in the buffer, 0.5..1.5 samples left for the allpass.
    const N = Math.max(2, Math.min(MAX_DELAY - 2, Math.floor(target - filterDelay - 0.5)));
    voice.delayLen = N;
    const apCoef = allpassCoefFor(target - filterDelay - N, w0);

    // Loop gain so the FUNDAMENTAL decays 60 dB in T60 seconds, whatever the
    // filters take off it.
    const perTrip = Math.pow(0.001, 1 / (this._t60(voice) * this.sr / target));
    const filterMag = mag2tap(b0, b1, w0) * magOnePole(lpP, w0);
    const g = Math.min(0.99995, perTrip / filterMag);

    const pickupOffset = Math.max(1, Math.round(N * Math.max(0.02, p.pickup)));
    const usePickup = p.pickup > 0.02;
    const pan = ((voice.note % 12) / 12 - 0.5) * p.stereoWidth;
    const gL = VOICE_GAIN * (0.5 - pan) * 2, gR = VOICE_GAIN * (0.5 + pan) * 2;
    const d = voice.delay, dispX = voice.dispX, dispY = voice.dispY;
    let peak = 0;

    for (let s = 0; s < blockSize; s++) {
      const readIdx = (voice.writeIdx - N + MAX_DELAY) % MAX_DELAY;
      const s0 = d[readIdx], s1 = d[(readIdx + 1) % MAX_DELAY];

      let x = b0 * s0 + b1 * s1;                           // Brightness
      voice.lpY = (1 - lpP) * x + lpP * voice.lpY;         // Damping
      x = voice.lpY;
      if (dispC !== 0) {                                   // Inharm
        for (let k = 0; k < DISP_STAGES; k++) {
          const y = dispC * x + dispX[k] - dispC * dispY[k];
          dispX[k] = x; dispY[k] = y; x = y;
        }
      }
      const ap = apCoef * x + voice.apX - apCoef * voice.apY; // tuning
      voice.apX = x; voice.apY = ap;

      d[voice.writeIdx] = ap * g;
      voice.writeIdx = (voice.writeIdx + 1) % MAX_DELAY;

      // Pickup position: a comb that notches the harmonics with a node there.
      let out = ap;
      if (usePickup) out = (out + d[(voice.writeIdx - 1 - pickupOffset + MAX_DELAY) % MAX_DELAY]) * 0.5;

      voice.dcY = out - voice.dcX + 0.995 * voice.dcY;
      voice.dcX = out;
      const sample = voice.dcY;
      const a = sample < 0 ? -sample : sample;
      if (a > peak) peak = a;
      outL[s] += sample * gL;
      outR[s] += sample * gR;
    }
    this._retireIfSilent(voice, peak);
  }

  _processBowed(voice, outL, outR, blockSize) {
    // STK Bowed: the bow splits the string into a nut side and a bridge side;
    // at the bow the string sticks or slips according to the friction curve.
    const p = this.params;
    const bend = Math.pow(2, (p.pitchBend || 0) * (p.pitchBendRange || 2) / 12);
    const total = this.sr / (voice.freq * bend);
    const pole = 0.75 - 0.2 * 22050 / this.sr;
    // Loop = neck + bridge delays + the bridge filter's phase delay at f0.
    const baseDelay = Math.max(4, total - phaseDelayOnePole(pole, 2 * Math.PI / total));
    const beta = 0.06 + Math.min(0.5, Math.max(0, p.pickup)) * 0.6;   // bow position
    const bridgeLen = Math.max(1.5, baseDelay * beta);
    const neckLen = Math.max(1.5, baseDelay - bridgeLen);
    const loopGain = 0.94 + 0.055 * Math.min(1, Math.max(0, p.decay));
    const slope = 5 - 4 * (0.35 + 0.4 * (p.color ?? 0.5));             // bow pressure
    const maxVel = 0.03 + 0.2 * voice.velocity;
    const attack = 1 / (this.sr * (0.03 + 0.1 * (1 - (p.color ?? 0.5))));
    const releaseRate = 1 / (this.sr * (0.05 + (p.release ?? 0.3) * 0.6));
    const pan = ((voice.note % 12) / 12 - 0.5) * p.stereoWidth;
    const gL = VOICE_GAIN * 0.7 * (0.5 - pan) * 2, gR = VOICE_GAIN * 0.7 * (0.5 + pan) * 2;
    let peak = 0;

    const readFrac = (buf, idx, len) => {
      const pos = idx - len + MAX_DELAY * 2;
      const i0 = Math.floor(pos), f = pos - i0;
      return buf[i0 % MAX_DELAY] * (1 - f) + buf[(i0 + 1) % MAX_DELAY] * f;
    };

    for (let s = 0; s < blockSize; s++) {
      if (voice.released) voice.bowVel = Math.max(0, voice.bowVel - maxVel * releaseRate);
      else voice.bowVel = Math.min(maxVel, voice.bowVel + maxVel * attack);

      voice.bowFilt = (1 - pole) * voice.bridgeOut * loopGain + pole * voice.bowFilt;
      const bridgeRefl = -voice.bowFilt;
      const nutRefl = -voice.neckOut;
      const stringVel = bridgeRefl + nutRefl;
      const dv = voice.bowVel - stringVel;
      const newVel = voice.bowVel > 0 ? dv * bowTable(dv, slope) : 0;

      voice.neck[voice.neckIdx] = bridgeRefl + newVel;
      voice.bridge[voice.bridgeIdx] = nutRefl + newVel;
      voice.neckIdx = (voice.neckIdx + 1) % MAX_DELAY;
      voice.bridgeIdx = (voice.bridgeIdx + 1) % MAX_DELAY;
      voice.neckOut = readFrac(voice.neck, voice.neckIdx, neckLen);
      voice.bridgeOut = readFrac(voice.bridge, voice.bridgeIdx, bridgeLen);

      const out = voice.bridgeOut;
      voice.dcY = out - voice.dcX + 0.995 * voice.dcY;
      voice.dcX = out;
      const sample = voice.dcY;
      const a = sample < 0 ? -sample : sample;
      if (a > peak) peak = a;
      outL[s] += sample * gL;
      outR[s] += sample * gR;
    }
    this._retireIfSilent(voice, peak);
  }

  _retireIfSilent(voice, peak) {
    voice.time++;
    // Only a string that is decaying on its own may stop; allow the attack.
    if (peak < SILENCE && voice.time > 20) {
      if (++voice.quiet > 8) voice.active = false;
    } else voice.quiet = 0;
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

    const p = this.params;
    const body = p.bodyAmount > 0.01 ? p.bodyAmount : 0;
    if (body) { this.bodyL.setSize(p.bodySize); this.bodyR.setSize(p.bodySize); }
    const vol = p.masterVolume;
    for (let s = 0; s < blockSize; s++) {
      let L = outL[s], R = outR[s];
      if (body) {
        L += this.bodyL.tick(L) * body;
        R += this.bodyR.tick(R) * body;
      }
      L *= vol; R *= vol;
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);
      // Soft knee above -1 dB instead of a hard clip.
      outL[s] = softLimit(L);
      outR[s] = softLimit(R);
    }
    return true;
  }
}

function softLimit(x) {
  const a = x < 0 ? -x : x;
  if (a <= 0.89) return x;
  const y = 0.89 + 0.11 * Math.tanh((a - 0.89) / 0.11);
  return x < 0 ? -y : y;
}

registerProcessor('pm-synth-processor', PMSynthProcessor);
