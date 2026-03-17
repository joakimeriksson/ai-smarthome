// Physical Modeling Synth — Main thread controller

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
function sendParam(param, value) { if (workletNode) workletNode.port.postMessage({ type: 'param', param, value }); }

// ─── UI Binding ─────────────────────────────────────────────────────────────

function bindSlider(id, paramPath, opts = {}) {
  const el = document.getElementById(id); if (!el) return;
  const valEl = document.getElementById(id + '-val');
  const fmt = opts.format || (v => parseFloat(v).toFixed(2));
  const map = opts.map || (v => parseFloat(v));
  el.oninput = () => { if (valEl) valEl.textContent = fmt(el.value); sendParam(paramPath, map(el.value)); };
  if (valEl) valEl.textContent = fmt(el.value);
}
function bindSelect(id, paramPath) {
  const el = document.getElementById(id); if (!el) return;
  el.onchange = () => sendParam(paramPath, parseInt(el.value));
}
function bindCheckbox(id, paramPath) {
  const el = document.getElementById(id); if (!el) return;
  el.onchange = () => sendParam(paramPath, el.checked);
}

function initUI() {
  bindSelect('exciter', 'exciter');
  bindSlider('color', 'color');
  bindSlider('brightness', 'brightness');
  bindSlider('decay', 'decay');
  bindSlider('damping', 'damping');
  bindSlider('pickup', 'pickup');
  bindSlider('inharm', 'inharm');
  bindSlider('body-amount', 'bodyAmount');
  bindSlider('body-size', 'bodySize');
  bindSlider('stereo-width', 'stereoWidth');
  bindSlider('master-vol', 'masterVolume');

  bindCheckbox('fx-chorus-on', 'fx.chorus.enabled');
  bindSlider('fx-chorus-rate', 'fx.chorus.rate', { map: v => parseFloat(v)*3, format: v => (parseFloat(v)*3).toFixed(1)+'Hz' });
  bindSlider('fx-chorus-depth', 'fx.chorus.depth', { map: v => parseFloat(v)*0.01 });
  bindSlider('fx-chorus-mix', 'fx.chorus.mix');
  bindCheckbox('fx-delay-on', 'fx.delay.enabled');
  bindSlider('fx-delay-time', 'fx.delay.timeL', { map: v => parseFloat(v)*1.5, format: v => Math.round(parseFloat(v)*1500)+'ms' });
  bindSlider('fx-delay-fb', 'fx.delay.feedback');
  bindSlider('fx-delay-mix', 'fx.delay.mix');
  bindCheckbox('fx-reverb-on', 'fx.reverb.enabled');
  bindSlider('fx-reverb-size', 'fx.reverb.roomSize');
  bindSlider('fx-reverb-damp', 'fx.reverb.damping');
  bindSlider('fx-reverb-mix', 'fx.reverb.mix');
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
    ctx.fillStyle = '#0a1a0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#44cc44'; ctx.lineWidth = 1.5; ctx.beginPath();
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

const FACTORY_PRESETS = [
  { name: 'Acoustic Guitar', params: { exciter: 0, color: 0.5, brightness: 0.45, decay: 0.5, damping: 0.1, pickup: 0.13, inharm: 0, bodyAmount: 0.3, bodySize: 0.5, stereoWidth: 0.2, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.5, damping: 0.5, mix: 0.15 } } },
  { name: 'Electric Guitar', params: { exciter: 0, color: 0.65, brightness: 0.6, decay: 0.6, damping: 0.05, pickup: 0.17, inharm: 0.03, bodyAmount: 0.0, bodySize: 0.5, stereoWidth: 0.15, masterVolume: 0.8 },
    fx: { chorus: { enabled: true, rate: 0.2, depth: 0.003, mix: 0.2 } } },
  { name: 'Nylon Guitar', params: { exciter: 0, color: 0.3, brightness: 0.3, decay: 0.4, damping: 0.15, pickup: 0.2, inharm: 0, bodyAmount: 0.4, bodySize: 0.6, stereoWidth: 0.25, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.6, mix: 0.2 } } },
  { name: 'Harp', params: { exciter: 0, color: 0.55, brightness: 0.5, decay: 0.85, damping: 0.15, pickup: 0.1, inharm: 0, bodyAmount: 0.2, bodySize: 0.4, stereoWidth: 0.4, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.8, damping: 0.4, mix: 0.3 } } },
  { name: 'Kalimba', params: { exciter: 1, color: 0.7, brightness: 0.6, decay: 0.7, damping: 0.25, pickup: 0.05, inharm: 0.15, bodyAmount: 0.5, bodySize: 0.3, stereoWidth: 0.3, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.7, damping: 0.5, mix: 0.25 } } },
  { name: 'Marimba', params: { exciter: 3, color: 0.35, brightness: 0.35, decay: 0.5, damping: 0.5, pickup: 0.25, inharm: 0.1, bodyAmount: 0.6, bodySize: 0.7, stereoWidth: 0.35, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.5, damping: 0.6, mix: 0.2 } } },
  { name: 'Koto', params: { exciter: 0, color: 0.7, brightness: 0.65, decay: 0.6, damping: 0.3, pickup: 0.08, inharm: 0, bodyAmount: 0.15, bodySize: 0.4, stereoWidth: 0.2, masterVolume: 0.8 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.4, mix: 0.2 } } },
  { name: 'Clavinet', params: { exciter: 1, color: 0.8, brightness: 0.75, decay: 0.55, damping: 0.15, pickup: 0.05, inharm: 0.08, bodyAmount: 0.0, bodySize: 0.5, stereoWidth: 0.1, masterVolume: 0.8 },
    fx: { chorus: { enabled: true, rate: 0.8, depth: 0.002, mix: 0.15 } } },
  { name: 'Bowed String', params: { exciter: 2, color: 0.4, brightness: 0.5, decay: 0.8, damping: 0.05, pickup: 0.15, inharm: 0, bodyAmount: 0.2, bodySize: 0.5, stereoWidth: 0.2, masterVolume: 0.7 },
    fx: { reverb: { enabled: true, roomSize: 0.7, damping: 0.5, mix: 0.25 } } },
  { name: 'Steel Drum', params: { exciter: 3, color: 0.6, brightness: 0.55, decay: 0.65, damping: 0.3, pickup: 0.3, inharm: 0.25, bodyAmount: 0.4, bodySize: 0.35, stereoWidth: 0.35, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.4, mix: 0.25 } } },
  { name: 'Bell Chime', params: { exciter: 1, color: 0.75, brightness: 0.7, decay: 0.9, damping: 0.1, pickup: 0.12, inharm: 0.3, bodyAmount: 0.2, bodySize: 0.3, stereoWidth: 0.4, masterVolume: 0.7 },
    fx: { reverb: { enabled: true, roomSize: 0.9, damping: 0.3, mix: 0.4 } } },
  { name: 'Sitar', params: { exciter: 0, color: 0.5, brightness: 0.5, decay: 0.75, damping: 0.25, pickup: 0.04, inharm: 0.2, bodyAmount: 0.5, bodySize: 0.6, stereoWidth: 0.15, masterVolume: 0.75 },
    fx: { reverb: { enabled: true, roomSize: 0.6, damping: 0.5, mix: 0.2 } } },
];

let userPresets = [];
function loadPresets() { try { const s = localStorage.getItem('pm-synth-presets'); if (s) userPresets = JSON.parse(s); } catch(e) {} }
function savePresetsToStorage() { try { localStorage.setItem('pm-synth-presets', JSON.stringify(userPresets)); } catch(e) {} }

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
  const p = preset.params;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; el.dispatchEvent(new Event('input')); } };
  const setSelect = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  setSelect('exciter', p.exciter || 0);
  set('color', p.color); set('brightness', p.brightness);
  set('decay', p.decay); set('damping', p.damping);
  set('pickup', p.pickup); set('inharm', p.inharm);
  set('body-amount', p.bodyAmount); set('body-size', p.bodySize);
  set('stereo-width', p.stereoWidth); set('master-vol', p.masterVolume);
  const fx = preset.fx || {};
  if (fx.chorus) setCheck('fx-chorus-on', fx.chorus.enabled);
  if (fx.delay) setCheck('fx-delay-on', fx.delay.enabled);
  if (fx.reverb) setCheck('fx-reverb-on', fx.reverb.enabled);
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
    const rv = id => { const el = document.getElementById(id); return el ? parseFloat(el.value) : 0; };
    const preset = { name, params: {
      exciter: parseInt(document.getElementById('exciter').value),
      color: rv('color'), brightness: rv('brightness'), decay: rv('decay'), damping: rv('damping'),
      pickup: rv('pickup'), inharm: rv('inharm'), bodyAmount: rv('body-amount'), bodySize: rv('body-size'),
      stereoWidth: rv('stereo-width'), masterVolume: rv('master-vol'),
    } };
    userPresets.push(preset); savePresetsToStorage(); populatePresetSelect();
  };
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/pm-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'pm-synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
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
    sustainChange: (on) => { sustainOn = on; if (!on) { for (const n of sustainedNotes) noteOff(n); sustainedNotes.clear(); } }
  });
  initUI(); initPresets(); updateVoiceDisplay();
  document.getElementById('start-btn').onclick = startAudio;
});
