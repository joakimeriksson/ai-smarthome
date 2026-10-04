// FM Synth AudioWorklet Processor — DX7-style 6-operator FM synthesis
// 8 algorithms, per-operator ADSR, feedback, LFO, 8-voice polyphony

import {
  Envelope,
  Chorus,
  StereoDelay,
  Freeverb,
  TWO_PI,
  ENV_OFF,
  ENV_ATTACK,
  ENV_DECAY,
  ENV_SUSTAIN,
  ENV_RELEASE,
} from './dsp-lib.js';

const NUM_VOICES = 8;
const NUM_OPS = 6;

// Operators run at 2x the output rate; a Kaiser-windowed sinc (flat to
// ~0.41 fs, >= 80 dB down from ~0.59 fs) brings them back down. This used to
// be "compute twice and average" — a 2-tap boxcar that is only -5 dB at a
// 30 kHz sideband before folding it to 18 kHz. Measured 2026-09-24:
// OP6 feedback >= 0.75 settles into a period-3 limit cycle at 1/3 of the
// internal rate (32 kHz); the boxcar folded it to 16 kHz, so 14-43 % of a
// high-feedback tone was a non-harmonic whine. The filter removes it (<0.2 %)
// and cuts inharmonic fold-back on the bells from ~-41 dB to below -80 dB.
// 4x was measured too: no audible gain over 2x, at 1.7x the CPU.
const OVERSAMPLE = 2;
function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 50; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break; } return s; }
function designDecimator(os) {
  const trans = 0.18 / os;                 // transition width, normalised to the internal rate
  const atten = 80, beta = 0.1102 * (atten - 8.7);
  let n = Math.ceil((atten - 8) / (2.285 * 2 * Math.PI * trans)) | 1;
  const fc = 0.5 / os, taps = new Float64Array(n), mid = (n - 1) / 2, i0b = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid, r = x / mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    taps[i] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
    sum += taps[i];
  }
  for (let i = 0; i < n; i++) taps[i] /= sum;  // unity DC gain: levels unchanged
  return taps;
}

// ─── Algorithms ─────────────────────────────────────────────────────────────
// mod[opIdx] = array of operator indices that modulate this op
// carriers = which ops output to the mix
// Process order: always 5,4,3,2,1,0 (high to low, so modulators compute first)

const ALGORITHMS = [
  { // 1: Chain 6→5→4→3→2→1
    mod: [[1],[2],[3],[4],[5],[]], carriers: [0] },
  { // 2: (5→4→3 + 2)→1, 6→5
    mod: [[1,2],[],[3],[4],[5],[]], carriers: [0] },
  { // 3: (6→5, 4→3)→2→1
    mod: [[1],[2,4],[3],[],[5],[]], carriers: [0] },
  { // 4: 6→5→4, 3→2, 1 (three outputs)
    mod: [[],[2],[],[4],[5],[]], carriers: [0,1,3] },
  { // 5: 6→5, 4→3, 2, 1 (four outputs)
    mod: [[],[],[3],[],[5],[]], carriers: [0,1,2,4] },
  { // 6: 6→(5,4,3,2), 1 (shared modulator)
    mod: [[],[5],[5],[5],[5],[]], carriers: [0,1,2,3,4] },
  { // 7: 6→5, 4→3, 2→1 (three pairs)
    mod: [[1],[],[3],[],[5],[]], carriers: [0,2,4] },
  { // 8: All carriers (additive)
    mod: [[],[],[],[],[],[]], carriers: [0,1,2,3,4,5] },
];

// ─── Envelope ───────────────────────────────────────────────────────────────


// ─── LFO ────────────────────────────────────────────────────────────────────

class LFO {
  constructor(sr) { this.sr = sr; this.phase = 0; this.rate = 4; this.waveform = 0; this.value = 0; this._sh = 0; this._prev = 0; }
  reset() { this.phase = 0; }
  process() {
    this._prev = this.phase; this.phase += this.rate / this.sr; if (this.phase >= 1) this.phase -= 1;
    switch (this.waveform) {
      case 0: this.value = Math.sin(TWO_PI * this.phase); break;
      case 1: this.value = this.phase < 0.5 ? 4*this.phase-1 : 3-4*this.phase; break;
      case 2: this.value = this.phase < 0.5 ? 1 : -1; break;
      case 3: if (this.phase < this._prev) this._sh = Math.random()*2-1; this.value = this._sh; break;
    }
    return this.value;
  }
}

// ─── FM Voice ───────────────────────────────────────────────────────────────

class FMVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.note = 0;
    this.velocity = 0;
    this.phases = new Float64Array(NUM_OPS);
    this.outputs = new Float64Array(NUM_OPS);
    this.prevOutputs = new Float64Array(NUM_OPS); // for feedback
    this.envs = [];
    for (let i = 0; i < NUM_OPS; i++) this.envs.push(new Envelope(sr));
    this.lfo = new LFO(sr);
    this._dt = new Float64Array(NUM_OPS);
    this._amp = new Float64Array(NUM_OPS);
    this._on = new Array(NUM_OPS).fill(false);
  }

  noteOn(note, velocity) {
    // Key sync: restart the operators only from silence. Re-using a voice that
    // is still sounding (retrigger, a releasing voice picked by the pool, a
    // steal) keeps the phases running — zeroing them mid-waveform is a step
    // in the output, i.e. a click on every repeated note. Envelopes already
    // attack from their current level.
    const sounding = this.isActive();
    this.active = true;
    this.note = note;
    this.velocity = velocity / 127;
    for (let i = 0; i < NUM_OPS; i++) {
      if (!sounding) {
        this.phases[i] = 0;
        this.outputs[i] = 0;
        this.prevOutputs[i] = 0;
      }
      this.envs[i].gate(true);
    }
    if (!sounding) this.lfo.reset();
  }

  noteOff() {
    for (let i = 0; i < NUM_OPS; i++) this.envs[i].gate(false);
  }

  isActive() {
    for (let i = 0; i < NUM_OPS; i++) if (this.envs[i].isActive()) return true;
    return false;
  }
}

// ─── Effects ────────────────────────────────────────────────────────────────

// ─── Main Processor ─────────────────────────────────────────────────────────

// Patch fields a preset may omit, and the FX parameters a preset may set.
const PATCH_DEFAULTS = { lfoRate: 4, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 };
const FX_DEFAULTS = {
  chorus: { enabled: false, mix: 0.3, rate: 0.5, depth: 0.005 },
  delay: { enabled: false, mix: 0.3, feedback: 0.4, timeL: 0.375, timeR: 0.5, damping: 0.3 },
  reverb: { enabled: false, mix: 0.2, roomSize: 0.8, damping: 0.5 },
};

class FMSynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = [];
    for (let i = 0; i < NUM_VOICES; i++) this.voices.push(new FMVoice(this.sr));

    this.params = {
      algorithm: 0, // 0-7
      feedback: 0.5, // 0-1 (op6 self-feedback)
      // Per-operator params: ops[0..5]
      ops: Array.from({length: NUM_OPS}, () => ({
        on: true, ratio: 1.0, fine: 1.0, level: 0.9,
        attack: 0.03045, decay: 2.072, sustain: 0.7, release: 2.072,
        velSens: 0.7
      })),
      // LFO
      lfoRate: 4, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
      // Master
      masterVolume: 0.7,
      pitchBend: 0, pitchBendRange: 2,
    };

    this.osBuf = new Float64Array(128 * OVERSAMPLE);
    this.decTaps = designDecimator(OVERSAMPLE);
    this.decHist = new Float64Array(this.decTaps.length * 2);
    this.decIdx = 0;
    this.dcR = Math.exp(-2 * Math.PI * 5 / this.sr);
    this.dcX1 = 0; this.dcY1 = 0;

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
        v.noteOn(msg.note, msg.velocity);
        // Apply operator envelope params
        for (let i = 0; i < NUM_OPS; i++) {
          const op = this.params.ops[i];
          v.envs[i].setParams(op.attack, op.decay, op.sustain, op.release);
          if (!op.on) { v.envs[i].stage = ENV_OFF; v.envs[i].level = 0; }
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
        if (param.startsWith('op.')) {
          // op.0.ratio, op.3.level, etc.
          const parts = param.split('.');
          const idx = parseInt(parts[1]);
          const field = parts[2];
          if (this.params.ops[idx]) this.params.ops[idx][field] = value;
        } else if (param.startsWith('fx.')) {
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
        // A preset is the whole patch: anything it leaves out goes back to
        // the default instead of leaking from the previous preset (the
        // op()-style factory presets omit lfoWaveform, and most name only the
        // FX they use — FM Bass after Strings used to keep Strings' reverb).
        // masterVolume and pitch bend are performance state and are kept.
        if (msg.params) {
          const { ops, ...rest } = msg.params;
          if (ops) this.params.ops = ops.map(op => ({...op}));
          Object.assign(this.params, PATCH_DEFAULTS, rest);
        }
        if (msg.fx) {
          const fx = msg.fx;
          Object.assign(this.chorus, FX_DEFAULTS.chorus, fx.chorus);
          Object.assign(this.delay, FX_DEFAULTS.delay, fx.delay);
          Object.assign(this.reverb, FX_DEFAULTS.reverb, fx.reverb);
        }
        break;
      }
    }
  }

  _processVoice(voice, os, blockSize) {
    if (!voice.isActive()) return;
    const p = this.params;
    const algo = ALGORITHMS[p.algorithm] || ALGORITHMS[0];
    const carriers = algo.carriers, numCarriers = carriers.length;
    const bendMult = p.pitchBend !== 0 ? Math.pow(2, p.pitchBend * p.pitchBendRange / 12) : 1;
    const baseFreq = 440 * Math.pow(2, (voice.note - 69) / 12) * bendMult;
    // 0.2 (was 0.1): with the shared reverb's gain fixed, FM sat ~15 dB under
    // VA/WS; +6 dB still leaves an 8-note chord at every preset below -1 dBFS.
    const outputScale = 0.2 / (Math.PI * numCarriers);
    const internalRate = this.sr * OVERSAMPLE;
    const fb = p.feedback;
    const ops = p.ops, phases = voice.phases, outs = voice.outputs, prevs = voice.prevOutputs;
    const dt = voice._dt, amp = voice._amp, on = voice._on;

    for (let s = 0; s < blockSize; s++) {
      // LFO (once per output sample)
      voice.lfo.rate = p.lfoRate;
      voice.lfo.waveform = p.lfoWaveform;
      const lfoVal = voice.lfo.process();
      const pitchMod = p.lfoPitchDepth * lfoVal;
      const ampMod = 1 + p.lfoAmpDepth * lfoVal;
      const freqMult = pitchMod !== 0 ? Math.pow(2, pitchMod / 12) : 1;

      // Per output sample: envelopes advance once, increments and gains are
      // held across the oversampled sub-steps.
      for (let i = 0; i < NUM_OPS; i++) {
        const op = ops[i];
        on[i] = op.on;
        if (!op.on) continue;
        dt[i] = baseFreq * op.ratio * op.fine * freqMult / internalRate;
        const velScale = 1 - op.velSens * (1 - voice.velocity);
        amp[i] = voice.envs[i].process() * op.level * velScale * Math.PI;
      }

      const gain = outputScale * ampMod;
      const o = s * OVERSAMPLE;
      for (let k = 0; k < OVERSAMPLE; k++) {
        // Process operators 5→0 (high to low, modulators first)
        for (let i = NUM_OPS - 1; i >= 0; i--) {
          if (!on[i]) { outs[i] = 0; continue; }
          let modSum = 0;
          const mods = algo.mod[i];
          for (let m = 0; m < mods.length; m++) modSum += outs[mods[m]];
          // Self-feedback (op6 only), DX7-style average of the last two outputs
          if (i === 5 && fb > 0) modSum += (outs[5] + prevs[5]) * 0.5 * fb;

          const sample = Math.sin(TWO_PI * phases[i] + modSum);
          prevs[i] = outs[i];
          outs[i] = sample * amp[i];
          phases[i] += dt[i];
          if (phases[i] >= 1) phases[i] -= 1;
        }
        let mix = 0;
        for (let c = 0; c < numCarriers; c++) mix += outs[carriers[c]];
        os[o + k] += mix * gain;
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;
    if (this.osBuf.length < blockSize * OVERSAMPLE) this.osBuf = new Float64Array(blockSize * OVERSAMPLE);
    const os = this.osBuf;
    os.fill(0, 0, blockSize * OVERSAMPLE);

    for (let i = 0; i < NUM_VOICES; i++) {
      this._processVoice(this.voices[i], os, blockSize);
    }

    const vol = this.params.masterVolume;
    const h = this.decHist, taps = this.decTaps, nt = taps.length;
    const dcR = this.dcR;
    for (let s = 0; s < blockSize; s++) {
      // Decimate: push OVERSAMPLE internal samples, one windowed-sinc output.
      // History is stored twice (idx and idx+nt) so the dot product never wraps.
      for (let k = 0; k < OVERSAMPLE; k++) {
        const x = os[s * OVERSAMPLE + k];
        this.decIdx = this.decIdx === 0 ? nt - 1 : this.decIdx - 1;
        h[this.decIdx] = x; h[this.decIdx + nt] = x;
      }
      let y = 0;
      for (let t = 0, j = this.decIdx; t < nt; t++, j++) y += h[j] * taps[t];
      // DC blocker (~5 Hz): 1:1 carrier/modulator pairs put a slowly drifting
      // offset on the output; the DX7's output is AC-coupled.
      const dc = y - this.dcX1 + dcR * this.dcY1;
      this.dcX1 = y; this.dcY1 = dc;

      let L = dc * vol, R = dc * vol;
      [L, R] = this.chorus.process(L, R);
      [L, R] = this.delay.process(L, R);
      [L, R] = this.reverb.process(L, R);
      outL[s] = Math.max(-1, Math.min(1, L));
      outR[s] = Math.max(-1, Math.min(1, R));
    }
    return true;
  }
}

registerProcessor('fm-synth-processor', FMSynthProcessor);
