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
    mod: [[1],[2],[3],[],[5],[]], carriers: [0] },
  { // 4: 6→5→4, 3→2, 1 (three outputs)
    mod: [[],[1],[3],[],[4],[5]], carriers: [0,1,3] },
  { // 5: 6→5, 4→3, 2, 1 (four outputs)
    mod: [[],[],[3],[],[5],[]], carriers: [0,1,2,3] },
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
  }

  noteOn(note, velocity) {
    this.active = true;
    this.note = note;
    this.velocity = velocity / 127;
    for (let i = 0; i < NUM_OPS; i++) {
      this.phases[i] = 0;
      this.outputs[i] = 0;
      this.prevOutputs[i] = 0;
      this.envs[i].gate(true);
    }
    this.lfo.reset();
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
        attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3,
        velSens: 0.7
      })),
      // LFO
      lfoRate: 4, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0,
      // Master
      masterVolume: 0.7,
      pitchBend: 0, pitchBendRange: 2,
    };

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
        if (msg.params) {
          // Deep copy ops array
          if (msg.params.ops) {
            this.params.ops = msg.params.ops.map(op => ({...op}));
            delete msg.params.ops;
          }
          Object.assign(this.params, msg.params);
        }
        if (msg.fx) {
          if (msg.fx.chorus) Object.assign(this.chorus, msg.fx.chorus);
          if (msg.fx.delay) Object.assign(this.delay, msg.fx.delay);
          if (msg.fx.reverb) Object.assign(this.reverb, msg.fx.reverb);
        }
        break;
      }
    }
  }

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.isActive()) return;
    const p = this.params;
    const algo = ALGORITHMS[p.algorithm];
    const numCarriers = algo.carriers.length;
    const bendMult = p.pitchBend !== 0 ? Math.pow(2, p.pitchBend * p.pitchBendRange / 12) : 1;
    const baseFreq = 440 * Math.pow(2, (voice.note - 69) / 12) * bendMult;
    const outputScale = 0.1 / (Math.PI * numCarriers);

    for (let s = 0; s < blockSize; s++) {
      // LFO (once per output sample)
      voice.lfo.rate = p.lfoRate;
      voice.lfo.waveform = p.lfoWaveform;
      const lfoVal = voice.lfo.process();
      const pitchMod = p.lfoPitchDepth * lfoVal;
      const ampMod = 1 + p.lfoAmpDepth * lfoVal;
      const freqMult = pitchMod !== 0 ? Math.pow(2, pitchMod / 12) : 1;

      // 2x oversampling: compute FM twice per output sample, average result
      let mixAccum = 0;
      for (let os = 0; os < 2; os++) {
        // Process operators 5→0 (high to low, modulators first)
        for (let i = NUM_OPS - 1; i >= 0; i--) {
          const op = p.ops[i];
          if (!op.on) { voice.outputs[i] = 0; continue; }

          const opFreq = baseFreq * op.ratio * op.fine * freqMult;
          const dt = opFreq / (this.sr * 2); // half step for 2x oversampling

          // Sum modulator inputs
          let modSum = 0;
          const mods = algo.mod[i];
          for (let m = 0; m < mods.length; m++) {
            modSum += voice.outputs[mods[m]];
          }

          // Self-feedback (op6 only)
          if (i === 5 && p.feedback > 0) {
            modSum += (voice.outputs[5] + voice.prevOutputs[5]) * 0.5 * p.feedback;
          }

          const sample = Math.sin(TWO_PI * voice.phases[i] + modSum);

          // Envelope (only advance on first oversample pass)
          const envLevel = os === 0 ? voice.envs[i].process() : voice.envs[i].level;
          const velScale = 1 - op.velSens * (1 - voice.velocity);

          voice.prevOutputs[i] = voice.outputs[i];
          voice.outputs[i] = sample * envLevel * op.level * velScale * Math.PI;

          voice.phases[i] += dt;
          if (voice.phases[i] >= 1) voice.phases[i] -= 1;
        }

        // Sum carriers for this oversample
        for (let c = 0; c < numCarriers; c++) {
          mixAccum += voice.outputs[algo.carriers[c]];
        }
      }

      // Average the 2 oversamples
      const mix = mixAccum * 0.5 * outputScale * ampMod;
      outL[s] += mix;
      outR[s] += mix;
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
      outL[s] = Math.max(-1, Math.min(1, L));
      outR[s] = Math.max(-1, Math.min(1, R));
    }
    return true;
  }
}

registerProcessor('fm-synth-processor', FMSynthProcessor);
