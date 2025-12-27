// table-editor-gt2.js - GoatTracker2 Table Editor UI

import { gt2TableManager, TABLE_TYPES, TABLE_NAMES } from './table-manager-gt2.js';

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

    // Presets
    document.getElementById('presetLinearButton').addEventListener('click', () => applyPreset('linear'));
    document.getElementById('presetSineButton').addEventListener('click', () => applyPreset('sine'));
    document.getElementById('presetTriangleButton').addEventListener('click', () => applyPreset('triangle'));
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

function applyPreset(presetType) {
    const table = gt2TableManager.getTable(currentTableType);
    if (!table) return;

    if (!confirm(`Apply ${presetType} preset?`)) return;

    switch (currentTableType) {
        case TABLE_TYPES.WAVE:
            applyWavePreset(table, presetType);
            break;
        case TABLE_TYPES.PULSE:
            applyPulsePreset(table, presetType);
            break;
        case TABLE_TYPES.FILTER:
            applyFilterPreset(table, presetType);
            break;
    }

    loadCurrentTable();
}

function applyWavePreset(table, preset) {
    table.clear();

    switch (preset) {
        case 'linear':
            // Arpeggio up octave
            table.setEntry(0, 0x21, 0x00); // Saw, base
            table.setEntry(1, 0x00, 0x04); // +4
            table.setEntry(2, 0x00, 0x07); // +7
            table.setEntry(3, 0x00, 0x0C); // +12 (octave)
            table.setEntry(4, 0xFF, 0x01); // Jump
            break;
        case 'sine':
            // Wave cycling
            table.setEntry(0, 0x11, 0x00); // Tri+Gate
            table.setEntry(1, 0x21, 0x00); // Saw+Gate
            table.setEntry(2, 0x41, 0x00); // Pul+Gate
            table.setEntry(3, 0xFF, 0x00); // Loop
            break;
        case 'triangle':
            // Triangle arpeggio
            table.setEntry(0, 0x11, 0x00);
            table.setEntry(1, 0x01, 0x03);
            table.setEntry(2, 0x01, 0x07);
            table.setEntry(3, 0x01, 0x03);
            table.setEntry(4, 0xFF, 0x01);
            break;
    }
}

function applyPulsePreset(table, preset) {
    table.clear();

    switch (preset) {
        case 'linear':
            table.setEntry(0, 0x80, 0x10); // Set $010
            table.setEntry(1, 0x80, 0x80); // Mod to $800
            table.setEntry(2, 0xFF, 0x01);
            break;
        case 'sine':
            table.setEntry(0, 0x88, 0x00); // Start $800
            table.setEntry(1, 0x20, 0x40); // 32 ticks, +64
            table.setEntry(2, 0x40, 0xE0); // 64 ticks, -32
            table.setEntry(3, 0xFF, 0x01);
            break;
        case 'triangle':
            table.setEntry(0, 0x80, 0x00); // $000
            table.setEntry(1, 0x30, 0x20); // 48 ticks, +32
            table.setEntry(2, 0x30, 0xE0); // 48 ticks, -32
            table.setEntry(3, 0xFF, 0x01);
            break;
    }
}

function applyFilterPreset(table, preset) {
    table.clear();

    switch (preset) {
        case 'linear':
            table.setEntry(0, 0x80, 0x00); // $000
            table.setEntry(1, 0x40, 0x10); // 64 ticks, +16
            table.setEntry(2, 0xFF, 0x01);
            break;
        case 'sine':
            table.setEntry(0, 0x84, 0x00); // $400
            table.setEntry(1, 0x20, 0x20); // 32 ticks, +32
            table.setEntry(2, 0x40, 0xE0); // 64 ticks, -32
            table.setEntry(3, 0xFF, 0x01);
            break;
        case 'triangle':
            table.setEntry(0, 0x80, 0x00);
            table.setEntry(1, 0x30, 0x08);
            table.setEntry(2, 0x30, 0xF8); // -8
            table.setEntry(3, 0xFF, 0x01);
            break;
    }
}

function saveChanges() {
    console.log('GoatTracker2 tables saved');
    closeTableEditor();
}
