// AudioWorkletProcessor that expects jsSID and jsSID.TinySID to be present (bundled above)

class SidProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.synth = null;
    this.ready = false;
    this.sampleCounter = 0;
    this.regs = new Uint8Array(0x20);
    this.instruments = [];
    this.currentStep = 0;
    this.bpm = 120;
    this.stepDurationSamples = 0;
    // GT2 order list support (only mode)
    this.allPatterns = [];
    this.orderLists = [[0], [0], [0]];
    this.orderPositions = [0, 0, 0];  // Current position in each voice's order list
    this.patternRows = [0, 0, 0];     // Current row in each voice's pattern
    this.nextStepSample = 0;
    this.retriggerGap = 96;
    this.pendingGateOns = [];
    // LFO/Arpeggio state per voice
    this.voiceState = [0,1,2].map(() => ({
      active: false,
      instrument: null,
      instrumentIndex: -1,
      baseHz: 0,
      basePW: 0x0800,
      pwmPhase: 0,
      fmPhase: 0,
      arpIdx: 0,
      arpCounter: 0,
      releaseUntilSample: 0,
      muted: false,
      // GT2 pattern command state
      activeCommand: 0,
      commandData: 0,
      currentFrequency: 0,
      targetFrequency: 0
    }));
    // LFO timing (approx 60Hz)
    this.lfoIntervalSamples = Math.max(1, Math.floor(sampleRate / 60));
    this.nextLfoSample = 0;
    // GT2 tempo and tick timing
    this.tempo = 6; // Default GT2 tempo (in ticks per row)
    this.tickIntervalSamples = Math.floor(sampleRate / 50); // 50Hz PAL timing
    // Debug (enabled by default to help diagnose LFO)
    this.debug = true;
    this.lastDebugSample = 0;

    this.port.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'init') {
        try {
          if (typeof jsSID === 'undefined' || typeof jsSID.TinySID === 'undefined') {
            throw new Error('TinySID not bundled');
          }
          this.synth = new jsSID.TinySID({ sampleRate: sampleRate, memory: new Array(65536).fill(0) });
          this.ready = true;
          this.port.postMessage({ type: 'ready', payload: { sampleRate, blockSize: 128 } });
        } catch (e) {
          this.port.postMessage({ type: 'error', payload: String(e) });
        }
      } else if (type === 'loadPattern') {
        // GT2 order list mode (only mode)
        this.allPatterns = payload.allPatterns || [];
        this.orderLists = payload.orderLists || [[0], [0], [0]];
        this.orderPositions = [0, 0, 0];
        this.patternRows = [0, 0, 0];
        this.instruments = payload.instruments || [];

        // Debug what we received
        console.log('Worklet: Loaded GT2 song');
        console.log('  Patterns:', this.allPatterns.length);
        console.log('  Order lists:', this.orderLists.map((ol, i) => `V${i}:[${ol.slice(0,3).join(',')}...]`).join(' '));

        // Check first pattern
        if (this.allPatterns.length > 0) {
          const p0 = this.allPatterns[0];
          const preview = p0.slice(0, 4).map(r => `${r.note || '...'}:${r.instrument}`).join(' ');
          console.log('  Pattern 0 preview:', preview);
        }
      } else if (type === 'setBPM') {
        this.bpm = Math.max(30, Math.min(300, payload.bpm || 120));
        this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
      } else if (type === 'updateInstruments') {
        // Replace instruments array on the fly so LFO/Arp see live changes
        this.instruments = payload && payload.instruments ? payload.instruments : this.instruments;
      } else if (type === 'start') {
        this.currentStep = 0;
        this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        // Debug: log mute state at start
        console.log('Worklet start - mute state:', this.voiceState.map((v, i) => `V${i}:${v.muted}`).join(' '));
        // Trigger first step immediately, then schedule subsequent steps
        try { this.handleSequencerStep(this.sampleCounter); } catch (_) {}
        this.nextStepSample = this.sampleCounter + this.stepDurationSamples;
        this.pendingGateOns.length = 0;
        this.nextLfoSample = this.sampleCounter + this.lfoIntervalSamples;
        this.nextTickSample = this.sampleCounter + this.tickIntervalSamples; // Start tick timer for commands
        this.port.postMessage({ type: 'started' });
      } else if (type === 'stop') {
        this.nextStepSample = 0;
        this.nextLfoSample = 0;
        this.nextTickSample = 0;
        this.pendingGateOns.length = 0;
        // Clear realtime command state
        for (let v = 0; v < 3; v++) {
          if (this.voiceState[v]) {
            this.voiceState[v].activeCommand = 0;
            this.voiceState[v].commandData = 0;
          }
        }
        this.port.postMessage({ type: 'stopped' });
      } else if (type === 'panic') {
        // Hard stop: clear sequencer timing and mute output
        this.nextStepSample = 0;
        this.nextLfoSample = 0;
        this.nextTickSample = 0;
        this.pendingGateOns.length = 0;
        // Clear gates and frequencies
        for (let v = 0; v < 3; v++) {
          this.setVoiceReg(v, 0x04, 0x00);
          this.setVoiceReg(v, 0x00, 0x00);
          this.setVoiceReg(v, 0x01, 0x00);
        }
        // Mute master volume
        this.poke(24, (this.regs[24] & 0xF0) | 0x00);
        // Clear voice states
        for (let v = 0; v < 3; v++) {
          const vs = this.voiceState[v];
          if (vs) { vs.active = false; vs.releaseUntilSample = 0; }
        }
        this.port.postMessage({ type: 'stopped' });
      } else if (type === 'setDebug') {
        this.debug = !!(payload && payload.enabled);
      } else if (type === 'muteVoice') {
        const voice = event.data.voice;
        if (voice >= 0 && voice < 3) {
          this.voiceState[voice].muted = true;
          // Immediately clear gate for this voice
          this.setVoiceReg(voice, 0x04, 0x00);
        }
      } else if (type === 'unmuteVoice') {
        const voice = event.data.voice;
        if (voice >= 0 && voice < 3) {
          this.voiceState[voice].muted = false;
        }
      } else if (type === 'poke') {
        if (this.synth) {
          const { address, value } = payload;
          // Debug waveform register pokes
          const reg = address % 7;
          if (reg === 4) {
            const voice = Math.floor(address / 7);
            console.log(`📥 Worklet poke: addr=0x${address.toString(16)}, voice=${voice}, reg=${reg}, value=0x${value.toString(16)}`);
          }
          this.synth.poke(address >>> 0, value & 0xFF);
          const idx = address & 0x1F;
          this.regs[idx] = value & 0xFF;
        }
      } else if (type === 'noteOn') {
        if (this.synth) {
          const { voice, frequencyHz, instrument } = payload;
          const sidFreq = this.hzToSid(frequencyHz);
          this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
          this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
          const pw = (instrument.pulseWidth | 0) & 0x0FFF;
          this.setVoiceReg(voice, 0x02, pw & 0xFF);
          this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
          this.setVoiceReg(voice, 0x05, instrument.ad & 0xFF);
          this.setVoiceReg(voice, 0x06, instrument.sr & 0xFF);
          this.applyFilterIfNeeded(voice, instrument);
          this.setVoiceReg(voice, 0x04, 0x00);
          let control = (instrument.waveform & 0xF0) | 0x01;
          if (instrument.sync) control |= 0x02;
          if (instrument.ringMod) control |= 0x04;
          // For GT2 tables, set initial waveform then let table engine take over
          const hasWavetable = instrument.tables && instrument.tables.wave >= 0;
          if (hasWavetable) {
            // Set instrument waveform+gate immediately, table will update it on first tick
            this.setVoiceReg(voice, 0x04, control);
          } else {
            // Normal instrument: schedule gate-on with full waveform
            this.pendingGateOns.push({ sample: this.sampleCounter + this.retriggerGap, voice, value: control });
          }
          // Ensure LFO timer is running even if sequencer is not started
          if (!(this.nextLfoSample > 0)) {
            this.nextLfoSample = this.sampleCounter + this.lfoIntervalSamples;
          }
          // Emit a quick debug snapshot immediately
          if (this.debug) {
            const hz = Math.round(frequencyHz * 100) / 100;
            const pwOut = pw & 0x0FFF;
            this.port.postMessage({ type: 'lfoDebug', payload: { sample: this.sampleCounter, voices: [{ voice, pw: pwOut, hz }] } });
          }
          // Track voice modulation state
          const vs = this.voiceState[voice];
          vs.active = true;
          vs.instrument = instrument;
          vs.instrumentIndex = (payload && typeof payload.instrumentIndex === 'number') ? payload.instrumentIndex : -1;
          vs.baseHz = frequencyHz;
          vs.basePW = pw;
          vs.pwmPhase = 0;
          vs.fmPhase = 0;
          vs.arpIdx = 0;
          vs.arpCounter = 0;
        }
      } else if (type === 'noteOff') {
        if (this.synth) {
          const { voice, waveform } = payload;
          const w = (waveform & 0xF0) & 0xFE;
          this.setVoiceReg(voice, 0x04, w);
          const vs = this.voiceState[voice];
          if (vs) {
            // Keep LFO running during release tail
            const inst = (vs.instrumentIndex >= 0 && this.instruments[vs.instrumentIndex]) ? this.instruments[vs.instrumentIndex] : vs.instrument;
            const rel = this.estimateReleaseSamples(inst);
            vs.releaseUntilSample = this.sampleCounter + rel;
            // Treat as still active during release
            vs.active = true;
          }
        }
      }
    };
  }

  noteToHz(note) {
    if (!note || note === 'R' || note === '---') return 0;
    const n = note.toUpperCase();

    // Parse note name (e.g., "C-4", "C#3", "B-2", "G-1")
    const match = n.match(/^([A-G])(#?)(-?)(\d)$/);
    if (!match) {
      console.warn(`noteToHz: Failed to parse note "${note}"`);
      return 0;
    }

    const [, noteName, sharp, , octave] = match;
    const noteMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };

    // Calculate MIDI note number
    const noteInOctave = noteMap[noteName] + (sharp ? 1 : 0);
    const midiNote = (parseInt(octave) + 1) * 12 + noteInOctave;

    // Convert MIDI note to frequency (A4 = 440 Hz = MIDI 69)
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

    // Debug low notes
    if (freq < 60) {
      console.log(`noteToHz: "${note}" -> MIDI ${midiNote} -> ${freq.toFixed(2)} Hz`);
    }

    return freq;
  }

  hzToSid(f) {
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
    const currentVolume = this.regs[24] & 0x0F;
    const volume = currentVolume === 0 ? 0x0F : currentVolume;
    const type = inst.filter.type & 0x70;
    this.poke(24, type | volume);
  }

  // Estimate a simple release time in samples based on instrument.sr low nibble
  estimateReleaseSamples(inst) {
    const rNib = (inst && typeof inst.sr === 'number') ? (inst.sr & 0x0F) : 0;
    const ms = Math.max(80, rNib * 70); // coarse but effective
    return Math.floor((ms / 1000) * sampleRate);
  }

  // Execute realtime commands (1-4) on each tick for smooth modulation
  executeRealtimeCommands() {
    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];

      // Skip if no active realtime command
      if (vs.activeCommand < 1 || vs.activeCommand > 4) continue;

      // Send command to main thread for execution
      // Tick will increment automatically, frequency tracking happens in command engine
      this.port.postMessage({
        type: 'executeCommand',
        voice: voice,
        command: vs.activeCommand,
        cmdData: vs.commandData,
        tick: 1,  // Non-zero tick indicates ongoing execution
        frequency: vs.currentFrequency
      });
    }
  }

  handleSequencerStep(eventSample) {
    // Capture positions BEFORE advancing for UI highlighting
    const playingPositions = [];

    for (let voice = 0; voice < 3; voice++) {
      // Skip if voice is muted
      if (this.voiceState[voice].muted) {
        playingPositions.push(null);
        continue;
      }

      // GT2 order list mode - get pattern from order list
      const orderList = this.orderLists[voice];
      const orderPos = this.orderPositions[voice];
      const patternIndex = orderList[orderPos];

      if (patternIndex >= this.allPatterns.length || patternIndex === 0xFF) {
        // End of song or invalid pattern
        playingPositions.push(null);
        continue;
      }

      const pattern = this.allPatterns[patternIndex];
      const row = this.patternRows[voice];

      // Save the position being played NOW (before advancing)
      playingPositions.push({
        orderPos: orderPos,
        patternIndex: patternIndex,
        patternRow: row
      });

      const step = pattern[row] || { note: '', instrument: 0, command: 0, cmdData: 0 };

      // Execute pattern command if present
      if (step.command && step.command > 0) {
        const vs = this.voiceState[voice];

        // Store realtime command state (1-4) for continuous execution
        if (step.command >= 1 && step.command <= 4) {
          vs.activeCommand = step.command;
          vs.commandData = step.cmdData;
        } else if (step.command === 0) {
          // Command 0 stops realtime effects
          vs.activeCommand = 0;
          vs.commandData = 0;
        }

        // Send command to main thread for execution
        this.port.postMessage({
          type: 'executeCommand',
          voice: voice,
          command: step.command,
          cmdData: step.cmdData,
          tick: 0,  // Tick 0 = initial execution
          frequency: vs.currentFrequency || 0
        });
      }

      // Advance pattern row
      this.patternRows[voice]++;
      if (this.patternRows[voice] >= pattern.length) {
        // Pattern ended, advance order list
        this.patternRows[voice] = 0;
        this.orderPositions[voice]++;

        // Handle order list end/loop (0xFE = LOOPSONG)
        if (this.orderPositions[voice] >= orderList.length || orderList[this.orderPositions[voice]] === 0xFF) {
          this.orderPositions[voice] = 0;  // Loop to start
        } else if (orderList[this.orderPositions[voice]] === 0xFE) {
          // LOOPSONG marker - next byte is loop position
          const loopPos = orderList[this.orderPositions[voice] + 1] || 0;
          this.orderPositions[voice] = loopPos;
        }
      }

      const note = (step.note || '').toUpperCase().trim();

      // Debug logging for voice 0
      if (voice === 0 && note) {
        console.log(`Voice 0: row=${row}, note="${note}", instrument=${step.instrument}`);
      }

      if (note === '') continue;
      if (note === '---') continue;
      if (note === 'R') {
        const inst = this.instruments[step.instrument | 0] || null;
        const waveform = inst ? (inst.waveform & 0xF0) : 0x10;
        this.setVoiceReg(voice, 0x04, waveform & 0xFE);
        const vsr = this.voiceState[voice];
        if (vsr) {
          const rel = this.estimateReleaseSamples(inst);
          vsr.releaseUntilSample = this.sampleCounter + rel;
          vsr.active = true;
        }
        continue;
      }
      const freqHz = this.noteToHz(note);
      const inst = this.instruments[step.instrument | 0] || null;
      if (!inst) {
        console.log(`Step ${this.currentStep}: Voice ${voice} - NO INSTRUMENT at index ${step.instrument}`);
        continue;
      }
      if (!freqHz) continue;
      console.log(`Step ${this.currentStep}: Voice ${voice} - Using instrument:`, inst.name || 'unnamed', 'waveform:', inst.waveform.toString(16));

      // Trigger GT2 frame engine tables if instrument has them
      if (inst.tables && (inst.tables.wave > 0 || inst.tables.pulse > 0 || inst.tables.filter > 0 || inst.tables.speed > 0)) {
        // Send message to main thread to trigger frame engine
        // Calculate base note from frequency (reverse of noteToHz)
        const midiNote = Math.round(69 + 12 * Math.log2(freqHz / 440));
        this.port.postMessage({
          type: 'triggerTables',
          voice: voice,
          baseNote: midiNote - 12,  // Convert MIDI to GT2 note number (approximate)
          instrument: inst
        });
      }
      const sidFreq = this.hzToSid(freqHz);
      this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
      this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
      const pw = inst.pulseWidth | 0;
      this.setVoiceReg(voice, 0x02, pw & 0xFF);
      this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
      this.setVoiceReg(voice, 0x05, inst.ad & 0xFF);
      this.setVoiceReg(voice, 0x06, inst.sr & 0xFF);
      this.applyFilterIfNeeded(voice, inst);
      this.setVoiceReg(voice, 0x04, 0x00);
      let control = (inst.waveform & 0xF0) | 0x01;
      if (inst.sync) control |= 0x02;
      if (inst.ringMod) control |= 0x04;
      const gateOnAt = (eventSample | 0) + this.retriggerGap;
      this.pendingGateOns.push({ sample: gateOnAt, voice, value: control });
      // Update voice LFO/Arp base state
      const vs = this.voiceState[voice];
      vs.active = true;
      vs.instrument = inst;
      vs.instrumentIndex = (step.instrument | 0);
      vs.baseHz = freqHz;
      vs.basePW = pw;
      vs.pwmPhase = 0;
      vs.fmPhase = 0;
      vs.arpIdx = 0;
      vs.arpCounter = 0;
      vs.releaseUntilSample = 0;
    }

    // In GT2 mode, there's no single pattern length (each voice has different patterns)
    // Just keep incrementing for timing purposes
    this.currentStep = this.currentStep + 1;

    // Send detailed position info for UI highlighting (positions that were JUST PLAYED)
    this.port.postMessage({
      type: 'step',
      payload: {
        step: this.currentStep,
        // Per-voice positions for track view highlighting (row that just played, not next row)
        voicePositions: playingPositions
      }
    });
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const left = output[0];
    const right = output[1] || output[0];
    const frames = left.length;
    if (!this.ready || !this.synth) {
      for (let i = 0; i < frames; i++) { left[i] = 0; right[i] = 0; }
      return true;
    }
    const bufferStart = this.sampleCounter;
    const bufferEnd = bufferStart + frames;
    const events = [];
    while (this.nextStepSample > 0 && this.nextStepSample >= bufferStart && this.nextStepSample < bufferEnd) {
      events.push({ type: 'seq', offset: this.nextStepSample - bufferStart });
      this.nextStepSample += this.stepDurationSamples;
    }
    while (this.nextLfoSample > 0 && this.nextLfoSample >= bufferStart && this.nextLfoSample < bufferEnd) {
      events.push({ type: 'lfo', offset: this.nextLfoSample - bufferStart });
      this.nextLfoSample += this.lfoIntervalSamples;
    }
    // Schedule tick events for realtime command execution (50Hz)
    if (!this.nextTickSample) this.nextTickSample = 0;
    while (this.nextTickSample > 0 && this.nextTickSample >= bufferStart && this.nextTickSample < bufferEnd) {
      events.push({ type: 'tick', offset: this.nextTickSample - bufferStart });
      this.nextTickSample += this.tickIntervalSamples;
    }
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
      for (let i = 0; i < chunk.length; i++) { left[start + i] = chunk[i]; right[start + i] = chunk[i]; }
    };
    let idx = 0;
    while (idx < events.length) {
      const off = events[idx].offset | 0;
      const len = Math.max(0, off - writeIndex);
      if (len > 0) { const chunk = this.synth.generate(len); writeChunk(chunk, writeIndex); writeIndex += len; }
      while (idx < events.length && events[idx].offset === off) {
        const ev = events[idx++];
        if (ev.type === 'seq') this.handleSequencerStep(bufferStart + off);
        else if (ev.type === 'lfo') this.updateLFO();
        else if (ev.type === 'tick') this.executeRealtimeCommands();
        else if (ev.type === 'gateOn') this.poke(ev.voice * 0x07 + 0x04, ev.value & 0xFF);
      }
    }
    const remaining = frames - writeIndex;
    if (remaining > 0) { const tail = this.synth.generate(remaining); writeChunk(tail, writeIndex); }
    this.sampleCounter += frames;
    return true;
  }

  updateLFO() {
    const dbg = [];
    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];
      if (!vs || !vs.instrument) continue;
      const inRelease = vs.releaseUntilSample > this.sampleCounter;
      if (!(vs.active || inRelease)) continue;
      // Use live instrument definition if index is known
      const inst = (vs.instrumentIndex >= 0 && this.instruments[vs.instrumentIndex]) ? this.instruments[vs.instrumentIndex] : vs.instrument;
      // PWM LFO
      // PWM LFO only meaningful on pulse waveform
      if (inst.pwmLFO && inst.pwmLFO.enabled && inst.pwmLFO.freq > 0 && inst.pwmLFO.depth > 0 && (inst.waveform & 0x40)) {
        vs.pwmPhase = (vs.pwmPhase + inst.pwmLFO.freq / 60) % 1;
        const tri = this.triangleLFO(vs.pwmPhase, inst.pwmLFO.depth);
        // Center modulation around live instrument PW for immediate UI feedback
        const basePW = (typeof inst.pulseWidth === 'number') ? inst.pulseWidth : vs.basePW;
        let modPW = basePW + Math.round(tri * 2048);
        if (modPW < 0) modPW = 0; if (modPW > 0x0FFF) modPW = 0x0FFF;
        this.setVoiceReg(voice, 0x02, modPW & 0xFF);
        this.setVoiceReg(voice, 0x03, (modPW >> 8) & 0xFF);
        if (this.debug) dbg.push({ voice, pw: modPW });
      }
      // Skip worklet modulation if GT2 tables are active (table engine controls freq/wave)
      const hasActiveTables = inst.tables && (inst.tables.wave >= 0 || inst.tables.pulse >= 0);

      // Base frequency for FM/Arp chain
      let currentHz = vs.baseHz;

      if (!hasActiveTables) {
        // FM LFO
        if (inst.fmLFO && inst.fmLFO.enabled && inst.fmLFO.freq > 0 && inst.fmLFO.depth > 0) {
          vs.fmPhase = (vs.fmPhase + inst.fmLFO.freq / 60) % 1;
          const tri = this.triangleLFO(vs.fmPhase, inst.fmLFO.depth);
          // Increase modulation depth for audibility; max ~20% at depth 1
          currentHz = vs.baseHz * (1 + tri * 0.2);
        }
        // Arpeggio
        if (inst.arpeggio && inst.arpeggio.enabled && Array.isArray(inst.arpeggio.notes) && inst.arpeggio.notes.length > 0) {
          vs.arpCounter++;
          const every = Math.max(1, inst.arpeggio.speed | 0);
          if (vs.arpCounter >= every) { vs.arpCounter = 0; vs.arpIdx = (vs.arpIdx + 1) % inst.arpeggio.notes.length; }
          const semis = inst.arpeggio.notes[vs.arpIdx] | 0;
          currentHz = vs.baseHz * Math.pow(2, semis / 12);
        }
        const sidFreq = this.hzToSid(currentHz);
        this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
        this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
      }
      if (this.debug) {
        const e = dbg.find(d => d.voice === voice);
        if (e) e.hz = Math.round(currentHz * 100) / 100; else dbg.push({ voice, hz: Math.round(currentHz * 100) / 100 });
      }
      // Clear release marker after tail
      if (!vs.active && !(vs.releaseUntilSample > this.sampleCounter)) {
        vs.releaseUntilSample = 0;
      }
    }
    // Stop LFO when no voices are active nor in release
    if (!this.voiceState.some(v => v && (v.active || (v.releaseUntilSample > this.sampleCounter)))) {
      this.nextLfoSample = 0;
    }
    if (this.debug && this.sampleCounter - this.lastDebugSample >= Math.floor(sampleRate / 4)) {
      this.lastDebugSample = this.sampleCounter;
      this.port.postMessage({ type: 'lfoDebug', payload: { sample: this.sampleCounter, voices: dbg } });
    }
  }

  triangleLFO(phase, depth) {
    let val = (phase < 0.5) ? (phase * 4 - 1) : (3 - phase * 4);
    return val * depth;
  }
}

registerProcessor('sid-processor', SidProcessor);
