// AudioWorkletProcessor that expects jsSID and jsSID.ReSID to be present (bundled above)

// GT2 Frequency Tables (from gplay.c) - exact C64 SID frequencies for notes 0-95
const freqtbllo = [
  0x17,0x27,0x39,0x4b,0x5f,0x74,0x8a,0xa1,0xba,0xd4,0xf0,0x0e,
  0x2d,0x4e,0x71,0x96,0xbe,0xe8,0x14,0x43,0x74,0xa9,0xe1,0x1c,
  0x5a,0x9c,0xe2,0x2d,0x7c,0xcf,0x28,0x85,0xe8,0x52,0xc1,0x37,
  0xb4,0x39,0xc5,0x5a,0xf7,0x9e,0x4f,0x0a,0xd1,0xa3,0x82,0x6e,
  0x68,0x71,0x8a,0xb3,0xee,0x3c,0x9e,0x15,0xa2,0x46,0x04,0xdc,
  0xd0,0xe2,0x14,0x67,0xdd,0x79,0x3c,0x29,0x44,0x8d,0x08,0xb8,
  0xa1,0xc5,0x28,0xcd,0xba,0xf1,0x78,0x53,0x87,0x1a,0x10,0x71,
  0x42,0x89,0x4f,0x9b,0x74,0xe2,0xf0,0xa6,0x0e,0x33,0x20,0xff
];
const freqtblhi = [
  0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x02,
  0x02,0x02,0x02,0x02,0x02,0x02,0x03,0x03,0x03,0x03,0x03,0x04,
  0x04,0x04,0x04,0x05,0x05,0x05,0x06,0x06,0x06,0x07,0x07,0x08,
  0x08,0x09,0x09,0x0a,0x0a,0x0b,0x0c,0x0d,0x0d,0x0e,0x0f,0x10,
  0x11,0x12,0x13,0x14,0x15,0x17,0x18,0x1a,0x1b,0x1d,0x1f,0x20,
  0x22,0x24,0x27,0x29,0x2b,0x2e,0x31,0x34,0x37,0x3a,0x3e,0x41,
  0x45,0x49,0x4e,0x52,0x57,0x5c,0x62,0x68,0x6e,0x75,0x7c,0x83,
  0x8b,0x93,0x9c,0xa5,0xaf,0xb9,0xc4,0xd0,0xdd,0xea,0xf8,0xff
];

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
    this.nextStepSample = 0;
    this.nextTickSample = 0;
    this.retriggerGap = 256;
    this.pendingGateOns = [];
    this.isGT2 = false;
    this.globalTempo = 6;
    this.funktempo = { active: false, left: 6, right: 6, state: 0 };
    // GT2 Tables
    this.tables = { ltable: [[], [], [], []], rtable: [[], [], [], []] };

    // GT2 GLOBAL filter state (filter is shared across all voices in GT2!)
    // In gplay.c, filterptr, filtertime, filtercutoff, filterctrl, filtertype are GLOBAL variables
    // executed ONCE per frame BEFORE the per-voice loop
    this.globalFilter = {
      ptr: 0,           // filterptr in GT2 (1-based, 0 = inactive)
      time: 0,          // filtertime - ticks remaining in modulation step
      cutoff: 0xFF,     // filtercutoff - current 8-bit cutoff value
      ctrl: 0,          // filterctrl - resonance (bits 4-7) + voice routing (bits 0-2)
      type: 0,          // filtertype - filter type (low=0x10, band=0x20, high=0x40)
      modSpeed: 0,      // signed speed for modulation
      triggerVoice: -1  // Which voice triggered the filter (-1 = none)
    };

    // GT2 voice state (no LFO - use PTBL/STBL/WTBL instead)
    this.voiceState = [0, 1, 2].map(() => ({
      active: false,
      instrument: null,
      instrumentIndex: -1,
      baseHz: 0,
      basePW: 0x0800,
      releaseUntilSample: 0,
      muted: false,
      // GT2 pattern command state
      activeCommand: 0,
      commandData: 0,
      currentFrequency: 0,
      targetFrequency: 0,
      transpose: 0,  // GT2 transpose amount in halftones

      // Portamento state
      portamentoSpeed: 0,
      portamentoActive: false,

      // Toneportamento state
      toneportaActive: false,
      toneportaTarget: 0,
      toneportaSpeed: 0,

      // Vibrato state
      vibratoActive: false,
      vibratoSpeed: 0,
      vibratoDepth: 0,
      vibratoPhase: 0,
      vibratoDirection: 1,

      // Base frequency (without modulation)
      baseFrequency: 0,

      // Table Execution State (Ported from GT2FrameEngine)
      // Pointers (1-based, 0 = inactive)
      ptr: [0, 0, 0, 0], // Wave, Pulse, Filter, Speed

      // Timers
      wavetime: 0,
      pulsetime: 0,
      filtertime: 0,
      speedtime: 0,

      // Current values (GT2 style: wave and gate are SEPARATE)
      wave: 0,       // Waveform value WITH gate bit (0x41=pulse+gate, etc.)
      gate: 0xFF,    // Gate mask (0xFF=pass all, 0xFE=clear gate bit)
      hrTimer: 0,    // Hard restart countdown (frames remaining, 0 = HR complete)
      baseNote: 24,  // GT2 note number (0-95), default to middle C
      lastnote: 24,  // Last played note for vibrato/portamento reference
      baseSidFreq: 0, // Base SID frequency for reference
      tableNote: 0,
      tablePulse: 0x800,
      tableFilter: 0,
      tableSpeed: 1,
      vibtime: 0,    // GT2 vibrato phase counter

      // Modulation
      pulseModSpeed: 0,
      pulseModTicks: 0,
      filterModSpeed: 0,
      filterModTicks: 0,

      // Filter state (GT2 style)
      filterType: 0,     // Filter type bits (low=0x10, band=0x20, high=0x40)
      filterCtrl: 0,     // Resonance (bits 4-7) + voice routing (bits 0-3)

      // Active flags
      waveActive: false,
      pulseActive: false,
      filterActive: false,
      speedActive: false,

      // Hard restart flag - prevents wavetable register writes until gate-on fires
      pendingGateOn: false
    }));
    // REMOVED: Old LFO timing - GT2 uses tables instead
    // GT2 tempo and tick timing
    this.tempo = 6; // Default GT2 tempo (in ticks per row)
    this.tickIntervalSamples = Math.floor(sampleRate / 50); // 50Hz PAL timing
    // Debug (enabled by default to help diagnose GT2 playback)
    this.debug = true;
    this.lastDebugSample = 0;

    this.port.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type === 'init') {
        try {
          if (typeof jsSID === 'undefined' || typeof jsSID.ReSID === 'undefined') {
            throw new Error('reSID not bundled');
          }
          // Use reSID with PAL clock, 6581 model, and fast sampling
          this.synth = new jsSID.ReSID({
            sampleRate: sampleRate,
            clock: jsSID.chip.clock.PAL,
            model: jsSID.chip.model.MOS6581,
            method: jsSID.ReSID.sampling_method.SAMPLE_FAST
          });
          this.ready = true;
          this.port.postMessage({ type: 'ready', payload: { sampleRate, blockSize: 128 } });
        } catch (e) {
          this.port.postMessage({ type: 'error', payload: String(e) });
        }
      } else if (type === 'loadPattern') {
        // GT2 order list mode (only mode)
        this.allPatterns = payload.allPatterns || [];
        this.orderLists = payload.orderLists || [[0], [0], [0]];
        this.patternRows = [0, 0, 0];
        this.instruments = payload.instruments || [];
        if (payload.tables) {
          this.tables = payload.tables;
        }
        this.isGT2 = true; // Flag to enforce GT2 timing logic

        // Initialize order positions to start of each orderlist
        this.orderPositions = [0, 0, 0];
        for (let voice = 0; voice < 3; voice++) {
          this.voiceState[voice].transpose = 0;
        }

        // Debug what we received
        console.log('Worklet: Loaded GT2 song');
        console.log('  Patterns:', this.allPatterns.length);
        console.log('  Order lists:', this.orderLists.map((ol, i) => `V${i}:[${ol.slice(0, 5).join(',')}...]`).join(' '));

        // Check first pattern for EACH voice based on their order lists
        for (let voice = 0; voice < 3; voice++) {
          const orderList = this.orderLists[voice] || [];
          const firstPatternIdx = orderList[0];
          if (firstPatternIdx !== undefined && firstPatternIdx < this.allPatterns.length) {
            const pattern = this.allPatterns[firstPatternIdx];
            console.log(`  Voice ${voice} starts with pattern ${firstPatternIdx} (${pattern ? pattern.length : 0} rows):`);
            if (pattern) {
              for (let row = 0; row < Math.min(5, pattern.length); row++) {
                const r = pattern[row];
                const noteHex = r && r.note !== undefined ? `0x${r.note.toString(16)}` : 'undef';
                const noteType = r ? (r.note === 0 ? 'EMPTY' : r.note === 0xBD ? 'REST' : r.note >= 0x60 && r.note <= 0xBC ? 'NOTE' : 'OTHER') : '???';
                console.log(`    Row ${row}: note=${r?.note} (${noteHex}) ${noteType}, inst=${r?.instrument}`);
              }
            }
          } else {
            console.log(`  Voice ${voice}: pattern ${firstPatternIdx} NOT FOUND in allPatterns`);
          }
        }
      } else if (type === 'setBPM') {
        if (!this.isGT2) {
          this.bpm = Math.max(30, Math.min(300, payload.bpm || 120));
          this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        }
      } else if (type === 'setGT2Tempo') {
        if (payload.speed > 0) {
          this.globalTempo = payload.speed;
          if (this.isGT2) this.stepDurationSamples = this.globalTempo * this.tickIntervalSamples;
        }
        if (payload.tempo > 0 && payload.tempo !== payload.speed) {
          this.funktempo = { active: true, left: payload.speed, right: payload.tempo, state: 0 };
        } else {
          this.funktempo = { active: false };
        }
        console.log(`Worklet: setGT2Tempo Speed=${this.globalTempo}, Tempo=${payload.tempo} (Dur=${this.stepDurationSamples})`);
      } else if (type === 'updateInstruments') {
        // Replace instruments array on the fly for live GT2 playback
        this.instruments = payload && payload.instruments ? payload.instruments : this.instruments;
      } else if (type === 'loadTables') {
        // Load tables for instrument testing (without starting sequencer)
        if (payload && payload.tables) {
          this.tables = payload.tables;
          console.log('Worklet: Loaded tables for testing');
        }
      } else if (type === 'setSidModel') {
        // Change SID chip model (6581 or 8580)
        if (this.synth && payload && payload.model !== undefined) {
          const model = payload.model === 8580 ? jsSID.chip.model.MOS8580 : jsSID.chip.model.MOS6581;
          this.synth.set_chip_model(model);
          console.log(`Worklet: SID chip model set to ${payload.model === 8580 ? 'MOS8580' : 'MOS6581'}`);
        }
      } else if (type === 'start') {
        this.currentStep = 0;
        // Reset pattern positions to start of each pattern/orderlist
        this.patternRows = [0, 0, 0];
        this.orderPositions = [0, 0, 0];

        if (this.isGT2) {
          // GT2 Mode: Initial duration based on Default Tempo (Speed 6)
          // Ensure tickInterval is set (in case sampleRate changed, though unlikely)
          this.tickIntervalSamples = Math.floor(sampleRate / 50);
          const initialTicks = this.globalTempo || 6;
          this.stepDurationSamples = initialTicks * this.tickIntervalSamples;
        } else {
          // Standard Mode: BPM based
          this.stepDurationSamples = (sampleRate * 60) / (this.bpm * 4);
        }

        // Reset filter to safe state at playback start
        this.poke(0x15, 0x00);
        this.poke(0x16, 0xFF);  // Max cutoff so nothing is filtered out initially
        this.poke(0x17, 0x00);  // No resonance, no voice routing
        // Reset GLOBAL filter state (GT2 filter is global, not per-voice)
        this.globalFilter.ptr = 0;
        this.globalFilter.time = 0;
        this.globalFilter.cutoff = 0xFF;
        this.globalFilter.ctrl = 0;
        this.globalFilter.type = 0;
        this.globalFilter.modSpeed = 0;
        this.globalFilter.triggerVoice = -1;
        // Reset filter debug counter
        this.filterDebugCount = [0, 0, 0];

        // Ensure volume is set to max with no filter type
        this.poke(24, 0x0F); // No filter type, max volume

        // Debug: log mute state at start
        console.log('Worklet start - mute state:', this.voiceState.map((v, i) => `V${i}:${v.muted}`).join(' '));
        // Clear any leftover gate-ons from previous playback BEFORE triggering first step
        this.pendingGateOns.length = 0;
        // Reset debug counters for new playback session
        this.bufferDebugCount = 0;
        this.genDebugCount = 0;
        this.tickDebugCount = 0;
        // Trigger first step immediately, then schedule subsequent steps
        try { this.handleSequencerStep(this.sampleCounter); } catch (_) { }
        // GT2 FIX: Execute wavetable immediately after first step so waveform is correct
        // In GT2, TICK0 = pattern data + WAVEEXEC happen on the same frame
        try { this.executeRealtimeCommands(); } catch (_) { }
        this.nextStepSample = this.sampleCounter + this.stepDurationSamples;
        this.nextTickSample = this.sampleCounter + this.tickIntervalSamples; // Start tick timer for commands
        this.port.postMessage({ type: 'started' });
      } else if (type === 'stop') {
        this.nextStepSample = 0;
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
        this.nextTickSample = 0;
        this.pendingGateOns.length = 0;
        // Clear gates and frequencies
        for (let v = 0; v < 3; v++) {
          this.setVoiceReg(v, 0x04, 0x00);
          this.setVoiceReg(v, 0x00, 0x00);
          this.setVoiceReg(v, 0x01, 0x00);
        }
        // Reset filter to safe state (bypass, max cutoff, no routing)
        this.poke(0x15, 0x00);
        this.poke(0x16, 0xFF);  // Max cutoff so nothing is filtered out
        this.poke(0x17, 0x00);  // No resonance, no voice routing
        this.poke(0x18, 0x0F);  // No filter type, max volume
        // Reset GLOBAL filter state (GT2 filter is global, not per-voice)
        this.globalFilter.ptr = 0;
        this.globalFilter.time = 0;
        this.globalFilter.cutoff = 0xFF;
        this.globalFilter.ctrl = 0;
        this.globalFilter.type = 0;
        this.globalFilter.modSpeed = 0;
        this.globalFilter.triggerVoice = -1;
        // Mute master volume temporarily, then restore
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
          // Clear gate first for retriggering (reSID needs to see 0->1 transition)
          this.setVoiceReg(voice, 0x04, 0x00);
          // Generate a few samples so reSID processes the gate-off
          this.synth.generate(8);
          let control = (instrument.waveform & 0xF0) | 0x01;
          if (instrument.sync) control |= 0x02;
          if (instrument.ringMod) control |= 0x04;
          // For GT2 tables, set initial waveform then let table engine take over
          // GT2 uses 1-based pointers: 0 = no table, 1+ = table position
          const hasWavetable = instrument.tables && instrument.tables.wave > 0;
          if (hasWavetable) {
            // Set instrument waveform+gate immediately, table will update it on first tick
            this.setVoiceReg(voice, 0x04, control);
          } else {
            // Normal instrument: schedule gate-on with full waveform
            this.pendingGateOns.push({ sample: this.sampleCounter + this.retriggerGap, voice, value: control });
          }
          // Track voice state for GT2 playback
          const vs = this.voiceState[voice];
          vs.active = true;
          vs.instrument = instrument;
          vs.instrumentIndex = (payload && typeof payload.instrumentIndex === 'number') ? payload.instrumentIndex : -1;
          vs.baseHz = frequencyHz;
          vs.basePW = pw;

          // Calculate baseNote from frequency for table arpeggios
          // MIDI formula: note = 12 * log2(freq/440) + 69
          vs.baseNote = Math.round(12 * Math.log2(frequencyHz / 440) + 69) - 12; // -12 for GT2 offset

          // Initialize tables if instrument has them (GT2: 1-based pointers, 0 = no table)
          if (instrument.tables && this.tables) {
            const t = instrument.tables;
            console.log(`🎹 V${voice} noteOn TABLES: wave=${t.wave}, pulse=${t.pulse}, filter=${t.filter}, speed=${t.speed}`);

            // Reset all table states for this voice
            vs.ptr = [0, 0, 0, 0];
            vs.wavetime = 0;
            vs.pulsetime = 0;
            vs.filtertime = 0;
            vs.speedtime = 0;
            vs.waveActive = false;
            vs.pulseActive = false;
            vs.speedActive = false;

            // Initialize wave and gate for table execution
            vs.wave = control;  // Initial waveform (will be modified by wavetable)
            vs.gate = 0xFF;     // Gate mask (0xFF = pass all bits)

            if (t.wave > 0) {
              console.log(`🎹 V${voice} WTBL ACTIVATED via noteOn: ptr=${t.wave}`);
              vs.ptr[0] = t.wave;
              vs.waveActive = true;
            }
            if (t.pulse > 0) {
              vs.ptr[1] = t.pulse;
              vs.pulseActive = true;
              vs.tablePulse = pw || 0x800;
            }
            if (t.filter > 0) {
              // GT2: Filter is GLOBAL - set global filter pointer
              this.globalFilter.ptr = t.filter;
              this.globalFilter.time = 0;
              this.globalFilter.triggerVoice = voice;
              console.log(`🎛️ V${voice} FTBL INIT via noteOn: ptr=${t.filter}`);
            }
            if (t.speed > 0) {
              vs.ptr[3] = t.speed;
              vs.speedActive = true;
            }

            // CRITICAL: Start tick timer if not running so tables execute even when sequencer is stopped
            if (!this.nextTickSample || this.nextTickSample === 0) {
              this.nextTickSample = this.sampleCounter + this.tickIntervalSamples;
              console.log(`⏱️ Started tick timer for noteOn table execution, nextTick=${this.nextTickSample}`);
            }
          }
        }
      } else if (type === 'noteOff') {
        if (this.synth) {
          const { voice, waveform } = payload;
          const w = (waveform & 0xF0) & 0xFE;
          this.setVoiceReg(voice, 0x04, w);
          const vs = this.voiceState[voice];
          if (vs) {
            // Track release for ADSR envelope completion
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

  // Process GT2 orderlist commands to find pattern and transpose
  processOrderlistCommands(orderList, startPos) {
    const MAX_PATTERNS = 208;
    let pos = startPos;
    let transpose = 0;

    while (pos < orderList.length) {
      const entry = orderList[pos];

      // 0xFF = ENDSONG, 0xFE = LOOPSONG - can't start here
      if (entry === 0xFF || entry === 0xFE) {
        return { patternIndex: 0, transpose: 0, nextPosition: 0 };
      }
      // 0xD0-0xDF = REPEAT command (skip command and parameter)
      else if (entry >= 0xD0 && entry <= 0xDF) {
        pos += 2; // Skip command and parameter byte
      }
      // 0xE0-0xEE = Transpose UP (+0 to +14 halftones)
      else if (entry >= 0xE0 && entry <= 0xEE) {
        transpose += (entry - 0xE0);
        pos++;
      }
      // 0xEF-0xFD = Transpose DOWN (-1 to -15 halftones)
      else if (entry >= 0xEF && entry <= 0xFD) {
        transpose -= (entry - 0xEE);
        pos++;
      }
      // Pattern number
      else if (entry < MAX_PATTERNS) {
        return { patternIndex: entry, transpose, nextPosition: pos };
      }
      // Unknown - skip
      else {
        pos++;
      }
    }

    // Reached end without finding pattern
    return { patternIndex: 0, transpose: 0, nextPosition: 0 };
  }

  noteToHz(note, transpose = 0) {
    if (!note || note === 'R' || note === '---' || note === 0xBD || note === 0xBE || note === 0xFE || note === 0xFF || note === 254 || note === 255 || note === 0) return 0;

    let midiNote;
    if (typeof note === 'number') {
      if (note >= 0x60) {
        // Raw GT2 bytes: 0x60 (96) = C-0 (MIDI 12)
        midiNote = (note - 0x60) + 12 + transpose;
      } else {
        // Legacy mapping: note 48 = C-4 = MIDI 60, so offset = 12
        midiNote = note + 12 + transpose;
      }
    } else {
      const n = note.toUpperCase();
      const match = n.match(/^([A-G])(#?)(-?)(\d)$/);
      if (!match) return 0;

      const [, noteName, sharp, , octave] = match;
      const noteMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
      const noteInOctave = noteMap[noteName] + (sharp ? 1 : 0);
      midiNote = (parseInt(octave) + 1) * 12 + noteInOctave + transpose;
    }

    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    return freq;
  }

  hzToSid(f) {
    const clock = 985248;
    const v = Math.round((f * 16777216) / clock);
    return Math.max(0, Math.min(65535, v));
  }

  poke(address, value) {
    const reg = address & 0x1F;
    const val = value & 0xFF;
    this.synth.poke(address & 0xFFFF, val);
    this.regs[reg] = val;

    // Debug: Log filter register writes to verify reSID receives them
    if (reg >= 0x15 && reg <= 0x18) {
      if (!this.filterPokeLog) this.filterPokeLog = 0;
      if (this.filterPokeLog < 20) {
        const f = this.synth.filter;
        console.log(`🔧 POKE $${reg.toString(16)}: ${val.toString(16)} → reSID fc=${f.fc}, res=${f.res}, filt=${f.filt}, vol=${f.vol}`);
        this.filterPokeLog++;
      }
    }
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
  executeRealtimeCommands_OLD() {
    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];

      // Skip if no active realtime command or voice not active
      if (vs.activeCommand < 1 || vs.activeCommand > 4) continue;

      // Data from speedtable
      const cmd = vs.activeCommand;
      const index = vs.commandData;

      let freqChange = 0;
      let updateFreq = false;

      // Command 1: Portamento Up
      if (cmd === 0x1) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          vs.currentFrequency += speed;
          updateFreq = true;
        }
      }
      // Command 2: Portamento Down
      else if (cmd === 0x2) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          vs.currentFrequency -= speed;
          updateFreq = true;
        }
      }
      // Command 3: Toneportamento
      else if (cmd === 0x3) {
        const speed = this.readSpeedtable16bit(index);
        if (speed > 0) {
          if (vs.currentFrequency < vs.targetFrequency) {
            vs.currentFrequency += speed;
            if (vs.currentFrequency > vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
          } else if (vs.currentFrequency > vs.targetFrequency) {
            vs.currentFrequency -= speed;
            if (vs.currentFrequency < vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
          }
          updateFreq = true;
        }
      }
      // Command 4: Vibrato
      else if (cmd === 0x4) {
        const entry = this.readSpeedtableDual(index);
        const speed = entry.left;
        const depth = entry.right;

        if (speed > 0 && depth > 0) {
          vs.vibratoPhase = (vs.vibratoPhase + speed) & 0xFF; // Wrap?
          // GT2 Vibrato is simple: add/sub based on phase direction
          // Usually it's a triangle wave or square wave.
          // GT2: phase goes 0..speed? No, looking at player.s:
          // It adds 2 to phase? "adc #$02" line 396?
          // Actually my JS implementation used a direction toggle.
          // Let's stick to the JS logic I verified earlier:
          vs.vibratoPhase++;
          if (vs.vibratoPhase >= speed) {
            vs.vibratoPhase = 0;
            vs.vibratoDirection = -vs.vibratoDirection;
          }

          // Apply depth * direction
          // Note: Vibrato modulates AROUND the base note. 
          // So we need to set freq = baseFrequency + (depth * dir)
          // But baseFrequency might be sliding if Toneporta is active? 
          // No, 4xx and 3xx are mutually exclusive in `activeCommand`.

          // Current implementation modifies `currentFrequency` directly?
          // If we modify `currentFrequency`, it drifts.
          // We should calculate `modFreq` from `currentFrequency` without writing back?
          // Or use `baseFrequency`?
          // Since `currentFrequency` is used for 1xx/2xx accumulation, using it as base is risky if we add/sub asymmetrically.
          // However, 1xx/2xx update `currentFrequency` permanently.
          // 4xx should optionally oscillate around it.

          // For now, let's just calculate a temporary frequency for the poke
          const mod = depth * vs.vibratoDirection;
          // We don't update vs.currentFrequency permanently, we just POKE the modulated value.
          // BUT, if we want to support 1xx + 4xx (not possible with one cmd),
          // wait, GT2 has only one command per row.

          // Poke the modulated frequency
          const finalFreq = Math.max(0, Math.min(65535, vs.currentFrequency + mod));
          this.setVoiceReg(voice, 0x00, finalFreq & 0xFF);
          this.setVoiceReg(voice, 0x01, (finalFreq >> 8) & 0xFF);

          continue; // Done for this voice
        }
      }

      if (updateFreq) {
        // Clamp and write
        vs.currentFrequency = Math.max(0, Math.min(65535, vs.currentFrequency));
        this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
        this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
      }
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

      // GT2 order list mode - process commands to get current pattern
      // Use a loop to handle 0xFF pattern end markers (which should take zero time)
      let orderList = this.orderLists[voice];
      let orderPos = this.orderPositions[voice];
      const vs = this.voiceState[voice];

      // Process commands from current position to get pattern and transpose
      const result = this.processOrderlistCommands(orderList, orderPos);
      const patternIndex = result.patternIndex;

      // Update transpose (don't update orderPosition yet - that happens when pattern ends)
      vs.transpose = result.transpose;

      if (patternIndex >= this.allPatterns.length || patternIndex === 0xFF) {
        // End of song or invalid pattern
        playingPositions.push(null);
        continue;
      }

      const pattern = this.allPatterns[patternIndex];
      let row = this.patternRows[voice];

      // Save the position being played NOW (before advancing)
      playingPositions.push({
        orderPos: orderPos,
        patternIndex: patternIndex,
        patternRow: row
      });

      let step = pattern[row] || { note: '', instrument: 0, command: 0, cmdData: 0 };

      // GT2: 0xFF is pattern end marker - skip this row entirely and advance to next pattern
      // This should take ZERO time - we need to process the next pattern's first row NOW
      let skipCount = 0;
      while (step.note === 0xFF && skipCount < 10) {
        skipCount++;
        console.log(`⏭️ V${voice} row=${row}: PATTERN END MARKER (0xFF) - advancing to next pattern`);
        this.patternRows[voice] = 0;
        this.orderPositions[voice] = result.nextPosition + 1;
        // Handle orderlist end/loop
        if (this.orderPositions[voice] >= orderList.length) {
          this.orderPositions[voice] = 0;
        } else {
          const nextEntry = orderList[this.orderPositions[voice]];
          if (nextEntry === 0xFF) {
            this.orderPositions[voice] = 0;
          } else if (nextEntry === 0xFE) {
            const loopPos = orderList[this.orderPositions[voice] + 1] || 0;
            this.orderPositions[voice] = loopPos;
          }
        }
        // Re-fetch pattern data for the new pattern
        orderPos = this.orderPositions[voice];
        const newResult = this.processOrderlistCommands(orderList, orderPos);
        if (newResult.patternIndex >= this.allPatterns.length) break;
        const newPattern = this.allPatterns[newResult.patternIndex];
        if (!newPattern || !newPattern[0]) break;
        // Update step to first row of new pattern
        step = newPattern[0] || { note: '', instrument: 0, command: 0, cmdData: 0 };
        row = 0;
        // Update result for later row advancement
        result.nextPosition = newResult.nextPosition;
        result.transpose = newResult.transpose;
        vs.transpose = newResult.transpose;
      }

      // Debug: log step data for all voices at row 0 AND for voices 1,2 on any note
      if (this.debug && row === 0) {
        console.log(`📊 V${voice} row=0 FIRST ROW: note=${step.note} (0x${(step.note||0).toString(16)}), inst=${step.instrument}, patternIdx=${patternIndex}, pattern.length=${pattern.length}, orderPos=${orderPos}`);
      }
      // Extra debug for voices 1 and 2 (index 1 and 2) - show all notes
      if (this.debug && (voice === 1 || voice === 2) && step.note >= 0x60 && step.note <= 0xBC) {
        console.log(`🎵 V${voice} row=${row}: NOTE 0x${step.note.toString(16)}, inst=${step.instrument}`);
      }

      // Execute pattern command if present
      if (step.command && step.command > 0) {
        // Store realtime command state (1-4) for continuous execution
        if (step.command >= 1 && step.command <= 4) {
          vs.activeCommand = step.command;
          vs.commandData = step.cmdData;
        } else if (step.command === 0) {
          // Command 0 stops realtime effects
          vs.activeCommand = 0;
          vs.commandData = 0;
          vs.vibratoPhase = 0; // Reset vibrato phase
        } else if (step.command === 0x0F) {
          // Set Tempo (Ticks per Row)
          if (step.cmdData < 0x80) {
            this.globalTempo = step.cmdData;
            this.stepDurationSamples = this.globalTempo * this.tickIntervalSamples;
          }
        } else if (step.command === 0x0E) {
          // Funktempo (Swing)
          if (step.cmdData === 0) {
            this.funktempo = { active: false };
          } else {
            const entry = this.readSpeedtableDual(step.cmdData);
            this.funktempo = { active: true, left: entry.left, right: entry.right, state: 0 };
          }
        }

        // Note: Command 3 (Toneportamento) setup happens below with Note
      }

      // Advance pattern row
      this.patternRows[voice]++;
      if (this.patternRows[voice] >= pattern.length) {
        // Pattern ended, advance order list to next entry after current pattern
        const oldOrderPos = this.orderPositions[voice];
        const oldPatternIdx = patternIndex;
        this.patternRows[voice] = 0;
        this.orderPositions[voice] = result.nextPosition + 1;
        console.log(`🔄 V${voice} PATTERN SWITCH @step${this.currentStep}: pattern ${oldPatternIdx} ended at row ${pattern.length-1}, advancing order ${oldOrderPos} → ${this.orderPositions[voice]}, next pattern row = 0, eventSample=${eventSample}`);

        // Check for special commands at new position
        if (this.orderPositions[voice] >= orderList.length) {
          // End of orderlist - loop to start
          this.orderPositions[voice] = 0;
        } else {
          const nextEntry = orderList[this.orderPositions[voice]];
          if (nextEntry === 0xFF) {
            // ENDSONG - loop to start
            this.orderPositions[voice] = 0;
          } else if (nextEntry === 0xFE) {
            // LOOPSONG - jump to specified position
            const loopPos = orderList[this.orderPositions[voice] + 1] || 0;
            this.orderPositions[voice] = loopPos;
          }
        }
      }

      // Handle Note / Instrument / Gate
      const noteInput = step.note;
      // GT2 file format (from official readme.txt section 6.1.6):
      //   $00       = empty (no note data - sustain)
      //   $60-$BC   = notes C-0 to G#7
      //   $BD (189) = REST ("...") - SUSTAIN previous note, NO gate change!
      //   $BE (190) = KEYOFF ("---") - clear gate bit, trigger ADSR release
      //   $BF (191) = KEYON ("+++") - set gate bit (re-trigger without new note)
      //   $FF       = pattern end marker (NOT a note command - should be treated as sustain)
      // IMPORTANT: 0xFF is pattern END marker - but we handle it above, so it shouldn't reach here
      const isSustain = (noteInput === 0 || noteInput === 0xBD || noteInput === 0xFF);
      const isKeyOn = (noteInput === 0xBF);
      const isRelease = (noteInput === 0xBE);

      if (isSustain) {
        // REST / Sustain - No gate change, no frequency change, keep playing
      } else if (isKeyOn) {
        // KEYON ("+++") - Set gate bit (re-trigger attack without changing frequency)
        vs.gate = 0xFF; // Gate on mask
        const gateOnVal = vs.wave | 0x01;  // Ensure gate bit is set
        console.log(`🔔 V${voice} @${this.sampleCounter} KEYON: wave=0x${vs.wave.toString(16)} → reg=0x${gateOnVal.toString(16)}`);
        this.setVoiceReg(voice, 0x04, gateOnVal);
      } else if (isRelease) {
        // KEYOFF ("---") - GT2 style: set gate = 0xFE and write immediately
        vs.gate = 0xFE; // Gate off mask
        // Write waveform with gate cleared to SID register NOW
        const gateOffVal = vs.wave & vs.gate;
        console.log(`🔕 V${voice} @${this.sampleCounter} KEYOFF: wave=0x${vs.wave.toString(16)} → reg=0x${gateOffVal.toString(16)}`);
        this.setVoiceReg(voice, 0x04, gateOffVal);
        const inst = this.instruments[step.instrument | 0] || vs.instrument || null;
        if (vs) {
          const rel = this.estimateReleaseSamples(inst);
          vs.releaseUntilSample = this.sampleCounter + rel;
          vs.active = true;
        }
      } else {
        // Normal Note
        const freqHz = this.noteToHz(noteInput, vs.transpose);
        // GT2: instrument 0 = "no change" (use current), 1+ = actual instrument
        const instNum = step.instrument | 0;
        const inst = (instNum > 0) ? (this.instruments[instNum] || vs.instrument) : vs.instrument;

        if (!inst) {
          // No instrument at all, skip
        } else if (freqHz) {
          // Trigger GT2 frame engine tables if instrument has them
          // GT2 uses 1-based pointers: 0 = no table, 1+ = table position

          // GT2 style: use firstWave on first frame if available
          // firstWave contains the full waveform byte (waveform + gate + sync/ring bits)
          if (inst.firstWave !== undefined && inst.firstWave !== 0) {
            vs.wave = inst.firstWave;
            console.log(`🎵 V${voice} Using firstWave: 0x${inst.firstWave.toString(16)}`);
          } else {
            // Fallback: construct from waveform field
            vs.wave = (inst.waveform & 0xF0) | 0x01;  // Waveform WITH gate bit
            if (inst.sync) vs.wave |= 0x02;
            if (inst.ringMod) vs.wave |= 0x04;
          }

          // GT2 Gate control from firstWave (gplay.c lines 358-366):
          // The HR in GT2 happens BEFORE TICK0 (when tick == gatetimer), not after.
          // On TICK0, firstWave controls the gate:
          //   - If firstwave >= 0xFE: gate = firstwave (0xFE = gate OFF, 0xFF = gate ON)
          //   - If firstwave < 0xFE: gate = 0xFF (gate ON immediately), wave = firstwave
          // The gatetimer controls WHEN pattern data is read (gatetimer frames before TICK0),
          // not a countdown after the note triggers.
          const firstWave = inst.firstWave || 0;
          if (firstWave >= 0xFE) {
            // firstWave 0xFE or 0xFF directly controls gate
            vs.gate = firstWave;
            vs.hrTimer = 0;  // No HR countdown needed, gate is set directly
            console.log(`🔄 V${voice} firstWave 0x${firstWave.toString(16)}: gate=0x${vs.gate.toString(16)}`);
          } else {
            // Normal instrument: gate ON immediately
            vs.gate = 0xFF;
            vs.hrTimer = 0;
            console.log(`🔄 V${voice} firstWave 0x${firstWave.toString(16)}: gate=0xFF (immediate)`);
          }

          // ALWAYS reset table state when a new note triggers
          vs.ptr = [0, 0, 0, 0]; // [Wave, Pulse, Filter, Speed]
          vs.waveActive = false;
          vs.pulseActive = false;
          vs.filterActive = false;
          vs.speedActive = false;
          vs.wavetime = 0;
          vs.pulsetime = 0;
          vs.filtertime = 0;
          vs.speedtime = 0;
          vs.tableNote = 0;
          vs.pulseModTicks = 0;
          vs.pulseModSpeed = 0;
          vs.filterModTicks = 0;
          vs.filterModSpeed = 0;
          // Reset filter state for new instrument
          vs.tableFilter = 0;
          vs.filterType = 0;
          vs.filterCtrl = 0;
          // GT2 note format: 0x60-0xBC = notes C-0 to G#7 (indices 0-92)
          // Convert to GT2 internal note index (like cptr->note = newnote - FIRSTNOTE)
          if (typeof noteInput === 'number' && noteInput >= 0x60 && noteInput <= 0xBC) {
            vs.baseNote = noteInput - 0x60;  // GT2: FIRSTNOTE = 0x60
          } else if (typeof noteInput === 'number' && noteInput < 96) {
            // Already in 0-95 format (legacy)
            vs.baseNote = noteInput;
          } else {
            vs.baseNote = this.getMidiNote(noteInput);
          }

          // Initialize tables if instrument has them (1-based pointers, 0 = no table)
          if (inst.tables) {
            const t = inst.tables;
            console.log(`🎹 V${voice} TABLES CHECK: wave=${t.wave}, pulse=${t.pulse}, filter=${t.filter}, speed=${t.speed}`);
            if (t.wave > 0) {
              console.log(`🎹 V${voice} WTBL ACTIVATED: ptr=${t.wave}`);
              vs.ptr[0] = t.wave;
              vs.waveActive = true;
            }
            if (t.pulse > 0) {
              vs.ptr[1] = t.pulse;
              vs.pulseActive = true;
              vs.tablePulse = vs.basePW || 0x800;
            }
            if (t.filter > 0) {
              // GT2: Filter is GLOBAL! Set the global filterptr when ANY voice triggers
              // a note with a filtertable (gplay.c lines 388-398)
              this.globalFilter.ptr = t.filter;
              this.globalFilter.time = 0;  // Reset modulation time
              this.globalFilter.triggerVoice = voice;  // Remember which voice triggered
              // Debug: Show filter table contents starting from the instrument's pointer
              const fPos = t.filter;
              const gf = this.globalFilter;
              console.log(`🎛️ V${voice} FTBL INIT (GLOBAL): ptr=${fPos}, triggerVoice=${voice}`);
              console.log(`🎛️ CURRENT FILTER STATE: type=0x${gf.type.toString(16)}, ctrl=0x${gf.ctrl.toString(16)}, cutoff=0x${gf.cutoff.toString(16)}`);
              // Show first 8 entries of filter table for debugging
              const firstL = this.tables.ltable[2][fPos - 1] || 0;
              const firstR = this.tables.rtable[2][fPos - 1] || 0;
              for (let i = 0; i < 8; i++) {
                const pos = fPos + i;
                const L = this.tables.ltable[2][pos - 1] || 0;
                const R = this.tables.rtable[2][pos - 1] || 0;
                const isSet = L >= 0x80;
                const isMod = L >= 0x01 && L < 0x80;
                const isCutoff = L === 0x00;
                const isJump = L === 0xFF;
                const desc = isSet ? `SET type=0x${(L & 0x70).toString(16)} ctrl=0x${R.toString(16)}` :
                            isMod ? `MOD ${L} ticks, speed=${(R & 0x80) ? (R - 256) : R}` :
                            isCutoff ? `CUTOFF 0x${R.toString(16)}` :
                            isJump ? `JUMP→${R}` : 'UNKNOWN';
                console.log(`  [${pos}] L=0x${L.toString(16).padStart(2,'0')} R=0x${R.toString(16).padStart(2,'0')} | ${desc}`);
                if (isJump) break;
              }
              // CRITICAL CHECK: If first entry is not a SET command AND current filter type is 0,
              // the filter won't work! Log a warning.
              if (firstL < 0x80 && gf.type === 0) {
                console.warn(`⚠️ FILTER WARNING: Table starts with non-SET command (L=0x${firstL.toString(16)}), but filter type is 0! Filter will NOT work until a SET command runs.`);
              }
            } else {
              // No filter table - clear this voice from GLOBAL filter routing
              // This prevents filter bleed from previous instruments
              const voiceBit = 1 << voice;
              this.globalFilter.ctrl = (this.globalFilter.ctrl & 0xF8) | ((this.globalFilter.ctrl & 0x07) & ~voiceBit);
              // Also update the register immediately
              this.poke(0x17, this.globalFilter.ctrl);
            }
            if (t.speed > 0) {
              vs.ptr[3] = t.speed;
              vs.speedActive = true;
            }
          } else {
            // No tables at all - clear this voice from GLOBAL filter routing
            const voiceBit = 1 << voice;
            this.globalFilter.ctrl = (this.globalFilter.ctrl & 0xF8) | ((this.globalFilter.ctrl & 0x07) & ~voiceBit);
            this.poke(0x17, this.globalFilter.ctrl);
          }

          // Use GT2 frequency tables for accurate C64 frequencies
          // vs.baseNote is already in GT2 internal format (0-95)
          const noteIndex = Math.min(vs.baseNote, 95);  // Clamp to table size
          const sidFreq = freqtbllo[noteIndex] | (freqtblhi[noteIndex] << 8);
          vs.lastnote = noteIndex;  // Store for vibrato/portamento reference

          // Handle Toneportamento (Command 3)
          if (vs.activeCommand === 0x3 && vs.commandData > 0) {
            vs.targetFrequency = sidFreq;
          } else {
            // Normal Note: Jump frequency immediately
            this.setVoiceReg(voice, 0x00, sidFreq & 0xFF);
            this.setVoiceReg(voice, 0x01, (sidFreq >> 8) & 0xFF);
            vs.currentFrequency = sidFreq;
            vs.baseSidFreq = sidFreq; // Store base for reference

            // Trigger Gate / ADSR / Pulse / etc.
            const pw = inst.pulseWidth | 0;
            // Ensure ADSR values are defined and non-zero (0x00 = instant attack/decay/sustain/release = silent)
            const ad = (inst.ad !== undefined && inst.ad !== null) ? (inst.ad & 0xFF) : 0x0F;  // Default: fast attack, moderate decay
            const sr = (inst.sr !== undefined && inst.sr !== null) ? (inst.sr & 0xFF) : 0xF0;  // Default: high sustain, slow release

            // Clear gate first for retriggering (reSID needs to see 0->1 transition)
            this.setVoiceReg(voice, 0x04, 0x00);
            this.synth.generate(8);  // Let reSID process the gate-off

            this.setVoiceReg(voice, 0x02, pw & 0xFF);
            this.setVoiceReg(voice, 0x03, (pw >> 8) & 0xFF);
            this.setVoiceReg(voice, 0x05, ad);
            this.setVoiceReg(voice, 0x06, sr);

            // DEBUG: Show all critical SID register values with timing
            console.log(`🔧 V${voice} @${this.sampleCounter} REGISTERS: freq=${sidFreq}, AD=0x${ad.toString(16).padStart(2,'0')}, SR=0x${sr.toString(16).padStart(2,'0')}, wave=0x${vs.wave.toString(16)}`);

            this.applyFilterIfNeeded(voice, inst);

            // Write waveform with current gate mask (0xFE during HR, 0xFF after)
            // During hard restart, gate bit is cleared to allow ADSR attack phase
            // GT2 FIX: If wavetable is active, DON'T write wave register here!
            // The wavetable execution in executeRealtimeCommands() will handle the first write
            // with the correct waveform from the table (not firstWave which may be a placeholder).
            // In GT2: TICK0 sets up tables, then WAVEEXEC runs, THEN sidreg is written.
            vs.pendingGateOn = false;
            if (!vs.waveActive) {
              // No wavetable - write wave register directly
              const gateOnVal = vs.wave & vs.gate;
              this.setVoiceReg(voice, 0x04, gateOnVal);
              console.log(`🎹 V${voice} @${this.sampleCounter} NOTE-ON (no wavetable): wave=0x${vs.wave.toString(16)}, gate=0x${vs.gate.toString(16)}, reg=0x${gateOnVal.toString(16)}, hrTimer=${vs.hrTimer}`);
            } else {
              // Wavetable active - let executeRealtimeCommands handle the wave register
              console.log(`🎹 V${voice} @${this.sampleCounter} NOTE-ON (wavetable): deferring wave write, firstWave=0x${vs.wave.toString(16)}, gate=0x${vs.gate.toString(16)}, ptr=${vs.ptr[0]}`);
            }
            if (this.debug) {
              console.log(`🎵 V${voice} NOTE: inst=${instNum}, vs.wave=0x${vs.wave.toString(16)}, tables=${inst.tables ? `W${inst.tables.wave}/P${inst.tables.pulse}` : 'none'}, waveActive=${vs.waveActive}`);
              // Debug: Print wavetable contents at the instrument's wave pointer
              if (inst.tables && inst.tables.wave > 0) {
                const wavePtr = inst.tables.wave;
                const TABLE_WAVE = 0;
                console.log(`📊 V${voice} WTBL contents starting at ptr=${wavePtr}:`);
                for (let i = 0; i < 8; i++) {
                  const pos = wavePtr + i;
                  const left = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
                  const right = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;
                  const isDelay = left <= 0x0F;
                  const isWaveform = left >= 0x10 && left < 0xE0;
                  const isJump = left === 0xFF;
                  const hasGate = (left & 0x01) !== 0;
                  console.log(`  [${pos}] L=0x${left.toString(16).padStart(2,'0')} R=0x${right.toString(16).padStart(2,'0')} | ${isDelay ? `DELAY ${left}` : isWaveform ? `WAVE ${hasGate ? '+gate' : 'NO-gate'}` : isJump ? `JUMP→${right}` : 'CMD'}`);
                  if (isJump) break; // Stop at jump
                }
              }
            }
          }

          // Update voice state for GT2 playback
          vs.active = true;
          vs.instrument = inst;
          vs.instrumentIndex = instNum; // 0 = no change, 1+ = instrument number
          vs.baseHz = freqHz;
          vs.basePW = (inst.pulseWidth | 0);
          vs.releaseUntilSample = 0;
        }
      }
    } // End of voice loop

    // === STEP-LEVEL OPERATIONS (once per step, not per voice) ===

    // In GT2 mode, there's no single pattern length (each voice has different patterns)
    // Just keep incrementing for timing purposes
    this.currentStep = this.currentStep + 1;

    // Update timing for NEXT step based on current Tempo/Funktempo
    let ticks = this.globalTempo || 6;
    if (this.funktempo && this.funktempo.active) {
      let ftVal = (this.funktempo.state === 0) ? this.funktempo.left : this.funktempo.right;
      // If funktempo value is invalid (0), ignore it and use global tempo
      if (ftVal > 0) {
        ticks = ftVal;
      }
      // Toggle state for next step (alternates between left and right tempo)
      this.funktempo.state ^= 1;
    }
    // Safety: Ticks must be at least 1 to prevent infinite loops/super-fast playback
    ticks = Math.max(1, ticks);

    // Send detailed position info for UI highlighting (positions that were JUST PLAYED)
    this.port.postMessage({
      type: 'step',
      payload: {
        step: this.currentStep,
        ticks: ticks,
        globalTempo: this.globalTempo || 6,
        isGT2: this.isGT2,
        // Per-voice positions for track view highlighting (row that just played, not next row)
        voicePositions: playingPositions
      }
    });

    this.stepDurationSamples = ticks * this.tickIntervalSamples;
    if (this.debug && this.currentStep % 16 === 0) {
      console.log(`Step ${this.currentStep}: Tempo=${this.globalTempo}, Ticks=${ticks}, Dur=${this.stepDurationSamples}`);
    }
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
    // REMOVED: Old LFO event scheduling - GT2 uses tables at 50Hz tick rate instead
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
    // Debug: show buffer boundaries and events (UNCONDITIONAL for first 30 buffers with events)
    if (this.bufferDebugCount === undefined) this.bufferDebugCount = 0;
    if (this.bufferDebugCount < 30 && events.length > 0) {
      console.log(`📦 Buffer @${bufferStart}-${bufferEnd} (${frames} frames), events=${events.length}, nextTick=${this.nextTickSample}, debug=${this.debug}`);
      console.log(`  Events: ${events.map(e => `${e.type}@${e.offset}`).join(', ')}`);
      this.bufferDebugCount++;
    }
    let writeIndex = 0;
    const writeChunk = (chunk, start) => {
      for (let i = 0; i < chunk.length; i++) { left[start + i] = chunk[i]; right[start + i] = chunk[i]; }
    };
    let idx = 0;
    let genCount = 0;
    while (idx < events.length) {
      const off = events[idx].offset | 0;
      const len = Math.max(0, off - writeIndex);
      if (len > 0) {
        const chunk = this.synth.generate(len);
        writeChunk(chunk, writeIndex);
        // Check for non-silent audio (first 50 GEN calls when there are events)
        if (this.debug && this.genDebugCount === undefined) this.genDebugCount = 0;
        if (this.debug && this.genDebugCount < 50) {
          const maxSample = Math.max(...chunk.map(Math.abs));
          const vol = this.regs[24] & 0x0F;
          console.log(`  🔈 GEN ${len} samples @${this.sampleCounter + writeIndex}, maxAmp=${maxSample.toFixed(4)}, vol=${vol}, regs4=[${this.regs[4].toString(16)},${this.regs[11].toString(16)},${this.regs[18].toString(16)}]`);
          this.genDebugCount++;
        }
        writeIndex += len;
        genCount++;
      }
      while (idx < events.length && events[idx].offset === off) {
        const ev = events[idx++];
        if (ev.type === 'seq') this.handleSequencerStep(bufferStart + off);
        else if (ev.type === 'tick') {
          // Debug: log tick processing with timing (UNCONDITIONAL for first 20)
          if (this.tickDebugCount === undefined) this.tickDebugCount = 0;
          if (this.tickDebugCount < 20) {
            console.log(`⏱️ TICK @${bufferStart + off}, buffer=[${bufferStart}-${bufferEnd}], genCount=${genCount}, writeIndex=${writeIndex}, debug=${this.debug}`);
            this.tickDebugCount++;
          }
          this.executeRealtimeCommands();
          // Telemetry for Oscilloscope (50Hz)
          this.port.postMessage({
            type: 'telemetry',
            payload: {
              regs: Array.from(this.regs),
              sampleCounter: this.sampleCounter + off,
              filterConfig: {
                res: (this.regs[0x17] >> 4) & 0x0F,
                type: (this.regs[0x18] >> 4) & 0x07 // LP: 0x10, BP: 0x20, HP: 0x40
              }
            }
          });
        }
        else if (ev.type === 'gateOn') {
          // GT2-style gate-on: set gate mask back to 0xFF and write current wave
          const vs = this.voiceState[ev.voice];
          if (vs) {
            vs.gate = 0xFF;  // GT2: cptr->gate = 0xff (pass all bits)
            vs.pendingGateOn = false;
            // Write current wave with gate enabled (wave & 0xFF = wave with gate bit)
            const val = vs.wave & vs.gate;
            if (this.debug) {
              console.log(`🎹 V${ev.voice} GATE-ON: vs.wave=0x${vs.wave.toString(16)}, gate=0x${vs.gate.toString(16)}, reg=0x${val.toString(16)}, hasGate=${(val & 0x01) !== 0}`);
            }
            this.poke(ev.voice * 0x07 + 0x04, val);
          } else {
            // Fallback for edge case
            this.poke(ev.voice * 0x07 + 0x04, ev.value & 0xFF);
          }
        }
      }
    }
    const remaining = frames - writeIndex;
    if (remaining > 0) { const tail = this.synth.generate(remaining); writeChunk(tail, writeIndex); }
    this.sampleCounter += frames;
    return true;
  }

  // REMOVED: Old PWM LFO, FM LFO, and Arpeggio engines
  // GT2-only: Use PTBL for PWM, STBL+command 4XY for vibrato, WTBL for arpeggios

  // Helper: Read 16-bit value from speedtable (for portamento)
  // GT2 uses 1-based indices, reads with [param-1]
  readSpeedtable16bit(index) {
    if (index === 0) return 0;
    // ltable[3] is speedtable left, rtable[3] is speedtable right
    const left = this.tables.ltable[3][index - 1] || 0;
    const right = this.tables.rtable[3][index - 1] || 0;
    return (left << 8) | right;
  }

  // Helper: Read dual-byte value from speedtable (for vibrato)
  // GT2 uses 1-based indices, reads with [param-1]
  readSpeedtableDual(index) {
    if (index === 0) return { left: 0, right: 0 };
    if (!this.tables.ltable[3] || !this.tables.rtable[3]) return { left: 0, right: 0 };
    const left = this.tables.ltable[3][index - 1] || 0;
    const right = this.tables.rtable[3][index - 1] || 0;
    return { left, right };
  }

  // Execute wavetable step - EXACT GT2 gplay.c logic (lines 518-726)
  // GT2 constants: WAVELASTDELAY=0x0F, WAVESILENT=0xE0, WAVELASTSILENT=0xEF, WAVECMD=0xF0
  // Converted to iterative to prevent stack overflow on jump loops
  executeWavetable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_WAVE = 0;
    const MAX_ITERATIONS = 16; // Prevent infinite loops

    if (!vs.waveActive || vs.ptr[TABLE_WAVE] === 0) return null;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const pos = vs.ptr[TABLE_WAVE];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const wave = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
      const note = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;

      // Debug: Log first few wavetable reads per voice
      if (this.debug && vs.wavetime === 0 && pos <= 3) {
        console.log(`🎵 WTBL V${voice} pos=${pos}: wave=0x${wave.toString(16)}, note=0x${note.toString(16)}, hasGate=${(wave & 0x01) !== 0}`);
      }

      // GT2: if (wave > WAVELASTDELAY) - i.e., wave > 0x0F
      if (wave > 0x0F) {
        // Normal waveform values (0x10-0xDF)
        if (wave < 0xE0) {
          // WARNING: Check if gate bit is missing (bit 0 = 0)
          if ((wave & 0x01) === 0 && this.debug) {
            console.warn(`⚠️ V${voice} WTBL pos=${pos}: Waveform 0x${wave.toString(16)} has NO gate bit! Sound will release.`);
          }
          vs.wave = wave;  // Update vs.wave directly (GT2: cptr->wave = wave)
        }
        // Silent waveforms (0xE0-0xEF) - gate off with waveform
        else if (wave >= 0xE0 && wave <= 0xEF) {
          vs.wave = wave & 0x0F;  // GT2: cptr->wave = wave & 0xf
        }
        // Commands (0xF0-0xFE) - execute pattern command from wavetable
        else if (wave >= 0xF0 && wave <= 0xFE) {
          vs.wavetime = 0;
          vs.ptr[TABLE_WAVE]++;
          this.handleWavetableJump(vs, TABLE_WAVE);
          return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
        }
        // Jump (0xFF) - loop instead of recursing
        else if (wave === 0xFF) {
          if (note === 0x00) {
            console.log(`🛑 V${voice} WTBL: Jump to 0 - STOPPING wavetable at pos=${pos}`);
            vs.waveActive = false;
            return null;
          }
          // Only log first few jumps per voice to avoid spam
          if (!this.jumpCount) this.jumpCount = [0, 0, 0];
          if (this.jumpCount[voice] < 5) {
            console.log(`🔄 V${voice} WTBL: Jump from pos ${pos} to ${note}, wavetime was ${vs.wavetime}`);
            this.jumpCount[voice]++;
          }
          vs.wavetime = 0;  // Reset wavetime on jump!
          vs.ptr[TABLE_WAVE] = note;
          continue; // Process new position in next iteration
        }
      } else {
        // Delay (0x00-0x0F)
        // GT2: if (cptr->wavetime != wave) { cptr->wavetime++; goto TICKNEFFECTS; }
        if (vs.wavetime !== wave) {
          vs.wavetime++;
          return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
        }
        // Delay expired - fall through to advance pointer and process note
      }

      // GT2: cptr->wavetime = 0; cptr->ptr[WTBL]++;
      vs.wavetime = 0;
      vs.ptr[TABLE_WAVE]++;

      // GT2: Process note from CURRENT position BEFORE checking for jumps at next position
      // This is critical: the note value we read belongs to THIS row, not the next!
      let noteChanged = false;
      let absolute = false;
      if (note !== 0x80) {
        if (note < 0x80) {
          vs.tableNote = note;
          noteChanged = true;
          absolute = false;
        } else {
          vs.tableNote = note & 0x7F;
          noteChanged = true;
          absolute = true;
        }
      }

      // GT2: Check for jump at new position and handle immediately
      // But we still return the note change from the current position!
      this.handleWavetableJump(vs, TABLE_WAVE);

      // Return with the note from current position (even if we jumped)
      return { wave: vs.wave, note: vs.tableNote, absolute: absolute, noteChanged: noteChanged };
    }

    // Safety: max iterations reached
    return { wave: vs.wave, note: vs.tableNote, noteChanged: false };
  }

  // Handle wavetable jump at current position - returns true if jump was taken
  handleWavetableJump(vs, TABLE_WAVE) {
    const pos = vs.ptr[TABLE_WAVE];
    // GT2 uses 1-based pointers, reads with [ptr-1]
    const nextWave = this.tables.ltable[TABLE_WAVE][pos - 1] || 0;
    if (nextWave === 0xFF) {
      const jumpTarget = this.tables.rtable[TABLE_WAVE][pos - 1] || 0;
      if (jumpTarget === 0x00) {
        console.log(`🔄 @${this.sampleCounter} WTBL handleJump: pos=${pos} jump to 0 - STOPPING`);
        vs.waveActive = false;
        return false;
      } else {
        console.log(`🔄 WTBL handleJump: pos=${pos} jumping to ${jumpTarget}`);
        vs.ptr[TABLE_WAVE] = jumpTarget;
        return true; // Jump was taken
      }
    }
    return false; // No jump
  }

  // Execute pulsetable step
  executePulsetable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_PULSE = 1;

    if (!vs.pulseActive || vs.ptr[TABLE_PULSE] === 0) return vs.tablePulse;

    // Modulation
    if (vs.pulseModTicks > 0) {
      vs.pulseModTicks--;
      vs.tablePulse = (vs.tablePulse + vs.pulseModSpeed) & 0xFFF;
      return vs.tablePulse;
    }

    let jumpCount = 0;
    const MAX_JUMPS = 10;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_PULSE];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_PULSE][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_PULSE][pos - 1] || 0;

      // Modulation (0x01-0x7F)
      if (left >= 0x01 && left <= 0x7F) {
        vs.pulseModTicks = left;
        vs.pulseModSpeed = (right & 0x80) ? (right - 256) : right;
        vs.ptr[TABLE_PULSE]++;
        break;
      }
      // Set pulse (0x80-0xFE)
      else if (left >= 0x80 && left <= 0xFE) {
        const highNibble = (left & 0x0F) << 8;
        vs.tablePulse = highNibble | right;
        vs.ptr[TABLE_PULSE]++;
        break;
      }
      // Jump (0xFF)
      else if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.pulseActive = false;
          break;
        }
        vs.ptr[TABLE_PULSE] = right;
        jumpCount++;
        continue;
      }
      else {
        vs.ptr[TABLE_PULSE]++;
        break;
      }
    }

    return vs.tablePulse;
  }

  // Execute filtertable step
  // GT2 format (from gplay.c):
  //   Left=0x00: Set cutoff to RIGHT value
  //   Left=0x01-0x7F: Modulation time (RIGHT=speed, signed)
  //   Left=0x80-0xFE: Set filter control (LEFT bits 4-6=type, RIGHT=passband/resonance routing)
  //   Left=0xFF: Jump to RIGHT position (0=stop)
  executeFiltertable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_FILTER = 2;

    if (!vs.filterActive || vs.ptr[TABLE_FILTER] === 0) {
      return { cutoff: vs.tableFilter, ctrl: vs.filterCtrl || 0, type: vs.filterType || 0, changed: false };
    }

    // Modulation in progress
    if (vs.filterModTicks > 0) {
      vs.filterModTicks--;
      const oldCutoff = vs.tableFilter;
      vs.tableFilter = Math.max(0, Math.min(0xFF, vs.tableFilter + vs.filterModSpeed));
      // Debug: show filter modulation progress (every 10 ticks)
      if (vs.filterModTicks % 10 === 0) {
        console.log(`🎚️ V${voice} FILTER MOD: cutoff ${oldCutoff}→${vs.tableFilter}, ${vs.filterModTicks} ticks left`);
      }
      return { cutoff: vs.tableFilter, ctrl: vs.filterCtrl || 0, type: vs.filterType || 0, changed: true };
    }

    let jumpCount = 0;
    const MAX_JUMPS = 10;
    let changed = false;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_FILTER];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_FILTER][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_FILTER][pos - 1] || 0;

      // Set cutoff (left = 0x00)
      if (left === 0x00) {
        vs.tableFilter = right;
        vs.ptr[TABLE_FILTER]++;
        changed = true;
        console.log(`🔊 V${voice} FTBL: Set cutoff = 0x${right.toString(16)} at pos ${pos}`);
        break;
      }
      // Modulation (0x01-0x7F)
      else if (left >= 0x01 && left <= 0x7F) {
        vs.filterModTicks = left;
        vs.filterModSpeed = (right & 0x80) ? (right - 256) : right;
        vs.ptr[TABLE_FILTER]++;
        console.log(`🔊 V${voice} FTBL: Modulate ${left} ticks, speed=${vs.filterModSpeed} at pos ${pos}`);
        break;
      }
      // Set filter control (0x80-0xFE): type from LEFT, resonance+routing from RIGHT
      // GT2 gplay.c lines 269-270:
      //   filtertype = ltable[FTBL][filterptr-1] & 0x70;  (bits 4-6 = low/band/high)
      //   filterctrl = rtable[FTBL][filterptr-1];         (resonance + voice routing)
      // Then written to registers:
      //   sidreg[0x17] = filterctrl  (resonance bits 4-7 + routing bits 0-2)
      //   sidreg[0x18] = filtertype | masterfader  (type bits 4-6 + volume bits 0-3)
      // NOTE: We OR the current voice into the routing to ensure the voice using
      // this filter table gets routed. This matches expected behavior when an
      // instrument's filtertable is supposed to filter that instrument's output.
      else if (left >= 0x80 && left <= 0xFE) {
        vs.filterType = left & 0x70;  // Filter type (low=0x10, band=0x20, high=0x40)
        // Preserve resonance (bits 4-7) and OR current voice into routing (bits 0-2)
        const voiceBit = 1 << voice;
        vs.filterCtrl = (right & 0xF8) | ((right & 0x07) | voiceBit);
        vs.ptr[TABLE_FILTER]++;
        console.log(`🔊 V${voice} FTBL: Set filter type=0x${vs.filterType.toString(16)}, ctrl=0x${right.toString(16)}→0x${vs.filterCtrl.toString(16)} (added voice ${voice}) at pos ${pos}`);
        changed = true;
        break;
      }
      // Jump (0xFF)
      else if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.filterActive = false;
          break;
        }
        vs.ptr[TABLE_FILTER] = right;
        jumpCount++;
        continue;
      }
      else {
        vs.ptr[TABLE_FILTER]++;
        break;
      }
    }

    return {
      cutoff: vs.tableFilter,
      ctrl: vs.filterCtrl || 0,      // For register 0x17 (resonance + routing)
      type: vs.filterType || 0,      // For register 0x18 (filter type)
      changed
    };
  }

  // Execute speedtable step (simple)
  executeSpeedtable(voice) {
    const vs = this.voiceState[voice];
    const TABLE_SPEED = 3;
    if (!vs.speedActive || vs.ptr[TABLE_SPEED] === 0) return vs.tableSpeed;

    let jumpCount = 0;
    const MAX_JUMPS = 10;

    while (jumpCount < MAX_JUMPS) {
      const pos = vs.ptr[TABLE_SPEED];
      // GT2 uses 1-based pointers, reads with [ptr-1]
      const left = this.tables.ltable[TABLE_SPEED][pos - 1] || 0;
      const right = this.tables.rtable[TABLE_SPEED][pos - 1] || 0;

      if (left === 0xFF) {
        if (right === 0x00 || right >= 0xFF) {
          vs.speedActive = false;
          break;
        }
        vs.ptr[TABLE_SPEED] = right;
        jumpCount++;
        continue;
      }

      vs.tableSpeed = left || 1;
      vs.ptr[TABLE_SPEED]++;
      break;
    }
    return vs.tableSpeed;
  }

  // Execute GLOBAL filtertable - GT2 filter is shared across all voices!
  // This is executed ONCE per frame BEFORE the per-voice loop (gplay.c lines 255-304)
  // IMPORTANT: GT2 ALWAYS writes filter registers at FILTERSTOP (lines 301-304), even when
  // filterptr is 0. We must match this behavior.
  executeGlobalFiltertable() {
    const gf = this.globalFilter;
    const TABLE_FILTER = 2;

    // Process filter table if active (gplay.c lines 255-299)
    if (gf.ptr !== 0) {
      // Jump check first (gplay.c lines 258-261)
      if (this.tables.ltable[TABLE_FILTER][gf.ptr - 1] === 0xFF) {
        gf.ptr = this.tables.rtable[TABLE_FILTER][gf.ptr - 1];
        // If jump to 0, filter stops but we still write registers below (FILTERSTOP)
      }

      // Process table if ptr is still active and no modulation in progress (gplay.c lines 264-291)
      if (gf.ptr !== 0 && gf.time === 0) {
        const left = this.tables.ltable[TABLE_FILTER][gf.ptr - 1] || 0;
        const right = this.tables.rtable[TABLE_FILTER][gf.ptr - 1] || 0;

        // Filter set (left >= 0x80) - gplay.c lines 267-278
        if (left >= 0x80) {
          gf.type = left & 0x70;
          // IMPORTANT: The table's ctrl value specifies resonance + base routing
          // But we MUST also include the voice that triggered the filter!
          // Otherwise that voice won't be routed through the filter.
          const tableCtrl = right;
          const triggerVoiceBit = (gf.triggerVoice >= 0 && gf.triggerVoice <= 2) ? (1 << gf.triggerVoice) : 0;
          gf.ctrl = (tableCtrl & 0xF8) | ((tableCtrl & 0x07) | triggerVoiceBit);
          gf.ptr++;
          console.log(`🔊 GLOBAL FTBL: Set filter type=0x${gf.type.toString(16)}, tableCtrl=0x${tableCtrl.toString(16)}→ctrl=0x${gf.ctrl.toString(16)} (added V${gf.triggerVoice}) at pos ${gf.ptr - 1}`);
          // Can be combined with cutoff set
          if (this.tables.ltable[TABLE_FILTER][gf.ptr - 1] === 0x00) {
            gf.cutoff = this.tables.rtable[TABLE_FILTER][gf.ptr - 1] || 0;
            gf.ptr++;
            console.log(`🔊 GLOBAL FTBL: Set cutoff = 0x${gf.cutoff.toString(16)} at pos ${gf.ptr - 1}`);
          }
        } else if (left >= 0x01 && left <= 0x7F) {
          // New modulation step (gplay.c lines 282-283)
          gf.time = left;
          gf.modSpeed = (right & 0x80) ? (right - 256) : right;
          console.log(`🔊 GLOBAL FTBL: Modulate ${left} ticks, speed=${gf.modSpeed} at pos ${gf.ptr}`);
        } else if (left === 0x00) {
          // Cutoff set (gplay.c lines 285-288)
          gf.cutoff = right;
          gf.ptr++;
          console.log(`🔊 GLOBAL FTBL: Set cutoff = 0x${gf.cutoff.toString(16)} at pos ${gf.ptr - 1}`);
        }
      }

      // Filter modulation (gplay.c lines 293-298)
      if (gf.time > 0) {
        const oldCutoff = gf.cutoff;
        gf.cutoff = Math.max(0, Math.min(0xFF, gf.cutoff + gf.modSpeed));
        gf.time--;
        if (gf.time === 0) gf.ptr++;
        // Debug every 10 ticks
        if (gf.time % 10 === 0) {
          console.log(`🎚️ GLOBAL FILTER MOD: cutoff ${oldCutoff}→${gf.cutoff}, ${gf.time} ticks left`);
        }
      }
    }

    // FILTERSTOP: ALWAYS write filter registers (gplay.c lines 301-304)
    // This is OUTSIDE the if(filterptr) block in GT2, so it always executes
    this.poke(0x15, 0x00);          // GT2 always writes 0
    this.poke(0x16, gf.cutoff);     // 8-bit cutoff
    this.poke(0x17, gf.ctrl);       // Resonance + voice routing
    const currentVol = this.regs[0x18] & 0x0F;
    this.poke(0x18, gf.type | currentVol);  // Filter type + volume

    // Debug: Log filter register writes periodically
    if (!this.filterLogCount) this.filterLogCount = 0;
    if (this.filterLogCount < 50 || this.filterLogCount % 100 === 0) {
      console.log(`🎛️ FILTER REGS: $15=0, $16=${gf.cutoff.toString(16)}, $17=${gf.ctrl.toString(16)}, $18=${(gf.type | currentVol).toString(16)} (type=${gf.type.toString(16)}, vol=${currentVol})`);
    }
    this.filterLogCount++;
  }

  // Execute realtime commands (1-4) on each tick for smooth modulation
  // AND execute GT2 tables (Wavetable, Pulsetable, Filtertable)
  // Logic updated to match gplay.c (GT2 source) exactly
  executeRealtimeCommands() {
    // GT2: Execute global filter ONCE per frame BEFORE the per-voice loop
    // (gplay.c lines 255-304 are executed before the for(c = 0; c < MAX_CHN; c++) loop)
    this.executeGlobalFiltertable();

    for (let voice = 0; voice < 3; voice++) {
      const vs = this.voiceState[voice];
      // Skip inactive or muted voices
      if (!vs.active || vs.muted) continue;

      let skipEffects = false;

      // NOTE: GT2 Hard Restart happens BEFORE TICK0, not during wavetable execution.
      // The hrTimer is kept for future compatibility but currently always 0.
      // Gate is now controlled by firstWave on note trigger (0xFF for normal instruments).
      if (vs.hrTimer > 0) {
        vs.hrTimer--;
        if (vs.hrTimer === 0) {
          vs.gate = 0xFF;
          console.log(`🔓 V${voice} hrTimer complete, gate=0xFF`);
        }
      }

      // 1. Wavetable Execution (updates vs.wave directly)
      let waveResult = this.executeWavetable(voice);
      if (waveResult) {
        // Write updated waveform to SID using gate mask
        // During hard restart: vs.gate = 0xFE clears gate bit
        // After hard restart: vs.gate = 0xFF passes gate bit
        const regVal = vs.wave & vs.gate;
        const hasGate = (regVal & 0x01) !== 0;

        // Track gate state changes
        if (!this.lastGateState) this.lastGateState = [null, null, null];
        if (this.lastGateState[voice] !== hasGate) {
          console.log(`🚦 V${voice} GATE ${hasGate ? 'ON' : 'OFF'}: wave=0x${vs.wave.toString(16)}, reg=0x${regVal.toString(16)}, ptr=${vs.ptr[0]}`);
          this.lastGateState[voice] = hasGate;
        }

        this.setVoiceReg(voice, 0x04, regVal);
      } else if (!vs.waveActive && vs.active) {
        // No wavetable - voice might not have one assigned
        if (!this.noWtblCount) this.noWtblCount = [0, 0, 0];
        if (this.noWtblCount[voice] < 3) {
          console.log(`⚪ V${voice} NO WAVETABLE: waveActive=${vs.waveActive}, ptr=${vs.ptr[0]}, inst=${vs.instrumentIndex}`);
          this.noWtblCount[voice]++;
        }
      }

      if (waveResult) {

        // GT2: if (note != 0x80) update frequency
        // Exact GT2 logic from gplay.c lines 716-725:
        //   if (note < 0x80)
        //     note += cptr->note;
        //   note &= 0x7f;
        //   cptr->freq = freqtbllo[note] | (freqtblhi[note]<<8);
        if (waveResult.noteChanged) {
          let resultNote;
          if (waveResult.absolute) {
            // Absolute note (0x81-0xDF in GT2, stored as 0x01-0x5F after masking)
            resultNote = vs.tableNote & 0x7F;
          } else {
            // Relative note - GT2 uses addition with overflow masking!
            // This handles both positive (0x00-0x5F) and "negative" (0x60-0x7F)
            // 0x60-0x7F become negative through overflow when added to base note
            resultNote = (vs.tableNote + vs.baseNote) & 0x7F;
          }

          // Clamp to valid frequency table range (0-95)
          resultNote = Math.min(resultNote, 95);

          // Use GT2 frequency table lookup instead of mathematical calculation
          vs.currentFrequency = freqtbllo[resultNote] | (freqtblhi[resultNote] << 8);

          // Store for vibrato/portamento reference
          vs.lastnote = resultNote;

          // Reset Vibrato Phase (GT2 behavior)
          vs.vibratoPhase = 0;
          skipEffects = true;
        }
      }

      // 3. Tick N Effects (Portamento / Vibrato)
      // Only if Wavetable didn't force a note set (SkipEffects)
      if (!skipEffects) {
        const cmd = vs.activeCommand;
        const index = vs.commandData;
        let updateFreq = false;

        // Command 1: Portamento Up (GT2 from gplay.c lines 734-748)
        if (cmd === 0x1) {
          let speed = this.readSpeedtable16bit(index);
          // GT2: Hifi mode (bit 15 set) calculates speed from note frequency difference
          if (speed >= 0x8000) {
            const note = vs.lastnote || 0;
            if (note < 95) {
              const entry = this.readSpeedtableDual(index);
              const freqNext = freqtbllo[note + 1] | (freqtblhi[note + 1] << 8);
              const freqCurr = freqtbllo[note] | (freqtblhi[note] << 8);
              speed = (freqNext - freqCurr) >> (entry.right & 0x0F);
            } else {
              speed = 0;
            }
          }
          if (speed > 0) {
            vs.currentFrequency += speed;
            updateFreq = true;
          }
        }
        // Command 2: Portamento Down (GT2 from gplay.c lines 750-765)
        else if (cmd === 0x2) {
          let speed = this.readSpeedtable16bit(index);
          if (speed >= 0x8000) {
            const note = vs.lastnote || 0;
            if (note < 95) {
              const entry = this.readSpeedtableDual(index);
              const freqNext = freqtbllo[note + 1] | (freqtblhi[note + 1] << 8);
              const freqCurr = freqtbllo[note] | (freqtblhi[note] << 8);
              speed = (freqNext - freqCurr) >> (entry.right & 0x0F);
            } else {
              speed = 0;
            }
          }
          if (speed > 0) {
            vs.currentFrequency -= speed;
            updateFreq = true;
          }
        }
        // Command 3: Toneportamento (GT2 from gplay.c lines 804-843)
        else if (cmd === 0x3) {
          let speed = this.readSpeedtable16bit(index);
          // GT2: Hifi mode
          if (speed >= 0x8000) {
            const note = vs.lastnote || 0;
            if (note < 95) {
              const entry = this.readSpeedtableDual(index);
              const freqNext = freqtbllo[note + 1] | (freqtblhi[note + 1] << 8);
              const freqCurr = freqtbllo[note] | (freqtblhi[note] << 8);
              speed = (freqNext - freqCurr) >> (entry.right & 0x0F);
            } else {
              speed = 0;
            }
          }
          if (speed > 0) {
            if (vs.currentFrequency < vs.targetFrequency) {
              vs.currentFrequency += speed;
              if (vs.currentFrequency > vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
            } else if (vs.currentFrequency > vs.targetFrequency) {
              vs.currentFrequency -= speed;
              if (vs.currentFrequency < vs.targetFrequency) vs.currentFrequency = vs.targetFrequency;
            }
            updateFreq = true;
          }
        }
        // Command 4: Vibrato
        // GT2 vibrato from gplay.c lines 776-801
        else if (cmd === 0x4) {
          const entry = this.readSpeedtableDual(index);
          let cmpvalue = entry.left;  // Speed/comparison value
          let speed = entry.right;    // Depth

          // Check for hifi mode (bit 7 of cmpvalue is set)
          // GT2: if (cmpvalue >= 0x80) calculate speed from frequency difference
          if (cmpvalue >= 0x80) {
            cmpvalue = cmpvalue & 0x7F;  // Clear bit 7

            // GT2 hifi vibrato: calculate semitone difference and right-shift
            // speed = freqtbllo[lastnote+1] | (freqtblhi[lastnote+1]<<8)
            // speed -= freqtbllo[lastnote] | (freqtblhi[lastnote]<<8)
            // speed >>= rtable[STBL][param-1]
            const note = vs.lastnote || 0;
            if (note < 95) {
              const freqNext = freqtbllo[note + 1] | (freqtblhi[note + 1] << 8);
              const freqCurr = freqtbllo[note] | (freqtblhi[note] << 8);
              speed = (freqNext - freqCurr) >> (entry.right & 0x0F);
            }
          }

          if (cmpvalue > 0) {
            // GT2 Vibrato Logic (exact from gplay.c):
            // if ((cptr->vibtime < 0x80) && (cptr->vibtime > cmpvalue))
            //   cptr->vibtime ^= 0xff;
            // cptr->vibtime += 0x02;
            // if (cptr->vibtime & 0x01) freq -= speed; else freq += speed;

            if (!vs.vibtime) vs.vibtime = 0;

            if ((vs.vibtime < 0x80) && (vs.vibtime > cmpvalue)) {
              vs.vibtime ^= 0xFF;
            }
            vs.vibtime = (vs.vibtime + 2) & 0xFF;

            let finalFreq = vs.currentFrequency;
            if (vs.vibtime & 0x01) {
              finalFreq -= speed;
            } else {
              finalFreq += speed;
            }

            // Clip
            finalFreq = Math.max(0, Math.min(65535, finalFreq));

            this.setVoiceReg(voice, 0x00, finalFreq & 0xFF);
            this.setVoiceReg(voice, 0x01, (finalFreq >> 8) & 0xFF);
            updateFreq = false; // Already poked
          }
        }

        if (updateFreq) {
          vs.currentFrequency = Math.max(0, Math.min(65535, vs.currentFrequency));
          this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
          this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
        }
      } else {
        // Absolute Note Active - Just write the reset frequency
        this.setVoiceReg(voice, 0x00, vs.currentFrequency & 0xFF);
        this.setVoiceReg(voice, 0x01, (vs.currentFrequency >> 8) & 0xFF);
      }

      // 4. Pulsetable Execution
      let pulseVal = this.executePulsetable(voice);
      this.setVoiceReg(voice, 0x02, pulseVal & 0xFF);
      this.setVoiceReg(voice, 0x03, (pulseVal >> 8) & 0x0F);

      // 5. Filtertable Execution - REMOVED (now executed globally via executeGlobalFiltertable)
      // GT2 filter is GLOBAL, not per-voice. See executeGlobalFiltertable() called at start of executeRealtimeCommands()
    }
  }



  getMidiNote(noteStr) {
    if (!noteStr || noteStr.length < 3) return 0;
    const notes = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
    const key = noteStr.substring(0, 2).toUpperCase();
    const oct = parseInt(noteStr.substring(2)) || 0;
    const idx = notes.indexOf(key);
    if (idx === -1) return 0;
    return (oct * 12) + idx;
  }
}

registerProcessor('sid-processor', SidProcessor);
