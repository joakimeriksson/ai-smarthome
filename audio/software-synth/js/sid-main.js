// SID Synth — Main thread controller

const NUM_VOICES = 3; // 1 SID chip per voice, 3-note polyphony (authentic C64)
const pool = new SynthShell.VoicePool(NUM_VOICES);

let audioCtx = null;
let workletNode = null;
let analyser = null;
let keyboard = null;

let sustainOn = false;
const sustainedNotes = new Set();

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

// ─── GT2 Table System ───────────────────────────────────────────────────────

const tables = {
  ltable: [new Array(255).fill(0), new Array(255).fill(0), new Array(255).fill(0)],
  rtable: [new Array(255).fill(0), new Array(255).fill(0), new Array(255).fill(0)]
};
let tableEnabled = false;
let tableStartPtrs = { wave: 0, pulse: 0, filter: 0 };
let activeTableTab = 0;

function sendTableData(tableType) {
  if (workletNode) workletNode.port.postMessage({ type: 'tableData', tableType, ltable: tables.ltable[tableType], rtable: tables.rtable[tableType] });
}

function sendAllTables() {
  for (let t = 0; t < 3; t++) sendTableData(t);
  sendTableStartPtrs();
  if (workletNode) workletNode.port.postMessage({ type: 'tableEnabled', value: tableEnabled });
}

function sendTableStartPtrs() {
  if (workletNode) workletNode.port.postMessage({ type: 'tableStartPtrs', ptrs: tableStartPtrs });
}

function setTableEnabled(on) {
  tableEnabled = on;
  if (workletNode) workletNode.port.postMessage({ type: 'tableEnabled', value: on });
}

// Table descriptions for display
function describeWTBL(left, right) {
  if (left === 0 && right === 0) return '';
  if (left <= 0x0F) return `Delay ${left} frames`;
  if (left === 0xFF) return right === 0 ? 'STOP' : `Jump → ${right}`;
  if (left >= 0xE0 && left <= 0xEF) return `Silent (gate off) ${(left&0xF).toString(16)}`;
  const wave = [];
  if (left & 0x10) wave.push('TRI');
  if (left & 0x20) wave.push('SAW');
  if (left & 0x40) wave.push('PUL');
  if (left & 0x80) wave.push('NOI');
  let s = wave.join('+');
  if (left & 0x01) s += ' gate';
  if (left & 0x02) s += ' sync';
  if (left & 0x04) s += ' ring';
  if (right === 0x80) s += ' (no note)';
  else if (right < 0x80) s += ` +${right}st`;
  else s += ` abs ${right & 0x7F}`;
  return s;
}

function describePTBL(left, right) {
  if (left === 0 && right === 0) return '';
  if (left >= 0x01 && left <= 0x7F) { const spd = (right & 0x80) ? right - 256 : right; return `Mod ${left}t spd=${spd >= 0 ? '+' : ''}${spd}`; }
  if (left >= 0x80 && left <= 0xFE) return `Set PW=$${(((left&0xF)<<8)|right).toString(16).toUpperCase()}`;
  if (left === 0xFF) return right === 0 ? 'STOP' : `Jump → ${right}`;
  return '';
}

function describeFTBL(left, right) {
  if (left === 0 && right === 0) return '';
  if (left === 0x00 && right > 0) return `Set cutoff=$${right.toString(16).toUpperCase()}`;
  if (left >= 0x01 && left <= 0x7F) { const spd = (right & 0x80) ? right - 256 : right; return `Mod ${left}t spd=${spd >= 0 ? '+' : ''}${spd}`; }
  if (left >= 0x80 && left <= 0xFE) {
    const types = []; if (left&0x10) types.push('LP'); if (left&0x20) types.push('BP'); if (left&0x40) types.push('HP');
    return `Set ${types.join('+')} res=${(right>>4)&0xF} route=${right&0x7}`;
  }
  if (left === 0xFF) return right === 0 ? 'STOP' : `Jump → ${right}`;
  return '';
}

const descFns = [describeWTBL, describePTBL, describeFTBL];

function renderTableGrid() {
  const grid = document.getElementById('table-grid');
  if (!grid) return;
  const t = activeTableTab;
  const lt = tables.ltable[t], rt = tables.rtable[t];
  // Find last non-zero row
  let lastRow = 0;
  for (let i = 254; i >= 0; i--) { if (lt[i] || rt[i]) { lastRow = i; break; } }
  const showRows = Math.max(8, lastRow + 4);

  let html = '';
  for (let i = 0; i < showRows; i++) {
    const desc = descFns[t](lt[i], rt[i]);
    const isStart = (t === 0 && i + 1 === tableStartPtrs.wave) || (t === 1 && i + 1 === tableStartPtrs.pulse) || (t === 2 && i + 1 === tableStartPtrs.filter);
    html += `<tr style="${isStart ? 'background:#2a2a5a;' : ''}${lt[i] === 0xFF ? 'color:var(--accent);' : ''}">
      <td style="text-align:center;color:var(--text-dim);padding:1px 4px">${(i + 1).toString().padStart(2, '0')}</td>
      <td style="text-align:center;padding:1px"><input type="text" value="${lt[i].toString(16).toUpperCase().padStart(2,'0')}" data-row="${i}" data-col="l" style="width:36px;background:#1a1a35;color:var(--text);border:1px solid var(--panel-border);border-radius:2px;text-align:center;font-family:monospace;font-size:11px;padding:1px"></td>
      <td style="text-align:center;padding:1px"><input type="text" value="${rt[i].toString(16).toUpperCase().padStart(2,'0')}" data-row="${i}" data-col="r" style="width:36px;background:#1a1a35;color:var(--text);border:1px solid var(--panel-border);border-radius:2px;text-align:center;font-family:monospace;font-size:11px;padding:1px"></td>
      <td style="padding:1px 4px;font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden">${desc}</td>
    </tr>`;
  }
  grid.innerHTML = html;

  // Bind hex input events
  grid.querySelectorAll('input').forEach(inp => {
    inp.onchange = () => {
      const row = parseInt(inp.dataset.row);
      const col = inp.dataset.col;
      const val = parseInt(inp.value, 16);
      if (isNaN(val) || val < 0 || val > 255) { inp.value = (col === 'l' ? lt[row] : rt[row]).toString(16).toUpperCase().padStart(2, '0'); return; }
      if (col === 'l') lt[row] = val; else rt[row] = val;
      sendTableData(t);
      renderTableGrid();
    };
  });
}

function initTableEditor() {
  // Tab switching
  document.querySelectorAll('#table-tabs button').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('#table-tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTableTab = parseInt(btn.dataset.tbl);
      renderTableGrid();
    };
  });

  // Enable toggle
  document.getElementById('table-enabled').onchange = (e) => setTableEnabled(e.target.checked);

  // Start pointers
  ['wave', 'pulse', 'filter'].forEach(key => {
    const el = document.getElementById(`tbl-${key}-ptr`);
    if (el) el.onchange = () => { tableStartPtrs[key] = parseInt(el.value) || 0; sendTableStartPtrs(); };
  });

  // Quick-fill buttons
  document.getElementById('tbl-clear').onclick = () => {
    tables.ltable[activeTableTab].fill(0); tables.rtable[activeTableTab].fill(0);
    sendTableData(activeTableTab); renderTableGrid();
  };

  document.getElementById('tbl-fill-arp').onclick = () => {
    const lt = tables.ltable[0], rt = tables.rtable[0];
    lt.fill(0); rt.fill(0);
    lt[0]=0x41; rt[0]=0x80; // pulse+gate, no note change (base)
    lt[1]=0x01; rt[1]=0x80; // delay 1
    lt[2]=0x41; rt[2]=0x04; // pulse+gate, +4st
    lt[3]=0x01; rt[3]=0x80; // delay 1
    lt[4]=0x41; rt[4]=0x07; // pulse+gate, +7st
    lt[5]=0x01; rt[5]=0x80; // delay 1
    lt[6]=0xFF; rt[6]=0x01; // jump to 1
    tableStartPtrs.wave = 1;
    document.getElementById('tbl-wave-ptr').value = 1;
    sendTableData(0); sendTableStartPtrs(); activeTableTab = 0;
    document.querySelectorAll('#table-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tbl === '0'));
    renderTableGrid();
  };

  document.getElementById('tbl-fill-pwm').onclick = () => {
    const lt = tables.ltable[1], rt = tables.rtable[1];
    lt.fill(0); rt.fill(0);
    lt[0]=0x88; rt[0]=0x00; // set PW $800
    lt[1]=0x40; rt[1]=0x20; // mod 64 ticks, speed +$20
    lt[2]=0x40; rt[2]=0xE0; // mod 64 ticks, speed -$20
    lt[3]=0xFF; rt[3]=0x02; // jump to 2
    tableStartPtrs.pulse = 1;
    document.getElementById('tbl-pulse-ptr').value = 1;
    sendTableData(1); sendTableStartPtrs(); activeTableTab = 1;
    document.querySelectorAll('#table-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tbl === '1'));
    renderTableGrid();
  };

  document.getElementById('tbl-fill-flt').onclick = () => {
    const lt = tables.ltable[2], rt = tables.rtable[2];
    lt.fill(0); rt.fill(0);
    lt[0]=0x90; rt[0]=0xF1; // set LP, res=F, route voice 0
    lt[1]=0x00; rt[1]=0x10; // set cutoff $10
    lt[2]=0x40; rt[2]=0x08; // mod 64 ticks, speed +$08
    lt[3]=0x40; rt[3]=0xF8; // mod 64 ticks, speed -$08
    lt[4]=0xFF; rt[4]=0x03; // jump to 3
    tableStartPtrs.filter = 1;
    document.getElementById('tbl-filter-ptr').value = 1;
    sendTableData(2); sendTableStartPtrs(); activeTableTab = 2;
    document.querySelectorAll('#table-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tbl === '2'));
    renderTableGrid();
  };

  document.getElementById('tbl-fill-transient').onclick = () => {
    const lt = tables.ltable[0], rt = tables.rtable[0];
    lt.fill(0); rt.fill(0);
    lt[0]=0x81; rt[0]=0x80; // noise+gate, no note
    lt[1]=0x01; rt[1]=0x80; // delay 1 frame
    lt[2]=0x41; rt[2]=0x80; // pulse+gate, no note
    lt[3]=0xFF; rt[3]=0x03; // jump to 3 (stay on pulse)
    tableStartPtrs.wave = 1;
    document.getElementById('tbl-wave-ptr').value = 1;
    sendTableData(0); sendTableStartPtrs(); activeTableTab = 0;
    document.querySelectorAll('#table-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tbl === '0'));
    renderTableGrid();
  };

  renderTableGrid();
}

// ─── UI Binding ─────────────────────────────────────────────────────────────

const bind = SynthShell.createBinder(sendParam);
const bindSlider = bind.slider, bindSelect = bind.select, bindCheckbox = bind.checkbox;

// ─── Waveform Toggle Buttons ────────────────────────────────────────────────

function initWaveToggles(prefix, paramPath) {
  const buttons = document.querySelectorAll(`.${prefix}-wave-toggles button`);
  let currentWave = 0x40; // default pulse

  function updateButtons() {
    buttons.forEach(btn => {
      const bit = parseInt(btn.dataset.bit);
      btn.classList.toggle('active', (currentWave & bit) !== 0);
    });
  }

  buttons.forEach(btn => {
    btn.onclick = () => {
      const bit = parseInt(btn.dataset.bit);
      currentWave ^= bit; // toggle bit
      if (!(currentWave & 0xF0)) currentWave = bit; // don't allow no waveform
      updateButtons();
      sendParam(paramPath, currentWave);
    };
  });

  updateButtons();
  return { get: () => currentWave, set: (v) => { currentWave = v; updateButtons(); } };
}

// ─── Init UI ────────────────────────────────────────────────────────────────

let mainWaveCtrl, modWaveCtrl;

function initUI() {
  // Waveform toggles
  mainWaveCtrl = initWaveToggles('main', 'waveform');
  modWaveCtrl = initWaveToggles('mod', 'osc2Waveform');

  // Pulse width
  bindSlider('pulse-width', 'pulseWidth', {
    map: v => Math.round(parseFloat(v) * 4095),
    format: v => Math.round(parseFloat(v) * 100) + '%'
  });

  // ADSR — pack into SID register bytes (ad = attack<<4|decay, sr = sustain<<4|release)
  function updateADSR() {
    const a = parseInt(document.getElementById('attack').value) || 0;
    const d = parseInt(document.getElementById('decay').value) || 0;
    const s = parseInt(document.getElementById('sustain').value) || 0;
    const r = parseInt(document.getElementById('release').value) || 0;
    sendParam('ad', (a << 4) | d);
    sendParam('sr', (s << 4) | r);
  }
  ['attack','decay','sustain','release'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const valEl = document.getElementById(id + '-val');
    el.oninput = () => { if (valEl) valEl.textContent = el.value; updateADSR(); };
    if (valEl) valEl.textContent = el.value;
  });

  // Oscillator 2
  bindCheckbox('osc2-on', 'osc2On');
  bindSlider('osc2-detune', 'osc2Detune', { format: v => parseFloat(v).toFixed(1) + 'st' });
  bindSlider('osc2-env-amt', 'osc2EnvAmt', { format: v => parseFloat(v).toFixed(2) });
  bindSlider('osc2-sweep-speed', 'osc2SweepSpeed', { map: v => parseInt(v), format: v => v });
  bindCheckbox('ring-mod', 'ringMod');
  bindCheckbox('hard-sync', 'hardSync');

  // Filter
  bindCheckbox('filter-on', 'filterOn');
  bindSelect('filter-mode', 'filterMode', { map: v => parseInt(v) });
  bindSlider('filter-cutoff', 'filterCutoff', {
    map: v => Math.round(parseFloat(v) * 255),
    format: v => Math.round(parseFloat(v) * 100) + '%'
  });
  bindSlider('filter-reso', 'filterReso', { map: v => parseInt(v), format: v => v });
  bindSlider('filter-env-amt', 'filterEnvAmt', { format: v => parseFloat(v).toFixed(2) });

  // Filter envelope — pack into SID bytes
  function updateFltADSR() {
    const a = parseInt(document.getElementById('flt-attack').value) || 0;
    const d = parseInt(document.getElementById('flt-decay').value) || 0;
    const s = parseInt(document.getElementById('flt-sustain').value) || 0;
    const r = parseInt(document.getElementById('flt-release').value) || 0;
    sendParam('fltAd', (a << 4) | d);
    sendParam('fltSr', (s << 4) | r);
  }
  ['flt-attack','flt-decay','flt-sustain','flt-release'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const valEl = document.getElementById(id + '-val');
    el.oninput = () => { if (valEl) valEl.textContent = el.value; updateFltADSR(); };
    if (valEl) valEl.textContent = el.value;
  });

  // Master volume (0-15, SID register)
  bindSlider('master-vol', 'masterVolume', { map: v => Math.round(parseFloat(v) * 15), format: v => Math.round(parseFloat(v) * 15) });
}

// ─── Scope ──────────────────────────────────────────────────────────────────

function initScope() {
  SynthShell.startScope({ canvasId: 'scope', analyser, background: '#0d0d20', stroke: '#7878ff' });
}

function updateVoiceDisplay() { SynthShell.showVoiceCount('voice-display', pool); }

// ─── Presets ────────────────────────────────────────────────────────────────

// Helper to build table data for presets
function mkTable(entries) {
  const lt = new Array(255).fill(0), rt = new Array(255).fill(0);
  entries.forEach(([l, r], i) => { lt[i] = l; rt[i] = r; });
  return { lt, rt };
}

// Preset helper: ad=attack<<4|decay, sr=sustain<<4|release (SID register format)
const FACTORY_PRESETS = [
  // ── Table-based presets ──
  // ── Galway / Hubbard tribute presets ──
  // Martin Galway's signature is the slow PWM sweep (Wizball, Times of Lore):
  // a pulse whose width the pulsetable walks up and down at frame rate. Rob
  // Hubbard's are the frame-rate chord arp, the PWM-wobble lead and the
  // resonant filter-sweep bass (Monty on the Run, Sanxion). All authored as
  // GT2 tables, the same mechanism the originals used.
  {
    name: 'Galway PWM Lead',
    params: { waveform: 0x41, pulseWidth: 0x200, ad: 0x2A, sr: 0xA6,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xC8, filterReso: 1, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ftbl: null,
      // PW 0x200, up 60 frames at +0x28, down 60 at -0x28, loop: ~2.4 s sweep.
      ptbl: mkTable([[0x82,0x00],[0x3C,0x28],[0x3C,0xD8],[0xFF,0x02]]) },
  },
  {
    name: 'Galway PWM Bass',
    params: { waveform: 0x41, pulseWidth: 0x300, ad: 0x09, sr: 0x96,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x70, filterReso: 3, filterEnvAmt: 0.2,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ftbl: null,
      // Sweep 0x580..0x880, centred on 50% duty: a pulse's level goes as
      // sin(pi*duty), so a sweep spanning 19..47% breathed ~3 dB with the
      // width. Around the 50% point the level curve is flat while the
      // harmonic content still moves — the creamy version of the trick.
      ptbl: mkTable([[0x85,0x80],[0x18,0x20],[0x18,0xE0],[0xFF,0x02]]) },
  },
  {
    name: 'Galway Ring Bell',
    params: { waveform: 0x11, pulseWidth: 0x800, ad: 0x0B, sr: 0x0A,
      osc2On: true, ringMod: true, hardSync: false, osc2Detune: 14, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
  },
  {
    name: 'Hubbard Lead',
    params: { waveform: 0x41, pulseWidth: 0x400, ad: 0x08, sr: 0xA8,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xE0, filterReso: 1, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ftbl: null,
      // Faster, narrower wobble than the Galway sweep — buzzy, not creamy.
      ptbl: mkTable([[0x84,0x00],[0x10,0x60],[0x20,0xA0],[0x10,0x60],[0xFF,0x02]]) },
  },
  {
    name: 'Hubbard Filter Bass',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x09, sr: 0x86,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x60, filterReso: 11, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0x00, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 0, filterPtr: 1,
      wtbl: null, ptbl: null,
      // One-shot resonant sweep down to 0x20 per note — not to zero, so the
      // sustain keeps speaking.
      ftbl: mkTable([[0x90,0xE0],[0x10,0xF4],[0xFF,0x00]]) },
  },
  {
    name: 'Hubbard Arp',
    params: { waveform: 0x41, pulseWidth: 0x600, ad: 0x0A, sr: 0xA5,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0,
      ptbl: null, ftbl: null,
      // Minor triad cycled at frame rate: root, +3, +7 — THE C64 chord.
      wtbl: mkTable([[0x41,0x80],[0x41,0x03],[0x41,0x07],[0xFF,0x01]]) },
  },
  // ── Hubbard percussion & layered voices ──
  // Drums are the classic wavetable trick: a noise crack and a tone whose
  // pitch FALLS through the table to the played note (offsets are up-only, so
  // the played key is the drum's floor). The layered presets use the chip's
  // third oscillator (ch1) — previously idle — for simultaneous noise+tone
  // drums, detuned/octave doubling, and the delayed echo blip. Envelopes
  // self-terminate (sustain 0) so drums are one-shots however long the key.

  { name: 'Hubbard Kick',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x08, sr: 0x06,
      layerOn: true, layerWave: 0x81, layerDetune: 40, layerAd: 0x04, layerSr: 0x00, layerDelay: 0,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x81,0x24],[0x41,0x14],[0x41,0x0A],[0x41,0x04],[0x41,0x00],[0xFF,0x00]]) } },
  { name: 'Hubbard Snare',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x08, sr: 0x05,
      layerOn: true, layerWave: 0x81, layerDetune: 30, layerAd: 0x08, layerSr: 0x00, layerDelay: 0,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x41,0x10],[0x41,0x07],[0x41,0x02],[0xFF,0x00]]) } },
  { name: 'Hubbard Tom',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x09, sr: 0x05,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x41,0x18],[0x41,0x13],[0x41,0x0E],[0x41,0x09],[0x41,0x04],[0x41,0x00],[0xFF,0x00]]) } },
  { name: 'Hubbard Hat',
    params: { waveform: 0x81, pulseWidth: 0x800, ad: 0x05, sr: 0x04,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x40, filterCutoff: 0xB0, filterReso: 4, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x81,0x48],[0x01,0x80],[0xE0,0x00],[0xFF,0x00]]) } },
  { name: 'Hubbard Blip',
    params: { waveform: 0x41, pulseWidth: 0x600, ad: 0x06, sr: 0x05,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x41,0x0C],[0x41,0x00],[0xFF,0x00]]) } },
  { name: 'Hubbard Echo Blip',
    params: { waveform: 0x41, pulseWidth: 0x600, ad: 0x06, sr: 0x05,
      layerOn: true, layerWave: 0x41, layerDetune: 12, layerPW: 0x300, layerAd: 0x06, layerSr: 0x04, layerDelay: 4,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x41,0x0C],[0x41,0x00],[0xFF,0x00]]) } },
  { name: 'Galway Fat PWM',
    params: { waveform: 0x41, pulseWidth: 0x200, ad: 0x2A, sr: 0xA6,
      layerOn: true, layerWave: 0x41, layerDetune: 0, layerFine: 28, layerPW: 0xA00, layerAd: 0x2A, layerSr: 0xA6, layerDelay: 0,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xC8, filterReso: 1, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ftbl: null,
      ptbl: mkTable([[0x82,0x00],[0x3C,0x28],[0x3C,0xD8],[0xFF,0x02]]) } },
  { name: 'Hubbard Octave Lead',
    params: { waveform: 0x41, pulseWidth: 0x400, ad: 0x08, sr: 0xA8,
      layerOn: true, layerWave: 0x41, layerDetune: 12, layerFine: 10, layerPW: 0x700, layerAd: 0x08, layerSr: 0xA8, layerDelay: 0,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xE0, filterReso: 1, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ftbl: null,
      ptbl: mkTable([[0x84,0x00],[0x10,0x60],[0x20,0xA0],[0x10,0x60],[0xFF,0x02]]) } },
  { name: 'Hubbard Zap',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x08, sr: 0x07,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0, ptbl: null, ftbl: null,
      wtbl: mkTable([[0x21,0x30],[0x21,0x2A],[0x21,0x24],[0x21,0x1E],[0x21,0x18],[0x21,0x12],[0x21,0x0C],[0x21,0x06],[0x21,0x00],[0xE0,0x00],[0xFF,0x00]]) } },
  {
    name: 'Noise→Pulse',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x0A, sr: 0xA4,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xA0, filterReso: 4, filterEnvAmt: 0.3,
      fltAd: 0x06, fltSr: 0x24, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0,
      wtbl: mkTable([[0x81,0x80],[0x01,0x80],[0x41,0x80],[0xFF,0x03]]), ptbl: null, ftbl: null },
  },
  {
    name: 'Major Arp',
    params: { waveform: 0x41, pulseWidth: 0x400, ad: 0x0A, sr: 0x82,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF0, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 0,
      wtbl: mkTable([[0x41,0x80],[0x01,0x80],[0x41,0x04],[0x01,0x80],[0x41,0x07],[0x01,0x80],[0xFF,0x01]]), ptbl: null, ftbl: null },
  },
  {
    name: 'Table PWM',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x6A, sr: 0xC8,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xB0, filterReso: 2, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0xF6, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 1, filterPtr: 0,
      wtbl: null, ptbl: mkTable([[0x88,0x00],[0x40,0x20],[0x40,0xE0],[0xFF,0x02]]), ftbl: null },
  },
  {
    name: 'Filter Acid',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x06, sr: 0x42,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x40, filterReso: 10, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0x00, masterVolume: 0x0F },
    tables: { wavePtr: 0, pulsePtr: 0, filterPtr: 1,
      wtbl: null, ptbl: null, ftbl: mkTable([[0x90,0xF1],[0x00,0x10],[0x30,0x08],[0x50,0xFA],[0xFF,0x03]]) },
  },
  {
    name: 'Acid Transient',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x06, sr: 0x42,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x30, filterReso: 12, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0x00, masterVolume: 0x0F },
    tables: { wavePtr: 1, pulsePtr: 0, filterPtr: 1,
      wtbl: mkTable([[0x81,0x80],[0x01,0x80],[0x21,0x80],[0xFF,0x03]]),
      ptbl: null, ftbl: mkTable([[0x90,0xA1],[0x00,0x08],[0x20,0x0C],[0x40,0xFB],[0xFF,0x03]]) },
  },
  {
    name: 'Laser Harp',
    params: { waveform: 0x41, pulseWidth: 0x800, ad: 0x08, sr: 0x66,
      osc2On: false, osc2Waveform: 0x21, osc2Detune: 0, osc2EnvAmt: 0.46, osc2SweepSpeed: 11, ringMod: false, hardSync: true,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xC0, filterReso: 2, filterEnvAmt: 0,
      fltAd: 0x08, fltSr: 0x06, masterVolume: 0x0F },
  },
  {
    name: 'Sync Zap',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x04, sr: 0x03,
      osc2On: false, osc2Waveform: 0x21, osc2Detune: 12, osc2EnvAmt: -0.8, osc2SweepSpeed: 3, ringMod: false, hardSync: true,
      filterOn: false, filterMode: 0x10, filterCutoff: 0xFF, filterReso: 0, filterEnvAmt: 0,
      fltAd: 0x04, fltSr: 0x03, masterVolume: 0x0F },
  },
  // ── Non-table presets ──
  {
    name: 'Ring Bell',
    params: { waveform: 0x11, pulseWidth: 0x800, ad: 0x0A, sr: 0x08,
      osc2On: true, ringMod: true, hardSync: false, osc2Detune: 7, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0xC0, filterReso: 4, filterEnvAmt: 0.2,
      fltAd: 0x08, fltSr: 0x06, masterVolume: 0x0F },
  },
  {
    name: 'Sync Lead',
    params: { waveform: 0x21, pulseWidth: 0x800, ad: 0x04, sr: 0x84,
      osc2On: true, ringMod: false, hardSync: true, osc2Detune: -5, osc2Waveform: 0x21, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x90, filterReso: 6, filterEnvAmt: 0.4,
      fltAd: 0x06, fltSr: 0x24, masterVolume: 0x0F },
  },
  {
    name: 'Dirty Bass',
    params: { waveform: 0x61, pulseWidth: 0x700, ad: 0x05, sr: 0x62,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x10, filterCutoff: 0x20, filterReso: 12, filterEnvAmt: 0.7,
      fltAd: 0x04, fltSr: 0x02, masterVolume: 0x0F },
  },
  {
    name: 'Space Noise',
    params: { waveform: 0x81, pulseWidth: 0x800, ad: 0x68, sr: 0x8A,
      osc2On: false, ringMod: false, hardSync: false, osc2Detune: 0, osc2Waveform: 0x11, osc2EnvAmt: 0,
      filterOn: true, filterMode: 0x20, filterCutoff: 0x40, filterReso: 14, filterEnvAmt: 0,
      fltAd: 0x00, fltSr: 0x00, masterVolume: 0x0F },
  },
];

const presets = new SynthShell.PresetStore({
  storageKey: 'sid-synth-presets',
  factory: FACTORY_PRESETS,
  apply: (p) => applyPreset(p),
  capture: () => capturePreset(),
});
function populatePresetSelect() { presets.populateSelect(); }

function applyPreset(preset) {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'preset', params: preset.params, fx: preset.fx || {} });
  updateUIFromPreset(preset);

  // Load table data if present
  if (preset.tables) {
    // Clear all tables first
    for (let t = 0; t < 3; t++) { tables.ltable[t].fill(0); tables.rtable[t].fill(0); }
    if (preset.tables.wtbl) { tables.ltable[0] = [...preset.tables.wtbl.lt]; tables.rtable[0] = [...preset.tables.wtbl.rt]; }
    if (preset.tables.ptbl) { tables.ltable[1] = [...preset.tables.ptbl.lt]; tables.rtable[1] = [...preset.tables.ptbl.rt]; }
    if (preset.tables.ftbl) { tables.ltable[2] = [...preset.tables.ftbl.lt]; tables.rtable[2] = [...preset.tables.ftbl.rt]; }
    tableStartPtrs = { wave: preset.tables.wavePtr || 0, pulse: preset.tables.pulsePtr || 0, filter: preset.tables.filterPtr || 0 };
    tableEnabled = true;
    const el = document.getElementById('table-enabled'); if (el) el.checked = true;
    ['wave','pulse','filter'].forEach(k => { const e = document.getElementById(`tbl-${k}-ptr`); if (e) e.value = tableStartPtrs[k]; });
    sendAllTables();
    renderTableGrid();
  } else {
    tableEnabled = false;
    const el = document.getElementById('table-enabled'); if (el) el.checked = false;
    setTableEnabled(false);
  }
}

function updateUIFromPreset(preset) {
  const p = preset.params;
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; const valEl = document.getElementById(id+'-val'); if(valEl) valEl.textContent = typeof val === 'number' ? (Number.isInteger(val) ? val : parseFloat(val).toFixed(2)) : val; } };
  const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  const setSelect = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

  if (mainWaveCtrl) mainWaveCtrl.set((p.waveform || 0x41) & 0xF0); // extract waveform bits only
  if (modWaveCtrl) modWaveCtrl.set((p.osc2Waveform || 0x11) & 0xF0);
  set('pulse-width', (p.pulseWidth || 0x800) / 4095);
  // Unpack SID ADSR bytes
  const ad = p.ad || 0;
  const sr = p.sr || 0;
  set('attack', (ad >> 4) & 0xF); set('decay', ad & 0xF);
  set('sustain', (sr >> 4) & 0xF); set('release', sr & 0xF);
  setCheck('osc2-on', p.osc2On); set('osc2-detune', p.osc2Detune || 0);
  set('osc2-env-amt', p.osc2EnvAmt || 0); set('osc2-sweep-speed', p.osc2SweepSpeed || 8);
  setCheck('ring-mod', p.ringMod); setCheck('hard-sync', p.hardSync);
  setCheck('filter-on', p.filterOn !== false); setSelect('filter-mode', p.filterMode || 0x10);
  set('filter-cutoff', (p.filterCutoff || 0xFF) / 255); set('filter-reso', p.filterReso || 0);
  set('filter-env-amt', p.filterEnvAmt || 0);
  const fad = p.fltAd || 0, fsr = p.fltSr || 0;
  set('flt-attack', (fad >> 4) & 0xF); set('flt-decay', fad & 0xF);
  set('flt-sustain', (fsr >> 4) & 0xF); set('flt-release', fsr & 0xF);
}

function capturePreset() {
  const rv = (id) => { const el = document.getElementById(id); return el ? parseFloat(el.value) : 0; };
  const rc = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
  return {
    params: {
      waveform: mainWaveCtrl ? mainWaveCtrl.get() : 0x40,
      pulseWidth: Math.round(rv('pulse-width') * 4095),
      attack: Math.round(rv('attack')), decay: Math.round(rv('decay')),
      sustain: Math.round(rv('sustain')), release: Math.round(rv('release')),
      osc2On: rc('osc2-on'), osc2Waveform: modWaveCtrl ? modWaveCtrl.get() : 0x10,
      osc2Detune: rv('osc2-detune'), osc2EnvAmt: rv('osc2-env-amt'), ringMod: rc('ring-mod'), hardSync: rc('hard-sync'),
      filterOn: rc('filter-on'), filterMode: parseInt(document.getElementById('filter-mode').value),
      filterCutoff: Math.round(rv('filter-cutoff') * 2047), filterReso: Math.round(rv('filter-reso')),
      filterEnvAmt: rv('filter-env-amt'), filterKeyTrack: rv('filter-keytrack'),
      fltAttack: Math.round(rv('flt-attack')), fltDecay: Math.round(rv('flt-decay')),
      fltSustain: Math.round(rv('flt-sustain')), fltRelease: Math.round(rv('flt-release')),
      lfoRate: rv('lfo-rate'), lfoWaveform: parseInt(document.getElementById('lfo-wave').value),
      lfoPWMDepth: rv('lfo-pwm'), lfoFilterDepth: rv('lfo-filter'),
      portamento: rc('portamento-on'), portamentoTime: rv('portamento-time'),
      masterVolume: rv('master-vol'),
    },
    fx: {
      chorus: { enabled: rc('fx-chorus-on') },
      delay: { enabled: rc('fx-delay-on') },
      reverb: { enabled: rc('fx-reverb-on') }
    }
  };
}

function initPresets() { presets.init(); }

// ─── Init ───────────────────────────────────────────────────────────────────

async function startAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule('js/sid-processor.js?v=' + Date.now());
  workletNode = new AudioWorkletNode(audioCtx, 'sid-synth-processor', { numberOfOutputs: 1, outputChannelCount: [2] });
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  workletNode.connect(analyser);
  analyser.connect(audioCtx.destination);
  initScope();
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
      if (!on) { for (const n of sustainedNotes) noteOff(n); sustainedNotes.clear(); }
      const ind = document.getElementById('sustain-indicator');
      if (ind) ind.style.color = on ? 'var(--accent)' : 'var(--text-dim)';
    }
  });
  initUI();
  initTableEditor();
  initPresets();
  updateVoiceDisplay();
  document.getElementById('start-btn').onclick = async () => {
    await startAudio();
    sendAllTables();
  };
});
