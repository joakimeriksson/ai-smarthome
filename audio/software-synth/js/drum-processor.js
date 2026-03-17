// Drum Machine AudioWorklet Processor
// 8 synthesis channels, 16-step sequencer, analog drum synthesis (808/909 style)

const TWO_PI = 2 * Math.PI;
const NUM_CHANNELS = 8;
const NUM_STEPS = 16;

// ─── Drum Voice Synthesis ───────────────────────────────────────────────────

class DrumVoice {
  constructor(sr) {
    this.sr = sr;
    this.active = false;
    this.phase = 0;
    this.phase2 = 0;  // second oscillator
    this.time = 0;
    this.velocity = 0;
    this.noiseState = 0x12345;
    this.lp1 = 0;     // filter states
    this.lp2 = 0;
  }

  trigger(velocity) {
    this.active = true;
    this.phase = 0;
    this.phase2 = 0;
    this.time = 0;
    this.velocity = velocity;
    this.lp1 = 0;
    this.lp2 = 0;
    this.noiseState = (Math.random() * 0xFFFFFF) | 1; // randomize for variety
  }

  _noise() {
    this.noiseState ^= this.noiseState << 13;
    this.noiseState ^= this.noiseState >> 17;
    this.noiseState ^= this.noiseState << 5;
    return ((this.noiseState & 0xFFFF) / 32768 - 1);
  }

  process(type, params) {
    if (!this.active) return 0;
    this.time++;
    const t = this.time / this.sr;
    const dcy = 0.05 + params.decay * 0.8;
    let out = 0;

    switch (type) {
      case 0: { // KICK — 808/909 style
        // Sub body: sine with fast pitch drop
        const pitchEnv = Math.exp(-t / 0.015);
        const freq = params.tone + params.tone * 4 * pitchEnv;
        this.phase += freq / this.sr;
        const bodyEnv = Math.exp(-t / (dcy * 2));
        const body = Math.sin(TWO_PI * this.phase) * bodyEnv;

        // Click transient: short burst for attack
        const clickEnv = Math.exp(-t / 0.003);
        const click = this._noise() * clickEnv * params.color;

        // Combine: body gives weight, click gives punch
        out = body * 0.9 + click * 0.3;
        break;
      }
      case 1: { // SNARE
        // Body: low sine for weight
        const freq = params.tone;
        this.phase += freq / this.sr;
        const bodyEnv = Math.exp(-t / (dcy * 0.25));
        const body = Math.sin(TWO_PI * this.phase) * bodyEnv;

        // Snare wires: filtered noise
        const wireEnv = Math.exp(-t / (dcy * 0.5));
        let wires = this._noise() * wireEnv;
        // Bandpass: LP then subtract LP (= HP)
        this.lp1 += 0.3 * (wires - this.lp1);   // LP at ~2kHz
        this.lp2 += 0.05 * (this.lp1 - this.lp2); // LP at ~400Hz
        wires = this.lp1 - this.lp2;              // BP = mid frequencies

        // Hit transient
        const hitEnv = Math.exp(-t / 0.005);
        const hit = this._noise() * hitEnv;

        out = body * (1 - params.color) * 0.6 + wires * (0.4 + params.color * 0.5) + hit * 0.15;
        break;
      }
      case 2: { // CLOSED HI-HAT — short, bright
        const env = Math.exp(-t / (dcy * 0.08));
        let n = this._noise();
        // Highpass: subtract lowpassed version
        this.lp1 += 0.08 * (n - this.lp1);
        out = (n - this.lp1) * env * 0.7;
        break;
      }
      case 3: { // OPEN HI-HAT — longer, shimmer
        const env = Math.exp(-t / (dcy * 0.5));
        let n = this._noise();
        this.lp1 += 0.08 * (n - this.lp1);
        out = (n - this.lp1) * env * 0.6;
        break;
      }
      case 4: { // CLAP — 3 bursts + reverby tail
        let n = this._noise();
        let env;
        if (t < 0.025) {
          // Three sharp bursts at 0ms, 8ms, 18ms
          const burst = (t < 0.004) || (t > 0.008 && t < 0.012) || (t > 0.018 && t < 0.022);
          env = burst ? 1.0 : 0.05;
        } else {
          env = Math.exp(-(t - 0.025) / (dcy * 0.35));
        }
        // Bandpass for hand-clap character
        this.lp1 += 0.25 * (n * env - this.lp1);
        this.lp2 += 0.03 * (this.lp1 - this.lp2);
        out = (this.lp1 - this.lp2) * 0.8;
        break;
      }
      case 5: { // TOM — pitched body
        const pitchEnv = Math.exp(-t / 0.03);
        const freq = params.tone + params.tone * 1.5 * pitchEnv;
        this.phase += freq / this.sr;
        const env = Math.exp(-t / (dcy * 0.6));
        const body = Math.sin(TWO_PI * this.phase) * env;
        // Click
        const click = this._noise() * Math.exp(-t / 0.003) * 0.2;
        out = body * 0.8 + click;
        break;
      }
      case 6: { // RIM SHOT — sharp metallic click
        const env = Math.exp(-t / (dcy * 0.06));
        // Two high frequencies for metallic ring
        const f1 = params.tone * 3.5;
        const f2 = params.tone * 5.1;
        this.phase += f1 / this.sr;
        this.phase2 += f2 / this.sr;
        const ring = (Math.sin(TWO_PI * this.phase) + Math.sin(TWO_PI * this.phase2)) * 0.3;
        // Sharp transient
        const click = (t < 0.0005) ? 1 : 0;
        out = (ring + click * 0.5) * env;
        break;
      }
      case 7: { // COWBELL — 808 style: two square waves, bandpassed
        const env = Math.exp(-t / (dcy * 0.35));
        const f1 = 545;  // 808 cowbell frequencies
        const f2 = 815;
        this.phase += f1 / this.sr;
        this.phase2 += f2 / this.sr;
        const sq = (Math.sin(TWO_PI * this.phase) > 0 ? 1 : -1)
                 + (Math.sin(TWO_PI * this.phase2) > 0 ? 1 : -1);
        // Bandpass
        this.lp1 += 0.1 * (sq * 0.25 * env - this.lp1);
        this.lp2 += 0.02 * (this.lp1 - this.lp2);
        out = this.lp1 - this.lp2;
        break;
      }
    }

    if (t > 4 || (t > 0.1 && Math.abs(out) < 0.00005)) this.active = false;
    return out * this.velocity;
  }
}

// ─── Main Processor ─────────────────────────────────────────────────────────

class DrumMachineProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;

    // Drum voices
    this.drumVoices = [];
    for (let i = 0; i < NUM_CHANNELS; i++) this.drumVoices.push(new DrumVoice(this.sr));

    // Channel params
    this.channels = [
      { type: 0, tone: 50, decay: 0.5, color: 0.3, level: 0.8, pan: 0 },    // Kick
      { type: 1, tone: 180, decay: 0.5, color: 0.6, level: 0.8, pan: 0 },    // Snare
      { type: 2, tone: 300, decay: 0.3, color: 0.5, level: 0.7, pan: 0.2 },  // Closed HH
      { type: 3, tone: 300, decay: 0.5, color: 0.5, level: 0.6, pan: 0.2 },  // Open HH
      { type: 4, tone: 200, decay: 0.5, color: 0.5, level: 0.7, pan: -0.1 }, // Clap
      { type: 5, tone: 100, decay: 0.5, color: 0.5, level: 0.8, pan: -0.2 }, // Tom
      { type: 6, tone: 400, decay: 0.3, color: 0.5, level: 0.6, pan: 0.1 },  // Rim
      { type: 7, tone: 540, decay: 0.4, color: 0.5, level: 0.6, pan: 0.3 },  // Cowbell
    ];

    // Sequencer
    this.pattern = new Array(NUM_CHANNELS).fill(null).map(() => new Uint8Array(NUM_STEPS));
    this.playing = false;
    this.bpm = 120;
    this.swing = 0;
    this.currentStep = 0;
    this.sampleCounter = 0;
    this.samplesPerStep = 0;
    this._calcTiming();

    this.masterVolume = 0.8;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _calcTiming() {
    // 16th notes: 4 steps per beat
    this.samplesPerStep = Math.round(this.sr * 60 / (this.bpm * 4));
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'trigger': {
        const ch = msg.channel;
        if (ch >= 0 && ch < NUM_CHANNELS) {
          this.drumVoices[ch].trigger(msg.velocity || 1.0);
          // Closed hat chokes open hat
          if (this.channels[ch].type === 2) this.drumVoices[3].active = false;
        }
        break;
      }
      case 'setPattern': {
        // Set full pattern: msg.pattern = array of 8 arrays of 16 values
        if (msg.pattern) {
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            for (let s = 0; s < NUM_STEPS; s++) {
              this.pattern[ch][s] = msg.pattern[ch] ? (msg.pattern[ch][s] || 0) : 0;
            }
          }
        }
        break;
      }
      case 'setStep': {
        // Toggle single step
        const { channel, step, value } = msg;
        if (channel >= 0 && channel < NUM_CHANNELS && step >= 0 && step < NUM_STEPS) {
          this.pattern[channel][step] = value;
        }
        break;
      }
      case 'play': { this.playing = true; this.currentStep = 0; this.sampleCounter = 0; break; }
      case 'stop': { this.playing = false; break; }
      case 'param': {
        const { param, value } = msg;
        if (param === 'bpm') { this.bpm = value; this._calcTiming(); }
        else if (param === 'swing') { this.swing = value; }
        else if (param === 'masterVolume') { this.masterVolume = value; }
        else if (param.startsWith('ch.')) {
          const parts = param.split('.');
          const ch = parseInt(parts[1]);
          const field = parts[2];
          if (this.channels[ch]) this.channels[ch][field] = value;
        }
        break;
      }
      case 'preset': {
        if (msg.channels) this.channels = msg.channels.map(c => ({...c}));
        if (msg.pattern) {
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            for (let s = 0; s < NUM_STEPS; s++) {
              this.pattern[ch][s] = msg.pattern[ch] ? (msg.pattern[ch][s] || 0) : 0;
            }
          }
        }
        if (msg.bpm) { this.bpm = msg.bpm; this._calcTiming(); }
        break;
      }
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const outL = output[0], outR = output[1];
    const blockSize = outL.length;
    outL.fill(0); outR.fill(0);

    for (let s = 0; s < blockSize; s++) {
      // Sequencer tick
      if (this.playing) {
        if (this.sampleCounter <= 0) {
          // Trigger step
          for (let ch = 0; ch < NUM_CHANNELS; ch++) {
            if (this.pattern[ch][this.currentStep]) {
              this.drumVoices[ch].trigger(this.pattern[ch][this.currentStep] / 127);
              // Hi-hat choke: closed hat (ch2) kills open hat (ch3)
              if (this.channels[ch].type === 2) {
                this.drumVoices[3].active = false;
              }
            }
          }
          this.port.postMessage({ type: 'step', step: this.currentStep });

          // Advance step with swing
          const isOdd = this.currentStep % 2 === 1;
          const swingOffset = isOdd ? Math.round(this.samplesPerStep * this.swing * 0.5) : 0;
          this.sampleCounter = this.samplesPerStep + swingOffset;
          this.currentStep = (this.currentStep + 1) % NUM_STEPS;
        }
        this.sampleCounter--;
      }

      // Mix all drum voices
      let L = 0, R = 0;
      for (let ch = 0; ch < NUM_CHANNELS; ch++) {
        const sample = this.drumVoices[ch].process(this.channels[ch].type, this.channels[ch]);
        const level = this.channels[ch].level;
        const pan = this.channels[ch].pan;
        L += sample * level * (0.5 - pan * 0.5);
        R += sample * level * (0.5 + pan * 0.5);
      }

      // Soft mix with headroom — scale down to prevent clipping
      outL[s] = Math.max(-1, Math.min(1, L * this.masterVolume * 0.5));
      outR[s] = Math.max(-1, Math.min(1, R * this.masterVolume * 0.5));
    }

    return true;
  }
}

registerProcessor('drum-machine-processor', DrumMachineProcessor);
