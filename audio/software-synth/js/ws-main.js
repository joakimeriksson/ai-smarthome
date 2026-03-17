// WaveSynth — Main thread controller
// Voice allocation, UI bindings, wave sequence editor
// Keyboard/MIDI handled by shared keyboard.js

const NUM_VOICES = 8;

const WAVE_NAMES = [
  'Sine', 'Triangle', 'Saw', 'Square',
  'Pulse 25%', 'Pulse 12%', 'Half Sine', 'Rectified',
  'Organ 1', 'Organ 2', 'Organ 3',
  'Brass', 'Strings', 'Choir',
  'Bell', 'Metallic',
  'Digital 1', 'Digital 2', 'FM',
  'Noise'
];

// ─── Audio Engine ───────────────────────────────────────────────────────────

let audioCtx = null;
let workletNode = null;
let analyser = null;
let keyboard = null;

// Voice allocation
const voices = new Array(NUM_VOICES).fill(null).map(() => ({
  note: -1, active: false, age: 0
}));
let voiceAge = 0;
let sustainOn = false;
const sustainedNotes = new Set();

function allocateVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i].note === note && voices[i].active) return i;
  }
  for (let i = 0; i < NUM_VOICES; i++) {
    if (!voices[i].active) {
      voices[i].note = note;
      voices[i].active = true;
      voices[i].age = ++voiceAge;
      return i;
    }
  }
  let oldest = 0;
  for (let i = 1; i < NUM_VOICES; i++) {
    if (voices[i].age < voices[oldest].age) oldest = i;
  }
  voices[oldest].note = note;
  voices[oldest].active = true;
  voices[oldest].age = ++voiceAge;
  return oldest;
}

function releaseVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) {
    if (voices[i].note === note && voices[i].active) {
      voices[i].active = false;
      return i;
    }
  }
  return -1;
}

function noteOn(note, velocity = 100) {
  if (!workletNode) return;
  const v = allocateVoice(note);
  workletNode.port.postMessage({ type: 'noteOn', voice: v, note, velocity });
  updateVoiceDisplay();
  if (keyboard) keyboard.highlightKey(note, true);
}

function noteOff(note) {
  if (!workletNode) return;
  if (sustainOn) { sustainedNotes.add(note); return; }
  const v = releaseVoice(note);
  if (v >= 0) {
    workletNode.port.postMessage({ type: 'noteOff', voice: v });
    updateVoiceDisplay();
  }
  if (keyboard) keyboard.highlightKey(note, false);
}

function sendParam(param, value) {
  if (workletNode) workletNode.port.postMessage({ type: 'param', param, value });
}

function sendWaveSeq(osc, steps, loopMode, speed) {
  if (workletNode) {
    workletNode.port.postMessage({
      type: osc === 'A' ? 'waveSeqA' : 'waveSeqB',
      steps, loopMode, speed
    });
  }
}

// ─── Wave Sequence Editor ───────────────────────────────────────────────────

const seqEditorState = {
  osc: 'A', // which oscillator's sequence we're editing
  stepsA: [
    { wave: 0, duration: 500, crossfade: 0.3 },
    { wave: 2, duration: 500, crossfade: 0.3 },
    { wave: 3, duration: 500, crossfade: 0.3 },
    { wave: 1, duration: 500, crossfade: 0.3 }
  ],
  stepsB: [],
  selectedStep: 0,
  loopModeA: 1,
  loopModeB: 0,
  speedA: 1.0,
  speedB: 1.0
};

function getActiveSeqSteps() {
  return seqEditorState.osc === 'A' ? seqEditorState.stepsA : seqEditorState.stepsB;
}

function getActiveLoopMode() {
  return seqEditorState.osc === 'A' ? seqEditorState.loopModeA : seqEditorState.loopModeB;
}

function getActiveSpeed() {
  return seqEditorState.osc === 'A' ? seqEditorState.speedA : seqEditorState.speedB;
}

function setActiveLoopMode(v) {
  if (seqEditorState.osc === 'A') seqEditorState.loopModeA = v;
  else seqEditorState.loopModeB = v;
}

function setActiveSpeed(v) {
  if (seqEditorState.osc === 'A') seqEditorState.speedA = v;
  else seqEditorState.speedB = v;
}

function renderSeqEditor() {
  const stepsContainer = document.getElementById('seq-steps');
  const paramsContainer = document.getElementById('seq-step-params');
  if (!stepsContainer) return;

  const steps = getActiveSeqSteps();
  stepsContainer.innerHTML = '';

  steps.forEach((step, i) => {
    const el = document.createElement('div');
    el.className = 'seq-step' + (i === seqEditorState.selectedStep ? ' selected' : '');
    el.innerHTML = `
      <div class="step-num">${i + 1}</div>
      <div class="step-wave">${WAVE_NAMES[step.wave]}</div>
      <div class="step-dur">${step.duration}ms / ${Math.round(step.crossfade * 100)}%</div>
    `;
    el.onclick = () => { seqEditorState.selectedStep = i; renderSeqEditor(); };
    stepsContainer.appendChild(el);
  });

  // Add button
  if (steps.length < 16) {
    const add = document.createElement('div');
    add.className = 'seq-step-add';
    add.textContent = '+';
    add.onclick = () => {
      steps.push({ wave: 0, duration: 500, crossfade: 0.3 });
      seqEditorState.selectedStep = steps.length - 1;
      renderSeqEditor();
      pushSeqToProcessor();
    };
    stepsContainer.appendChild(add);
  }

  // Selected step params
  if (paramsContainer && steps.length > 0) {
    const idx = Math.min(seqEditorState.selectedStep, steps.length - 1);
    seqEditorState.selectedStep = idx;
    const step = steps[idx];

    paramsContainer.innerHTML = `
      <div class="control-row">
        <label>Wave</label>
        <select id="seq-wave">${WAVE_NAMES.map((n, i) =>
          `<option value="${i}" ${i === step.wave ? 'selected' : ''}>${n}</option>`
        ).join('')}</select>
      </div>
      <div class="control-row">
        <label>Duration</label>
        <input type="range" id="seq-duration" min="50" max="5000" step="10" value="${step.duration}">
        <span class="val" id="seq-duration-val">${step.duration}ms</span>
      </div>
      <div class="control-row">
        <label>X-Fade</label>
        <input type="range" id="seq-crossfade" min="0" max="1" step="0.01" value="${step.crossfade}">
        <span class="val" id="seq-crossfade-val">${Math.round(step.crossfade * 100)}%</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-small btn-danger" id="seq-remove-btn">Remove</button>
      </div>
    `;

    document.getElementById('seq-wave').onchange = (e) => {
      step.wave = parseInt(e.target.value);
      renderSeqEditor();
      pushSeqToProcessor();
    };
    document.getElementById('seq-duration').oninput = (e) => {
      step.duration = parseInt(e.target.value);
      document.getElementById('seq-duration-val').textContent = step.duration + 'ms';
      pushSeqToProcessor();
    };
    document.getElementById('seq-crossfade').oninput = (e) => {
      step.crossfade = parseFloat(e.target.value);
      document.getElementById('seq-crossfade-val').textContent = Math.round(step.crossfade * 100) + '%';
      pushSeqToProcessor();
    };
    document.getElementById('seq-remove-btn').onclick = () => {
      if (steps.length > 1) {
        steps.splice(idx, 1);
        seqEditorState.selectedStep = Math.min(idx, steps.length - 1);
        renderSeqEditor();
        pushSeqToProcessor();
      }
    };
  }

  // Loop mode and speed
  const loopSel = document.getElementById('seq-loop');
  if (loopSel) loopSel.value = getActiveLoopMode();
  const speedSlider = document.getElementById('seq-speed');
  if (speedSlider) speedSlider.value = getActiveSpeed();
  const speedVal = document.getElementById('seq-speed-val');
  if (speedVal) speedVal.textContent = getActiveSpeed().toFixed(1) + 'x';

  // Osc toggle
  document.querySelectorAll('.seq-osc-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.osc === seqEditorState.osc);
  });
}

function pushSeqToProcessor() {
  sendWaveSeq('A', seqEditorState.stepsA, seqEditorState.loopModeA, seqEditorState.speedA);
  sendWaveSeq('B', seqEditorState.stepsB, seqEditorState.loopModeB, seqEditorState.speedB);
}

// ─── UI Binding ─────────────────────────────────────────────────────────────

function bindSlider(id, paramPath, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const valEl = document.getElementById(id + '-val');
  const fmt = opts.format || (v => parseFloat(v).toFixed(2));
  const map = opts.map || (v => parseFloat(v));

  el.oninput = () => {
    const raw = el.value;
    const mapped = map(raw);
    if (valEl) valEl.textContent = fmt(raw);
    sendParam(paramPath, mapped);
  };
  // Init display
  if (valEl) valEl.textContent = fmt(el.value);
}

function bindSelect(id, paramPath, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const map = opts.map || (v => parseInt(v));
  el.onchange = () => sendParam(paramPath, map(el.value));
}

function bindCheckbox(id, paramPath) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onchange = () => sendParam(paramPath, el.checked);
}

// Map 0-1 slider to frequency (20Hz to 20kHz logarithmic)
function sliderToFreq(v) {
  return 20 * Math.pow(1000, parseFloat(v));
}

function freqFormat(v) {
  const f = sliderToFreq(v);
  return f >= 1000 ? (f / 1000).toFixed(1) + 'k' : Math.round(f) + '';
}

// Map 0-1 slider to time (1ms to 10s logarithmic)
function sliderToTime(v) {
  return 0.001 * Math.pow(10000, parseFloat(v));
}

function timeFormat(v) {
  const t = sliderToTime(v);
  return t >= 1 ? t.toFixed(1) + 's' : Math.round(t * 1000) + 'ms';
}

// Map 0-1 slider to LFO rate (0.01-50 Hz log)
function sliderToLFORate(v) {
  return 0.01 * Math.pow(5000, parseFloat(v));
}

function lfoRateFormat(v) {
  return sliderToLFORate(v).toFixed(2) + 'Hz';
}

function initUI() {
  // Populate wave selects
  ['oscA-wave', 'oscB-wave'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) WAVE_NAMES.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = i; opt.textContent = name;
      sel.appendChild(opt);
    });
  });

  // Oscillator A
  bindSelect('oscA-wave', 'oscA.wave');
  const oscAModeButtons = document.querySelectorAll('.oscA-mode button');
  oscAModeButtons.forEach(btn => {
    btn.onclick = () => {
      oscAModeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sendParam('oscA.mode', parseInt(btn.dataset.mode));
    };
  });
  bindSlider('oscA-scan', 'oscA.scanPos', { format: v => Math.round(v * 100) + '%' });
  bindSlider('oscA-level', 'oscA.level', { format: v => parseFloat(v).toFixed(2) });

  // Oscillator B
  bindSelect('oscB-wave', 'oscB.wave');
  const oscBModeButtons = document.querySelectorAll('.oscB-mode button');
  oscBModeButtons.forEach(btn => {
    btn.onclick = () => {
      oscBModeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sendParam('oscB.mode', parseInt(btn.dataset.mode));
    };
  });
  bindSlider('oscB-scan', 'oscB.scanPos', { format: v => Math.round(v * 100) + '%' });
  bindSlider('oscB-level', 'oscB.level', { format: v => parseFloat(v).toFixed(2) });
  bindSlider('oscB-detune', 'oscBDetune', {
    format: v => parseFloat(v).toFixed(1) + 'c',
    map: v => parseFloat(v)
  });
  bindSelect('oscB-octave', 'oscBOctave', { map: v => parseInt(v) });

  // A/B Mix
  bindSlider('ab-mix', 'abMix', { format: v => { const f = parseFloat(v); return `A${Math.round((1-f)*100)} B${Math.round(f*100)}`; }});

  // Filter
  bindSelect('filter-type', 'filterType');
  bindSelect('filter-mode', 'filterMode');
  bindSlider('filter-cutoff', 'filterCutoff', { map: sliderToFreq, format: freqFormat });
  bindSlider('filter-reso', 'filterResonance');
  bindSlider('filter-env-amt', 'filterEnvAmount', { format: v => parseFloat(v).toFixed(2) });
  bindSlider('filter-keytrack', 'filterKeyTrack');

  // Amp Envelope
  bindSlider('amp-a', 'ampA', { map: sliderToTime, format: timeFormat });
  bindSlider('amp-d', 'ampD', { map: sliderToTime, format: timeFormat });
  bindSlider('amp-s', 'ampS');
  bindSlider('amp-r', 'ampR', { map: sliderToTime, format: timeFormat });

  // Filter Envelope
  bindSlider('flt-a', 'fltA', { map: sliderToTime, format: timeFormat });
  bindSlider('flt-d', 'fltD', { map: sliderToTime, format: timeFormat });
  bindSlider('flt-s', 'fltS');
  bindSlider('flt-r', 'fltR', { map: sliderToTime, format: timeFormat });

  // Wave Envelope
  bindSlider('wave-a', 'waveA', { map: sliderToTime, format: timeFormat });
  bindSlider('wave-d', 'waveD', { map: sliderToTime, format: timeFormat });
  bindSlider('wave-s', 'waveS');
  bindSlider('wave-r', 'waveR', { map: sliderToTime, format: timeFormat });
  bindSlider('wave-env-amt', 'waveEnvAmt', { format: v => parseFloat(v).toFixed(2) });

  // LFOs
  bindSlider('lfo1-rate', 'lfo1Rate', { map: sliderToLFORate, format: lfoRateFormat });
  bindSelect('lfo1-wave', 'lfo1Waveform');
  bindCheckbox('lfo1-sync', 'lfo1Sync');
  bindSlider('lfo1-delay', 'lfo1Delay', { map: v => parseFloat(v) * 3, format: v => (parseFloat(v) * 3).toFixed(1) + 's' });
  bindSlider('lfo1-fadein', 'lfo1FadeIn', { map: v => parseFloat(v) * 3, format: v => (parseFloat(v) * 3).toFixed(1) + 's' });

  bindSlider('lfo2-rate', 'lfo2Rate', { map: sliderToLFORate, format: lfoRateFormat });
  bindSelect('lfo2-wave', 'lfo2Waveform');
  bindCheckbox('lfo2-sync', 'lfo2Sync');
  bindSlider('lfo2-delay', 'lfo2Delay', { map: v => parseFloat(v) * 3, format: v => (parseFloat(v) * 3).toFixed(1) + 's' });
  bindSlider('lfo2-fadein', 'lfo2FadeIn', { map: v => parseFloat(v) * 3, format: v => (parseFloat(v) * 3).toFixed(1) + 's' });

  // Mod Matrix
  for (let i = 0; i < 4; i++) {
    bindSelect(`mod${i}-src`, `mod.${i}.src`, { map: v => v });
    bindSelect(`mod${i}-dst`, `mod.${i}.dst`, { map: v => v });
    const amtEl = document.getElementById(`mod${i}-amt`);
    if (amtEl) amtEl.oninput = () => sendParam(`mod.${i}.amount`, parseFloat(amtEl.value));
  }

  // Performance
  bindSlider('portamento-time', 'portamentoTime', {
    map: v => parseFloat(v), format: v => parseFloat(v).toFixed(2) + 's'
  });
  bindCheckbox('portamento-on', 'portamento');
  bindSelect('pitch-bend-range', 'pitchBendRange');

  // Effects
  bindCheckbox('fx-chorus-on', 'fx.chorus.enabled');
  bindSlider('fx-chorus-rate', 'fx.chorus.rate', { map: v => parseFloat(v) * 3, format: v => (parseFloat(v)*3).toFixed(1) + 'Hz' });
  bindSlider('fx-chorus-depth', 'fx.chorus.depth', { map: v => parseFloat(v) * 0.01 });
  bindSlider('fx-chorus-mix', 'fx.chorus.mix');

  bindCheckbox('fx-delay-on', 'fx.delay.enabled');
  bindSlider('fx-delay-time', 'fx.delay.timeL', { map: v => parseFloat(v) * 1.5, format: v => Math.round(parseFloat(v)*1500) + 'ms' });
  bindSlider('fx-delay-fb', 'fx.delay.feedback');
  bindSlider('fx-delay-mix', 'fx.delay.mix');

  bindCheckbox('fx-reverb-on', 'fx.reverb.enabled');
  bindSlider('fx-reverb-size', 'fx.reverb.roomSize');
  bindSlider('fx-reverb-damp', 'fx.reverb.damping');
  bindSlider('fx-reverb-mix', 'fx.reverb.mix');

  // Master
  bindSlider('master-vol', 'masterVolume');

  // Wave Sequence Editor
  document.querySelectorAll('.seq-osc-toggle button').forEach(btn => {
    btn.onclick = () => {
      seqEditorState.osc = btn.dataset.osc;
      seqEditorState.selectedStep = 0;
      renderSeqEditor();
    };
  });

  const seqLoop = document.getElementById('seq-loop');
  if (seqLoop) seqLoop.onchange = () => {
    setActiveLoopMode(parseInt(seqLoop.value));
    pushSeqToProcessor();
  };

  const seqSpeed = document.getElementById('seq-speed');
  if (seqSpeed) seqSpeed.oninput = () => {
    setActiveSpeed(parseFloat(seqSpeed.value));
    document.getElementById('seq-speed-val').textContent = parseFloat(seqSpeed.value).toFixed(1) + 'x';
    pushSeqToProcessor();
  };

  renderSeqEditor();
}

// ─── Scope ──────────────────────────────────────────────────────────────────

function initScope() {
  const canvas = document.getElementById('scope');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const bufLen = analyser.frequencyBinCount;
  const dataArray = new Float32Array(bufLen);

  function draw() {
    requestAnimationFrame(draw);
    analyser.getFloatTimeDomainData(dataArray);
    ctx.fillStyle = '#0a0d1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const sliceWidth = canvas.width / bufLen;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const y = (1 - dataArray[i]) * canvas.height / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();
  }
  draw();
}

// ─── Display Updates ────────────────────────────────────────────────────────

function updateVoiceDisplay() {
  const el = document.getElementById('voice-display');
  if (el) {
    const active = voices.filter(v => v.active).length;
    el.textContent = `Voices: ${active}/${NUM_VOICES}`;
  }
}


// ─── Presets ────────────────────────────────────────────────────────────────

const FACTORY_PRESETS = [
  {
    name: 'Wave Pad',
    params: {
      oscA: { wave: 0, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 2, mode: 0, scanPos: 0, level: 0.0 },
      oscBDetune: 0, oscBOctave: 0, abMix: 0,
      filterType: 0, filterMode: 0, filterCutoff: 4000, filterResonance: 0.1,
      filterEnvAmount: 0.2, filterKeyTrack: 0.3,
      ampA: 0.1, ampD: 0.3, ampS: 0.8, ampR: 0.5,
      fltA: 0.05, fltD: 0.4, fltS: 0.3, fltR: 0.4,
      waveA: 0.01, waveD: 0.5, waveS: 0, waveR: 0.5, waveEnvAmt: 0,
      masterVolume: 0.7
    },
    seqA: {
      steps: [
        { wave: 0, duration: 600, crossfade: 0.5 },
        { wave: 1, duration: 600, crossfade: 0.5 },
        { wave: 2, duration: 600, crossfade: 0.5 },
        { wave: 3, duration: 600, crossfade: 0.5 }
      ],
      loopMode: 1, speed: 1.0
    },
    fx: { chorus: { enabled: true, rate: 0.3, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.8, damping: 0.5, mix: 0.25 } }
  },
  {
    name: 'Digital Dreams',
    params: {
      oscA: { wave: 16, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 18, mode: 0, scanPos: 0, level: 0.3 },
      oscBDetune: 7, oscBOctave: 12, abMix: 0.3,
      filterType: 0, filterMode: 0, filterCutoff: 3000, filterResonance: 0.2,
      filterEnvAmount: 0.4, filterKeyTrack: 0.5,
      ampA: 0.01, ampD: 0.3, ampS: 0.6, ampR: 0.8,
      fltA: 0.01, fltD: 0.5, fltS: 0.2, fltR: 0.5,
      waveA: 0.01, waveD: 0.5, waveS: 0, waveR: 0.5, waveEnvAmt: 0,
      masterVolume: 0.6
    },
    seqA: {
      steps: [
        { wave: 16, duration: 300, crossfade: 0.4 },
        { wave: 17, duration: 300, crossfade: 0.4 },
        { wave: 18, duration: 300, crossfade: 0.4 },
        { wave: 15, duration: 300, crossfade: 0.4 }
      ],
      loopMode: 1, speed: 1.5
    },
    fx: { delay: { enabled: true, timeL: 0.375, feedback: 0.3, mix: 0.2 }, reverb: { enabled: true, roomSize: 0.7, damping: 0.4, mix: 0.2 } }
  },
  {
    name: 'Vocal Morph',
    params: {
      oscA: { wave: 13, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 0, mode: 0, scanPos: 0, level: 0.0 },
      oscBDetune: 0, oscBOctave: 0, abMix: 0,
      filterType: 0, filterMode: 0, filterCutoff: 5000, filterResonance: 0.15,
      filterEnvAmount: 0.1, filterKeyTrack: 0.3,
      ampA: 0.08, ampD: 0.4, ampS: 0.7, ampR: 0.6,
      fltA: 0.05, fltD: 0.5, fltS: 0.4, fltR: 0.4,
      waveA: 0.01, waveD: 0.5, waveS: 0, waveR: 0.5, waveEnvAmt: 0,
      masterVolume: 0.7
    },
    seqA: {
      steps: [
        { wave: 13, duration: 800, crossfade: 0.6 },
        { wave: 8, duration: 800, crossfade: 0.6 },
        { wave: 12, duration: 800, crossfade: 0.6 },
        { wave: 11, duration: 800, crossfade: 0.6 }
      ],
      loopMode: 1, speed: 0.8
    },
    fx: { chorus: { enabled: true, rate: 0.2, depth: 0.003, mix: 0.25 }, reverb: { enabled: true, roomSize: 0.85, damping: 0.6, mix: 0.3 } }
  },
  {
    name: 'Bell Chime',
    params: {
      oscA: { wave: 14, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 15, mode: 0, scanPos: 0, level: 0.3 },
      oscBDetune: 0, oscBOctave: 12, abMix: 0.2,
      filterType: 1, filterMode: 0, filterCutoff: 6000, filterResonance: 0.1,
      filterEnvAmount: 0.3, filterKeyTrack: 0.5,
      ampA: 0.001, ampD: 0.8, ampS: 0.0, ampR: 1.0,
      fltA: 0.001, fltD: 0.6, fltS: 0.1, fltR: 0.6,
      waveA: 0.01, waveD: 0.5, waveS: 0, waveR: 0.5, waveEnvAmt: 0,
      masterVolume: 0.6
    },
    seqA: {
      steps: [
        { wave: 14, duration: 200, crossfade: 0.3 },
        { wave: 0, duration: 200, crossfade: 0.3 },
        { wave: 15, duration: 200, crossfade: 0.3 }
      ],
      loopMode: 1, speed: 2.0
    },
    fx: { reverb: { enabled: true, roomSize: 0.9, damping: 0.3, mix: 0.4 } }
  },
  {
    name: 'Ambient Drift',
    params: {
      oscA: { wave: 0, mode: 1, scanPos: 0.2, level: 1.0 },
      oscB: { wave: 1, mode: 1, scanPos: 0.5, level: 0.5 },
      oscBDetune: 5, oscBOctave: 0, abMix: 0.4,
      filterType: 0, filterMode: 0, filterCutoff: 2000, filterResonance: 0.2,
      filterEnvAmount: 0.3, filterKeyTrack: 0.2,
      ampA: 0.3, ampD: 0.5, ampS: 0.8, ampR: 1.5,
      fltA: 0.2, fltD: 0.8, fltS: 0.2, fltR: 0.8,
      waveA: 0.5, waveD: 2.0, waveS: 0, waveR: 2.0, waveEnvAmt: 0.6,
      masterVolume: 0.7
    },
    fx: {
      chorus: { enabled: true, rate: 0.15, depth: 0.005, mix: 0.4 },
      delay: { enabled: true, timeL: 0.5, feedback: 0.35, mix: 0.2 },
      reverb: { enabled: true, roomSize: 0.9, damping: 0.6, mix: 0.4 }
    }
  },
  {
    name: 'Organ Sweep',
    params: {
      oscA: { wave: 8, mode: 1, scanPos: 0.4, level: 1.0 },
      oscB: { wave: 10, mode: 0, scanPos: 0, level: 0.0 },
      oscBDetune: 0, oscBOctave: 0, abMix: 0,
      filterType: 0, filterMode: 0, filterCutoff: 6000, filterResonance: 0.05,
      filterEnvAmount: 0.0, filterKeyTrack: 0.5,
      ampA: 0.01, ampD: 0.1, ampS: 0.9, ampR: 0.15,
      fltA: 0.01, fltD: 0.2, fltS: 0.5, fltR: 0.2,
      waveA: 0.5, waveD: 1.0, waveS: 0.5, waveR: 0.5, waveEnvAmt: 0.3,
      masterVolume: 0.65
    },
    fx: { chorus: { enabled: true, rate: 0.8, depth: 0.003, mix: 0.2 }, reverb: { enabled: true, roomSize: 0.6, damping: 0.5, mix: 0.15 } }
  },
  {
    name: 'Ice Crystal',
    params: {
      oscA: { wave: 16, mode: 1, scanPos: 0.8, level: 1.0 },
      oscB: { wave: 14, mode: 0, scanPos: 0, level: 0.4 },
      oscBDetune: 3, oscBOctave: 12, abMix: 0.3,
      filterType: 1, filterMode: 0, filterCutoff: 8000, filterResonance: 0.3,
      filterEnvAmount: -0.3, filterKeyTrack: 0.6,
      ampA: 0.001, ampD: 0.5, ampS: 0.3, ampR: 1.2,
      fltA: 0.001, fltD: 0.3, fltS: 0.5, fltR: 0.5,
      waveA: 0.3, waveD: 1.5, waveS: 0, waveR: 1.0, waveEnvAmt: -0.5,
      masterVolume: 0.55
    },
    fx: {
      delay: { enabled: true, timeL: 0.25, feedback: 0.4, mix: 0.25 },
      reverb: { enabled: true, roomSize: 0.85, damping: 0.3, mix: 0.35 }
    }
  },
  {
    name: 'Bass Growl',
    params: {
      oscA: { wave: 2, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 3, mode: 0, scanPos: 0, level: 0.5 },
      oscBDetune: 0, oscBOctave: 0, abMix: 0.3,
      filterType: 0, filterMode: 0, filterCutoff: 800, filterResonance: 0.4,
      filterEnvAmount: 0.6, filterKeyTrack: 0.1,
      ampA: 0.001, ampD: 0.15, ampS: 0.8, ampR: 0.1,
      fltA: 0.001, fltD: 0.2, fltS: 0.2, fltR: 0.1,
      waveA: 0.01, waveD: 0.5, waveS: 0, waveR: 0.5, waveEnvAmt: 0,
      masterVolume: 0.7
    },
    seqA: {
      steps: [
        { wave: 2, duration: 150, crossfade: 0.2 },
        { wave: 3, duration: 150, crossfade: 0.2 },
        { wave: 4, duration: 150, crossfade: 0.2 },
        { wave: 11, duration: 150, crossfade: 0.2 }
      ],
      loopMode: 1, speed: 2.0
    },
    fx: {}
  },
  {
    name: 'Ethereal',
    params: {
      oscA: { wave: 0, mode: 2, scanPos: 0, level: 1.0 },
      oscB: { wave: 1, mode: 1, scanPos: 0.3, level: 0.5 },
      oscBDetune: 7, oscBOctave: 12, abMix: 0.4,
      filterType: 0, filterMode: 0, filterCutoff: 3000, filterResonance: 0.15,
      filterEnvAmount: 0.2, filterKeyTrack: 0.3,
      ampA: 0.2, ampD: 0.5, ampS: 0.7, ampR: 2.0,
      fltA: 0.1, fltD: 0.6, fltS: 0.3, fltR: 1.0,
      waveA: 0.5, waveD: 2.0, waveS: 0.5, waveR: 2.0, waveEnvAmt: 0.4,
      masterVolume: 0.6
    },
    seqA: {
      steps: [
        { wave: 0, duration: 1000, crossfade: 0.7 },
        { wave: 13, duration: 1000, crossfade: 0.7 },
        { wave: 1, duration: 1000, crossfade: 0.7 },
        { wave: 12, duration: 1000, crossfade: 0.7 }
      ],
      loopMode: 1, speed: 0.5
    },
    fx: {
      chorus: { enabled: true, rate: 0.1, depth: 0.004, mix: 0.35 },
      delay: { enabled: true, timeL: 0.4, feedback: 0.3, mix: 0.15 },
      reverb: { enabled: true, roomSize: 0.92, damping: 0.5, mix: 0.45 }
    }
  },
  {
    name: 'Scan Lead',
    params: {
      oscA: { wave: 2, mode: 1, scanPos: 0.1, level: 1.0 },
      oscB: { wave: 0, mode: 0, scanPos: 0, level: 0.0 },
      oscBDetune: 0, oscBOctave: 0, abMix: 0,
      filterType: 0, filterMode: 0, filterCutoff: 2500, filterResonance: 0.3,
      filterEnvAmount: 0.5, filterKeyTrack: 0.5,
      ampA: 0.001, ampD: 0.1, ampS: 0.8, ampR: 0.15,
      fltA: 0.001, fltD: 0.3, fltS: 0.3, fltR: 0.2,
      waveA: 0.01, waveD: 0.8, waveS: 0, waveR: 0.3, waveEnvAmt: 0.7,
      portamento: true, portamentoTime: 0.08,
      masterVolume: 0.65
    },
    fx: { delay: { enabled: true, timeL: 0.3, feedback: 0.25, mix: 0.15 } }
  }
];

let userPresets = [];

function loadPresets() {
  try {
    const stored = localStorage.getItem('ws-synth-presets');
    if (stored) userPresets = JSON.parse(stored);
  } catch(e) {}
}

function savePresetsToStorage() {
  try {
    localStorage.setItem('ws-synth-presets', JSON.stringify(userPresets));
  } catch(e) {}
}

function populatePresetSelect() {
  const sel = document.getElementById('preset-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Preset --</option>';
  FACTORY_PRESETS.forEach((p, i) => {
    sel.innerHTML += `<option value="f:${i}">${p.name}</option>`;
  });
  if (userPresets.length > 0) {
    sel.innerHTML += '<option disabled>──────────</option>';
    userPresets.forEach((p, i) => {
      sel.innerHTML += `<option value="u:${i}">${p.name}</option>`;
    });
  }
}

function applyPreset(preset) {
  if (!workletNode) return;
  // Send params to processor
  workletNode.port.postMessage({
    type: 'preset',
    params: preset.params,
    fx: preset.fx || {},
    seqA: preset.seqA || { steps: [], loopMode: 0, speed: 1.0 },
    seqB: preset.seqB || { steps: [], loopMode: 0, speed: 1.0 }
  });

  // Update seq editor state
  if (preset.seqA) {
    seqEditorState.stepsA = preset.seqA.steps.map(s => ({...s}));
    seqEditorState.loopModeA = preset.seqA.loopMode || 0;
    seqEditorState.speedA = preset.seqA.speed || 1.0;
  }
  if (preset.seqB) {
    seqEditorState.stepsB = preset.seqB.steps.map(s => ({...s}));
    seqEditorState.loopModeB = preset.seqB.loopMode || 0;
    seqEditorState.speedB = preset.seqB.speed || 1.0;
  }
  seqEditorState.selectedStep = 0;
  renderSeqEditor();

  // Update UI controls to match preset
  updateUIFromPreset(preset);
}

function updateUIFromPreset(preset) {
  const p = preset.params;
  if (!p) return;

  // Helper to set element value
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('input')); }
  };
  const setCheck = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.checked = val; }
  };
  const setSelect = (id, val) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; }
  };

  // Oscillators
  if (p.oscA) {
    setSelect('oscA-wave', p.oscA.wave);
    set('oscA-scan', p.oscA.scanPos);
    set('oscA-level', p.oscA.level);
    document.querySelectorAll('.oscA-mode button').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.mode) === p.oscA.mode);
    });
  }
  if (p.oscB) {
    setSelect('oscB-wave', p.oscB.wave);
    set('oscB-scan', p.oscB.scanPos);
    set('oscB-level', p.oscB.level);
    document.querySelectorAll('.oscB-mode button').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.mode) === p.oscB.mode);
    });
  }
  if (p.oscBDetune !== undefined) set('oscB-detune', p.oscBDetune);
  if (p.oscBOctave !== undefined) setSelect('oscB-octave', p.oscBOctave);
  if (p.abMix !== undefined) set('ab-mix', p.abMix);

  // Filter — need to reverse the log mapping for cutoff
  if (p.filterCutoff !== undefined) {
    const sliderVal = Math.log(p.filterCutoff / 20) / Math.log(1000);
    set('filter-cutoff', Math.max(0, Math.min(1, sliderVal)));
  }
  if (p.filterResonance !== undefined) set('filter-reso', p.filterResonance);
  if (p.filterEnvAmount !== undefined) set('filter-env-amt', p.filterEnvAmount);
  if (p.filterKeyTrack !== undefined) set('filter-keytrack', p.filterKeyTrack);
  if (p.filterType !== undefined) setSelect('filter-type', p.filterType);
  if (p.filterMode !== undefined) setSelect('filter-mode', p.filterMode);

  // Envelopes — reverse log time mapping
  const timeToSlider = (t) => Math.log(t / 0.001) / Math.log(10000);
  if (p.ampA !== undefined) set('amp-a', timeToSlider(p.ampA));
  if (p.ampD !== undefined) set('amp-d', timeToSlider(p.ampD));
  if (p.ampS !== undefined) set('amp-s', p.ampS);
  if (p.ampR !== undefined) set('amp-r', timeToSlider(p.ampR));
  if (p.fltA !== undefined) set('flt-a', timeToSlider(p.fltA));
  if (p.fltD !== undefined) set('flt-d', timeToSlider(p.fltD));
  if (p.fltS !== undefined) set('flt-s', p.fltS);
  if (p.fltR !== undefined) set('flt-r', timeToSlider(p.fltR));
  if (p.waveA !== undefined) set('wave-a', timeToSlider(p.waveA));
  if (p.waveD !== undefined) set('wave-d', timeToSlider(p.waveD));
  if (p.waveS !== undefined) set('wave-s', p.waveS);
  if (p.waveR !== undefined) set('wave-r', timeToSlider(p.waveR));
  if (p.waveEnvAmt !== undefined) set('wave-env-amt', p.waveEnvAmt);

  if (p.masterVolume !== undefined) set('master-vol', p.masterVolume);
  if (p.portamento !== undefined) setCheck('portamento-on', p.portamento);
  if (p.portamentoTime !== undefined) set('portamento-time', p.portamentoTime);

  // Effects
  const fx = preset.fx || {};
  if (fx.chorus) {
    setCheck('fx-chorus-on', fx.chorus.enabled);
    if (fx.chorus.rate !== undefined) set('fx-chorus-rate', fx.chorus.rate / 3);
    if (fx.chorus.mix !== undefined) set('fx-chorus-mix', fx.chorus.mix);
  }
  if (fx.delay) {
    setCheck('fx-delay-on', fx.delay.enabled);
    if (fx.delay.timeL !== undefined) set('fx-delay-time', fx.delay.timeL / 1.5);
    if (fx.delay.feedback !== undefined) set('fx-delay-fb', fx.delay.feedback);
    if (fx.delay.mix !== undefined) set('fx-delay-mix', fx.delay.mix);
  }
  if (fx.reverb) {
    setCheck('fx-reverb-on', fx.reverb.enabled);
    if (fx.reverb.roomSize !== undefined) set('fx-reverb-size', fx.reverb.roomSize);
    if (fx.reverb.damping !== undefined) set('fx-reverb-damp', fx.reverb.damping);
    if (fx.reverb.mix !== undefined) set('fx-reverb-mix', fx.reverb.mix);
  }
}

function initPresets() {
  loadPresets();
  populatePresetSelect();

  document.getElementById('preset-select').onchange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const [type, idx] = val.split(':');
    const preset = type === 'f' ? FACTORY_PRESETS[idx] : userPresets[idx];
    if (preset) applyPreset(preset);
  };

  document.getElementById('save-preset-btn').onclick = () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const preset = getCurrentPreset(name);
    const existing = userPresets.findIndex(p => p.name === name);
    if (existing >= 0) userPresets[existing] = preset;
    else userPresets.push(preset);
    savePresetsToStorage();
    populatePresetSelect();
  };
}

function getCurrentPreset(name) {
  // Read current UI state to build a preset object
  const readVal = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) : 0; };
  const readSel = (id) => { const el = document.getElementById(id); return el ? parseInt(el.value) : 0; };
  const readCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

  const activeOscAMode = document.querySelector('.oscA-mode button.active');
  const activeOscBMode = document.querySelector('.oscB-mode button.active');

  return {
    name,
    params: {
      oscA: { wave: readSel('oscA-wave'), mode: activeOscAMode ? parseInt(activeOscAMode.dataset.mode) : 0, scanPos: readVal('oscA-scan'), level: readVal('oscA-level') },
      oscB: { wave: readSel('oscB-wave'), mode: activeOscBMode ? parseInt(activeOscBMode.dataset.mode) : 0, scanPos: readVal('oscB-scan'), level: readVal('oscB-level') },
      oscBDetune: readVal('oscB-detune'), oscBOctave: readSel('oscB-octave'), abMix: readVal('ab-mix'),
      filterType: readSel('filter-type'), filterMode: readSel('filter-mode'),
      filterCutoff: sliderToFreq(readVal('filter-cutoff')), filterResonance: readVal('filter-reso'),
      filterEnvAmount: readVal('filter-env-amt'), filterKeyTrack: readVal('filter-keytrack'),
      ampA: sliderToTime(readVal('amp-a')), ampD: sliderToTime(readVal('amp-d')), ampS: readVal('amp-s'), ampR: sliderToTime(readVal('amp-r')),
      fltA: sliderToTime(readVal('flt-a')), fltD: sliderToTime(readVal('flt-d')), fltS: readVal('flt-s'), fltR: sliderToTime(readVal('flt-r')),
      waveA: sliderToTime(readVal('wave-a')), waveD: sliderToTime(readVal('wave-d')), waveS: readVal('wave-s'), waveR: sliderToTime(readVal('wave-r')),
      waveEnvAmt: readVal('wave-env-amt'),
      portamento: readCheck('portamento-on'), portamentoTime: readVal('portamento-time'),
      masterVolume: readVal('master-vol')
    },
    seqA: { steps: seqEditorState.stepsA.map(s => ({...s})), loopMode: seqEditorState.loopModeA, speed: seqEditorState.speedA },
    seqB: { steps: seqEditorState.stepsB.map(s => ({...s})), loopMode: seqEditorState.loopModeB, speed: seqEditorState.speedB },
    fx: {
      chorus: { enabled: readCheck('fx-chorus-on'), rate: readVal('fx-chorus-rate') * 3, depth: readVal('fx-chorus-depth') * 0.01, mix: readVal('fx-chorus-mix') },
      delay: { enabled: readCheck('fx-delay-on'), timeL: readVal('fx-delay-time') * 1.5, feedback: readVal('fx-delay-fb'), mix: readVal('fx-delay-mix') },
      reverb: { enabled: readCheck('fx-reverb-on'), roomSize: readVal('fx-reverb-size'), damping: readVal('fx-reverb-damp'), mix: readVal('fx-reverb-mix') }
    }
  };
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/ws-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'ws-synth-processor', {
    numberOfOutputs: 1,
    outputChannelCount: [2]
  });

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  workletNode.connect(analyser);
  analyser.connect(audioCtx.destination);

  initScope();
  pushSeqToProcessor();

  const btn = document.getElementById('start-btn');
  if (btn) { btn.textContent = 'Audio On'; btn.disabled = true; }
}

document.addEventListener('DOMContentLoaded', () => {
  keyboard = new SynthKeyboard('piano-keyboard', {
    noteOn: (note, vel) => noteOn(note, vel),
    noteOff: (note) => noteOff(note),
    pitchBend: (val) => sendParam('pitchBend', val),
    sustainChange: (on) => {
      sustainOn = on;
      if (!on) {
        for (const n of sustainedNotes) noteOff(n);
        sustainedNotes.clear();
      }
      const ind = document.getElementById('sustain-indicator');
      if (ind) ind.style.color = on ? 'var(--accent)' : 'var(--text-dim)';
    }
  });

  initUI();
  initPresets();
  updateVoiceDisplay();

  document.getElementById('start-btn').onclick = startAudio;
});
