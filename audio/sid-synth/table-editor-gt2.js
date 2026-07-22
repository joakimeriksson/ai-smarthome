// table-editor-gt2.js - GoatTracker2 Table Editor UI

import { gt2TableManager, TABLE_TYPES, TABLE_NAMES } from './table-manager-gt2.js';
import { generate, GENERATORS_BY_TABLE, CHORDS, WAVEFORMS, FILTER_MODES, DRUM_KINDS }
    from './table-generators.js';

let currentTableType = TABLE_TYPES.WAVE;
let isEditorOpen = false;

export function initGT2TableEditor() {
    const modal = document.getElementById('tableEditorModal');
    const openButton = document.getElementById('tableEditorButton');
    const closeButton = document.getElementById('closeTableEditor');

    // Modal control
    openButton.addEventListener('click', openTableEditor);
    closeButton.addEventListener('click', closeTableEditor);

    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeTableEditor();
        }
    });

    // Initialize controls
    initializeControls();
}

function initializeControls() {
    // Table type selection
    const tableTypeSelect = document.getElementById('tableTypeSelect');
    tableTypeSelect.innerHTML = '';
    TABLE_NAMES.forEach((name, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = name;
        tableTypeSelect.appendChild(option);
    });

    tableTypeSelect.addEventListener('change', (e) => {
        currentTableType = parseInt(e.target.value);
        loadCurrentTable();
    });

    // Table operations
    document.getElementById('clearTableButton').addEventListener('click', clearCurrentTable);
    document.getElementById('saveTableButton').addEventListener('click', saveChanges);
    document.getElementById('cancelTableButton').addEventListener('click', closeTableEditor);

    // Resize (this button had no listener at all - the Length field did nothing)
    document.getElementById('resizeTableButton').addEventListener('click', () => {
        const table = gt2TableManager.getTable(currentTableType);
        if (!table) return;
        table.length = parseInt(document.getElementById('tableLength').value, 10) || 16;
        loadCurrentTable();
    });

    // Generators
    document.getElementById('generatorSelect').addEventListener('change', renderGeneratorParams);
    document.getElementById('generatorInsertButton').addEventListener('click', insertGenerated);
}

function openTableEditor() {
    const modal = document.getElementById('tableEditorModal');
    modal.style.display = 'block';
    isEditorOpen = true;
    loadCurrentTable();
}

function closeTableEditor() {
    const modal = document.getElementById('tableEditorModal');
    modal.style.display = 'none';
    isEditorOpen = false;
}

function loadCurrentTable() {
    const table = gt2TableManager.getTable(currentTableType);
    if (!table) return;

    // Update table info
    document.getElementById('tableLength').value = table.length;
    document.getElementById('tableName').value = table.name;

    // Update table data grid
    updateTableDataGrid();

    // Show hex reference for current table type
    updateHexReference();

    // Offer only the generators that apply to this table type
    renderGeneratorOptions();
}

function updateHexReference() {
    const refDiv = document.getElementById('hexReference');
    if (!refDiv) return;

    let refText = '';

    switch (currentTableType) {
        case TABLE_TYPES.WAVE:
            refText = `
<b>WAVETABLE (WTBL) - Left Byte Commands:</b>
$00      = No wave change
$01-$0F  = Delay 1-15 frames
$10-$DF  = Waveform ($10=Tri, $20=Saw, $40=Pul, $80=Noi)
           Add: $01=Gate, $02=Sync, $04=Ring, $08=Test
$E0-$EF  = Inaudible waveform $00-$0F
$F0-$FE  = Execute pattern command 0XY-EXY
$FF      = Jump (right=$00 stops, else jump to position)

<b>Right Byte (Note Control):</b>
$00-$5F  = Relative note +0 to +95 semitones
$60-$7F  = Relative note -0 to -31 semitones
$80      = Keep frequency unchanged
$81-$DF  = Absolute note C#0 to B-7`;
            break;

        case TABLE_TYPES.PULSE:
            refText = `
<b>PULSETABLE (PTBL) - Left Byte Commands:</b>
$01-$7F  = Modulate for N ticks at speed (right byte)
$80-$FE  = Set pulse width $XYY (high nibble + right byte)
$FF      = Jump (right=$00 stops, else jump to position)

<b>Right Byte:</b>
For $01-$7F: Signed speed value ($00-$7F = +0 to +127,
                                  $80-$FF = -128 to -1)
For $80-$FE: Low 8 bits of pulse width`;
            break;

        case TABLE_TYPES.FILTER:
            refText = `
<b>FILTERTABLE (FTBL) - Left Byte Commands:</b>
$01-$7F  = Modulate for N ticks at speed (right byte)
$80-$FE  = Set filter frequency $XYY (bits 0-2 + right byte)
$FF      = Jump (right=$00 stops, else jump to position)

<b>Right Byte:</b>
For $01-$7F: Signed speed value ($00-$7F = +0 to +127,
                                  $80-$FF = -128 to -1)
For $80-$FE: Low 8 bits of filter frequency`;
            break;

        case TABLE_TYPES.SPEED:
            refText = `
<b>SPEEDTABLE (STBL) - Left Byte Commands:</b>
$00      = Stop (speed 0)
$01-$FE  = Set speed multiplier
$FF      = Jump (right=$00 stops, else jump to position)

<b>Right Byte:</b>
Only used for $FF jump command (jump position)`;
            break;
    }

    refDiv.innerHTML = `<pre style="font-size: 11px; margin: 5px; line-height: 1.4;">${refText}</pre>`;
}

function updateTableDataGrid() {
    const table = gt2TableManager.getTable(currentTableType);
    if (!table) return;

    const grid = document.getElementById('tableDataGrid');
    grid.innerHTML = '';

    for (let i = 0; i < table.length; i++) {
        const entry = table.getEntry(i);
        const row = document.createElement('div');
        row.className = 'table-row';

        // Step number
        const stepDiv = document.createElement('div');
        stepDiv.className = 'table-step';
        stepDiv.textContent = i.toString().padStart(2, '0');
        row.appendChild(stepDiv);

        // Left byte input (hex)
        const leftDiv = document.createElement('div');
        leftDiv.className = 'table-value';
        const leftInput = document.createElement('input');
        leftInput.type = 'text';
        leftInput.value = entry.left.toString(16).toUpperCase().padStart(2, '0');
        leftInput.maxLength = 2;
        leftInput.style.width = '50px';
        leftInput.style.fontFamily = 'monospace';
        leftInput.style.textAlign = 'center';
        leftInput.style.textTransform = 'uppercase';

        // Validate hex input
        leftInput.addEventListener('input', (e) => {
            let val = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '');
            e.target.value = val;
        });

        leftInput.addEventListener('blur', (e) => {
            const val = parseInt(e.target.value, 16) || 0;
            table.setEntry(i, val, entry.right);
            e.target.value = val.toString(16).toUpperCase().padStart(2, '0');
            updateTableDataGrid();
        });

        leftDiv.appendChild(document.createTextNode('$'));
        leftDiv.appendChild(leftInput);
        row.appendChild(leftDiv);

        // Right byte input (hex)
        const rightDiv = document.createElement('div');
        rightDiv.className = 'table-value';
        const rightInput = document.createElement('input');
        rightInput.type = 'text';
        rightInput.value = entry.right.toString(16).toUpperCase().padStart(2, '0');
        rightInput.maxLength = 2;
        rightInput.style.width = '50px';
        rightInput.style.fontFamily = 'monospace';
        rightInput.style.textAlign = 'center';
        rightInput.style.textTransform = 'uppercase';

        // Validate hex input
        rightInput.addEventListener('input', (e) => {
            let val = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '');
            e.target.value = val;
        });

        rightInput.addEventListener('blur', (e) => {
            const val = parseInt(e.target.value, 16) || 0;
            table.setEntry(i, entry.left, val);
            e.target.value = val.toString(16).toUpperCase().padStart(2, '0');
            updateTableDataGrid();
        });

        rightDiv.appendChild(document.createTextNode('$'));
        rightDiv.appendChild(rightInput);
        row.appendChild(rightDiv);

        // Description
        const descDiv = document.createElement('div');
        descDiv.className = 'table-desc';
        descDiv.textContent = getEntryDescription(currentTableType, entry.left, entry.right);
        descDiv.style.fontSize = '11px';
        descDiv.style.flex = '2';
        row.appendChild(descDiv);

        grid.appendChild(row);
    }
}

function getEntryDescription(tableType, left, right) {
    switch (tableType) {
        case TABLE_TYPES.WAVE:
            return describeWavetable(left, right);
        case TABLE_TYPES.PULSE:
            return describePulsetable(left, right);
        case TABLE_TYPES.FILTER:
            return describeFiltertable(left, right);
        case TABLE_TYPES.SPEED:
            return describeSpeedtable(left, right);
        default:
            return '';
    }
}

function describeWavetable(left, right) {
    if (left === 0x00) return 'No wave change';
    if (left >= 0x01 && left <= 0x0F) return `Delay ${left} frames`;
    if (left >= 0x10 && left <= 0xDF) {
        const wave = getWaveformName(left);
        const note = getNoteDescription(right);
        return `${wave}, ${note}`;
    }
    if (left >= 0xE0 && left <= 0xEF) return `Inaudible $${(left & 0x0F).toString(16).toUpperCase()}`;
    if (left >= 0xF0 && left <= 0xFE) return `Cmd ${(left & 0x0F).toString(16).toUpperCase()}XY, par=$${right.toString(16).toUpperCase()}`;
    if (left === 0xFF) return right === 0x00 ? 'STOP' : `Jump to ${right.toString(16).toUpperCase()}`;
    return '';
}

function describePulsetable(left, right) {
    if (left >= 0x01 && left <= 0x7F) {
        const speed = (right & 0x80) ? (right - 256) : right;
        return `${left} ticks, speed ${speed > 0 ? '+' : ''}${speed}`;
    }
    if (left >= 0x80 && left <= 0xFE) {
        const pw = ((left & 0x0F) << 8) | right;
        return `Set PW=$${pw.toString(16).toUpperCase().padStart(3, '0')} (${((pw/4095)*100).toFixed(1)}%)`;
    }
    if (left === 0xFF) return right === 0x00 ? 'STOP' : `Jump to ${right.toString(16).toUpperCase()}`;
    return '';
}

function describeFiltertable(left, right) {
    if (left >= 0x01 && left <= 0x7F) {
        const speed = (right & 0x80) ? (right - 256) : right;
        return `${left} ticks, speed ${speed > 0 ? '+' : ''}${speed}`;
    }
    if (left >= 0x80 && left <= 0xFE) {
        const freq = ((left & 0x07) << 8) | right;
        return `Set Filter=$${freq.toString(16).toUpperCase().padStart(3, '0')}`;
    }
    if (left === 0xFF) return right === 0x00 ? 'STOP' : `Jump to ${right.toString(16).toUpperCase()}`;
    return '';
}

function describeSpeedtable(left, right) {
    if (left === 0xFF) return right === 0x00 ? 'STOP' : `Jump to ${right.toString(16).toUpperCase()}`;
    return `Speed ${left || 1}`;
}

function getWaveformName(wave) {
    const names = [];
    if (wave & 0x10) names.push('Tri');
    if (wave & 0x20) names.push('Saw');
    if (wave & 0x40) names.push('Pul');
    if (wave & 0x80) names.push('Noi');
    if (wave & 0x08) names.push('Test');
    if (wave & 0x04) names.push('Ring');
    if (wave & 0x02) names.push('Sync');
    if (wave & 0x01) names.push('Gate');
    return names.join('+') || 'None';
}

function getNoteDescription(note) {
    if (note >= 0x00 && note <= 0x5F) return `+${note} semi`;
    if (note >= 0x60 && note <= 0x7F) return `-${note - 0x60} semi`;
    if (note === 0x80) return 'Keep freq';
    if (note >= 0x81 && note <= 0xDF) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const absNote = note - 0x81;
        const octave = Math.floor(absNote / 12);
        const noteName = noteNames[absNote % 12];
        return `Abs ${noteName}-${octave}`;
    }
    return '';
}

function clearCurrentTable() {
    if (confirm('Clear this table?')) {
        gt2TableManager.clearTable(currentTableType);
        loadCurrentTable();
    }
}

// ---------------------------------------------------------------- generators
// The old "Presets" buttons were dead in two ways: three of the five had no
// listener at all, and applyPreset() called gt2TableManager.getTable(), which
// did not exist - so every click threw. They are replaced by parameterised
// generators backed by table-generators.js (the same pure module
// tools/make-default-song.js uses, so there is one implementation of the byte
// layout and its many traps).

// Field specs per generator: [key, label, type, default, options?]
const GENERATOR_FIELDS = {
    arpeggio: [
        ['chord', 'Chord', 'select', 'minor', () => Object.keys(CHORDS)],
        ['waveform', 'Waveform', 'select', WAVEFORMS.pulse,
            () => Object.entries(WAVEFORMS).map(([k, v]) => [v, k])],
        ['stepFrames', 'Frames/step', 'number', 1, { min: 1, max: 17 }],
    ],
    drum: [
        ['kind', 'Kind', 'select', 'kick', () => DRUM_KINDS],
    ],
    pwm: [
        ['center', 'Centre PW', 'number', 0x800, { min: 0, max: 4095 }],
        ['depth', 'Depth', 'number', 0x400, { min: 1, max: 4095 }],
        ['rate', 'Frames/leg', 'number', 32, { min: 1, max: 127 }],
    ],
    filter: [
        ['mode', 'Mode', 'select', 'lowpass', () => Object.keys(FILTER_MODES)],
        ['resonance', 'Resonance', 'number', 10, { min: 0, max: 15 }],
        ['routing', 'Voices (bitmask)', 'number', 1, { min: 0, max: 7 }],
        ['low', 'Cutoff low', 'number', 0x20, { min: 0, max: 255 }],
        ['high', 'Cutoff high', 'number', 0xC0, { min: 0, max: 255 }],
        ['rate', 'Frames/leg', 'number', 48, { min: 1, max: 127 }],
    ],
    vibrato: [
        ['periodFrames', 'Period (frames)', 'number', 12, { min: 1, max: 127 }],
        ['depth', 'Depth (SID units)', 'number', 0x30, { min: 1, max: 2000 }],
    ],
};

const GENERATOR_LABELS = {
    arpeggio: 'Arpeggio / trill',
    drum: 'Drum (one-shot)',
    pwm: 'PWM sweep',
    filter: 'Filter sweep',
    vibrato: 'Vibrato',
};

function renderGeneratorOptions() {
    const sel = document.getElementById('generatorSelect');
    if (!sel) return;
    const names = GENERATORS_BY_TABLE[currentTableType] || [];
    sel.innerHTML = '';
    names.forEach(n => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = GENERATOR_LABELS[n] || n;
        sel.appendChild(o);
    });
    document.getElementById('tableGeneratorPanel').style.display = names.length ? '' : 'none';
    renderGeneratorParams();
}

function renderGeneratorParams() {
    const host = document.getElementById('generatorParams');
    const name = document.getElementById('generatorSelect').value;
    if (!host || !name) return;
    host.innerHTML = '';
    for (const [key, label, type, def, opts] of (GENERATOR_FIELDS[name] || [])) {
        const lab = document.createElement('label');
        lab.textContent = label + ':';
        lab.style.marginLeft = '8px';
        host.appendChild(lab);

        let input;
        if (type === 'select') {
            input = document.createElement('select');
            for (const entry of opts()) {
                const [value, text] = Array.isArray(entry) ? entry : [entry, entry];
                const o = document.createElement('option');
                o.value = value;
                o.textContent = text;
                input.appendChild(o);
            }
        } else {
            input = document.createElement('input');
            input.type = 'number';
            if (opts) { input.min = opts.min; input.max = opts.max; }
            input.style.width = '72px';
        }
        input.value = def;
        input.dataset.key = key;
        input.addEventListener('input', updateGeneratorPreview);
        input.addEventListener('change', updateGeneratorPreview);
        host.appendChild(input);
    }
    updateGeneratorPreview();
}

function readGeneratorParams() {
    const name = document.getElementById('generatorSelect').value;
    const startPos = parseInt(document.getElementById('generatorStart').value, 10) || 0;
    const params = { startPos };
    document.querySelectorAll('#generatorParams [data-key]').forEach(el => {
        const v = el.value;
        // numeric-valued selects (waveform) and number inputs both coerce here
        params[el.dataset.key] = (el.tagName === 'INPUT' || /^\d+$/.test(v)) ? Number(v) : v;
    });
    return { name, params, startPos };
}

function updateGeneratorPreview() {
    const preview = document.getElementById('generatorPreview');
    if (!preview) return;
    try {
        const { name, params, startPos } = readGeneratorParams();
        const result = generate(name, params);
        const lines = result.entries.map((e, i) =>
            `  [${startPos + i}] $${e.left.toString(16).padStart(2, '0')} ` +
            `$${e.right.toString(16).padStart(2, '0')}  ${e.description || ''}`);
        preview.textContent = `${result.description}\n${lines.join('\n')}`;
        preview.style.color = '#8c8';
    } catch (err) {
        preview.textContent = err.message;
        preview.style.color = '#c88';
    }
}

function insertGenerated() {
    const table = gt2TableManager.getTable(currentTableType);
    if (!table) return;
    const { name, params, startPos } = readGeneratorParams();
    let result;
    try {
        result = generate(name, params);
    } catch (err) {
        alert(`Generator failed: ${err.message}`);
        return;
    }
    const end = startPos + result.entries.length;
    if (end > 255) {
        alert(`Does not fit: needs ${result.entries.length} entries at step ${startPos} (max 255).`);
        return;
    }
    result.entries.forEach((e, i) => table.setEntry(startPos + i, e.left, e.right));
    // Keep the generated block visible in the grid
    if (table.length < end) table.length = Math.min(255, end + 2);
    console.log(`Generated ${name} at ${startPos}: ${result.description}`);
    loadCurrentTable();
}

function saveChanges() {
    console.log('GoatTracker2 tables saved');
    closeTableEditor();
}
