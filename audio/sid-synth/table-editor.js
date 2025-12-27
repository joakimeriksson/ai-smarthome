// table-editor.js - Table Editor UI for GoatTracker-style tables

import { tableManager, TABLE_TYPES } from './table-manager.js';

let currentTableType = TABLE_TYPES.WAVE;
let currentTableIndex = 0;
let isEditorOpen = false;
let copiedTableData = null;

export function initTableEditor() {
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

    // Initialize UI controls
    initializeControls();
}

function initializeControls() {
    // Table type selection
    const tableTypeSelect = document.getElementById('tableTypeSelect');
    tableTypeSelect.addEventListener('change', (e) => {
        currentTableType = e.target.value;
        updateTableIndexOptions();
        loadCurrentTable();
    });

    // Table index selection
    const tableIndexSelect = document.getElementById('tableIndexSelect');
    tableIndexSelect.addEventListener('change', (e) => {
        currentTableIndex = parseInt(e.target.value);
        loadCurrentTable();
    });

    // Table length
    const tableLengthInput = document.getElementById('tableLength');
    const resizeButton = document.getElementById('resizeTableButton');
    resizeButton.addEventListener('click', () => {
        const newLength = parseInt(tableLengthInput.value);
        resizeCurrentTable(newLength);
    });

    // Table name
    const tableNameInput = document.getElementById('tableName');
    tableNameInput.addEventListener('change', (e) => {
        const table = tableManager.getTable(currentTableType, currentTableIndex);
        if (table) {
            table.name = e.target.value;
        }
    });

    // Operations
    document.getElementById('clearTableButton').addEventListener('click', clearCurrentTable);
    document.getElementById('copyTableButton').addEventListener('click', copyCurrentTable);
    document.getElementById('pasteTableButton').addEventListener('click', pasteTable);
    document.getElementById('newTableButton').addEventListener('click', createNewTable);

    // Loop controls
    const loopEnabledCheck = document.getElementById('tableLoopEnabled');
    const loopStartInput = document.getElementById('tableLoopStart');
    const loopEndInput = document.getElementById('tableLoopEnd');

    loopEnabledCheck.addEventListener('change', updateLoopSettings);
    loopStartInput.addEventListener('change', updateLoopSettings);
    loopEndInput.addEventListener('change', updateLoopSettings);

    // Preset buttons
    document.getElementById('presetLinearButton').addEventListener('click', () => applyPreset('linear'));
    document.getElementById('presetSineButton').addEventListener('click', () => applyPreset('sine'));
    document.getElementById('presetTriangleButton').addEventListener('click', () => applyPreset('triangle'));
    document.getElementById('presetSawButton').addEventListener('click', () => applyPreset('sawtooth'));
    document.getElementById('presetRandomButton').addEventListener('click', () => applyPreset('random'));

    // Modal buttons
    document.getElementById('saveTableButton').addEventListener('click', saveChanges);
    document.getElementById('cancelTableButton').addEventListener('click', closeTableEditor);
}

function openTableEditor() {
    const modal = document.getElementById('tableEditorModal');
    modal.style.display = 'block';
    isEditorOpen = true;

    updateTableIndexOptions();
    loadCurrentTable();
}

function closeTableEditor() {
    const modal = document.getElementById('tableEditorModal');
    modal.style.display = 'none';
    isEditorOpen = false;
}

function updateTableIndexOptions() {
    const tableIndexSelect = document.getElementById('tableIndexSelect');
    const tableNames = tableManager.getTableNames(currentTableType);

    tableIndexSelect.innerHTML = '';
    tableNames.forEach(({ index, name, length }) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${index}: ${name} (${length})`;
        tableIndexSelect.appendChild(option);
    });

    // Set current selection
    tableIndexSelect.value = currentTableIndex;
}

function loadCurrentTable() {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (!table) return;

    // Update controls
    document.getElementById('tableLength').value = table.length;
    document.getElementById('tableName').value = table.name;

    // Update loop controls
    document.getElementById('tableLoopEnabled').checked = table.loop;
    document.getElementById('tableLoopStart').value = table.loopStart;
    document.getElementById('tableLoopEnd').value = table.loopEnd;
    document.getElementById('tableLoopStart').max = table.length - 1;
    document.getElementById('tableLoopEnd').max = table.length - 1;

    // Update table data grid
    updateTableDataGrid();
}

function updateTableDataGrid() {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (!table) return;

    const grid = document.getElementById('tableDataGrid');
    grid.innerHTML = '';

    for (let i = 0; i < table.length; i++) {
        const row = document.createElement('div');
        row.className = 'table-row';

        // Add loop indicators
        if (table.loop) {
            if (i === table.loopStart) row.classList.add('loop-start');
            if (i === table.loopEnd) row.classList.add('loop-end');
        }

        // Step number
        const stepDiv = document.createElement('div');
        stepDiv.className = 'table-step';
        stepDiv.textContent = i.toString().padStart(2, '0');
        row.appendChild(stepDiv);

        // Value input
        const valueDiv = document.createElement('div');
        valueDiv.className = 'table-value';
        const valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.value = table.getValue(i);
        valueInput.min = getMinValue(currentTableType);
        valueInput.max = getMaxValue(currentTableType);
        valueInput.addEventListener('change', (e) => {
            table.setValue(i, parseInt(e.target.value) || 0);
            updateTableDataGrid(); // Refresh to update hex and description
        });
        valueDiv.appendChild(valueInput);
        row.appendChild(valueDiv);

        // Hex display
        const hexDiv = document.createElement('div');
        hexDiv.className = 'table-hex';
        hexDiv.textContent = '$' + table.getValue(i).toString(16).toUpperCase().padStart(2, '0');
        row.appendChild(hexDiv);

        // Description
        const descDiv = document.createElement('div');
        descDiv.className = 'table-desc';
        descDiv.textContent = getValueDescription(currentTableType, table.getValue(i));
        row.appendChild(descDiv);

        grid.appendChild(row);
    }
}

function getMinValue(tableType) {
    switch (tableType) {
        case TABLE_TYPES.WAVE: return 0;
        case TABLE_TYPES.PULSE: return 0;
        case TABLE_TYPES.FILTER: return 0;
        case TABLE_TYPES.SPEED: return 0;
        default: return 0;
    }
}

function getMaxValue(tableType) {
    switch (tableType) {
        case TABLE_TYPES.WAVE: return 255;
        case TABLE_TYPES.PULSE: return 0xFFF;
        case TABLE_TYPES.FILTER: return 0x7FF;
        case TABLE_TYPES.SPEED: return 255;
        default: return 255;
    }
}

function getValueDescription(tableType, value) {
    switch (tableType) {
        case TABLE_TYPES.WAVE:
            switch (value) {
                case 0x10: return 'Triangle';
                case 0x20: return 'Sawtooth';
                case 0x40: return 'Pulse';
                case 0x80: return 'Noise';
                default: return 'Invalid';
            }

        case TABLE_TYPES.PULSE:
            const percentage = ((value / 0xFFF) * 100).toFixed(1);
            return `${percentage}% duty cycle`;

        case TABLE_TYPES.FILTER:
            return `Filter freq ${value}`;

        case TABLE_TYPES.SPEED:
            if (value === 0) return 'Stop';
            return `Speed x${value}`;

        default:
            return '';
    }
}

function resizeCurrentTable(newLength) {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (table) {
        table.resize(newLength);
        loadCurrentTable();
    }
}

function clearCurrentTable() {
    if (confirm('Clear all values in this table?')) {
        tableManager.clearTable(currentTableType, currentTableIndex);
        loadCurrentTable();
    }
}

function copyCurrentTable() {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (table) {
        copiedTableData = table.export();
        console.log('Table copied to clipboard');
    }
}

function pasteTable() {
    if (!copiedTableData) {
        alert('No table data to paste');
        return;
    }

    if (confirm('Replace current table with copied data?')) {
        const table = tableManager.getTable(currentTableType, currentTableIndex);
        if (table) {
            table.import(copiedTableData);
            loadCurrentTable();
        }
    }
}

function createNewTable() {
    const length = parseInt(document.getElementById('tableLength').value) || 16;
    tableManager.createTable(currentTableType, currentTableIndex, length);
    updateTableIndexOptions();
    loadCurrentTable();
}

function updateLoopSettings() {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (!table) return;

    const loopEnabled = document.getElementById('tableLoopEnabled').checked;
    const loopStart = parseInt(document.getElementById('tableLoopStart').value);
    const loopEnd = parseInt(document.getElementById('tableLoopEnd').value);

    if (loopEnabled) {
        table.setLoop(loopStart, loopEnd);
    } else {
        table.clearLoop();
    }

    updateTableDataGrid();
}

function applyPreset(presetType) {
    const table = tableManager.getTable(currentTableType, currentTableIndex);
    if (!table) return;

    if (!confirm(`Apply ${presetType} preset to current table?`)) return;

    for (let i = 0; i < table.length; i++) {
        let value = 0;

        switch (presetType) {
            case 'linear':
                value = Math.floor((i / (table.length - 1)) * getMaxValue(currentTableType));
                break;

            case 'sine':
                const sineAngle = (i / table.length) * Math.PI * 2;
                value = Math.floor(((Math.sin(sineAngle) + 1) / 2) * getMaxValue(currentTableType));
                break;

            case 'triangle':
                const halfLength = table.length / 2;
                if (i <= halfLength) {
                    value = Math.floor((i / halfLength) * getMaxValue(currentTableType));
                } else {
                    value = Math.floor(((table.length - i) / halfLength) * getMaxValue(currentTableType));
                }
                break;

            case 'sawtooth':
                value = Math.floor((i / table.length) * getMaxValue(currentTableType));
                break;

            case 'random':
                value = Math.floor(Math.random() * (getMaxValue(currentTableType) + 1));
                break;
        }

        // Apply table-specific constraints
        if (currentTableType === TABLE_TYPES.WAVE) {
            const waveforms = [0x10, 0x20, 0x40, 0x80];
            value = waveforms[Math.floor((value / getMaxValue(currentTableType)) * waveforms.length)];
        }

        table.setValue(i, value);
    }

    loadCurrentTable();
}

function saveChanges() {
    // Tables are automatically saved as they're edited
    // This could trigger a project save or other persistence
    console.log('Table changes saved');
    closeTableEditor();
}