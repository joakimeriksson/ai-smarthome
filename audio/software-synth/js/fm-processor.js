// FM Synth AudioWorklet Processor — DX7-style 6-operator FM synthesis
// 8 algorithms, per-operator ADSR, feedback, LFO, 8-voice polyphony

const NUM_VOICES = 8;
const NUM_OPS = 6;
const TWO_PI = 2 * Math.PI;

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

const ENV_OFF = 0, ENV_ATTACK = 1, ENV_DECAY = 2, ENV_SUSTAIN = 3, ENV_RELEASE = 4;

class Envelope {
  constructor(sr) {
    this.sr = sr; this.stage = ENV_OFF; this.level = 0;
    this.attack = 0.01; this.decay = 0.3; this.sustain = 0.7; this.release = 0.3;
    this.aCoeff = 0; this.dCoeff = 0; this.rCoeff = 0;
    this._recalc();
  }
  _recalc() {
    this.aCoeff = this.attack < 0.001 ? 1 : 1 - Math.exp(-1 / (this.attack * this.sr));
    this.dCoeff = this.decay < 0.001 ? 1 : 1 - Math.exp(-1 / (this.decay * this.sr));
    this.rCoeff = this.release < 0.001 ? 1 : 1 - Math.exp(-1 / (this.release * this.sr));
  }
  setParams(a, d, s, r) { this.attack = a; this.decay = d; this.sustain = s; this.release = r; this._recalc(); }
  gate(on) { if (on) this.stage = ENV_ATTACK; else if (this.stage !== ENV_OFF) this.stage = ENV_RELEASE; }
  process() {
    switch (this.stage) {
      case ENV_ATTACK:
        this.level += (1.05 - this.level) * this.aCoeff;
        if (this.level >= 1.0) { this.level = 1.0; this.stage = ENV_DECAY; } break;
      case ENV_DECAY:
        this.level += (this.sustain - this.level) * this.dCoeff;
        if (Math.abs(this.level - this.sustain) < 0.0001) { this.level = this.sustain; this.stage = ENV_SUSTAIN; } break;
      case ENV_SUSTAIN: this.level = this.sustain; break;
      case ENV_RELEASE:
        this.level += -this.level * this.rCoeff;
        if (this.level < 0.0001) { this.level = 0; this.stage = ENV_OFF; } break;
    }
    return this.level;
  }
  isActive() { return this.stage !== ENV_OFF; }
}

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

class Chorus {
  constructor(sr) {
    this.sr = sr; this.mix = 0.3; this.rate = 0.5; this.depth = 0.005; this.enabled = false;
    const m = Math.ceil(sr * 0.03);
    this.bufL = new Float32Array(m); this.bufR = new Float32Array(m);
    this.bufSize = m; this.writeIdx = 0; this.phase = 0;
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    this.bufL[this.writeIdx] = inL; this.bufR[this.writeIdx] = inR;
    this.phase += this.rate / this.sr; if (this.phase >= 1) this.phase -= 1;
    const m1 = Math.sin(TWO_PI * this.phase) * this.depth * this.sr;
    const m2 = Math.sin(TWO_PI * this.phase + Math.PI) * this.depth * this.sr;
    const read = (buf, d) => { const p = this.writeIdx - d, i = Math.floor(p), f = p - i; const a = ((i % this.bufSize) + this.bufSize) % this.bufSize, b = ((i+1) % this.bufSize + this.bufSize) % this.bufSize; return buf[a] + f * (buf[b] - buf[a]); };
    const oL = inL + this.mix * read(this.bufL, 0.007*this.sr+m1);
    const oR = inR + this.mix * read(this.bufR, 0.007*this.sr+m2);
    this.writeIdx = (this.writeIdx + 1) % this.bufSize;
    return [oL, oR];
  }
}

class StereoDelay {
  constructor(sr) {
    this.sr = sr; this.mix = 0.3; this.feedback = 0.4; this.timeL = 0.375; this.timeR = 0.5; this.enabled = false;
    const m = Math.ceil(sr * 2);
    this.bufL = new Float32Array(m); this.bufR = new Float32Array(m);
    this.bufSize = m; this.writeIdx = 0; this.lpL = 0; this.lpR = 0;
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    const dL = Math.floor(this.timeL*this.sr), dR = Math.floor(this.timeR*this.sr);
    const iL = ((this.writeIdx-dL)%this.bufSize+this.bufSize)%this.bufSize;
    const iR = ((this.writeIdx-dR)%this.bufSize+this.bufSize)%this.bufSize;
    let tL = this.bufL[iL], tR = this.bufR[iR];
    this.lpL += 0.3*(tL-this.lpL); this.lpR += 0.3*(tR-this.lpR); tL = this.lpL; tR = this.lpR;
    this.bufL[this.writeIdx] = inL + tR*this.feedback; this.bufR[this.writeIdx] = inR + tL*this.feedback;
    this.writeIdx = (this.writeIdx + 1) % this.bufSize;
    return [inL + tL*this.mix, inR + tR*this.mix];
  }
}

class Freeverb {
  constructor(sr) {
    this.sr = sr; this.mix = 0.2; this.roomSize = 0.8; this.damping = 0.5; this.enabled = false;
    const scale = sr / 44100;
    const combLens = [1116,1188,1277,1356,1422,1491,1557,1617].map(n => Math.round(n*scale));
    const apLens = [556,441,341,225].map(n => Math.round(n*scale));
    this.combsL = combLens.map(n => ({buf:new Float32Array(n),idx:0,len:n,filt:0}));
    this.combsR = combLens.map(n => {const l=n+Math.round(23*scale);return{buf:new Float32Array(l),idx:0,len:l,filt:0};});
    this.apsL = apLens.map(n => ({buf:new Float32Array(n),idx:0,len:n}));
    this.apsR = apLens.map(n => {const l=n+Math.round(23*scale);return{buf:new Float32Array(l),idx:0,len:l};});
  }
  process(inL, inR) {
    if (!this.enabled) return [inL, inR];
    const input = (inL+inR)*0.5, fb = this.roomSize*0.28+0.7, d1 = this.damping*0.4, d2 = 1-d1;
    let outL = 0, outR = 0;
    for (let i = 0; i < 8; i++) {
      const cL = this.combsL[i]; const sL = cL.buf[cL.idx]; cL.filt = sL*d2+cL.filt*d1; cL.buf[cL.idx] = input+cL.filt*fb; cL.idx = (cL.idx+1)%cL.len; outL += sL;
      const cR = this.combsR[i]; const sR = cR.buf[cR.idx]; cR.filt = sR*d2+cR.filt*d1; cR.buf[cR.idx] = input+cR.filt*fb; cR.idx = (cR.idx+1)%cR.len; outR += sR;
    }
    for (let i = 0; i < 4; i++) {
      const aL = this.apsL[i]; const bL = aL.buf[aL.idx]; aL.buf[aL.idx] = outL+bL*0.5; outL = bL-outL; aL.idx = (aL.idx+1)%aL.len;
      const aR = this.apsR[i]; const bR = aR.buf[aR.idx]; aR.buf[aR.idx] = outR+bR*0.5; outR = bR-outR; aR.idx = (aR.idx+1)%aR.len;
    }
    const wet = this.mix, dry = 1-wet;
    return [inL*dry+outL*wet, inR*dry+outR*wet];
  }
}

function fastTanh(x) { if (x < -3) return -1; if (x > 3) return 1; const x2 = x*x; return x*(27+x2)/(27+9*x2); }

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
