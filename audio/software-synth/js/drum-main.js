// Drum Machine — Main thread controller

let audioCtx = null, workletNode = null, analyser = null;
const NUM_CHANNELS = 8, NUM_STEPS = 16;
const CHANNEL_NAMES = ['Kick', 'Snare', 'CH Hat', 'OH Hat', 'Clap', 'Tom', 'Rim', 'Cowbell'];
const pattern = new Array(NUM_CHANNELS).fill(null).map(() => new Uint8Array(NUM_STEPS));
let playing = false, currentStep = -1, selectedChannel = 0;

function sendParam(param, value) { if (workletNode) workletNode.port.postMessage({ type: 'param', param, value }); }
function triggerDrum(ch, vel = 1.0) { if (workletNode) workletNode.port.postMessage({ type: 'trigger', channel: ch, velocity: vel }); }

// ─── Pattern Grid ───────────────────────────────────────────────────────────

function renderGrid() {
  const grid = document.getElementById('seq-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    const row = document.createElement('div');
    row.className = 'seq-row';
    const label = document.createElement('div');
    label.className = 'seq-label' + (ch === selectedChannel ? ' selected' : '');
    label.textContent = CHANNEL_NAMES[ch];
    label.onclick = () => { selectedChannel = ch; renderGrid(); renderChannelEditor(); triggerDrum(ch); };
    row.appendChild(label);
    for (let s = 0; s < NUM_STEPS; s++) {
      const step = document.createElement('div');
      step.className = 'seq-step' + (pattern[ch][s] ? ' on' : '') + (s === currentStep ? ' current' : '');
      step.onclick = () => {
        pattern[ch][s] = pattern[ch][s] ? 0 : 100;
        if (workletNode) workletNode.port.postMessage({ type: 'setStep', channel: ch, step: s, value: pattern[ch][s] });
        renderGrid();
      };
      row.appendChild(step);
    }
    grid.appendChild(row);
  }
}

function highlightStep(step) {
  currentStep = step;
  document.querySelectorAll('.seq-step.current').forEach(el => el.classList.remove('current'));
  document.querySelectorAll('.seq-row').forEach((row, ch) => {
    const steps = row.querySelectorAll('.seq-step');
    if (steps[step]) steps[step].classList.add('current');
  });
}

// ─── Channel Editor ─────────────────────────────────────────────────────────

function renderChannelEditor() {
  const el = document.getElementById('channel-edit');
  if (!el) return;
  const ch = selectedChannel;
  el.innerHTML = `
    <div class="panel-title">${CHANNEL_NAMES[ch]} Settings</div>
    <div class="control-row"><label>Type</label><select id="ch-type">
      <option value="0" ${ch===0?'selected':''}>Kick</option><option value="1" ${ch===1?'selected':''}>Snare</option>
      <option value="2">Closed HH</option><option value="3">Open HH</option>
      <option value="4">Clap</option><option value="5">Tom</option>
      <option value="6">Rim</option><option value="7">Cowbell</option>
    </select></div>
    <div class="control-row"><label>Tone</label><input type="range" id="ch-tone" min="20" max="800" step="1" value="200"><span class="val" id="ch-tone-val"></span></div>
    <div class="control-row"><label>Decay</label><input type="range" id="ch-decay" min="0.1" max="1" step="0.01" value="0.5"><span class="val" id="ch-decay-val"></span></div>
    <div class="control-row"><label>Color</label><input type="range" id="ch-color" min="0" max="1" step="0.01" value="0.5"><span class="val" id="ch-color-val"></span></div>
    <div class="control-row"><label>Level</label><input type="range" id="ch-level" min="0" max="1" step="0.01" value="0.8"><span class="val" id="ch-level-val"></span></div>
    <div class="control-row"><label>Pan</label><input type="range" id="ch-pan" min="-1" max="1" step="0.01" value="0"><span class="val" id="ch-pan-val"></span></div>
  `;
  // Bind
  const bind = (id, field) => {
    const inp = document.getElementById(id);
    const val = document.getElementById(id + '-val');
    if (inp) {
      inp.oninput = () => { sendParam(`ch.${ch}.${field}`, parseFloat(inp.value)); if (val) val.textContent = parseFloat(inp.value).toFixed(field==='tone'?0:2); };
      if (val) val.textContent = parseFloat(inp.value).toFixed(field==='tone'?0:2);
    }
  };
  document.getElementById('ch-type').onchange = (e) => sendParam(`ch.${ch}.type`, parseInt(e.target.value));
  bind('ch-tone', 'tone'); bind('ch-decay', 'decay'); bind('ch-color', 'color');
  bind('ch-level', 'level'); bind('ch-pan', 'pan');
}

// ─── Presets ────────────────────────────────────────────────────────────────

const FACTORY_PRESETS = [
  { name: '808 Basic', bpm: 120,
    pattern: [
      [100,0,0,0,100,0,0,0,100,0,0,0,100,0,0,0], // kick
      [0,0,0,0,100,0,0,0,0,0,0,0,100,0,0,0],       // snare
      [100,0,100,0,100,0,100,0,100,0,100,0,100,0,100,0], // ch hat
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,0],         // oh hat
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],           // clap
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],           // tom
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],           // rim
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],           // cowbell
    ] },
  { name: 'Funky', bpm: 110,
    pattern: [
      [100,0,0,100,0,0,100,0,0,0,100,0,0,100,0,0],
      [0,0,0,0,100,0,0,0,0,0,0,0,100,0,0,100],
      [100,100,100,100,100,100,100,100,100,100,100,100,100,100,100,100],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,0],
      [0,0,0,0,100,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,100,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ] },
  { name: 'Breakbeat', bpm: 140,
    pattern: [
      [100,0,0,0,0,0,100,0,0,100,0,0,0,0,0,0],
      [0,0,0,0,100,0,0,0,0,0,0,0,100,0,0,100],
      [100,0,100,0,100,0,100,0,100,0,100,0,100,0,100,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,100,0],
      [0,0,0,0,0,0,0,0,0,100,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,100,0,0],
      [0,0,100,0,0,0,0,0,0,0,100,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ] },
  { name: 'House', bpm: 126,
    pattern: [
      [100,0,0,0,100,0,0,0,100,0,0,0,100,0,0,0],
      [0,0,0,0,100,0,0,0,0,0,0,0,100,0,0,0],
      [0,0,100,0,0,0,100,0,0,0,100,0,0,0,100,0],
      [100,0,0,0,0,0,0,0,100,0,0,0,0,0,0,0],
      [0,0,0,0,100,0,0,0,0,0,0,0,100,0,0,100],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ] },
];

function populatePresetSelect() {
  const sel = document.getElementById('preset-select'); if (!sel) return;
  sel.innerHTML = '<option value="">-- Pattern --</option>';
  FACTORY_PRESETS.forEach((p, i) => sel.innerHTML += `<option value="${i}">${p.name}</option>`);
}

function applyPreset(preset) {
  if (!workletNode) return;
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    for (let s = 0; s < NUM_STEPS; s++) {
      pattern[ch][s] = preset.pattern[ch] ? (preset.pattern[ch][s] || 0) : 0;
    }
  }
  workletNode.port.postMessage({ type: 'setPattern', pattern: pattern.map(ch => [...ch]) });
  if (preset.bpm) {
    document.getElementById('bpm').value = preset.bpm;
    document.getElementById('bpm-val').textContent = preset.bpm;
    sendParam('bpm', preset.bpm);
  }
  renderGrid();
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
    ctx.fillStyle = '#1a0a0a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#ff4444'; ctx.lineWidth = 1.5; ctx.beginPath();
    const sw = canvas.width / buf.length;
    for (let i = 0, x = 0; i < buf.length; i++, x += sw) {
      const y = (1 - buf[i]) * canvas.height / 2;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  })();
}

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/drum-processor.js');
  workletNode = new AudioWorkletNode(audioCtx, 'drum-machine-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
  analyser = audioCtx.createAnalyser(); analyser.fftSize = 2048;
  workletNode.connect(analyser); analyser.connect(audioCtx.destination);

  // Listen for step updates from processor
  workletNode.port.onmessage = (e) => {
    if (e.data.type === 'step') highlightStep(e.data.step);
  };

  initScope();
  document.getElementById('start-btn').textContent = 'Audio On';
  document.getElementById('start-btn').disabled = true;
}

document.addEventListener('DOMContentLoaded', () => {
  renderGrid();
  renderChannelEditor();
  populatePresetSelect();

  document.getElementById('start-btn').onclick = startAudio;

  document.getElementById('play-btn').onclick = () => {
    if (!workletNode) return;
    playing = !playing;
    workletNode.port.postMessage({ type: playing ? 'play' : 'stop' });
    document.getElementById('play-btn').textContent = playing ? 'STOP' : 'PLAY';
    document.getElementById('play-btn').classList.toggle('active', playing);
    if (!playing) { currentStep = -1; renderGrid(); }
  };

  const bpmEl = document.getElementById('bpm');
  const bpmVal = document.getElementById('bpm-val');
  if (bpmEl) bpmEl.oninput = () => { if (bpmVal) bpmVal.textContent = bpmEl.value; sendParam('bpm', parseInt(bpmEl.value)); };
  if (bpmVal) bpmVal.textContent = bpmEl.value;

  const swingEl = document.getElementById('swing');
  const swingVal = document.getElementById('swing-val');
  if (swingEl) swingEl.oninput = () => { if (swingVal) swingVal.textContent = Math.round(parseFloat(swingEl.value)*100)+'%'; sendParam('swing', parseFloat(swingEl.value)); };

  const volEl = document.getElementById('master-vol');
  const volVal = document.getElementById('master-vol-val');
  if (volEl) volEl.oninput = () => { if (volVal) volVal.textContent = parseFloat(volEl.value).toFixed(2); sendParam('masterVolume', parseFloat(volEl.value)); };

  document.getElementById('preset-select').onchange = (e) => {
    const idx = parseInt(e.target.value);
    if (!isNaN(idx) && FACTORY_PRESETS[idx]) applyPreset(FACTORY_PRESETS[idx]);
  };

  document.getElementById('clear-btn').onclick = () => {
    for (let ch = 0; ch < NUM_CHANNELS; ch++) pattern[ch].fill(0);
    if (workletNode) workletNode.port.postMessage({ type: 'setPattern', pattern: pattern.map(ch => [...ch]) });
    renderGrid();
  };

  // Keyboard triggers (number keys 1-8 trigger drums)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const num = parseInt(e.key);
    if (num >= 1 && num <= 8) triggerDrum(num - 1);
    if (e.key === ' ') { e.preventDefault(); document.getElementById('play-btn').click(); }
  });
});
