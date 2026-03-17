// FM Synth — Main thread controller

const NUM_VOICES = 8;
let audioCtx = null, workletNode = null, analyser = null, keyboard = null;

const voices = new Array(NUM_VOICES).fill(null).map(() => ({ note: -1, active: false, age: 0 }));
let voiceAge = 0, sustainOn = false;
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
  const v = allocateVoice(note);
  workletNode.port.postMessage({ type: 'noteOn', voice: v, note, velocity });
  updateVoiceDisplay();
  if (keyboard) keyboard.highlightKey(note, true);
}

function noteOff(note) {
  if (!workletNode) return;
  if (sustainOn) { sustainedNotes.add(note); return; }
  const v = releaseVoice(note);
  if (v >= 0) { workletNode.port.postMessage({ type: 'noteOff', voice: v }); updateVoiceDisplay(); }
  if (keyboard) keyboard.highlightKey(note, false);
}

function sendParam(param, value) {
  if (workletNode) workletNode.port.postMessage({ type: 'param', param, value });
}

// ─── UI Binding ─────────────────────────────────────────────────────────────

function bindSlider(id, paramPath, opts = {}) {
  const el = document.getElementById(id); if (!el) return;
  const valEl = document.getElementById(id + '-val');
  const fmt = opts.format || (v => parseFloat(v).toFixed(2));
  const map = opts.map || (v => parseFloat(v));
  el.oninput = () => { const m = map(el.value); if (valEl) valEl.textContent = fmt(el.value); sendParam(paramPath, m); };
  if (valEl) valEl.textContent = fmt(el.value);
}

function bindSelect(id, paramPath, opts = {}) {
  const el = document.getElementById(id); if (!el) return;
  el.onchange = () => sendParam(paramPath, (opts.map || parseInt)(el.value));
}

function bindCheckbox(id, paramPath) {
  const el = document.getElementById(id); if (!el) return;
  el.onchange = () => sendParam(paramPath, el.checked);
}

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
  const canvas = document.getElementById('scope');
  if (!canvas || !analyser) return;
  const ctx = canvas.getContext('2d');
  const buf = new Float32Array(analyser.frequencyBinCount);
  (function draw() {
    requestAnimationFrame(draw);
    analyser.getFloatTimeDomainData(buf);
    ctx.fillStyle = '#1a1208'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ff8800'; ctx.lineWidth = 1.5; ctx.beginPath();
    const sw = canvas.width / buf.length;
    for (let i = 0, x = 0; i < buf.length; i++, x += sw) {
      const y = (1 - buf[i]) * canvas.height / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  })();
}

function updateVoiceDisplay() {
  const el = document.getElementById('voice-display');
  if (el) el.textContent = `Voices: ${voices.filter(v => v.active).length}/${NUM_VOICES}`;
}

// ─── Presets ────────────────────────────────────────────────────────────────

function op(ratio, fine, level, a, d, s, r, vel) {
  return { on: true, ratio, fine: fine || 1.0, level: level/99, attack: a, decay: d, sustain: s, release: r, velSens: vel !== undefined ? vel : 0.7 };
}
function opOff() { return { on: false, ratio: 1, fine: 1, level: 0, attack: 0.01, decay: 0.3, sustain: 0, release: 0.3, velSens: 0 }; }

const FACTORY_PRESETS = [
  { name: 'E.Piano 1', params: { algorithm: 4, feedback: 0.2, ops: [
    op(1,1,85, 0.001,0.8,0.3,0.5, 0.3), op(1,1,75, 0.001,0.6,0.2,0.4, 0.5),
    op(1,1,50, 0.001,0.4,0.0,0.3, 0.8), op(14,1,35, 0.001,0.12,0.0,0.1, 0.9),
    opOff(), opOff()
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.5, mix: 0.15 } } },

  { name: 'E.Piano 2', params: { algorithm: 1, feedback: 0.2, ops: [
    op(1,1,90, 0.001,1.0,0.2,0.6, 0.3), op(1,1,50, 0.001,0.5,0.0,0.3, 0.7),
    op(1,1,40, 0.001,0.3,0.0,0.2, 0.8), op(14,1,30, 0.001,0.08,0.0,0.1, 0.95),
    op(1,1,20, 0.001,0.2,0.0,0.1, 0.5), op(1,1,15, 0.001,0.8,0.0,0.3, 0.5)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { chorus: { enabled: true, rate: 0.3, depth: 0.003, mix: 0.2 } } },

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

  { name: 'DX Brass', params: { algorithm: 2, feedback: 0.25, ops: [
    op(1,1,90, 0.05,0.3,0.8,0.2, 0.3), op(1,1,50, 0.08,0.4,0.3,0.3, 0.6),
    op(1,1,45, 0.1,0.5,0.2,0.3, 0.7), op(1,1,35, 0.12,0.5,0.15,0.3, 0.8),
    op(3,1,30, 0.08,0.3,0.1,0.2, 0.8), op(1,1,20, 0.1,0.4,0.1,0.3, 0.5)
  ], lfoRate: 5, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.6, mix: 0.15 } } },

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

  { name: 'Organ', params: { algorithm: 7, feedback: 0.2, ops: [
    op(0.5,1,75, 0.001,0.05,0.95,0.05, 0.1), op(1,1,80, 0.001,0.05,0.95,0.05, 0.1),
    op(2,1,65, 0.001,0.05,0.9,0.05, 0.1), op(3,1,50, 0.001,0.05,0.85,0.05, 0.1),
    op(4,1,40, 0.001,0.05,0.8,0.05, 0.1), op(8,1,30, 0.001,0.05,0.75,0.05, 0.1)
  ], lfoRate: 6, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { chorus: { enabled: true, rate: 1.0, depth: 0.002, mix: 0.2 } } },

  { name: 'Synth Lead', params: { algorithm: 6, feedback: 0.35, ops: [
    op(1,1,88, 0.01,0.2,0.8,0.15, 0.4), op(1,1,50, 0.001,0.12,0.3,0.1, 0.7),
    op(2,1,75, 0.01,0.25,0.7,0.2, 0.4), op(3,1,40, 0.001,0.08,0.2,0.1, 0.8),
    op(1,0.995,85, 0.01,0.2,0.8,0.15, 0.4), op(2,1,35, 0.001,0.12,0.15,0.1, 0.7)
  ], lfoRate: 5, lfoPitchDepth: 0.3, lfoAmpDepth: 0 }, fx: { delay: { enabled: true, timeL: 0.3, feedback: 0.3, mix: 0.15 } } },

  { name: 'Strings', params: { algorithm: 6, feedback: 0.05, ops: [
    op(1,1,85, 0.15,0.3,0.85,0.4, 0.2), op(1,1,35, 0.1,0.4,0.2,0.3, 0.5),
    op(1,1.003,82, 0.18,0.35,0.83,0.45, 0.2), op(2,1,30, 0.12,0.4,0.15,0.3, 0.5),
    op(1,0.997,80, 0.2,0.3,0.8,0.5, 0.2), op(1,1,25, 0.15,0.4,0.1,0.3, 0.5)
  ], lfoRate: 0.2, lfoPitchDepth: 0.15, lfoAmpDepth: 0.05 },
  fx: { chorus: { enabled: true, rate: 0.15, depth: 0.004, mix: 0.3 }, reverb: { enabled: true, roomSize: 0.8, mix: 0.25 } } },

  { name: 'Tubular Bell', params: { algorithm: 6, feedback: 0.15, ops: [
    op(1,1,80, 0.001,3.0,0.0,2.0, 0.2), op(3.5,1,40, 0.001,0.8,0.0,0.5, 0.5),
    op(2.76,1,70, 0.001,2.5,0.0,1.5, 0.2), op(5.4,1,35, 0.001,0.6,0.0,0.4, 0.5),
    op(7.1,1,55, 0.001,1.8,0.0,1.0, 0.3), op(11,1,28, 0.001,0.5,0.0,0.3, 0.6)
  ], lfoRate: 4, lfoPitchDepth: 0, lfoAmpDepth: 0 }, fx: { reverb: { enabled: true, roomSize: 0.9, mix: 0.4 } } },
];

let userPresets = [];

function loadPresets() { try { const s = localStorage.getItem('fm-synth-presets'); if (s) userPresets = JSON.parse(s); } catch(e) {} }
function savePresetsToStorage() { try { localStorage.setItem('fm-synth-presets', JSON.stringify(userPresets)); } catch(e) {} }

function populatePresetSelect() {
  const sel = document.getElementById('preset-select'); if (!sel) return;
  sel.innerHTML = '<option value="">-- Preset --</option>';
  FACTORY_PRESETS.forEach((p, i) => sel.innerHTML += `<option value="f:${i}">${p.name}</option>`);
  if (userPresets.length > 0) {
    sel.innerHTML += '<option disabled>──────────</option>';
    userPresets.forEach((p, i) => sel.innerHTML += `<option value="u:${i}">${p.name}</option>`);
  }
}

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

function initPresets() {
  loadPresets(); populatePresetSelect();
  document.getElementById('preset-select').onchange = (e) => {
    const val = e.target.value; if (!val) return;
    const [type, idx] = val.split(':');
    const preset = type === 'f' ? FACTORY_PRESETS[idx] : userPresets[idx];
    if (preset) applyPreset(preset);
  };
  document.getElementById('save-preset-btn').onclick = () => {
    const name = prompt('Preset name:'); if (!name) return;
    // TODO: read current state
    const preset = { name, params: { algorithm: 0, feedback: 0.5, ops: [] } };
    userPresets.push(preset); savePresetsToStorage(); populatePresetSelect();
  };
}

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
