// AudioWorkletProcessor for jsSID rendering with sample-accurate execution context
// Note: This script runs in the AudioWorkletGlobalScope.

// Load only the minimal jsSID pieces we need for synthesis (TinySID)
try {
  importScripts('jsSID/js/jssid.core.js', 'jsSID/js/jssid.tinysid.js');
} catch (e) {
  // Let main thread handle fallback
}

class SidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = null;
    this.ready = false;
    this.sampleCounter = 0;
    this.regs = new Uint8Array(0x20); // small mirror for debug
    this.pattern = null; // pattern.data[voice][step] -> {note, instrument}
    this.patternLength = 16;
    this.instruments = [];
    this.currentStep = 0;
    this.bpm = 120;
    this.stepDurationSamples = 0;
    this.nextStepSample = 0;
    // Use a slightly longer retrigger gap to ensure the OFF phase is
    // observed by the envelope before re-opening the gate.
    this.retriggerGap = 256; // samples (~5.8ms @44.1k)
    this.pendingGateOns = []; // { sample: N, voice, value }
    this.voiceState = [0,1,2].map(() => ({ active:false, instrument:null, instrumentIndex:-1, baseHz:0, basePW:0x0800, pwmPhase:0, fmPhase:0, arpIdx:0, arpCounter:0 }));

    this.port.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'init') {
        try {
          // eslint-disable-next-line no-undef
          if (typeof jsSID === 'undefined' || typeof jsSID.TinySID === 'undefined') {
            throw new Error('TinySID not available in worklet');
          }
          this.synth = new jsSID.TinySID({
            sampleRate: sampleRate,
            memory: new Array(65536).fill(0)
          });
          this.ready = true;
          this.port.postMessage({ type: 'ready', payload: { sampleRate, blockSize: 128 } });
        } catch (e) {
          this.port.postMessage({ type: 'error', payload: String(e) });
        }
      } else if (type === 'loadPattern') {
        // payload: { pattern, patternLength, instruments }
        this.pattern = payload.pattern;
        this.patternLength = payload.patternLength >>> 0;
        this.instruments = payload.instruments || [];
      } else if (type === 'updateInstruments') {
        // Live update of instrument parameters during playback
        const list = (payload && payload.instruments) || [];
        this.instruments = list;
        // Refresh active voice instrument references if they came from indices
        for (let v = 0; v < 3; v++) {
          const vs = this.voiceState[v];
          if (vs && vs.active && typeof vs.instrumentIndex === 'number' && vs.instrumentIndex >= 0 && vs.instrumentIndex < list.length) {
            vs.instrument = list[vs.instrumentIndex];
          }
        }
      } else if (type === 'setBPM') {
        this.bpm = Math.max(30, Math.min(300, payload.bpm || 120));
        this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
      } else if (type === 'start') {
        this.currentStep = 0;
        this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        // Trigger step 0 immediately so the first notes are not delayed/missed
        this.nextStepSample = this.sampleCounter;
        this.pendingGateOns.length = 0;
        this.port.postMessage({ type: 'started' });
      } else if (type === 'stop') {
        this.nextStepSample = 0;
        this.pendingGateOns.length = 0;
        this.port.postMessage({ type: 'stopped' });
      } else if (type === 'poke') {
        if (this.synth) {
          const { address, value } = payload;
          this.synth.poke(address >>> 0, value & 0xFF);
          const idx = address & 0x1F;
          this.regs[idx] = value & 0xFF;
        }
      } else if (type === 'noteOn') {
        if (this.synth) {
          const { voice, frequencyHz, instrument, instrumentIndex } = payload;
          const sidFreq = this.hzToSid(frequencyHz);
          // Frequency
          this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
          this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
          // Pulse width
          const pw = (instrument.pulseWidth | 0) & 0x0FFF;
          this.setVoiceReg(voice, 0x02, pw & 0xFF);
          this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
          // ADSR
          this.setVoiceReg(voice, 0x05, instrument.ad & 0xFF);
          this.setVoiceReg(voice, 0x06, instrument.sr & 0xFF);
          // Filter
          this.applyFilterIfNeeded(voice, instrument);
          // Gate OFF then schedule ON
          this.setVoiceReg(voice, 0x04, 0x00);
          let control = (instrument.waveform & 0xF0) | 0x01;
          if (instrument.sync) control |= 0x02;
          if (instrument.ringMod) control |= 0x04;
          this.pendingGateOns.push({ sample: this.sampleCounter + this.retriggerGap, voice, value: control });
          // Track voice LFO state
          const vs = this.voiceState[voice];
          if (vs) {
            vs.active = true;
            vs.instrument = instrument || null;
            vs.instrumentIndex = (typeof instrumentIndex === 'number') ? instrumentIndex : -1;
            vs.baseHz = frequencyHz || 0;
            vs.basePW = pw & 0x0FFF;
            vs.pwmPhase = 0;
            vs.fmPhase = 0;
          }
        }
      } else if (type === 'noteOff') {
        if (this.synth) {
          const { voice, waveform } = payload || {};
          // If waveform not provided, preserve current waveform bits from mirror
          const current = this.regs[(voice * 0x07 + 0x04) & 0x1F] || 0x10;
          const wave = (typeof waveform === 'number') ? waveform : current;
          const w = (wave & 0xF0) & 0xFE;
          this.setVoiceReg(voice, 0x04, w);
          const vs = this.voiceState[voice];
          if (vs) vs.active = false;
        }
      } else if (type === 'panic') {
        // Hard-stop: clear pending events and gate off all voices while
        // preserving waveform selection.
        this.pendingGateOns.length = 0;
        for (let v = 0; v < 3; v++) {
          const ctrl = this.regs[(v * 0x07 + 0x04) & 0x1F] || 0x10;
          const w = (ctrl & 0xF0) & 0xFE;
          this.setVoiceReg(v, 0x04, w);
        }
      }
    };
  }

  // Note -> Hz map
  noteToHz(note) {
    if (!note || note === 'R' || note === '---') return 0;
    const n = note.toUpperCase();
    const table = {
      'C-0': 16.35,'C#0':17.32,'D-0':18.35,'D#0':19.45,'E-0':20.60,'F-0':21.83,'F#0':23.12,'G-0':24.50,'G#0':25.96,'A-0':27.50,'A#0':29.14,'B-0':30.87,
      'C-1':32.70,'C#1':34.65,'D-1':36.71,'D#1':38.89,'E-1':41.20,'F-1':43.65,'F#1':46.25,'G-1':49.00,'G#1':51.91,'A-1':55.00,'A#1':58.27,'B-1':61.74,
      'C-2':65.41,'C#2':69.30,'D-2':73.42,'D#2':77.78,'E-2':82.41,'F-2':87.31,'F#2':92.50,'G-2':98.00,'G#2':103.83,'A-2':110.00,'A#2':116.54,'B-2':123.47,
      'C-3':130.81,'C#3':138.59,'D-3':146.83,'D#3':155.56,'E-3':164.81,'F-3':174.61,'F#3':185.00,'G-3':196.00,'G#3':207.65,'A-3':220.00,'A#3':233.08,'B-3':246.94,
      'C-4':261.63,'C#4':277.18,'D-4':293.66,'D#4':311.13,'E-4':329.63,'F-4':349.23,'F#4':369.99,'G-4':392.00,'G#4':415.30,'A-4':440.00,'A#4':466.16,'B-4':493.88,
      'C-5':523.25,'C#5':554.37,'D-5':587.33,'D#5':622.25,'E-5':659.25,'F-5':698.46,'F#5':739.99,'G-5':783.99,'G#5':830.61,'A-5':880.00,'A#5':932.33,'B-5':987.77,
      'C-6':1046.50,'C#6':1108.73,'D-6':1174.66,'D#6':1244.51,'E-6':1318.51,'F-6':1396.91,'F#6':1479.98,'G-6':1567.98,'G#6':1661.22,'A-6':1760.00,'A#6':1864.66,'B-6':1975.53
    };
    return table[n] || 0;
  }

  hzToSid(f) {
    // Using PAL clock default 985248
    const clock = 985248;
    const v = Math.round((f * 16777216) / clock);
    return Math.max(0, Math.min(65535, v));
  }

  poke(address, value) {
    this.synth.poke(address & 0xFFFF, value & 0xFF);
    this.regs[address & 0x1F] = value & 0xFF;
  }

  setVoiceReg(voice, reg, value) {
    const VOFF = 0x07;
    this.poke(voice * VOFF + reg, value);
  }

  applyFilterIfNeeded(voice, inst) {
    if (!inst || !inst.filter || !inst.filter.enabled) return;
    const freq = inst.filter.frequency | 0;
    const ffreqlo = freq & 0x07;
    const ffreqhi = (freq >> 3) & 0xFF;
    this.poke(21, ffreqlo);
    this.poke(22, ffreqhi);
    const resonance = (inst.filter.resonance & 0xF0);
    const currentRouting = this.regs[23] & 0x07;
    const routing = currentRouting | (1 << voice);
    this.poke(23, resonance | routing);
    const volume = (this.regs[24] & 0x0F) || 0x0F;
    const type = inst.filter.type & 0x70;
    this.poke(24, type | volume);
  }

  handleSequencerStep(eventSample) {
    if (!this.pattern) return;
    for (let voice = 0; voice < 3; voice++) {
      const step = this.pattern[voice] && this.pattern[voice][this.currentStep] ? this.pattern[voice][this.currentStep] : { note: '', instrument: 0 };
      const note = (step.note || '').toUpperCase().trim();
      if (note === '') continue; // no change
      if (note === '---') {
        // sustain: do nothing
        continue;
      }
      if (note === 'R') {
        // rest: clear gate, keep waveform
        const inst = this.instruments[step.instrument | 0] || null;
        const waveform = inst ? (inst.waveform & 0xF0) : 0x10;
        this.setVoiceReg(voice, 0x04, waveform & 0xFE);
        this.voiceState[voice].active = false;
        continue;
      }
      const freqHz = this.noteToHz(note);
      const inst = this.instruments[step.instrument | 0] || null;
      if (!freqHz || !inst) continue;
      const sidFreq = this.hzToSid(freqHz);
      // Frequency
      this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
      this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
      // Pulse width
      const pw = inst.pulseWidth | 0;
      this.setVoiceReg(voice, 0x02, pw & 0xFF);
      // TinySID expects full 8-bit high register; limiting to 0x0F can
      // collapse duty cycle to silent extremes for pulse wave.
      this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
      // ADSR
      this.setVoiceReg(voice, 0x05, inst.ad & 0xFF);
      this.setVoiceReg(voice, 0x06, inst.sr & 0xFF);
      // Filter
      this.applyFilterIfNeeded(voice, inst);
      // Gate OFF immediately
      this.setVoiceReg(voice, 0x04, 0x00);
      // Schedule Gate ON with waveform + gate + optional sync/ring
      let control = (inst.waveform & 0xF0) | 0x01;
      if (inst.sync) control |= 0x02;
      if (inst.ringMod) control |= 0x04;
      const gateOnAt = (eventSample | 0) + this.retriggerGap;
      this.pendingGateOns.push({ sample: gateOnAt, voice, value: control });
      // Track voice LFO base values
      const vs = this.voiceState[voice];
      vs.active = true;
      vs.instrument = inst;
      vs.instrumentIndex = (step.instrument | 0);
      vs.baseHz = freqHz;
      vs.basePW = pw & 0x0FFF;
      vs.pwmPhase = 0;
      vs.fmPhase = 0;
    }
    // Advance step & notify
    this.currentStep = (this.currentStep + 1) % this.patternLength;
    this.port.postMessage({ type: 'step', payload: { step: this.currentStep } });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];

    const frames = left.length; // typically 128

    if (!this.ready || !this.synth) {
      for (let i = 0; i < frames; i++) {
        left[i] = 0;
        right[i] = 0;
      }
      return true;
    }

    // Apply coarse LFO updates once per buffer for worklet-driven PWM/FM while editing
    const dt = frames / sampleRate;
    const tri = (p) => (p < 0.5 ? (p * 4 - 1) : (3 - p * 4)); // -1..1
    for (let v = 0; v < 3; v++) {
      const vs = this.voiceState[v];
      const inst = vs && vs.instrument;
      if (!vs || !vs.active || !inst) continue;
      // PWM LFO
      if (inst.pwmLFO && inst.pwmLFO.enabled && inst.pwmLFO.freq > 0 && typeof inst.pwmLFO.depth === 'number' && (inst.waveform & 0x40)) {
        vs.pwmPhase = (vs.pwmPhase + inst.pwmLFO.freq * dt) % 1;
        const l = tri(vs.pwmPhase) * inst.pwmLFO.depth; // -depth..+depth
        const basePW = (typeof inst.pulseWidth === 'number') ? inst.pulseWidth : vs.basePW;
        const margin = 32;
        const upRoom = Math.max(0, 0x0FFF - margin - basePW);
        const dnRoom = Math.max(0, basePW - margin);
        const room = Math.min(upRoom, dnRoom);
        if (room > 0) {
          const amplitude = Math.floor(room * Math.min(1, Math.max(0, inst.pwmLFO.depth)));
          let pw = basePW + Math.round((l / Math.max(0.0001, inst.pwmLFO.depth)) * amplitude);
          if (pw < margin) pw = margin;
          if (pw > 0x0FFF - margin) pw = 0x0FFF - margin;
          this.setVoiceReg(v, 0x02, pw & 0xFF);
          this.setVoiceReg(v, 0x03, (pw >> 8) & 0xFF);
        }
      }
      // FM LFO
      if (inst.fmLFO && inst.fmLFO.enabled && inst.fmLFO.freq > 0 && typeof inst.fmLFO.depth === 'number' && vs.baseHz > 0) {
        vs.fmPhase = (vs.fmPhase + inst.fmLFO.freq * dt) % 1;
        const l = tri(vs.fmPhase) * inst.fmLFO.depth;
        const f = vs.baseHz * (1 + l * 0.2);
        const sidf = this.hzToSid(f);
        this.setVoiceReg(v, 0x00, sidf & 0xFF);
        this.setVoiceReg(v, 0x01, (sidf >> 8) & 0xFF);
      }
    }

    const bufferStart = this.sampleCounter;
    const bufferEnd = bufferStart + frames;
    const events = [];

    // Step events within buffer
    while (this.nextStepSample > 0 && this.nextStepSample >= bufferStart && this.nextStepSample < bufferEnd) {
      events.push({ type: 'seq', offset: this.nextStepSample - bufferStart });
      this.nextStepSample += this.stepDurationSamples;
    }
    // Gate ON events within buffer (pre-existing from prior buffers)
    const remainGate = [];
    for (let i = 0; i < this.pendingGateOns.length; i++) {
      const ge = this.pendingGateOns[i];
      if (ge.sample >= bufferStart && ge.sample < bufferEnd) {
        events.push({ type: 'gateOn', offset: ge.sample - bufferStart, voice: ge.voice, value: ge.value });
      } else if (ge.sample >= bufferEnd) {
        remainGate.push(ge);
      }
    }
    this.pendingGateOns = remainGate;

    events.sort((a, b) => a.offset - b.offset);

    let writeIndex = 0;
    const writeChunk = (chunk, start) => {
      for (let i = 0; i < chunk.length; i++) {
        left[start + i] = chunk[i];
        right[start + i] = chunk[i];
      }
    };

    let idx = 0;
    while (idx < events.length) {
      const off = events[idx].offset | 0;
      const len = Math.max(0, off - writeIndex);
      if (len > 0) {
        const chunk = this.synth.generate(len);
        writeChunk(chunk, writeIndex);
        writeIndex += len;
      }
      while (idx < events.length && events[idx].offset === off) {
        const ev = events[idx++];
        if (ev.type === 'seq') {
          // Handle the step which can schedule new gateOn events
          this.handleSequencerStep(bufferStart + off);
          // Capture any newly-scheduled gateOn events that fall within this buffer
          if (this.pendingGateOns && this.pendingGateOns.length) {
            const ready = [];
            const still = [];
            for (let i = 0; i < this.pendingGateOns.length; i++) {
              const ge = this.pendingGateOns[i];
              if (ge.sample >= bufferStart && ge.sample < bufferEnd) {
                ready.push({ type: 'gateOn', offset: ge.sample - bufferStart, voice: ge.voice, value: ge.value });
              } else {
                still.push(ge);
              }
            }
            this.pendingGateOns = still;
            if (ready.length) {
              // Insert and keep events ordered by offset
              for (const e of ready) events.push(e);
              events.sort((a, b) => a.offset - b.offset);
            }
          }
        } else if (ev.type === 'gateOn') {
          const VOFF = 0x07;
          this.poke(ev.voice * VOFF + 0x04, ev.value & 0xFF);
        }
      }
    }

    const remaining = frames - writeIndex;
    if (remaining > 0) {
      const tail = this.synth.generate(remaining);
      writeChunk(tail, writeIndex);
    }

    this.sampleCounter += frames;
    return true;
  }
}

registerProcessor('sid-processor', SidProcessor);
