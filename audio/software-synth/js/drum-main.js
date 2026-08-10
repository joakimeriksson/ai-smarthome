// Drum Machine — Main thread controller

let audioCtx = null, workletNode = null, analyser = null;
const NUM_CHANNELS = 8, NUM_STEPS = 16;
const CHANNEL_NAMES = ['Kick', 'Snare', 'CH Hat', 'OH Hat', 'Clap', 'Tom', 'Rim', 'Cowbell'];
const TYPE_NAMES = ['Kick', 'Snare', 'CH Hat', 'OH Hat', 'Clap', 'Tom', 'Rim', 'Cowbell',
                    'Cymbal', 'Maraca', 'Conga', 'Claves'];

// Main-thread mirror of the per-channel voice settings. The worklet holds the
// truth, but it cannot be queried — so this mirror is what the channel editor
// shows and what presets write through. Matches the processor's defaults.
const DEFAULT_KIT = [
  { type: 0, tone: 55,  decay: 0.55, color: 0.35, level: 0.9,  pan: 0 },
  { type: 1, tone: 172, decay: 0.45, color: 0.55, blend: 0.5, level: 0.75, pan: 0 },
  { type: 2, tone: 300, decay: 0.3,  color: 0.5,  level: 0.55, pan: 0.15 },
  { type: 3, tone: 300, decay: 0.5,  color: 0.5,  level: 0.5,  pan: 0.15 },
  { type: 4, tone: 200, decay: 0.5,  color: 0.4,  level: 0.7,  pan: -0.15 },
  { type: 5, tone: 110, decay: 0.5,  color: 0.4,  level: 0.7,  pan: -0.25 },
  { type: 6, tone: 436, decay: 0.35, color: 0.5,  level: 0.6,  pan: 0.2 },
  { type: 7, tone: 540, decay: 0.45, color: 0.5,  level: 0.5,  pan: 0.3 },
];
let kit = DEFAULT_KIT.map(c => ({ ...c }));

/** Row label follows the channel's current voice, not its default role. */
function rowLabel(ch) { return TYPE_NAMES[kit[ch].type] || CHANNEL_NAMES[ch]; }

/** Write one kit field: mirror + worklet. */
function setKit(ch, field, value) {
  kit[ch][field] = value;
  sendParam(`ch.${ch}.${field}`, value);
}
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
    label.textContent = rowLabel(ch);
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
    <div class="panel-title">${rowLabel(ch)} Settings</div>
    <div class="control-row"><label>Type</label><select id="ch-type">
      <option value="0">Kick</option><option value="1">Snare</option>
      <option value="2">Closed HH</option><option value="3">Open HH</option>
      <option value="4">Clap</option><option value="5">Tom</option>
      <option value="6">Rim</option><option value="7">Cowbell</option>
      <option value="8">Cymbal</option><option value="9">Maraca</option>
      <option value="10">Conga</option><option value="11">Claves</option>
    </select></div>
    <div class="control-row"><label>Tone</label><input type="range" id="ch-tone" min="20" max="800" step="1" value="200"><span class="val" id="ch-tone-val"></span></div>
    <div class="control-row"><label>Decay</label><input type="range" id="ch-decay" min="0.1" max="1" step="0.01" value="0.5"><span class="val" id="ch-decay-val"></span></div>
    <div class="control-row"><label>Color</label><input type="range" id="ch-color" min="0" max="1" step="0.01" value="0.5"><span class="val" id="ch-color-val"></span></div>
    <div class="control-row"><label>Blend</label><input type="range" id="ch-blend" min="0" max="1" step="0.01" value="0.5"><span class="val" id="ch-blend-val"></span></div>
    <div class="control-row"><label>Level</label><input type="range" id="ch-level" min="0" max="1" step="0.01" value="0.8"><span class="val" id="ch-level-val"></span></div>
    <div class="control-row"><label>Pan</label><input type="range" id="ch-pan" min="-1" max="1" step="0.01" value="0"><span class="val" id="ch-pan-val"></span></div>
  `;
  // Bind, showing the kit's ACTUAL values — the old hardcoded template values
  // meant the panel showed defaults after every preset load or channel switch.
  const bind = (id, field) => {
    const inp = document.getElementById(id);
    const val = document.getElementById(id + '-val');
    if (!inp) return;
    inp.value = kit[ch][field];
    const show = () => { if (val) val.textContent = parseFloat(inp.value).toFixed(field==='tone'?0:2); };
    inp.oninput = () => { setKit(ch, field, parseFloat(inp.value)); show(); };
    show();
  };
  const typeSel = document.getElementById('ch-type');
  typeSel.value = String(kit[ch].type);
  typeSel.onchange = (e) => {
    setKit(ch, 'type', parseInt(e.target.value));
    renderGrid();               // row label follows the voice
    renderChannelEditor();      // panel title too
    triggerDrum(ch);            // audition the new voice
  };
  bind('ch-tone', 'tone'); bind('ch-decay', 'decay'); bind('ch-color', 'color'); bind('ch-blend', 'blend');
  bind('ch-level', 'level'); bind('ch-pan', 'pan');
}

// ─── Presets ────────────────────────────────────────────────────────────────

const FACTORY_PRESETS = [
  // Every preset carries a KIT (per-channel voice tunings, including re-typing
  // channels to the conga/claves/cymbal/maraca voices) and uses the accent
  // bus: velocity changes brightness as well as level, so a 45 and a 127 are
  // different sounds, not just different volumes. Kit entries are overrides on
  // the default channels; omitted fields keep their defaults.
  { name: '808 Classic', bpm: 96, swing: 0.08,
    kit: [
      { tone: 52, decay: 0.75, color: 0.3 },            // long boom kick
      { color: 0.65, decay: 0.5 },                      // snappy snare
      { decay: 0.25 }, { decay: 0.55 },
      {}, {}, {}, {},
    ],
    pattern: [
      [127,0,0,0, 0,0,95,0, 0,90,0,0, 110,0,0,0],
      [0,0,0,0, 115,0,0,45, 0,0,0,0, 115,0,0,40],
      [90,0,55,0, 85,0,55,0, 90,0,55,0, 85,0,60,0],
      [0,0,0,0, 0,0,0,0, 0,0,80,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ] },
  { name: 'Planet Funk', bpm: 118,
    kit: [
      { tone: 55, decay: 0.35, color: 0.55 },           // tight electro kick
      { tone: 190, color: 0.8, decay: 0.4 },            // bright snap
      { decay: 0.2, color: 0.65 }, { decay: 0.45 },
      { color: 0.6 }, { type: 10, tone: 340, decay: 0.5, pan: -0.2 },  // conga
      { type: 11, tone: 2423, level: 0.5, pan: 0.25 },  // claves
      { tone: 540, level: 0.45 },
    ],
    pattern: [
      [127,0,0,0, 0,0,0,85, 0,0,100,0, 0,0,0,0],
      [0,0,0,0, 110,0,0,0, 0,0,0,0, 110,0,0,0],
      [80,45,60,45, 80,45,60,45, 80,45,60,45, 80,45,70,45],
      [0,0,90,0, 0,0,0,0, 0,0,90,0, 0,0,0,0],
      [0,0,0,0, 100,0,0,0, 0,0,0,0, 100,0,0,60],
      [0,0,0,0, 0,0,0,0, 0,0,0,70, 0,0,90,0],
      [0,0,0,75, 0,0,0,0, 0,0,0,75, 0,0,0,0],
      [90,0,0,0, 0,0,0,80, 0,0,0,0, 0,90,0,0],
    ] },
  { name: 'Miami Boom', bpm: 100,
    kit: [
      { tone: 48, decay: 0.95, color: 0.25, level: 1.0 },  // earthquake kick
      { color: 0.7 },
      { decay: 0.2 }, { decay: 0.4 },
      {}, { tone: 95, decay: 0.6 }, {}, {},
    ],
    pattern: [
      [127,0,0,0, 0,0,0,0, 100,0,0,95, 0,0,0,0],
      [0,0,0,0, 115,0,0,0, 0,0,0,0, 115,0,0,0],
      [45,60,75,90, 45,60,75,90, 45,60,75,90, 45,60,75,90],
      [0,0,0,0, 0,0,90,0, 0,0,0,0, 0,0,90,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,90,70,55],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ] },
  { name: 'Deep House', bpm: 124, swing: 0.12,
    kit: [
      { tone: 55, decay: 0.5, color: 0.4 },
      { level: 0 },
      { decay: 0.2, level: 0.45 }, { decay: 0.5, level: 0.6 },
      { color: 0.55 }, { type: 9, tone: 300, decay: 0.4, level: 0.4, pan: -0.3 },  // shaker
      { tone: 436, level: 0.5 }, { level: 0 },
    ],
    pattern: [
      [115,0,0,0, 115,0,0,0, 115,0,0,0, 115,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [55,0,40,0, 55,0,40,0, 55,0,40,0, 55,0,40,0],
      [0,0,95,0, 0,0,95,0, 0,0,95,0, 0,0,95,0],
      [0,0,0,0, 105,0,0,0, 0,0,0,0, 105,0,0,0],
      [70,40,55,40, 70,40,55,40, 70,40,55,40, 70,40,60,45],
      [0,0,0,0, 60,0,0,0, 0,0,0,60, 60,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ] },
  { name: 'Afro-Cuban', bpm: 105,
    kit: [
      { tone: 50, decay: 0.55, level: 0.8 },
      { level: 0 },
      { decay: 0.2, level: 0.4 },
      { type: 10, tone: 412, decay: 0.4, pan: 0.3 },    // hi conga (slap)
      { type: 9, tone: 300, decay: 0.35, level: 0.5, pan: -0.35 },  // maracas
      { type: 10, tone: 200, decay: 0.6, pan: -0.2 },   // low conga
      { type: 11, tone: 2423, level: 0.6, pan: 0.15 },  // claves
      { tone: 540, level: 0.5 },
    ],
    pattern: [
      [110,0,0,0, 0,0,0,0, 100,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [50,0,40,0, 50,0,40,0, 50,0,40,0, 50,0,40,0],
      [0,0,90,0, 0,0,75,0, 0,0,90,0, 0,60,75,0],
      [70,45,70,45, 70,45,70,45, 70,45,70,45, 70,45,70,45],
      [0,0,80,0, 0,0,70,0, 0,0,80,0, 0,60,95,0],
      [100,0,0,90, 0,0,85,0, 0,0,95,0, 90,0,0,0],
      [85,0,0,0, 85,0,0,0, 85,0,0,0, 85,0,0,0],
    ] },
  { name: 'Trap 88', bpm: 140, swing: 0.0,
    kit: [
      { tone: 45, decay: 1.0, color: 0.2, level: 1.0 }, // sub boom
      { tone: 195, color: 0.9, decay: 0.45 },
      { decay: 0.15, color: 0.7 }, { decay: 0.4 },
      { color: 0.5 }, {},
      { type: 11, tone: 2423, level: 0.4, pan: 0.3 },   // claves sprinkle
      { level: 0 },
    ],
    pattern: [
      [127,0,0,0, 0,0,0,90, 0,0,60,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 120,0,0,0, 0,0,0,0],
      [75,0,75,0, 75,45,45,45, 75,0,75,0, 100,60,60,60],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,90,0],
      [0,0,0,0, 0,0,0,0, 100,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,55,0, 0,0,0,0, 0,55,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ] },
  { name: 'Warehouse', bpm: 132,
    kit: [
      { tone: 52, decay: 0.55, color: 0.45 },
      { level: 0 },
      { decay: 0.2, level: 0.4 }, { decay: 0.45 },
      { color: 0.6, level: 0.6 },
      { type: 9, tone: 300, decay: 0.3, level: 0.45, pan: -0.3 },   // shaker
      { tone: 436, level: 0.45, decay: 0.25 },
      { type: 8, tone: 300, decay: 0.35, color: 0.4, level: 0.35, pan: 0.2 },  // cymbal
    ],
    pattern: [
      [120,0,0,0, 120,0,0,0, 120,0,0,0, 120,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      [40,0,40,0, 40,0,40,0, 40,0,40,0, 40,0,40,0],
      [0,0,90,0, 0,0,90,0, 0,0,90,0, 0,0,90,0],
      [0,0,0,0, 80,0,0,0, 0,0,0,0, 80,0,0,0],
      [55,35,45,35, 55,35,45,35, 55,35,45,35, 55,35,50,40],
      [0,35,0,35, 0,35,0,35, 0,35,0,35, 0,35,45,35],
      [70,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    ] },
  { name: 'Breakbeat', bpm: 138,
    kit: [
      { tone: 55, decay: 0.4, color: 0.5 },
      { color: 0.75, decay: 0.5 },
      { decay: 0.25 }, { decay: 0.5 },
      {}, { tone: 120, decay: 0.45 }, {}, {},
    ],
    pattern: [
      [115,0,0,0, 0,0,95,0, 0,100,0,0, 0,0,0,0],
      [0,0,0,0, 115,0,0,45, 0,0,0,0, 110,0,0,60],
      [80,0,60,0, 80,0,60,0, 80,0,60,0, 80,0,60,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,85,0],
      [0,0,0,0, 0,0,0,0, 0,90,0,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,80,0,0],
      [0,0,70,0, 0,0,0,0, 0,0,65,0, 0,0,0,0],
      [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
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

  // The kit is part of the sound: reset to defaults, then lay the preset's
  // overrides on top, so switching presets never inherits stray tunings.
  kit = DEFAULT_KIT.map((c, ch) => ({ ...c, ...(preset.kit?.[ch] ?? {}) }));
  for (let ch = 0; ch < NUM_CHANNELS; ch++) {
    for (const [field, value] of Object.entries(kit[ch])) {
      sendParam(`ch.${ch}.${field}`, value);
    }
  }

  if (preset.bpm) {
    document.getElementById('bpm').value = preset.bpm;
    document.getElementById('bpm-val').textContent = preset.bpm;
    sendParam('bpm', preset.bpm);
  }
  const swing = preset.swing ?? 0;
  const swingEl = document.getElementById('swing');
  if (swingEl) {
    swingEl.value = swing;
    const sv = document.getElementById('swing-val');
    if (sv) sv.textContent = Math.round(swing * 100) + '%';
  }
  sendParam('swing', swing);

  renderGrid();
  renderChannelEditor();
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
