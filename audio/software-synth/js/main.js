// VA Synth — Main thread controller
// Voice allocation, keyboard, UI bindings, MIDI

const NUM_VOICES = 8;

// ─── Arpeggiator ──────────────────────────────────────────────────────────────

class Arpeggiator {
  constructor(noteOnFn, noteOffFn) {
    this._noteOn = noteOnFn;
    this._noteOff = noteOffFn;
    this.enabled = false;
    this.bpm = 120;
    this.division = '1/8';
    this.mode = 'up';
    this.octaveRange = 1;
    this.gate = 0.8;
    this.swing = 0;

    this.heldNotes = [];       // {note, velocity} in order played
    this.sequence = [];        // computed note sequence
    this.stepIndex = 0;
    this.direction = 1;        // for upDown/downUp
    this.currentNote = null;
    this._stepTimer = null;
    this._gateTimer = null;
    this._isSwingStep = false; // alternates for swing
  }

  static DIVISIONS = {
    '1/4': 1, '1/8': 0.5, '1/8T': 1/3, '1/16': 0.25, '1/16T': 1/6, '1/32': 0.125
  };

  get stepMs() {
    const beatMs = 60000 / this.bpm;
    return beatMs * (Arpeggiator.DIVISIONS[this.division] || 0.5);
  }

  addNote(note, velocity) {
    // Don't add duplicates
    if (this.heldNotes.some(n => n.note === note)) return;
    this.heldNotes.push({ note, velocity });
    this._rebuildSequence();
    // Start stepping if this is the first note
    if (this.heldNotes.length === 1) {
      this.stepIndex = 0;
      this.direction = 1;
      this._isSwingStep = false;
      this._startStepping();
      this._doStep(); // play immediately
    }
  }

  removeNote(note) {
    this.heldNotes = this.heldNotes.filter(n => n.note !== note);
    if (this.heldNotes.length === 0) {
      this._stopStepping();
      if (this.currentNote !== null) {
        this._noteOff(this.currentNote);
        this.currentNote = null;
      }
    } else {
      this._rebuildSequence();
      // Clamp stepIndex
      if (this.sequence.length > 0) {
        this.stepIndex = this.stepIndex % this.sequence.length;
      }
    }
  }

  _rebuildSequence() {
    if (this.heldNotes.length === 0) { this.sequence = []; return; }

    let baseNotes;
    if (this.mode === 'order') {
      baseNotes = this.heldNotes.map(n => ({ ...n }));
    } else {
      baseNotes = [...this.heldNotes].sort((a, b) => a.note - b.note);
    }

    // Expand across octave range
    let expanded = [];
    for (let oct = 0; oct < this.octaveRange; oct++) {
      for (const n of baseNotes) {
        expanded.push({ note: n.note + oct * 12, velocity: n.velocity });
      }
    }

    switch (this.mode) {
      case 'up':
      case 'order':
        this.sequence = expanded;
        break;
      case 'down':
        this.sequence = expanded.reverse();
        break;
      case 'upDown':
        if (expanded.length > 1) {
          this.sequence = [...expanded, ...expanded.slice(1, -1).reverse()];
        } else {
          this.sequence = expanded;
        }
        break;
      case 'downUp':
        if (expanded.length > 1) {
          const rev = [...expanded].reverse();
          this.sequence = [...rev, ...rev.slice(1, -1).reverse()];
        } else {
          this.sequence = expanded;
        }
        break;
      case 'random':
        this.sequence = expanded; // selection randomized at step time
        break;
      default:
        this.sequence = expanded;
    }
  }

  _startStepping() {
    this._stopStepping();
    const scheduleNext = () => {
      let delay = this.stepMs;
      // Apply swing to even steps (0-indexed: step 1, 3, 5... are "even" in musical sense)
      if (this._isSwingStep && this.swing > 0) {
        delay += delay * (this.swing / 100);
      }
      this._stepTimer = setTimeout(() => {
        this._doStep();
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }

  _stopStepping() {
    if (this._stepTimer) { clearTimeout(this._stepTimer); this._stepTimer = null; }
    if (this._gateTimer) { clearTimeout(this._gateTimer); this._gateTimer = null; }
  }

  _doStep() {
    if (this.sequence.length === 0) return;

    // Note off previous
    if (this.currentNote !== null) {
      this._noteOff(this.currentNote);
      this.currentNote = null;
    }

    // Pick next note
    let entry;
    if (this.mode === 'random') {
      entry = this.sequence[Math.floor(Math.random() * this.sequence.length)];
    } else {
      entry = this.sequence[this.stepIndex % this.sequence.length];
      this.stepIndex = (this.stepIndex + 1) % this.sequence.length;
    }

    // Note on
    this.currentNote = entry.note;
    this._noteOn(entry.note, entry.velocity);

    // Gate off scheduling
    if (this.gate < 1.0) {
      const gateMs = this.stepMs * this.gate;
      if (this._gateTimer) clearTimeout(this._gateTimer);
      this._gateTimer = setTimeout(() => {
        if (this.currentNote === entry.note) {
          this._noteOff(entry.note);
          this.currentNote = null;
        }
      }, gateMs);
    }

    this._isSwingStep = !this._isSwingStep;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      // Turn off arp, release any sounding note
      this._stopStepping();
      if (this.currentNote !== null) {
        this._noteOff(this.currentNote);
        this.currentNote = null;
      }
      this.heldNotes = [];
      this.sequence = [];
    }
  }

  restartTimer() {
    if (this.heldNotes.length > 0) {
      this._stopStepping();
      this._startStepping();
    }
  }

  getState() {
    return {
      arpEnabled: this.enabled,
      arpBpm: this.bpm,
      arpDivision: this.division,
      arpMode: this.mode,
      arpOctaves: this.octaveRange,
      arpGate: this.gate,
      arpSwing: this.swing
    };
  }

  loadState(state) {
    if (state.arpBpm !== undefined) this.bpm = state.arpBpm;
    if (state.arpDivision !== undefined) this.division = state.arpDivision;
    if (state.arpMode !== undefined) this.mode = state.arpMode;
    if (state.arpOctaves !== undefined) this.octaveRange = state.arpOctaves;
    if (state.arpGate !== undefined) this.gate = state.arpGate;
    if (state.arpSwing !== undefined) this.swing = state.arpSwing;
    if (state.arpEnabled !== undefined) this.setEnabled(state.arpEnabled);
  }
}

// Create arpeggiator instance (wired up after noteOn/noteOff are defined)
let arp;

let audioCtx = null;
let synthNode = null;
let analyserNode = null;
let started = false;

// Voice allocation
const voices = new Array(NUM_VOICES).fill(null).map(() => ({
  note: -1,
  velocity: 0,
  age: 0,
  active: false
}));
let voiceAge = 0;

// Mono/Legato mode
let monoMode = 'poly'; // 'poly', 'mono', 'legato'
let notePriority = 'last'; // 'last', 'high', 'low'
let monoNoteStack = []; // {note, velocity} stack for mono mode

// Sustain pedal
let sustainPedalOn = false;
let sustainedNotes = [];

// Keyboard state
let octaveShift = 0;
const keyMap = {
  // Lower row: C3-B3
  'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5,
  'g': 6, 'b': 7, 'h': 8, 'n': 9, 'j': 10, 'm': 11,
  // Upper row: C4-C5
  'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17,
  '5': 18, 't': 19, '6': 20, 'y': 21, '7': 22, 'u': 23,
  'i': 24
};
const activeKeys = new Set();

// ─── Audio Setup ────────────────────────────────────────────────────────────

async function initAudio() {
  if (started) return;
  audioCtx = new AudioContext({ sampleRate: 48000 });
  await audioCtx.audioWorklet.addModule('js/va-processor.js?v=' + Date.now());

  synthNode = new AudioWorkletNode(audioCtx, 'va-synth-processor', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 2048;

  synthNode.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  started = true;
  document.getElementById('start-btn').textContent = 'Audio Running';
  document.getElementById('start-btn').disabled = true;

  initScope();
  initMIDI();
}

// ─── Voice Allocation ───────────────────────────────────────────────────────

function allocVoice(note) {
  // Check if note already playing
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i].note === note && voices[i].active) return i;
  }
  // Find free voice
  for (let i = 0; i < NUM_VOICES; i++) {
    if (!voices[i].active) return i;
  }
  // Steal oldest
  let oldest = 0, oldestAge = Infinity;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i].age < oldestAge) {
      oldestAge = voices[i].age;
      oldest = i;
    }
  }
  return oldest;
}

let masterTranspose = 0; // semitones (multiples of 12)

function noteOn(note, velocity = 100, legato = false) {
  if (!started) return;
  const transposed = note + masterTranspose;
  // In mono/legato mode, always use voice 0
  const idx = (monoMode !== 'poly') ? 0 : allocVoice(transposed);
  voices[idx] = { note: transposed, velocity, age: ++voiceAge, active: true };
  synthNode.port.postMessage({ type: 'noteOn', voice: idx, note: transposed, velocity, legato });
  updateVoiceDisplay();
}

function noteOff(note) {
  if (!started) return;
  const transposed = note + masterTranspose;
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i].note === transposed && voices[i].active) {
      voices[i].active = false;
      voices[i].note = -1;
      synthNode.port.postMessage({ type: 'noteOff', voice: i });
    }
  }
  updateVoiceDisplay();
}

// ─── Preset State Tracking ──────────────────────────────────────────────────
// Shadow object capturing all current synth param values for preset save/export
let currentParams = {};

let currentFxState = {
  distortion: { enabled: false, drive: 0.1 },
  chorus: { enabled: false, rate: 0.1, depth: 0.5, mix: 0.3 },
  delay: { enabled: false, time: 0.19, feedback: 0.4, mix: 0.3 },
  reverb: { enabled: false, size: 0.8, damping: 0.5, mix: 0.2 },
  eq: { enabled: false, low: 0.5, mid: 0.5, high: 0.5 }
};

function sendParam(param, value) {
  if (!synthNode) return;
  synthNode.port.postMessage({ type: 'param', param, value });
  currentParams[param] = value;
}

// Create arpeggiator wired to noteOn/noteOff
arp = new Arpeggiator(noteOn, noteOff);

// ─── Input Routing (keyboard/MIDI → arp or direct) ─────────────────────────

function _getMonoPriorityNote() {
  if (monoNoteStack.length === 0) return null;
  if (notePriority === 'high') {
    return monoNoteStack.reduce((best, n) => n.note > best.note ? n : best);
  } else if (notePriority === 'low') {
    return monoNoteStack.reduce((best, n) => n.note < best.note ? n : best);
  }
  return monoNoteStack[monoNoteStack.length - 1]; // 'last'
}

function inputNoteOn(note, velocity = 100) {
  if (arp.enabled) {
    arp.addNote(note, velocity);
  } else if (monoMode !== 'poly') {
    // Mono or legato mode
    const wasEmpty = monoNoteStack.length === 0;
    // Remove if already in stack (re-press)
    monoNoteStack = monoNoteStack.filter(n => n.note !== note);
    monoNoteStack.push({ note, velocity });

    const target = _getMonoPriorityNote();
    if (monoMode === 'legato' && !wasEmpty) {
      noteOn(target.note, target.velocity, true); // legato: don't retrigger envelopes
    } else {
      noteOn(target.note, target.velocity, false);
    }
  } else {
    noteOn(note, velocity);
  }
}

function inputNoteOff(note) {
  if (arp.enabled) {
    arp.removeNote(note);
  } else if (monoMode !== 'poly') {
    // Mono/legato: remove from stack
    monoNoteStack = monoNoteStack.filter(n => n.note !== note);
    if (monoNoteStack.length > 0) {
      const target = _getMonoPriorityNote();
      if (monoMode === 'legato') {
        noteOn(target.note, target.velocity, true);
      } else {
        noteOn(target.note, target.velocity, false);
      }
    } else {
      // Release voice 0 directly (note might differ from what was originally pressed)
      voices[0].active = false;
      voices[0].note = -1;
      if (synthNode) synthNode.port.postMessage({ type: 'noteOff', voice: 0 });
      updateVoiceDisplay();
    }
  } else if (sustainPedalOn) {
    sustainedNotes.push(note);
  } else {
    noteOff(note);
  }
}

// ─── Computer Keyboard ─────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  if (e.key === '[') { octaveShift = Math.max(-3, octaveShift - 1); updateOctaveDisplay(); return; }
  if (e.key === ']') { octaveShift = Math.min(3, octaveShift + 1); updateOctaveDisplay(); return; }

  const k = e.key.toLowerCase();
  if (k in keyMap && !activeKeys.has(k)) {
    activeKeys.add(k);
    const note = 48 + octaveShift * 12 + keyMap[k]; // C3 base
    inputNoteOn(note);
  }
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k in keyMap && activeKeys.has(k)) {
    activeKeys.delete(k);
    const note = 48 + octaveShift * 12 + keyMap[k];
    inputNoteOff(note);
  }
});

// ─── UI Bindings ────────────────────────────────────────────────────────────

function bindSlider(id, param, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const display = document.getElementById(id + '-val');
  const { transform, suffix = '', decimals = 2 } = opts;

  el.addEventListener('input', () => {
    let raw = parseFloat(el.value);
    let value = transform ? transform(raw) : raw;
    sendParam(param, value);
    if (display) {
      display.textContent = (typeof value === 'number' ? value.toFixed(decimals) : value) + suffix;
    }
  });

  // Set initial display
  if (display) {
    let raw = parseFloat(el.value);
    let value = transform ? transform(raw) : raw;
    display.textContent = (typeof value === 'number' ? value.toFixed(decimals) : value) + suffix;
  }
}

function bindSelect(id, param, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    let value = opts.number ? parseInt(el.value) : el.value;
    if (opts.bool) value = el.value === 'true';
    sendParam(param, value);
  });
}

function bindToggle(id, param) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    sendParam(param, el.checked);
  });
}

// FX state key mapping: HTML id prefix → currentFxState key
const FX_ID_TO_KEY = {
  'fx-dist': 'distortion', 'fx-chorus': 'chorus', 'fx-delay': 'delay',
  'fx-reverb': 'reverb', 'fx-eq': 'eq'
};

function bindFxToggle(id, fxName) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => {
    sendParam('fx.' + fxName + '.enabled', el.checked);
    // Track in currentFxState
    const prefix = id.replace('-on', '');
    const stateKey = FX_ID_TO_KEY[prefix];
    if (stateKey && currentFxState[stateKey]) currentFxState[stateKey].enabled = el.checked;
  });
}

function bindFxSlider(id, fxParam, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const display = document.getElementById(id + '-val');
  const { transform, suffix = '', decimals = 2 } = opts;

  el.addEventListener('input', () => {
    let raw = parseFloat(el.value);
    let value = transform ? transform(raw) : raw;
    sendParam('fx.' + fxParam, value);
    if (display) {
      display.textContent = (typeof value === 'number' ? value.toFixed(decimals) : value) + suffix;
    }
    // Track raw slider value in currentFxState for save/restore
    _trackFxSlider(id, raw);
  });

  if (display) {
    let raw = parseFloat(el.value);
    let value = transform ? transform(raw) : raw;
    display.textContent = (typeof value === 'number' ? value.toFixed(decimals) : value) + suffix;
  }
}

function _trackFxSlider(id, raw) {
  // Map slider IDs to currentFxState paths
  const map = {
    'fx-dist-drive': ['distortion', 'drive'],
    'fx-chorus-rate': ['chorus', 'rate'],
    'fx-chorus-depth': ['chorus', 'depth'],
    'fx-chorus-mix': ['chorus', 'mix'],
    'fx-delay-time': ['delay', 'time'],
    'fx-delay-fb': ['delay', 'feedback'],
    'fx-delay-mix': ['delay', 'mix'],
    'fx-reverb-size': ['reverb', 'size'],
    'fx-reverb-damp': ['reverb', 'damping'],
    'fx-reverb-mix': ['reverb', 'mix'],
    'fx-eq-low': ['eq', 'low'],
    'fx-eq-mid': ['eq', 'mid'],
    'fx-eq-high': ['eq', 'high']
  };
  const path = map[id];
  if (path) currentFxState[path[0]][path[1]] = raw;
}

function setupBindings() {
  // Oscillator
  bindSelect('osc1-wave', 'osc1Waveform', { number: true });
  bindSelect('osc2-wave', 'osc2Waveform', { number: true });
  bindSlider('osc1-level', 'osc1Level');
  bindSlider('osc2-level', 'osc2Level');
  bindSlider('osc2-detune', 'osc2Detune', { suffix: '¢' });
  bindSelect('osc2-octave', 'osc2Octave', { number: true });
  bindSlider('pulse-width', 'pulseWidth');
  bindSlider('sub-level', 'subLevel');
  bindToggle('osc-sync', 'oscSync');
  bindToggle('ring-mod', 'ringMod');

  // Filter
  bindSelect('filter-type', 'filterType', { number: true });
  bindSelect('filter-mode', 'filterMode', { number: true });
  bindSlider('filter-cutoff', 'filterCutoff', {
    transform: v => 20 * Math.pow(1000, v), // 0→20Hz, 1→20kHz (log)
    suffix: 'Hz', decimals: 0
  });
  bindSlider('filter-reso', 'filterResonance');
  bindSlider('filter-env-amt', 'filterEnvAmount');
  bindSlider('filter-keytrack', 'filterKeyTrack');

  // Amp ADSR
  bindSlider('amp-a', 'ampAttack', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('amp-d', 'ampDecay', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('amp-s', 'ampSustain');
  bindSlider('amp-r', 'ampRelease', { transform: v => v * v * 10, suffix: 's', decimals: 3 });

  // Filter ADSR
  bindSlider('flt-a', 'filterAttack', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('flt-d', 'filterDecay', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('flt-s', 'filterSustain');
  bindSlider('flt-r', 'filterRelease', { transform: v => v * v * 10, suffix: 's', decimals: 3 });

  // Mod ADSR
  bindSlider('mod-a', 'modAttack', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('mod-d', 'modDecay', { transform: v => v * v * 5, suffix: 's', decimals: 3 });
  bindSlider('mod-s', 'modSustain');
  bindSlider('mod-r', 'modRelease', { transform: v => v * v * 10, suffix: 's', decimals: 3 });

  // LFOs
  bindSlider('lfo1-rate', 'lfo1Rate', {
    transform: v => 0.01 * Math.pow(5000, v), suffix: 'Hz', decimals: 2
  });
  bindSelect('lfo1-wave', 'lfo1Waveform', { number: true });
  bindToggle('lfo1-sync', 'lfo1Sync');

  bindSlider('lfo2-rate', 'lfo2Rate', {
    transform: v => 0.01 * Math.pow(5000, v), suffix: 'Hz', decimals: 2
  });
  bindSelect('lfo2-wave', 'lfo2Waveform', { number: true });
  bindToggle('lfo2-sync', 'lfo2Sync');

  // Mod Matrix
  for (let i = 0; i < 4; i++) {
    bindSelect(`mod${i}-src`, `mod.${i}.src`);
    bindSelect(`mod${i}-dst`, `mod.${i}.dst`);
    bindSlider(`mod${i}-amt`, `mod.${i}.amount`);
  }

  // Analog warmth
  bindSlider('drift', 'driftAmount');
  bindSlider('saturation', 'saturationDrive', {
    transform: v => 1 + v * 4, decimals: 1
  });

  // Unison
  bindSelect('unison-count', 'unisonCount', { number: true });
  bindSlider('unison-detune', 'unisonDetune', { suffix: '¢', decimals: 0 });
  bindSlider('unison-spread', 'unisonSpread');

  // Master
  bindSlider('master-vol', 'masterVolume');

  const masterOctEl = document.getElementById('master-octave');
  if (masterOctEl) {
    masterOctEl.addEventListener('change', () => {
      masterTranspose = parseInt(masterOctEl.value);
    });
  }

  // Performance: Portamento
  bindToggle('portamento-on', 'portamento');
  bindSlider('portamento-time', 'portamentoTime', {
    transform: v => 0.001 * Math.pow(2000, v), suffix: 's', decimals: 3
  });

  // Performance: Pitch Bend Range
  const pbRangeEl = document.getElementById('pitch-bend-range');
  if (pbRangeEl) {
    pbRangeEl.addEventListener('change', () => {
      sendParam('pitchBendRange', parseInt(pbRangeEl.value));
    });
  }

  // Performance: Mono/Legato mode
  const monoModeEl = document.getElementById('mono-mode');
  if (monoModeEl) {
    monoModeEl.addEventListener('change', () => {
      monoMode = monoModeEl.value;
      monoNoteStack = [];
      const priRow = document.getElementById('note-priority-row');
      if (priRow) priRow.style.display = monoMode === 'poly' ? 'none' : 'flex';
    });
  }

  const notePriEl = document.getElementById('note-priority');
  if (notePriEl) {
    notePriEl.addEventListener('change', () => {
      notePriority = notePriEl.value;
    });
  }

  // Cross-mod
  bindSlider('cross-mod', 'crossModAmount');

  // HPF
  bindSlider('hpf-cutoff', 'hpfCutoff', {
    transform: v => 20 * Math.pow(100, v), suffix: 'Hz', decimals: 0
  });

  // Noise mixer
  bindSlider('noise-level', 'noiseLevel');

  // LFO delay/fade-in
  bindSlider('lfo1-delay', 'lfo1Delay', {
    transform: v => v * 2, suffix: 's', decimals: 2
  });
  bindSlider('lfo1-fadein', 'lfo1FadeIn', {
    transform: v => v * 2, suffix: 's', decimals: 2
  });
  bindSlider('lfo2-delay', 'lfo2Delay', {
    transform: v => v * 2, suffix: 's', decimals: 2
  });
  bindSlider('lfo2-fadein', 'lfo2FadeIn', {
    transform: v => v * 2, suffix: 's', decimals: 2
  });

  // Arpeggiator
  const arpOnEl = document.getElementById('arp-on');
  if (arpOnEl) {
    arpOnEl.addEventListener('change', () => {
      arp.setEnabled(arpOnEl.checked);
    });
  }

  const arpBpmEl = document.getElementById('arp-bpm');
  const arpBpmVal = document.getElementById('arp-bpm-val');
  if (arpBpmEl) {
    arpBpmEl.addEventListener('input', () => {
      arp.bpm = parseInt(arpBpmEl.value);
      if (arpBpmVal) arpBpmVal.textContent = arp.bpm;
      arp.restartTimer();
    });
    if (arpBpmVal) arpBpmVal.textContent = arpBpmEl.value;
  }

  const arpDivEl = document.getElementById('arp-division');
  if (arpDivEl) {
    arpDivEl.addEventListener('change', () => {
      arp.division = arpDivEl.value;
      arp.restartTimer();
    });
  }

  const arpModeEl = document.getElementById('arp-mode');
  if (arpModeEl) {
    arpModeEl.addEventListener('change', () => {
      arp.mode = arpModeEl.value;
      arp._rebuildSequence();
    });
  }

  const arpOctEl = document.getElementById('arp-octaves');
  if (arpOctEl) {
    arpOctEl.addEventListener('change', () => {
      arp.octaveRange = parseInt(arpOctEl.value);
      arp._rebuildSequence();
    });
  }

  const arpGateEl = document.getElementById('arp-gate');
  const arpGateVal = document.getElementById('arp-gate-val');
  if (arpGateEl) {
    arpGateEl.addEventListener('input', () => {
      arp.gate = parseFloat(arpGateEl.value);
      if (arpGateVal) arpGateVal.textContent = Math.round(arp.gate * 100) + '%';
    });
    if (arpGateVal) arpGateVal.textContent = Math.round(parseFloat(arpGateEl.value) * 100) + '%';
  }

  const arpSwingEl = document.getElementById('arp-swing');
  const arpSwingVal = document.getElementById('arp-swing-val');
  if (arpSwingEl) {
    arpSwingEl.addEventListener('input', () => {
      arp.swing = parseInt(arpSwingEl.value);
      if (arpSwingVal) arpSwingVal.textContent = arp.swing + '%';
    });
    if (arpSwingVal) arpSwingVal.textContent = arpSwingEl.value + '%';
  }

  // Effects
  bindFxToggle('fx-dist-on', 'dist');
  bindFxSlider('fx-dist-drive', 'dist.drive', { transform: v => 1 + v * 9, decimals: 1 });

  bindFxToggle('fx-eq-on', 'eq');
  bindFxSlider('fx-eq-low', 'eq.0.gain', { transform: v => v * 24 - 12, suffix: 'dB', decimals: 1 });
  bindFxSlider('fx-eq-mid', 'eq.1.gain', { transform: v => v * 24 - 12, suffix: 'dB', decimals: 1 });
  bindFxSlider('fx-eq-high', 'eq.2.gain', { transform: v => v * 24 - 12, suffix: 'dB', decimals: 1 });

  // EQ — need special handling since eq uses band index
  for (const [sliderId, bandIdx] of [['fx-eq-low', 0], ['fx-eq-mid', 1], ['fx-eq-high', 2]]) {
    const el = document.getElementById(sliderId);
    if (el) {
      el.addEventListener('input', () => {
        const val = parseFloat(el.value) * 24 - 12;
        sendParam(`eq.${bandIdx}`, val);
      });
    }
  }

  bindFxToggle('fx-chorus-on', 'chorus');
  bindFxSlider('fx-chorus-rate', 'chorus.rate', { transform: v => 0.1 + v * 5, suffix: 'Hz' });
  bindFxSlider('fx-chorus-depth', 'chorus.depth', { transform: v => v * 0.01 });
  bindFxSlider('fx-chorus-mix', 'chorus.mix');

  bindFxToggle('fx-delay-on', 'delay');
  bindFxSlider('fx-delay-time', 'delay.timeL', { transform: v => v * 2, suffix: 's' });
  bindFxSlider('fx-delay-fb', 'delay.feedback');
  bindFxSlider('fx-delay-mix', 'delay.mix');

  bindFxToggle('fx-reverb-on', 'reverb');
  bindFxSlider('fx-reverb-size', 'reverb.roomSize');
  bindFxSlider('fx-reverb-damp', 'reverb.damping');
  bindFxSlider('fx-reverb-mix', 'reverb.mix');
}

// ─── Display Updates ────────────────────────────────────────────────────────

function updateOctaveDisplay() {
  const el = document.getElementById('octave-display');
  if (el) el.textContent = `Oct: ${octaveShift >= 0 ? '+' : ''}${octaveShift}`;
}

function updateVoiceDisplay() {
  const el = document.getElementById('voice-display');
  if (!el) return;
  const count = voices.filter(v => v.active).length;
  el.textContent = `Voices: ${count}/${NUM_VOICES}`;
}

function updateSustainIndicator() {
  const el = document.getElementById('sustain-indicator');
  if (el) el.style.color = sustainPedalOn ? 'var(--accent)' : 'var(--text-dim)';
}

// ─── Oscilloscope ───────────────────────────────────────────────────────────

let scopeCanvas, scopeCtx, scopeData;

function initScope() {
  scopeCanvas = document.getElementById('scope');
  if (!scopeCanvas) return;
  scopeCtx = scopeCanvas.getContext('2d');
  scopeData = new Float32Array(analyserNode.fftSize);
  drawScope();
}

function drawScope() {
  if (!scopeCanvas) { requestAnimationFrame(drawScope); return; }
  requestAnimationFrame(drawScope);

  analyserNode.getFloatTimeDomainData(scopeData);
  const w = scopeCanvas.width;
  const h = scopeCanvas.height;

  scopeCtx.fillStyle = '#1a1a2e';
  scopeCtx.fillRect(0, 0, w, h);

  // Grid
  scopeCtx.strokeStyle = '#2a2a4e';
  scopeCtx.lineWidth = 0.5;
  scopeCtx.beginPath();
  scopeCtx.moveTo(0, h / 2);
  scopeCtx.lineTo(w, h / 2);
  scopeCtx.stroke();

  // Zero-crossing trigger
  let triggerIdx = 0;
  for (let i = 1; i < scopeData.length / 2; i++) {
    if (scopeData[i - 1] <= 0 && scopeData[i] > 0) {
      triggerIdx = i;
      break;
    }
  }

  // Waveform
  scopeCtx.strokeStyle = '#00ff88';
  scopeCtx.lineWidth = 2;
  scopeCtx.beginPath();

  const samplesToShow = Math.min(512, scopeData.length - triggerIdx);
  for (let i = 0; i < samplesToShow; i++) {
    const x = (i / samplesToShow) * w;
    const y = h / 2 - scopeData[triggerIdx + i] * h * 0.4;
    if (i === 0) scopeCtx.moveTo(x, y);
    else scopeCtx.lineTo(x, y);
  }
  scopeCtx.stroke();
}

// ─── On-Screen Keyboard ────────────────────────────────────────────────────

function initOnScreenKeyboard() {
  const container = document.getElementById('piano-keyboard');
  if (!container) return;

  const startNote = 48; // C3
  const numOctaves = 4;
  const whiteNotes = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
  const blackNotes = [1, 3, -1, 6, 8, 10, -1]; // C# D# - F# G# A#
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  let isMouseDown = false;

  for (let oct = 0; oct < numOctaves; oct++) {
    const octBase = startNote + oct * 12;

    // White keys
    for (let i = 0; i < 7; i++) {
      const note = octBase + whiteNotes[i];
      const key = document.createElement('div');
      key.className = 'piano-key white-key';
      key.dataset.note = note;
      if (i === 0) {
        const label = document.createElement('span');
        label.className = 'key-label';
        label.textContent = `C${3 + oct}`;
        key.appendChild(label);
      }
      container.appendChild(key);

      key.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isMouseDown = true;
        inputNoteOn(note, 100);
        key.classList.add('active');
      });
      key.addEventListener('mouseenter', () => {
        if (isMouseDown) {
          inputNoteOn(note, 80);
          key.classList.add('active');
        }
      });
      key.addEventListener('mouseleave', () => {
        if (isMouseDown) {
          inputNoteOff(note);
          key.classList.remove('active');
        }
      });
      key.addEventListener('mouseup', () => {
        inputNoteOff(note);
        key.classList.remove('active');
        isMouseDown = false;
      });
    }

    // Black keys
    for (let i = 0; i < 7; i++) {
      if (blackNotes[i] === -1) continue;
      const note = octBase + blackNotes[i];
      const key = document.createElement('div');
      key.className = 'piano-key black-key';
      key.dataset.note = note;
      // White key stride = 38px (border-box) + 1px margin = 39px
      const whiteStride = 39;
      const blackW = 24;
      const offset = oct * 7 * whiteStride + (i + 1) * whiteStride - blackW / 2;
      key.style.left = offset + 'px';
      container.appendChild(key);

      key.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isMouseDown = true;
        inputNoteOn(note, 100);
        key.classList.add('active');
      });
      key.addEventListener('mouseenter', () => {
        if (isMouseDown) {
          inputNoteOn(note, 80);
          key.classList.add('active');
        }
      });
      key.addEventListener('mouseleave', () => {
        if (isMouseDown) {
          inputNoteOff(note);
          key.classList.remove('active');
        }
      });
      key.addEventListener('mouseup', () => {
        inputNoteOff(note);
        key.classList.remove('active');
        isMouseDown = false;
      });
    }
  }

  document.addEventListener('mouseup', () => {
    isMouseDown = false;
    container.querySelectorAll('.piano-key.active').forEach(k => {
      const note = parseInt(k.dataset.note);
      inputNoteOff(note);
      k.classList.remove('active');
    });
  });
}

// ─── MIDI ───────────────────────────────────────────────────────────────────

function initMIDI() {
  if (!navigator.requestMIDIAccess) return;
  navigator.requestMIDIAccess().then(midi => {
    const midiStatus = document.getElementById('midi-status');

    function onMIDIMessage(e) {
      const [status, data1, data2] = e.data;
      const cmd = status & 0xf0;

      if (cmd === 0x90 && data2 > 0) {
        inputNoteOn(data1, data2);
      } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
        inputNoteOff(data1);
      } else if (cmd === 0xb0) {
        // CC mapping
        const val = data2 / 127;
        switch (data1) {
          case 1: // Mod wheel
            sendParam('mod.0.amount', val); break;
          case 64: // Sustain pedal
            sustainPedalOn = data2 >= 64;
            if (!sustainPedalOn) {
              sustainedNotes.forEach(n => noteOff(n));
              sustainedNotes = [];
            }
            updateSustainIndicator();
            break;
          case 71: // Resonance
            sendParam('filterResonance', val); break;
          case 74: // Cutoff
            sendParam('filterCutoff', 20 * Math.pow(1000, val)); break;
        }
      } else if (cmd === 0xe0) {
        // Pitch bend
        const bend = ((data2 << 7) | data1) / 8192 - 1; // -1 to +1
        sendParam('pitchBend', bend);
      }
    }

    for (const input of midi.inputs.values()) {
      input.onmidimessage = onMIDIMessage;
    }
    midi.onstatechange = () => {
      for (const input of midi.inputs.values()) {
        input.onmidimessage = onMIDIMessage;
      }
      if (midiStatus) {
        const count = [...midi.inputs.values()].length;
        midiStatus.textContent = count > 0 ? `MIDI: ${count} device(s)` : 'MIDI: No devices';
      }
    };

    if (midiStatus) {
      const count = [...midi.inputs.values()].length;
      midiStatus.textContent = count > 0 ? `MIDI: ${count} device(s)` : 'MIDI: No devices';
    }
  }).catch(() => {});
}

// ─── Preset State Capture ────────────────────────────────────────────────────

function getCurrentState() {
  // Read all slider/select/checkbox values from UI with inverse transforms
  function readSlider(id, inverse) {
    const el = document.getElementById(id);
    if (!el) return 0;
    const raw = parseFloat(el.value);
    return inverse ? inverse(raw) : raw;
  }
  function readSelect(id, numeric) {
    const el = document.getElementById(id);
    if (!el) return 0;
    return numeric ? parseInt(el.value) : el.value;
  }
  function readCheckbox(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  const state = {
    osc1Waveform: readSelect('osc1-wave', true),
    osc2Waveform: readSelect('osc2-wave', true),
    osc1Level: readSlider('osc1-level'),
    osc2Level: readSlider('osc2-level'),
    osc2Detune: readSlider('osc2-detune'),
    osc2Octave: readSelect('osc2-octave', true),
    pulseWidth: readSlider('pulse-width'),
    subLevel: readSlider('sub-level'),
    oscSync: readCheckbox('osc-sync'),
    ringMod: readCheckbox('ring-mod'),

    filterType: readSelect('filter-type', true),
    filterMode: readSelect('filter-mode', true),
    filterCutoff: readSlider('filter-cutoff', v => 20 * Math.pow(1000, v)),
    filterResonance: readSlider('filter-reso'),
    filterEnvAmount: readSlider('filter-env-amt'),
    filterKeyTrack: readSlider('filter-keytrack'),

    ampAttack: readSlider('amp-a', v => v * v * 5),
    ampDecay: readSlider('amp-d', v => v * v * 5),
    ampSustain: readSlider('amp-s'),
    ampRelease: readSlider('amp-r', v => v * v * 10),

    filterAttack: readSlider('flt-a', v => v * v * 5),
    filterDecay: readSlider('flt-d', v => v * v * 5),
    filterSustain: readSlider('flt-s'),
    filterRelease: readSlider('flt-r', v => v * v * 10),

    modAttack: readSlider('mod-a', v => v * v * 5),
    modDecay: readSlider('mod-d', v => v * v * 5),
    modSustain: readSlider('mod-s'),
    modRelease: readSlider('mod-r', v => v * v * 10),

    lfo1Rate: readSlider('lfo1-rate', v => 0.01 * Math.pow(5000, v)),
    lfo1Waveform: readSelect('lfo1-wave', true),
    lfo1Sync: readCheckbox('lfo1-sync'),
    lfo1Delay: readSlider('lfo1-delay', v => v * 2),
    lfo1FadeIn: readSlider('lfo1-fadein', v => v * 2),

    lfo2Rate: readSlider('lfo2-rate', v => 0.01 * Math.pow(5000, v)),
    lfo2Waveform: readSelect('lfo2-wave', true),
    lfo2Sync: readCheckbox('lfo2-sync'),
    lfo2Delay: readSlider('lfo2-delay', v => v * 2),
    lfo2FadeIn: readSlider('lfo2-fadein', v => v * 2),

    driftAmount: readSlider('drift'),
    saturationDrive: readSlider('saturation', v => 1 + v * 4),

    unisonCount: readSelect('unison-count', true),
    unisonDetune: readSlider('unison-detune'),
    unisonSpread: readSlider('unison-spread'),

    crossModAmount: readSlider('cross-mod'),
    hpfCutoff: readSlider('hpf-cutoff', v => 20 * Math.pow(100, v)),
    noiseLevel: readSlider('noise-level'),

    masterVolume: readSlider('master-vol'),

    portamento: readCheckbox('portamento-on'),
    portamentoTime: readSlider('portamento-time', v => 0.001 * Math.pow(2000, v)),
    pitchBendRange: readSelect('pitch-bend-range', true),

    monoMode,
    notePriority,

    mod: [0, 1, 2, 3].map(i => ({
      src: readSelect(`mod${i}-src`),
      dst: readSelect(`mod${i}-dst`),
      amount: readSlider(`mod${i}-amt`)
    })),

    ...arp.getState(),

    fx: JSON.parse(JSON.stringify(currentFxState))
  };

  return state;
}

// ─── localStorage Persistence ───────────────────────────────────────────────

const USER_PRESETS_KEY = 'va-synth-user-presets';

function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem(USER_PRESETS_KEY)) || {}; }
  catch { return {}; }
}

function saveUserPresetsToStorage(presets) {
  localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
}

// ─── Presets ────────────────────────────────────────────────────────────────

const PRESETS = {
  'Init': {},

  'Warm Pad': {
    osc1Waveform: 0, osc2Waveform: 0, osc2Level: 0.5, osc2Detune: 7,
    filterCutoff: 2000, filterResonance: 0.2, filterEnvAmount: 0.3,
    ampAttack: 0.5, ampDecay: 0.5, ampSustain: 0.8, ampRelease: 1.0,
    filterAttack: 0.3, filterDecay: 0.8, filterSustain: 0.3, filterRelease: 0.8,
    driftAmount: 0.5, unisonCount: 4, unisonDetune: 15, unisonSpread: 0.7,
    fx: {
      chorus: { enabled: true, rate: 0.12, depth: 0.55, mix: 0.35 },
      reverb: { enabled: true, size: 0.85, damping: 0.4, mix: 0.35 }
    }
  },

  'Pluck Bass': {
    osc1Waveform: 0, osc2Level: 0, subLevel: 0.4,
    filterCutoff: 800, filterResonance: 0.3, filterEnvAmount: 0.7,
    ampAttack: 0.001, ampDecay: 0.3, ampSustain: 0.0, ampRelease: 0.1,
    filterAttack: 0.001, filterDecay: 0.2, filterSustain: 0.0, filterRelease: 0.1,
    saturationDrive: 2.0,
    fx: {
      distortion: { enabled: true, drive: 0.15 },
      eq: { enabled: true, low: 0.65, mid: 0.45, high: 0.4 }
    }
  },

  'Acid Lead': {
    osc1Waveform: 0, osc2Level: 0,
    filterCutoff: 500, filterResonance: 0.85, filterEnvAmount: 0.8, filterKeyTrack: 0.5,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.6, ampRelease: 0.1,
    filterAttack: 0.001, filterDecay: 0.15, filterSustain: 0.1, filterRelease: 0.1,
    saturationDrive: 1.5,
    fx: {
      distortion: { enabled: true, drive: 0.25 },
      delay: { enabled: true, time: 0.16, feedback: 0.35, mix: 0.2 }
    }
  },

  'PWM Strings': {
    osc1Waveform: 1, osc2Waveform: 1, osc2Level: 0.5, osc2Detune: 5,
    pulseWidth: 0.3, filterCutoff: 4000, filterResonance: 0.1,
    ampAttack: 0.4, ampDecay: 0.3, ampSustain: 0.8, ampRelease: 0.6,
    driftAmount: 0.4, unisonCount: 2, unisonDetune: 8,
    mod: [{ src: 'lfo1', dst: 'pwm', amount: 0.6 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 }],
    lfo1Rate: 0.3, lfo1Waveform: 1,
    fx: {
      chorus: { enabled: true, rate: 0.08, depth: 0.45, mix: 0.3 },
      reverb: { enabled: true, size: 0.75, damping: 0.5, mix: 0.25 }
    }
  },

  'Reso Sweep': {
    osc1Waveform: 0, filterCutoff: 200, filterResonance: 0.7,
    ampAttack: 0.01, ampDecay: 0.5, ampSustain: 0.5, ampRelease: 0.5,
    mod: [{ src: 'lfo1', dst: 'cutoff', amount: 0.5 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 }],
    lfo1Rate: 0.2, lfo1Waveform: 1,
    fx: {
      delay: { enabled: true, time: 0.19, feedback: 0.45, mix: 0.25 },
      reverb: { enabled: true, size: 0.7, damping: 0.5, mix: 0.2 }
    }
  },

  'Laser Harp': {
    osc1Waveform: 0, osc2Waveform: 0, osc2Level: 0.8, osc2Octave: 12,
    oscSync: true, filterCutoff: 6000, filterResonance: 0.15,
    filterEnvAmount: 0.5, filterKeyTrack: 0.5,
    ampAttack: 0.001, ampDecay: 0.4, ampSustain: 0.0, ampRelease: 0.15,
    filterAttack: 0.001, filterDecay: 0.3, filterSustain: 0.0, filterRelease: 0.15,
    modAttack: 0.001, modDecay: 0.5, modSustain: 0.0, modRelease: 0.1,
    mod: [{ src: 'modEnv', dst: 'osc2Pitch', amount: 0.7 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 }],
    saturationDrive: 1.3,
    fx: {
      distortion: { enabled: true, drive: 0.12 },
      delay: { enabled: true, time: 0.14, feedback: 0.3, mix: 0.2 }
    }
  },

  'Deep Sub': {
    osc1Waveform: 0, osc2Waveform: 3, osc2Level: 0.3, osc2Octave: -12,
    subLevel: 0.6, filterCutoff: 400, filterResonance: 0.15, filterEnvAmount: 0.5,
    ampAttack: 0.005, ampDecay: 0.4, ampSustain: 0.6, ampRelease: 0.2,
    filterAttack: 0.001, filterDecay: 0.3, filterSustain: 0.2, filterRelease: 0.15,
    saturationDrive: 1.8, monoMode: 'mono', portamento: true, portamentoTime: 0.06,
    fx: {
      distortion: { enabled: true, drive: 0.2 },
      eq: { enabled: true, low: 0.7, mid: 0.4, high: 0.35 }
    }
  },

  'Ambient Wash': {
    osc1Waveform: 2, osc2Waveform: 3, osc2Level: 0.4, osc2Detune: 3,
    filterCutoff: 3000, filterResonance: 0.1, filterEnvAmount: -0.2,
    ampAttack: 1.2, ampDecay: 1.0, ampSustain: 0.7, ampRelease: 2.5,
    filterAttack: 0.8, filterDecay: 1.5, filterSustain: 0.5, filterRelease: 2.0,
    driftAmount: 0.6, unisonCount: 6, unisonDetune: 20, unisonSpread: 0.9,
    lfo1Rate: 0.08, lfo1Waveform: 0,
    mod: [{ src: 'lfo1', dst: 'cutoff', amount: 0.15 },
          { src: 'lfo2', dst: 'pwm', amount: 0.3 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 }],
    lfo2Rate: 0.15, lfo2Waveform: 1,
    fx: {
      chorus: { enabled: true, rate: 0.06, depth: 0.6, mix: 0.4 },
      delay: { enabled: true, time: 0.35, feedback: 0.5, mix: 0.25 },
      reverb: { enabled: true, size: 0.95, damping: 0.3, mix: 0.45 }
    }
  },

  'Funk Clav': {
    osc1Waveform: 1, osc2Waveform: 1, osc2Level: 0.6, osc2Octave: 12,
    pulseWidth: 0.15, filterCutoff: 3500, filterResonance: 0.4, filterEnvAmount: 0.6,
    filterKeyTrack: 0.4,
    ampAttack: 0.001, ampDecay: 0.15, ampSustain: 0.0, ampRelease: 0.08,
    filterAttack: 0.001, filterDecay: 0.12, filterSustain: 0.0, filterRelease: 0.08,
    saturationDrive: 1.4,
    fx: {
      distortion: { enabled: true, drive: 0.08 },
      delay: { enabled: true, time: 0.12, feedback: 0.25, mix: 0.15 },
      eq: { enabled: true, low: 0.4, mid: 0.6, high: 0.55 }
    }
  },

  'Brass Stab': {
    osc1Waveform: 0, osc2Waveform: 0, osc2Level: 0.7, osc2Detune: 10,
    filterCutoff: 1200, filterResonance: 0.15, filterEnvAmount: 0.7,
    filterKeyTrack: 0.3,
    ampAttack: 0.02, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.15,
    filterAttack: 0.02, filterDecay: 0.25, filterSustain: 0.4, filterRelease: 0.15,
    unisonCount: 4, unisonDetune: 12, unisonSpread: 0.5,
    saturationDrive: 1.6, driftAmount: 0.3,
    fx: {
      eq: { enabled: true, low: 0.45, mid: 0.55, high: 0.5 },
      reverb: { enabled: true, size: 0.5, damping: 0.6, mix: 0.15 }
    }
  },

  'Supersaw Lead': {
    osc1Waveform: 0, osc2Waveform: 0, osc2Level: 0.8, osc2Detune: 15,
    filterCutoff: 6000, filterResonance: 0.1, filterEnvAmount: 0.2,
    filterKeyTrack: 0.3,
    ampAttack: 0.005, ampDecay: 0.3, ampSustain: 0.8, ampRelease: 0.2,
    filterAttack: 0.005, filterDecay: 0.4, filterSustain: 0.6, filterRelease: 0.2,
    unisonCount: 8, unisonDetune: 25, unisonSpread: 0.8,
    driftAmount: 0.2, monoMode: 'mono', portamento: true, portamentoTime: 0.04,
    fx: {
      chorus: { enabled: true, rate: 0.1, depth: 0.3, mix: 0.2 },
      delay: { enabled: true, time: 0.17, feedback: 0.3, mix: 0.15 },
      reverb: { enabled: true, size: 0.6, damping: 0.5, mix: 0.2 }
    }
  },

  'Wobble Bass': {
    osc1Waveform: 0, osc2Waveform: 1, osc2Level: 0.5, osc2Octave: 0,
    subLevel: 0.3, pulseWidth: 0.4,
    filterCutoff: 300, filterResonance: 0.6, filterEnvAmount: 0.3,
    ampAttack: 0.001, ampDecay: 0.2, ampSustain: 0.8, ampRelease: 0.1,
    filterAttack: 0.001, filterDecay: 0.1, filterSustain: 0.7, filterRelease: 0.1,
    saturationDrive: 2.5, monoMode: 'mono',
    lfo1Rate: 3.0, lfo1Waveform: 0, lfo1Sync: true,
    mod: [{ src: 'lfo1', dst: 'cutoff', amount: 0.7 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 },
          { src: 'off', dst: 'off', amount: 0 }],
    fx: {
      distortion: { enabled: true, drive: 0.35 },
      eq: { enabled: true, low: 0.65, mid: 0.5, high: 0.4 }
    }
  },

  'Crystal Bell': {
    osc1Waveform: 3, osc2Waveform: 2, osc2Level: 0.6, osc2Octave: 12,
    ringMod: true, crossModAmount: 0.3,
    filterCutoff: 8000, filterResonance: 0.05, filterEnvAmount: -0.3,
    ampAttack: 0.001, ampDecay: 0.8, ampSustain: 0.0, ampRelease: 1.5,
    filterAttack: 0.001, filterDecay: 1.0, filterSustain: 0.0, filterRelease: 1.0,
    modAttack: 0.001, modDecay: 0.6, modSustain: 0.0, modRelease: 0.3,
    fx: {
      delay: { enabled: true, time: 0.22, feedback: 0.35, mix: 0.2 },
      reverb: { enabled: true, size: 0.9, damping: 0.3, mix: 0.4 }
    }
  },

  'Vintage Keys': {
    osc1Waveform: 3, osc2Waveform: 2, osc2Level: 0.3, osc2Octave: 12,
    filterCutoff: 3000, filterResonance: 0.1, filterEnvAmount: 0.4,
    filterKeyTrack: 0.5,
    ampAttack: 0.005, ampDecay: 0.5, ampSustain: 0.3, ampRelease: 0.3,
    filterAttack: 0.001, filterDecay: 0.4, filterSustain: 0.1, filterRelease: 0.3,
    driftAmount: 0.4,
    fx: {
      chorus: { enabled: true, rate: 0.15, depth: 0.4, mix: 0.25 },
      reverb: { enabled: true, size: 0.45, damping: 0.6, mix: 0.15 }
    }
  },

  'Space Arp': {
    osc1Waveform: 0, osc2Waveform: 1, osc2Level: 0.4, osc2Detune: 5,
    pulseWidth: 0.35, filterCutoff: 4000, filterResonance: 0.25,
    filterEnvAmount: 0.5, filterKeyTrack: 0.3,
    ampAttack: 0.001, ampDecay: 0.25, ampSustain: 0.0, ampRelease: 0.3,
    filterAttack: 0.001, filterDecay: 0.2, filterSustain: 0.0, filterRelease: 0.25,
    driftAmount: 0.3,
    arpEnabled: true, arpBpm: 135, arpDivision: '1/16', arpMode: 'up',
    arpOctaves: 3, arpGate: 0.6, arpSwing: 0,
    fx: {
      delay: { enabled: true, time: 0.22, feedback: 0.55, mix: 0.35 },
      reverb: { enabled: true, size: 0.85, damping: 0.4, mix: 0.3 }
    }
  },

};

const PRESET_DEFAULTS = {
  osc1Waveform: 0, osc2Waveform: 0, osc1Level: 1.0, osc2Level: 0.0,
  osc2Detune: 0, osc2Octave: 0, pulseWidth: 0.5, subLevel: 0,
  oscSync: false, ringMod: false,
  filterType: 0, filterMode: 0, filterCutoff: 8000, filterResonance: 0,
  filterEnvAmount: 0, filterKeyTrack: 0,
  ampAttack: 0.01, ampDecay: 0.2, ampSustain: 0.7, ampRelease: 0.3,
  filterAttack: 0.01, filterDecay: 0.3, filterSustain: 0.3, filterRelease: 0.3,
  modAttack: 0.01, modDecay: 0.3, modSustain: 0, modRelease: 0.1,
  lfo1Rate: 2, lfo1Waveform: 0, lfo1Sync: true,
  lfo2Rate: 0.5, lfo2Waveform: 0, lfo2Sync: true,
  driftAmount: 0.3, saturationDrive: 1.0,
  unisonCount: 1, unisonDetune: 10, unisonSpread: 0.5,
  portamento: false, portamentoTime: 0.1,
  pitchBendRange: 2,
  crossModAmount: 0,
  hpfCutoff: 20,
  noiseLevel: 0,
  lfo1Delay: 0, lfo1FadeIn: 0,
  lfo2Delay: 0, lfo2FadeIn: 0,
  masterVolume: 0.7, masterPan: 0,
  monoMode: 'poly', notePriority: 'last',
  mod: [
    { src: 'off', dst: 'off', amount: 0 },
    { src: 'off', dst: 'off', amount: 0 },
    { src: 'off', dst: 'off', amount: 0 },
    { src: 'off', dst: 'off', amount: 0 }
  ],
  arpEnabled: false, arpBpm: 120, arpDivision: '1/8', arpMode: 'up',
  arpOctaves: 1, arpGate: 0.8, arpSwing: 0
};

const FX_DEFAULTS = {
  distortion: { enabled: false, drive: 0.1 },
  chorus: { enabled: false, rate: 0.1, depth: 0.5, mix: 0.3 },
  delay: { enabled: false, time: 0.19, feedback: 0.4, mix: 0.3 },
  reverb: { enabled: false, size: 0.8, damping: 0.5, mix: 0.2 },
  eq: { enabled: false, low: 0.5, mid: 0.5, high: 0.5 }
};

function loadPreset(name) {
  // Resolve preset data: check user presets first, then factory
  let preset;
  const sel = document.getElementById('preset-select');
  const selectedValue = sel ? sel.value : '';

  if (selectedValue.startsWith('user:')) {
    const userPresets = loadUserPresets();
    preset = userPresets[name];
  } else {
    preset = PRESETS[name];
  }
  if (!preset) return;

  // Separate FX state from synth params
  const { fx: presetFx, ...synthPreset } = preset;
  const merged = { ...PRESET_DEFAULTS, ...synthPreset };

  if (synthNode) {
    synthNode.port.postMessage({ type: 'preset', params: merged });
  }

  // Update UI controls to match
  updateUIFromPreset(merged);

  // Load FX state
  const fxMerged = JSON.parse(JSON.stringify(FX_DEFAULTS));
  if (presetFx) {
    for (const key of Object.keys(fxMerged)) {
      if (presetFx[key]) Object.assign(fxMerged[key], presetFx[key]);
    }
  }
  currentFxState = fxMerged;
  updateFxUIFromState(fxMerged);

  // Update delete button visibility
  updateDeleteButtonVisibility();
}

function updateFxUIFromState(fx) {
  function setSlider(id, val) {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
  }
  function setCheckbox(id, val) {
    const el = document.getElementById(id);
    if (el) { el.checked = val; el.dispatchEvent(new Event('change')); }
  }

  setCheckbox('fx-dist-on', fx.distortion.enabled);
  setSlider('fx-dist-drive', fx.distortion.drive);

  setCheckbox('fx-eq-on', fx.eq.enabled);
  setSlider('fx-eq-low', fx.eq.low);
  setSlider('fx-eq-mid', fx.eq.mid);
  setSlider('fx-eq-high', fx.eq.high);

  setCheckbox('fx-chorus-on', fx.chorus.enabled);
  setSlider('fx-chorus-rate', fx.chorus.rate);
  setSlider('fx-chorus-depth', fx.chorus.depth);
  setSlider('fx-chorus-mix', fx.chorus.mix);

  setCheckbox('fx-delay-on', fx.delay.enabled);
  setSlider('fx-delay-time', fx.delay.time);
  setSlider('fx-delay-fb', fx.delay.feedback);
  setSlider('fx-delay-mix', fx.delay.mix);

  setCheckbox('fx-reverb-on', fx.reverb.enabled);
  setSlider('fx-reverb-size', fx.reverb.size);
  setSlider('fx-reverb-damp', fx.reverb.damping);
  setSlider('fx-reverb-mix', fx.reverb.mix);
}

function updateUIFromPreset(p) {
  // Helper to set slider value and trigger display update
  function setSlider(id, rawValue) {
    const el = document.getElementById(id);
    if (el) { el.value = rawValue; el.dispatchEvent(new Event('input')); }
  }
  function setSelect(id, value) {
    const el = document.getElementById(id);
    if (el) { el.value = value; el.dispatchEvent(new Event('change')); }
  }
  function setCheckbox(id, value) {
    const el = document.getElementById(id);
    if (el) { el.checked = value; el.dispatchEvent(new Event('change')); }
  }

  setSelect('osc1-wave', p.osc1Waveform);
  setSelect('osc2-wave', p.osc2Waveform);
  setSlider('osc1-level', p.osc1Level);
  setSlider('osc2-level', p.osc2Level);
  setSlider('osc2-detune', p.osc2Detune);
  setSelect('osc2-octave', p.osc2Octave);
  setSlider('pulse-width', p.pulseWidth);
  setSlider('sub-level', p.subLevel);
  setCheckbox('osc-sync', p.oscSync);
  setCheckbox('ring-mod', p.ringMod);

  setSelect('filter-type', p.filterType);
  setSelect('filter-mode', p.filterMode);
  // Cutoff is log mapped: raw = log(cutoff/20) / log(1000)
  setSlider('filter-cutoff', Math.log(p.filterCutoff / 20) / Math.log(1000));
  setSlider('filter-reso', p.filterResonance);
  setSlider('filter-env-amt', p.filterEnvAmount);
  setSlider('filter-keytrack', p.filterKeyTrack);

  // ADSR: raw = sqrt(val/maxTime)
  setSlider('amp-a', Math.sqrt(p.ampAttack / 5));
  setSlider('amp-d', Math.sqrt(p.ampDecay / 5));
  setSlider('amp-s', p.ampSustain);
  setSlider('amp-r', Math.sqrt(p.ampRelease / 10));

  setSlider('flt-a', Math.sqrt(p.filterAttack / 5));
  setSlider('flt-d', Math.sqrt(p.filterDecay / 5));
  setSlider('flt-s', p.filterSustain);
  setSlider('flt-r', Math.sqrt(p.filterRelease / 10));

  // LFO rates: inverse of 0.01 * Math.pow(5000, v) → log(v/0.01) / log(5000)
  if (p.lfo1Rate !== undefined) setSlider('lfo1-rate', Math.log(p.lfo1Rate / 0.01) / Math.log(5000));
  if (p.lfo1Waveform !== undefined) setSelect('lfo1-wave', p.lfo1Waveform);
  if (p.lfo1Sync !== undefined) setCheckbox('lfo1-sync', p.lfo1Sync);
  if (p.lfo2Rate !== undefined) setSlider('lfo2-rate', Math.log(p.lfo2Rate / 0.01) / Math.log(5000));
  if (p.lfo2Waveform !== undefined) setSelect('lfo2-wave', p.lfo2Waveform);
  if (p.lfo2Sync !== undefined) setCheckbox('lfo2-sync', p.lfo2Sync);

  setSlider('drift', p.driftAmount);
  setSlider('saturation', (p.saturationDrive - 1) / 4);

  setSelect('unison-count', p.unisonCount);
  setSlider('unison-detune', p.unisonDetune);
  setSlider('unison-spread', p.unisonSpread);
  setSlider('master-vol', p.masterVolume);

  // Mod Matrix (update UI only, no events — preset message already sent full state)
  if (p.mod) {
    for (let i = 0; i < 4; i++) {
      const slot = p.mod[i];
      if (!slot) continue;
      const srcEl = document.getElementById(`mod${i}-src`);
      const dstEl = document.getElementById(`mod${i}-dst`);
      const amtEl = document.getElementById(`mod${i}-amt`);
      if (srcEl) srcEl.value = slot.src;
      if (dstEl) dstEl.value = slot.dst;
      if (amtEl) amtEl.value = slot.amount;
    }
  }

  // Performance
  if (p.portamento !== undefined) setCheckbox('portamento-on', p.portamento);
  if (p.portamentoTime !== undefined) setSlider('portamento-time', Math.log(p.portamentoTime / 0.001) / Math.log(2000));
  if (p.pitchBendRange !== undefined) setSelect('pitch-bend-range', p.pitchBendRange);
  if (p.crossModAmount !== undefined) setSlider('cross-mod', p.crossModAmount);
  if (p.hpfCutoff !== undefined) setSlider('hpf-cutoff', Math.log(p.hpfCutoff / 20) / Math.log(100));
  if (p.noiseLevel !== undefined) setSlider('noise-level', p.noiseLevel);
  if (p.lfo1Delay !== undefined) setSlider('lfo1-delay', p.lfo1Delay / 2);
  if (p.lfo1FadeIn !== undefined) setSlider('lfo1-fadein', p.lfo1FadeIn / 2);
  if (p.lfo2Delay !== undefined) setSlider('lfo2-delay', p.lfo2Delay / 2);
  if (p.lfo2FadeIn !== undefined) setSlider('lfo2-fadein', p.lfo2FadeIn / 2);
  if (p.monoMode !== undefined) {
    setSelect('mono-mode', p.monoMode);
    monoMode = p.monoMode;
    const priRow = document.getElementById('note-priority-row');
    if (priRow) priRow.style.display = monoMode === 'poly' ? 'none' : 'flex';
  }
  if (p.notePriority !== undefined) {
    setSelect('note-priority', p.notePriority);
    notePriority = p.notePriority;
  }

  // Mod envelope ADSR
  setSlider('mod-a', Math.sqrt(p.modAttack / 5));
  setSlider('mod-d', Math.sqrt(p.modDecay / 5));
  setSlider('mod-s', p.modSustain);
  setSlider('mod-r', Math.sqrt(p.modRelease / 10));

  // Arpeggiator
  if (p.arpEnabled !== undefined) {
    setCheckbox('arp-on', p.arpEnabled);
    arp.setEnabled(p.arpEnabled);
  }
  if (p.arpBpm !== undefined) {
    setSlider('arp-bpm', p.arpBpm);
    arp.bpm = p.arpBpm;
  }
  if (p.arpDivision !== undefined) {
    setSelect('arp-division', p.arpDivision);
    arp.division = p.arpDivision;
  }
  if (p.arpMode !== undefined) {
    setSelect('arp-mode', p.arpMode);
    arp.mode = p.arpMode;
  }
  if (p.arpOctaves !== undefined) {
    setSelect('arp-octaves', p.arpOctaves);
    arp.octaveRange = p.arpOctaves;
  }
  if (p.arpGate !== undefined) {
    setSlider('arp-gate', p.arpGate);
    arp.gate = p.arpGate;
  }
  if (p.arpSwing !== undefined) {
    setSlider('arp-swing', p.arpSwing);
    arp.swing = p.arpSwing;
  }
}

function rebuildPresetList(selectValue) {
  const sel = document.getElementById('preset-select');
  if (!sel) return;

  // Remember current selection if not explicitly setting one
  if (selectValue === undefined) selectValue = sel.value;

  sel.innerHTML = '';
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = '-- Preset --';
  sel.appendChild(emptyOpt);

  // Factory presets optgroup
  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory';
  for (const name of Object.keys(PRESETS)) {
    const opt = document.createElement('option');
    opt.value = 'factory:' + name;
    opt.textContent = name;
    factoryGroup.appendChild(opt);
  }
  sel.appendChild(factoryGroup);

  // User presets optgroup
  const userPresets = loadUserPresets();
  const userNames = Object.keys(userPresets);
  if (userNames.length > 0) {
    const userGroup = document.createElement('optgroup');
    userGroup.label = 'User';
    for (const name of userNames) {
      const opt = document.createElement('option');
      opt.value = 'user:' + name;
      opt.textContent = name;
      userGroup.appendChild(opt);
    }
    sel.appendChild(userGroup);
  }

  // Restore selection
  if (selectValue) sel.value = selectValue;
  updateDeleteButtonVisibility();
}

function updateDeleteButtonVisibility() {
  const sel = document.getElementById('preset-select');
  const delBtn = document.getElementById('delete-preset-btn');
  if (!sel || !delBtn) return;
  delBtn.style.display = sel.value.startsWith('user:') ? '' : 'none';
}

function getPresetNameFromValue(value) {
  if (!value) return '';
  const idx = value.indexOf(':');
  return idx >= 0 ? value.substring(idx + 1) : value;
}

function initPresets() {
  const sel = document.getElementById('preset-select');
  if (!sel) return;

  rebuildPresetList('');

  sel.addEventListener('change', () => {
    const val = sel.value;
    if (!val) return;
    const name = getPresetNameFromValue(val);
    loadPreset(name);
    updateDeleteButtonVisibility();
  });

  // Save button
  document.getElementById('save-preset-btn')?.addEventListener('click', () => {
    const val = sel.value;
    if (val.startsWith('user:')) {
      // Overwrite existing user preset
      const name = getPresetNameFromValue(val);
      const userPresets = loadUserPresets();
      userPresets[name] = getCurrentState();
      saveUserPresetsToStorage(userPresets);
      _showButtonFeedback('save-preset-btn', 'Saved!');
    } else {
      // No user preset selected — behave like Save As
      _doSaveAs();
    }
  });

  // Save As button
  document.getElementById('saveas-preset-btn')?.addEventListener('click', _doSaveAs);

  // Delete button
  document.getElementById('delete-preset-btn')?.addEventListener('click', () => {
    const val = sel.value;
    if (!val.startsWith('user:')) return;
    const name = getPresetNameFromValue(val);
    if (!confirm(`Delete user preset "${name}"?`)) return;
    const userPresets = loadUserPresets();
    delete userPresets[name];
    saveUserPresetsToStorage(userPresets);
    rebuildPresetList('');
  });

  // Export button
  document.getElementById('export-preset-btn')?.addEventListener('click', () => {
    const json = JSON.stringify(getCurrentState(), null, 2);
    navigator.clipboard.writeText(json).then(() => {
      _showButtonFeedback('export-preset-btn', 'Copied!');
    }).catch(() => {
      // Fallback: show in a prompt for manual copy
      prompt('Copy preset JSON:', json);
    });
  });

  // Import button
  document.getElementById('import-preset-btn')?.addEventListener('click', () => {
    navigator.clipboard.readText().then(text => {
      _importPresetFromJSON(text);
    }).catch(() => {
      // Fallback: ask user to paste
      const text = prompt('Paste preset JSON:');
      if (text) _importPresetFromJSON(text);
    });
  });
}

function _doSaveAs() {
  const name = prompt('Preset name:');
  if (!name || !name.trim()) return;
  const trimmed = name.trim();
  const userPresets = loadUserPresets();
  userPresets[trimmed] = getCurrentState();
  saveUserPresetsToStorage(userPresets);
  rebuildPresetList('user:' + trimmed);
}

function _importPresetFromJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    alert('Invalid JSON');
    return;
  }
  if (typeof data !== 'object' || data === null) {
    alert('Invalid preset data');
    return;
  }

  // Apply the imported preset
  const { fx: importedFx, ...synthParams } = data;
  const merged = { ...PRESET_DEFAULTS, ...synthParams };

  if (synthNode) {
    synthNode.port.postMessage({ type: 'preset', params: merged });
  }
  updateUIFromPreset(merged);

  // FX
  const fxMerged = JSON.parse(JSON.stringify(FX_DEFAULTS));
  if (importedFx) {
    for (const key of Object.keys(fxMerged)) {
      if (importedFx[key]) Object.assign(fxMerged[key], importedFx[key]);
    }
  }
  currentFxState = fxMerged;
  updateFxUIFromState(fxMerged);

  // Reset dropdown since this is a transient import
  const sel = document.getElementById('preset-select');
  if (sel) sel.value = '';
  updateDeleteButtonVisibility();

  _showButtonFeedback('import-preset-btn', 'Loaded!');
}

function _showButtonFeedback(btnId, text) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('start-btn').addEventListener('click', initAudio);
  setupBindings();
  initOnScreenKeyboard();
  initPresets();
  updateOctaveDisplay();
  updateVoiceDisplay();
});
