// Physical Modeling Synth AudioWorklet Processor
// Karplus-Strong with extended controls: exciter types, body resonance, damping, pickup position

const NUM_VOICES = 8;
const TWO_PI = 2 * Math.PI;
const MAX_DELAY = 4096; // enough for ~12Hz at 48kHz

// ─── Karplus-Strong Voice ───────────────────────────────────────────────────

class KSVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.note = 0;
    this.velocity = 0;
    this.energy = 0; // tracks remaining energy for isActive

    // Delay line (circular buffer)
    this.delay = new Float32Array(MAX_DELAY);
    this.delayLen = 100;
    this.writeIdx = 0;

    // Feedback filter state
    this.lpState = 0;

    // Body resonator (second short delay for body)
    this.bodyDelay = new Float32Array(512);
    this.bodyLen = 50;
    this.bodyIdx = 0;
    this.bodyState = 0;

    // Exciter state
    this.exciterSamples = 0;
    this.exciterPhase = 0;

    // DC blocker
    this.dcX = 0;
    this.dcY = 0;
  }

  noteOn(note, velocity, params) {
    this.active = true;
    this.note = note;
    this.velocity = velocity / 127;
    this.energy = 1.0;

    const freq = 440 * Math.pow(2, (note - 69) / 12);
    this.delayLen = Math.max(2, Math.round(this.sr / freq));

    // Clear delay line
    this.delay.fill(0);
    // writeIdx will be set to delayLen after exciter fill,
    // so first read comes from index 0 (start of exciter signal)
    this.lpState = 0;
    this.dcX = 0;
    this.dcY = 0;

    // Body resonator tuned slightly off from main string
    const bodyRatio = params.bodySize || 0.5;
    this.bodyLen = Math.max(2, Math.round(this.delayLen * (0.3 + bodyRatio * 0.7)));
    this.bodyDelay.fill(0);
    this.bodyIdx = 0;
    this.bodyState = 0;

    // Fill delay line with exciter signal
    const exciterType = params.exciter || 0;
    const color = params.color || 0.5;
    this.exciterSamples = 0;
    this.exciterPhase = 0;
    this.time = 0;

    if (exciterType === 0) {
      // Pluck: filtered noise burst
      let prev = 0;
      for (let i = 0; i < this.delayLen; i++) {
        let n = Math.random() * 2 - 1;
        // Color filter: low = dark, high = bright
        n = prev + color * (n - prev);
        prev = n;
        this.delay[i] = n * this.velocity;
      }
    } else if (exciterType === 1) {
      // Strike: short impulse + harmonics
      const strikeLen = Math.min(this.delayLen, Math.round(this.sr * 0.002));
      for (let i = 0; i < strikeLen; i++) {
        const t = i / strikeLen;
        this.delay[i] = Math.sin(Math.PI * t) * this.velocity * (1 - t * 0.5);
      }
    } else if (exciterType === 2) {
      // Bow: initial noise + continuous excitation (handled in process)
      for (let i = 0; i < this.delayLen; i++) {
        this.delay[i] = (Math.random() * 2 - 1) * 0.1 * this.velocity;
      }
      this.exciterSamples = Math.round(this.sr * 60); // sustain up to 60s (until noteOff)
    } else if (exciterType === 3) {
      // Hammer: strong short excitation with body thump
      const hammerLen = Math.min(this.delayLen, Math.round(this.sr * 0.005));
      for (let i = 0; i < hammerLen; i++) {
        const t = i / hammerLen;
        const window = Math.sin(Math.PI * t);
        this.delay[i] = (window * 0.7 + (Math.random() * 2 - 1) * 0.3) * this.velocity * window;
      }
    }

    // Start writing AFTER the exciter data so first read comes from index 0
    this.writeIdx = this.delayLen;
  }

  noteOff() {
    // Quick damp for bowed strings
    this.exciterSamples = 0;
  }

  isActive() { return this.active && this.energy > 0.0001; }
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
      brightness: 0.5, // feedback filter 0=dark, 1=bright
      decay: 0.7,      // feedback amount (sustain length)
      damping: 0.3,    // high-freq damping rate
      bodyAmount: 0.0,  // body resonance mix 0-1
      bodySize: 0.5,   // body resonator size
      pickup: 0.13,    // pickup position along string (0-0.5)
      inharm: 0.0,     // inharmonicity (string stiffness)
      stereoWidth: 0.3,// stereo spread
      masterVolume: 0.8,
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

  _processVoice(voice, outL, outR, blockSize) {
    if (!voice.isActive()) return;
    const p = this.params;
    const dLen = voice.delayLen;

    // Classic Karplus-Strong: read two adjacent samples, average them (lowpass),
    // apply a loss factor, write back. The averaging IS the lowpass filter.
    // Brightness controls the mix between pure average (dark) and original (bright).
    // Decay loss is per-cycle, not per-sample: we want feedback very close to 1.0.

    // Per-CYCLE loss: decay 0=very short, 1=very long
    // At 48kHz with dLen=183 (C4), we want ~1-5 seconds of audible decay
    // loss_per_sample = loss_per_cycle ^ (1/dLen)
    const decaySeconds = 0.1 + p.decay * 8; // 0.1 to 8 seconds
    const cyclesForDecay = decaySeconds * (this.sr / dLen); // how many cycles in that time
    const lossPerCycle = Math.pow(0.001, 1 / cyclesForDecay); // -60dB in decaySeconds
    const lossPerSample = Math.pow(lossPerCycle, 1 / dLen);

    // Brightness: 0 = heavy averaging (dark, fast HF decay), 1 = minimal averaging (bright)
    const avgMix = 1 - p.brightness * 0.9; // 1.0 = full average, 0.1 = mostly original

    // Damping: extra HF loss
    const dampLoss = 1 - p.damping * 0.3 / dLen;

    // Pickup position
    const pickupOffset = Math.max(1, Math.round(dLen * Math.max(0.02, p.pickup)));

    for (let s = 0; s < blockSize; s++) {
      // Read from delay line: current sample and next sample for averaging
      const readIdx = (voice.writeIdx - dLen + MAX_DELAY) % MAX_DELAY;
      const readIdx2 = (readIdx + 1) % MAX_DELAY;
      const s0 = voice.delay[readIdx];
      const s1 = voice.delay[readIdx2];

      // Karplus-Strong averaging filter: blend between s0 and average(s0,s1)
      let out = s0 * (1 - avgMix) + (s0 + s1) * 0.5 * avgMix;

      // Pickup position: comb filter
      if (p.pickup > 0.02) {
        const pickIdx = (voice.writeIdx - pickupOffset + MAX_DELAY) % MAX_DELAY;
        out = (out + voice.delay[pickIdx]) * 0.5;
      }

      // Bow exciter: continuous energy injection (sustains until noteOff)
      if (voice.exciterSamples > 0) {
        voice.exciterSamples--;
        // Attack ramp over ~50ms, then sustain
        const elapsed = voice.time - voice.exciterSamples;
        const attackRamp = Math.min(1, (voice.time || 0) / (this.sr * 0.05));
        // Bow friction: filtered noise that reinforces the string vibration
        const bowNoise = (Math.random() * 2 - 1) * 0.15 * voice.velocity * attackRamp;
        // Inject energy proportional to how quiet the string is (self-regulating)
        const currentEnergy = Math.abs(out);
        const targetEnergy = 0.3 * voice.velocity;
        const injection = currentEnergy < targetEnergy ? bowNoise : bowNoise * 0.1;
        out += injection;
      }
      voice.time++;

      // Apply per-sample loss and damping
      const filtered = out * lossPerSample * dampLoss;

      // Write back to delay line
      voice.delay[voice.writeIdx] = filtered;
      voice.writeIdx = (voice.writeIdx + 1) % MAX_DELAY;

      // Body resonance
      let bodySample = 0;
      if (p.bodyAmount > 0.01) {
        const bodyRead = (voice.bodyIdx - voice.bodyLen + 512) % 512;
        bodySample = voice.bodyDelay[bodyRead];
        voice.bodyState = voice.bodyState + 0.3 * (bodySample - voice.bodyState);
        voice.bodyDelay[voice.bodyIdx] = out * 0.3 + voice.bodyState * 0.7;
        voice.bodyIdx = (voice.bodyIdx + 1) % 512;
      }

      // DC blocker
      voice.dcY = out - voice.dcX + 0.995 * voice.dcY;
      voice.dcX = out;
      let sample = voice.dcY + bodySample * p.bodyAmount;

      // Track energy
      voice.energy = voice.energy * 0.9999 + Math.abs(sample) * 0.0001;
      if (voice.energy < 0.00001 && voice.exciterSamples <= 0) voice.active = false;

      // Stereo
      const pan = ((voice.note % 12) / 12 - 0.5) * p.stereoWidth;
      outL[s] += sample * (0.5 - pan);
      outR[s] += sample * (0.5 + pan);
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

registerProcessor('pm-synth-processor', PMSynthProcessor);
