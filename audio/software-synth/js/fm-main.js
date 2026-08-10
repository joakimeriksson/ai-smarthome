// FM Synth — Main thread controller

const NUM_VOICES = 8;
const pool = new SynthShell.VoicePool(NUM_VOICES);
let audioCtx = null, workletNode = null, analyser = null, keyboard = null;

let sustainOn = false;
const sustainedNotes = new Set();

function allocateVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) if (voices[i].note === note && voices[i].active) return i;
  for (let i = 0; i < NUM_VOICES; i++) if (!voices[i].active) { voices[i].note = note; voices[i].active = true; voices[i].age = ++voiceAge; return i; }
  let oldest = 0;
  for (let i = 1; i < NUM_VOICES; i++) if (voices[i].age < voices[oldest].age) oldest = i;
  voices[oldest].note = note; voices[oldest].active = true; voices[oldest].age = ++voiceAge;
  return oldest;
}

function releaseVoice(note) {
  for (let i = 0; i < NUM_VOICES; i++) if (voices[i].note === note && voices[i].active) { voices[i].active = false; return i; }
  return -1;
}

function noteOn(note, velocity = 100) {
  if (!workletNode) return;
  const v = pool.alloc(note);
  workletNode.port.postMessage({ type: 'noteOn', voice: v, note, velocity });
  updateVoiceDisplay();
  if (keyboard) keyboard.highlightKey(note, true);
}

function noteOff(note) {
  if (!workletNode) return;
  if (sustainOn) { sustainedNotes.add(note); return; }
  const v = pool.release(note);
  if (v >= 0) { workletNode.port.postMessage({ type: 'noteOff', voice: v }); updateVoiceDisplay(); }
  if (keyboard) keyboard.highlightKey(note, false);
}

function sendParam(param, value) {
  if (workletNode) workletNode.port.postMessage({ type: 'param', param, value });
}

// ─── UI Binding ─────────────────────────────────────────────────────────────

const bind = SynthShell.createBinder(sendParam);
const bindSlider = bind.slider, bindSelect = bind.select, bindCheckbox = bind.checkbox;

function sliderToTime(v) { return 0.001 * Math.pow(10000, parseFloat(v)); }
function timeFormat(v) { const t = sliderToTime(v); return t >= 1 ? t.toFixed(1)+'s' : Math.round(t*1000)+'ms'; }

// ─── Algorithm Diagrams ─────────────────────────────────────────────────────

const ALGO_DIAGRAMS = [
  '6→5→4→3→2→1        [1 carrier]',
  '(5→4→3 + 2)→1  6→5  [1 carrier]',
  '(6→5  4→3)→2→1      [1 carrier]',
  '6→5→4  3→2  1        [3 carriers]',
  '6→5  4→3  2  1       [4 carriers]',
  '6→(5,4,3,2)  1       [5 carriers]',
  '6→5  4→3  2→1        [3 pairs]',
  '6  5  4  3  2  1     [additive]',
];

const ALGO_CARRIERS = [[0],[0],[0],[0,1,3],[0,1,2,3],[0,1,2,3,4],[0,2,4],[0,1,2,3,4,5]];

// ─── Init UI ────────────────────────────────────────────────────────────────

function initUI() {
  // Algorithm selector
  document.querySelectorAll('#algo-buttons button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#algo-buttons button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const algo = parseInt(btn.dataset.algo);
      sendParam('algorithm', algo);
      document.getElementById('algo-diagram').textContent = ALGO_DIAGRAMS[algo];
      updateOpRoles(algo);
    };
  });

  bindSlider('feedback', 'feedback');

  // Operator panels
  for (let i = 0; i < 6; i++) {
    bindCheckbox(`op${i}-on`, `op.${i}.on`);
    bindSelect(`op${i}-ratio`, `op.${i}.ratio`, { map: v => parseFloat(v) });
    bindSlider(`op${i}-fine`, `op.${i}.fine`, { format: v => parseFloat(v).toFixed(2) });
    bindSlider(`op${i}-level`, `op.${i}.level`, { map: v => parseInt(v) / 99, format: v => v });
    bindSlider(`op${i}-velsens`, `op.${i}.velSens`);
    bindSlider(`op${i}-a`, `op.${i}.attack`, { map: sliderToTime, format: timeFormat });
    bindSlider(`op${i}-d`, `op.${i}.decay`, { map: sliderToTime, format: timeFormat });
    bindSlider(`op${i}-s`, `op.${i}.sustain`);
    bindSlider(`op${i}-r`, `op.${i}.release`, { map: sliderToTime, format: timeFormat });
  }

  // LFO
  bindSlider('lfo-rate', 'lfoRate', { format: v => parseFloat(v).toFixed(1)+'Hz' });
  bindSelect('lfo-wave', 'lfoWaveform');
  bindSlider('lfo-pitch', 'lfoPitchDepth', { map: v => parseFloat(v) * 12, format: v => (parseFloat(v)*12).toFixed(1)+'st' });
  bindSlider('lfo-amp', 'lfoAmpDepth');

  // Effects
  bindCheckbox('fx-chorus-on', 'fx.chorus.enabled');
  bindCheckbox('fx-delay-on', 'fx.delay.enabled');
  bindSlider('fx-delay-time', 'fx.delay.timeL', { map: v => parseFloat(v)*1.5, format: v => Math.round(parseFloat(v)*1500)+'ms' });
  bindSlider('fx-delay-fb', 'fx.delay.feedback');
  bindCheckbox('fx-reverb-on', 'fx.reverb.enabled');
  bindSlider('fx-reverb-size', 'fx.reverb.roomSize');
  bindSlider('fx-reverb-mix', 'fx.reverb.mix');
  bindSlider('master-vol', 'masterVolume');

  updateOpRoles(0);
}

function updateOpRoles(algo) {
  const carriers = ALGO_CARRIERS[algo];
  for (let i = 0; i < 6; i++) {
    const el = document.getElementById(`op${i}-role`);
    if (el) el.textContent = carriers.includes(i) ? 'CARRIER' : 'MOD';
  }
}

// ─── Scope ──────────────────────────────────────────────────────────────────

function initScope() {
  SynthShell.startScope({ canvasId: 'scope', analyser, background: '#1a0d00', stroke: '#ff8800' });
}

function updateVoiceDisplay() { SynthShell.showVoiceCount('voice-display', pool); }

// ─── Presets ────────────────────────────────────────────────────────────────

function op(ratio, fine, level, a, d, s, r, vel) {
  return { on: true, ratio, fine: fine || 1.0, level: level/99, attack: a, decay: d, sustain: s, release: r, velSens: vel !== undefined ? vel : 0.7 };
}
function opOff() { return { on: false, ratio: 1, fine: 1, level: 0, attack: 0.01, decay: 0.3, sustain: 0, release: 0.3, velSens: 0 }; }

// E.Piano 1, Wurlitzer, DX Brass, Strings and Organ are FITTED against real
// DX7 recordings (soundpacks.com sample pack) by tools/fm-fit — structure from
// the documented patches, numbers by coordinate descent on a harmonic-ladder +
// envelope distance. velSens was added after fitting (the pack is single-
// velocity), so velocity response is convention, not measurement.
const FACTORY_PRESETS = [
  { name: 'E.Piano 1', params: { algorithm: 6, feedback: 0.24, ops: [
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.001, decay: 1.496, sustain: 0, release: 0.4, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.03, decay: 0.765, sustain: 0.25, release: 0.3, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.001, level: 0.315, attack: 0.014, decay: 0.6, sustain: 0, release: 0.4, velSens: 0.3 },
    { on: true, ratio: 14, fine: 1, level: 0.084, attack: 0.001, decay: 0.003, sustain: 0, release: 0.1, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.999, level: 0.21, attack: 0.01, decay: 1.53, sustain: 0.15, release: 0.4, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.3, attack: 0.03, decay: 0.51, sustain: 0.25, release: 0.3, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.5, mix: 0.15 } } },

  { name: 'E.Piano 2', params: { algorithm: 1, feedback: 0.2, ops: [
    op(1,1,90, 0.001,1.0,0.2,0.6, 0.3), op(1,1,50, 0.001,0.5,0.0,0.3, 0.7),
    op(1,1,40, 0.001,0.3,0.0,0.2, 0.8), op(14,1,30, 0.001,0.08,0.0,0.1, 0.95),
    op(1,1,20, 0.001,0.2,0.0,0.1, 0.5), op(1,1,15, 0.001,0.8,0.0,0.3, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { chorus: { enabled: true, rate: 0.3, depth: 0.003, mix: 0.2 } } },

  { name: 'Wurlitzer', params: { algorithm: 6, feedback: 0.768, ops: [
    { on: true, ratio: 1, fine: 1, level: 0.791, attack: 0.0588, decay: 0.432, sustain: 0, release: 0.35, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.0288, decay: 0.595, sustain: 0.086, release: 0.3, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1, level: 0.274, attack: 0.01, decay: 0.23, sustain: 0, release: 0.35, velSens: 0.3 },
    { on: true, ratio: 7, fine: 1, level: 0.416, attack: 0.001, decay: 0.051, sustain: 0.115, release: 0.1, velSens: 0.7 },
    { on: true, ratio: 1, fine: 1, level: 0.245, attack: 0.0037, decay: 0.269, sustain: 0, release: 0.35, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.585, attack: 0.014, decay: 0.722, sustain: 0.432, release: 0.3, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.4, mix: 0.12 } } },
  { name: 'FM Bass', params: { algorithm: 6, feedback: 0.15, ops: [
    op(1,1,90, 0.001,0.2,0.6,0.1, 0.3), op(1,1,50, 0.001,0.12,0.0,0.08, 0.8),
    op(1,1,85, 0.001,0.3,0.5,0.15, 0.3), op(2,1,40, 0.001,0.08,0.0,0.05, 0.9),
    op(0.5,1,80, 0.001,0.2,0.7,0.1, 0.2), op(1,1,30, 0.001,0.1,0.0,0.05, 0.7)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: {} },

  { name: 'Slap Bass', params: { algorithm: 0, feedback: 0.3, ops: [
    op(1,1,90, 0.001,0.12,0.0,0.08, 0.5), op(1,1,55, 0.001,0.06,0.0,0.05, 0.9),
    op(2,1,45, 0.001,0.04,0.0,0.03, 0.9), op(3,1,35, 0.001,0.03,0.0,0.02, 0.95),
    op(4,1,25, 0.001,0.02,0.0,0.01, 0.95), op(1,1,20, 0.001,0.05,0.0,0.02, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: {} },

  { name: 'DX Brass', params: { algorithm: 6, feedback: 0.44, ops: [
    { on: true, ratio: 1, fine: 1, level: 0.95, attack: 0.084, decay: 0.48, sustain: 0.48, release: 0.15, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 1, attack: 0.028, decay: 0.18, sustain: 0.264, release: 0.15, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.003, level: 0.826, attack: 0.08, decay: 0.48, sustain: 0.8, release: 0.15, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.42, attack: 0.2, decay: 0.5, sustain: 0.5, release: 0.15, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.997, level: 0.425, attack: 0.05, decay: 0.48, sustain: 0.48, release: 0.15, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.55, attack: 0.09, decay: 0.5, sustain: 0.5, release: 0.15, velSens: 0.6 }
  ], lfoRate: 0, lfoWaveform: 0, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.4, mix: 0.12 } } },

  { name: 'Warm Pad', params: { algorithm: 3, feedback: 0.1, ops: [
    op(1,1,85, 0.3,0.5,0.8,0.8, 0.2), op(2,1,30, 0.2,0.6,0.2,0.5, 0.3),
    op(1,1,80, 0.4,0.6,0.7,0.9, 0.2), op(3,1,25, 0.3,0.5,0.15,0.5, 0.4),
    op(1,1.01,75, 0.5,0.5,0.75,1.0, 0.2), op(2,1,20, 0.4,0.6,0.1,0.6, 0.3)
  ], lfoRate: 0.3, lfoPitchDepth: 0, lfoAmpDepth: 0.1 },
  fx: { chorus: { enabled: true, rate: 0.2, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.85, mix: 0.3 } } },

  { name: 'Bright Bell', params: { algorithm: 0, feedback: 0.4, ops: [
    op(1,1,85, 0.001,2.0,0.0,1.5, 0.3), op(1.41,1,50, 0.001,1.5,0.0,1.0, 0.5),
    op(2.83,1,40, 0.001,1.2,0.0,0.8, 0.5), op(7.07,1,30, 0.001,0.8,0.0,0.5, 0.6),
    op(14.1,1,18, 0.001,0.4,0.0,0.3, 0.7), op(1,1,25, 0.001,1.0,0.0,0.5, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.9, mix: 0.35 } } },

  { name: 'Marimba', params: { algorithm: 1, feedback: 0.05, ops: [
    op(1,1,90, 0.001,0.25,0.0,0.15, 0.4), op(4,1,40, 0.001,0.06,0.0,0.05, 0.8),
    op(1,1,30, 0.001,0.12,0.0,0.1, 0.5), opOff(), opOff(), opOff()
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.5, mix: 0.2 } } },

  { name: 'Organ', params: { algorithm: 7, feedback: 0.1, ops: [
    { on: true, ratio: 0.5, fine: 1.004, level: 0.762, attack: 0.004, decay: 0.1, sustain: 1, release: 0.05, velSens: 0.3 },
    { on: true, ratio: 1, fine: 0.998, level: 0.262, attack: 0.0112, decay: 0.06, sustain: 0.216, release: 0.05, velSens: 0.3 },
    { on: true, ratio: 1.5, fine: 1, level: 1, attack: 0.008, decay: 0.06, sustain: 0.96, release: 0.05, velSens: 0.3 },
    { on: true, ratio: 4, fine: 1, level: 0.02, attack: 0.004, decay: 0.022, sustain: 0.23, release: 0.05, velSens: 0.3 },
    { on: true, ratio: 6, fine: 1.002, level: 0.12, attack: 0.008, decay: 0.136, sustain: 0.311, release: 0.05, velSens: 0.3 },
    { on: true, ratio: 8, fine: 0.994, level: 0.101, attack: 0.004, decay: 0.036, sustain: 0.922, release: 0.05, velSens: 0.3 }
  ], lfoRate: 6.24, lfoWaveform: 0, lfoPitchDepth: 0.015, lfoAmpDepth: 0.27 }, fx: { reverb: { enabled: true, roomSize: 0.3, mix: 0.1 } } },

  { name: 'Synth Lead', params: { algorithm: 6, feedback: 0.35, ops: [
    op(1,1,88, 0.01,0.2,0.8,0.15, 0.4), op(1,1,50, 0.001,0.12,0.3,0.1, 0.7),
    op(2,1,75, 0.01,0.25,0.7,0.2, 0.4), op(3,1,40, 0.001,0.08,0.2,0.1, 0.8),
    op(1,0.995,85, 0.01,0.2,0.8,0.15, 0.4), op(2,1,35, 0.001,0.12,0.15,0.1, 0.7)
  ], lfoRate: 5, lfoPitchDepth: 0.3, lfoAmpDepth: 0 }, fx: { delay: { enabled: true, timeL: 0.3, feedback: 0.3, mix: 0.15 } } },

  { name: 'Strings', params: { algorithm: 6, feedback: 0.5, ops: [
    { on: true, ratio: 1, fine: 1, level: 0.535, attack: 1.82, decay: 1.2, sustain: 0.9, release: 0.6, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.475, attack: 0.0469, decay: 0.36, sustain: 0.553, release: 0.6, velSens: 0.6 },
    { on: true, ratio: 1, fine: 1.004, level: 0.5, attack: 1.68, decay: 1.2, sustain: 0.9, release: 0.6, velSens: 0.3 },
    { on: true, ratio: 3, fine: 0.996, level: 0.274, attack: 1.6, decay: 0.9, sustain: 0.5, release: 0.6, velSens: 0.7 },
    { on: true, ratio: 1, fine: 0.996, level: 0.595, attack: 2.744, decay: 1.2, sustain: 0.9, release: 0.6, velSens: 0.3 },
    { on: true, ratio: 1, fine: 1, level: 0.42, attack: 0.735, decay: 1.7, sustain: 0.72, release: 0.6, velSens: 0.6 }
  ], lfoRate: 3.52, lfoWaveform: 0, lfoPitchDepth: 0.03, lfoAmpDepth: 0.225 }, fx: { chorus: { enabled: true, rate: 0.4, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.7, mix: 0.25 } } },

  { name: 'Tubular Bell', params: { algorithm: 6, feedback: 0.15, ops: [
    op(1,1,80, 0.001,3.0,0.0,2.0, 0.2), op(3.5,1,40, 0.001,0.8,0.0,0.5, 0.5),
    op(2.76,1,70, 0.001,2.5,0.0,1.5, 0.2), op(5.4,1,35, 0.001,0.6,0.0,0.4, 0.5),
    op(7.1,1,55, 0.001,1.8,0.0,1.0, 0.3), op(11,1,28, 0.001,0.5,0.0,0.3, 0.6)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.9, mix: 0.4 } } },
];

const presets = new SynthShell.PresetStore({
  storageKey: 'fm-synth-presets',
  factory: FACTORY_PRESETS,
  apply: (p) => applyPreset(p),
});
function populatePresetSelect() { presets.populateSelect(); }

function applyPreset(preset) {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'preset', params: preset.params, fx: preset.fx || {} });
  updateUIFromPreset(preset);
}

function updateUIFromPreset(preset) {
  const p = preset.params; if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; const v = document.getElementById(id+'-val'); if(v) v.textContent = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val).toFixed(2)) : val; } };
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  const setSelect = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  // Algorithm
  document.querySelectorAll('#algo-buttons button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.algo) === p.algorithm));
  document.getElementById('algo-diagram').textContent = ALGO_DIAGRAMS[p.algorithm || 0];
  updateOpRoles(p.algorithm || 0);
  set('feedback', p.feedback || 0);

  // Operators
  if (p.ops) p.ops.forEach((op, i) => {
    setCheck(`op${i}-on`, op.on);
    setSelect(`op${i}-ratio`, op.ratio);
    set(`op${i}-fine`, op.fine || 1.0);
    set(`op${i}-level`, Math.round((op.level || 0) * 99));
    set(`op${i}-velsens`, op.velSens || 0);
    // ADSR — convert time to slider (inverse of sliderToTime)
    const timeToSlider = t => Math.log(t / 0.001) / Math.log(10000);
    set(`op${i}-a`, timeToSlider(op.attack || 0.01));
    set(`op${i}-d`, timeToSlider(op.decay || 0.3));
    set(`op${i}-s`, op.sustain || 0);
    set(`op${i}-r`, timeToSlider(op.release || 0.3));
  });

  set('master-vol', p.masterVolume || 0.7);
}

function initPresets() { presets.init(); }

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/fm-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'fm-synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
  workletNode.connect(analyser); analyser.connect(audioCtx.destination);
  initScope();
  document.getElementById('start-btn').textContent = 'Audio On';
  document.getElementById('start-btn').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
  keyboard = new SynthKeyboard('piano-keyboard', {
    noteOn: (note, vel) => noteOn(note, vel),
    noteOff: (note) => noteOff(note),
    pitchBend: (val) => sendParam('pitchBend', val),
    sustainChange: (on) => {
      sustainOn = on;
      if (!on) { for (const n of sustainedNotes) noteOff(n); sustainedNotes.clear(); }
    }
  });
  initUI();
  initPresets();
  updateVoiceDisplay();
  document.getElementById('start-btn').onclick = startAudio;
});
