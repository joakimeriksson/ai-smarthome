// instrument-editor.js - GT2-only version
import { instruments, initSynth, playNote, playNoteWithInstrument, stopVoice, stopAllVoices, setGlobalSIDRegister, isWorkletActive, workletNoteOff, workletUpdateInstruments } from './synth.js';
import { keyboardInput } from './keyboard-input.js';
import { tableManager, TABLE_TYPES } from './table-manager.js';
import { gt2TableManager } from './table-manager-gt2.js';

let currentInstrumentIndex = 0;
let originalInstruments = [];
let isEditorOpen = false;

export function initInstrumentEditor() {
    // Store original instruments for cancel functionality
    originalInstruments = JSON.parse(JSON.stringify(instruments));
    
    const modal = document.getElementById('instrumentEditorModal');
    const openButton = document.getElementById('instrumentEditorButton');
    const closeButton = document.getElementById('closeInstrumentEditor');
    const instrumentSelect = document.getElementById('editInstrumentSelect');
    
    // Modal control
    openButton.addEventListener('click', openInstrumentEditor);
    closeButton.addEventListener('click', closeInstrumentEditor);
    
    // Close modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeInstrumentEditor();
        }
    });
    
    // Instrument selection
    instrumentSelect.addEventListener('change', (e) => {
        currentInstrumentIndex = parseInt(e.target.value);
        loadInstrumentToEditor();
        
        // Update keyboard input to use new instrument
        if (isEditorOpen) {
            keyboardInput.setInstrument(currentInstrumentIndex);
        }
    });
    
    // Button handlers
    document.getElementById('newInstrumentButton').addEventListener('click', createNewInstrument);
    document.getElementById('duplicateInstrumentButton').addEventListener('click', duplicateInstrument);
    document.getElementById('deleteInstrumentButton').addEventListener('click', deleteInstrument);
    document.getElementById('testInstrumentButton').addEventListener('click', testCurrentInstrument);
    document.getElementById('saveInstrumentButton').addEventListener('click', saveInstrumentChanges);
    document.getElementById('cancelInstrumentButton').addEventListener('click', cancelInstrumentChanges);
    
    // Parameter change handlers
    setupParameterHandlers();
}

function openInstrumentEditor() {
    const modal = document.getElementById('instrumentEditorModal');
    modal.style.display = 'block';
    isEditorOpen = true;

    // Enable keyboard input for testing instruments
    keyboardInput.enable();
    keyboardInput.setInstrument(currentInstrumentIndex);

    // Populate instrument selector
    populateInstrumentSelector();

    // Populate GT2 table selectors
    populateGT2TableSelectors();

    // Load first instrument
    currentInstrumentIndex = 0;
    loadInstrumentToEditor();
    
    console.log('🎹 Instrument Editor opened - Use keyboard to test instruments!');
}

function closeInstrumentEditor() {
    const modal = document.getElementById('instrumentEditorModal');
    modal.style.display = 'none';
    isEditorOpen = false;
    
    // Disable keyboard input when closing editor
    keyboardInput.disable();
}

function populateInstrumentSelector() {
    const select = document.getElementById('editInstrumentSelect');
    select.innerHTML = '';

    instruments.forEach((instrument, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = `${index}: ${instrument.name}`;
        select.appendChild(option);
    });

    select.value = currentInstrumentIndex;
}

function populateGT2TableSelectors() {
    const tableTypes = [
        { id: 'waveTableSelect', type: 0, name: 'WTBL' },
        { id: 'pulseTableSelect', type: 1, name: 'PTBL' },
        { id: 'filterTableSelect', type: 2, name: 'FTBL' },
        { id: 'speedTableSelect', type: 3, name: 'STBL' }
    ];

    tableTypes.forEach(({ id, type, name }) => {
        const select = document.getElementById(id);
        if (!select) return;

        // Keep "None" option
        select.innerHTML = '<option value="-1">None</option>';

        // Add GT2 table 0 option (we only have one table per type for now)
        const table = gt2TableManager.getTable(type);
        if (table) {
            const option = document.createElement('option');
            option.value = 0;
            option.textContent = `${name} 0: ${table.name}`;
            select.appendChild(option);
        }
    });
}

function loadInstrumentToEditor() {
    const instrument = instruments[currentInstrumentIndex];
    if (!instrument) return;
    
    // Basic parameters
    document.getElementById('instrumentName').value = instrument.name;
    document.getElementById('waveformSelect').value = instrument.waveform;
    
    // ADSR (decode from combined values)
    const attack = (instrument.ad >> 4) & 0x0F;
    const decay = instrument.ad & 0x0F;
    const sustain = (instrument.sr >> 4) & 0x0F;
    const release = instrument.sr & 0x0F;
    
    document.getElementById('attackSlider').value = attack;
    document.getElementById('decaySlider').value = decay;
    document.getElementById('sustainSlider').value = sustain;
    document.getElementById('releaseSlider').value = release;
    
    updateSliderDisplay('attack', attack);
    updateSliderDisplay('decay', decay);
    updateSliderDisplay('sustain', sustain);
    updateSliderDisplay('release', release);
    
    // Pulse width
    document.getElementById('pulseWidthSlider').value = instrument.pulseWidth;
    updateSliderDisplay('pulseWidth', instrument.pulseWidth);

    // SID Features
    document.getElementById('syncEnabled').checked = instrument.sync || false;
    document.getElementById('ringModEnabled').checked = instrument.ringMod || false;

    // Populate table selectors and load current values
    populateTableSelectors();

    // Tables
    const tables = instrument.tables || { wave: -1, pulse: -1, filter: -1, speed: -1 };
    document.getElementById('waveTableSelect').value = tables.wave;
    document.getElementById('pulseTableSelect').value = tables.pulse;
    document.getElementById('filterTableSelect').value = tables.filter;
    document.getElementById('speedTableSelect').value = tables.speed;
}

function setupParameterHandlers() {
    // Name input
    document.getElementById('instrumentName').addEventListener('input', updateCurrentInstrument);
    
    // Waveform select
    document.getElementById('waveformSelect').addEventListener('change', updateCurrentInstrument);
    
    // ADSR sliders
    ['attack', 'decay', 'sustain', 'release'].forEach(param => {
        const slider = document.getElementById(`${param}Slider`);
        slider.addEventListener('input', (e) => {
            updateSliderDisplay(param, e.target.value);
            updateCurrentInstrument();
        });
    });
    
    // Pulse width slider
    document.getElementById('pulseWidthSlider').addEventListener('input', (e) => {
        updateSliderDisplay('pulseWidth', e.target.value);
        updateCurrentInstrument();
    });

    // SID Features
    ['syncEnabled', 'ringModEnabled'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateCurrentInstrument);
    });

    // Table selects
    ['waveTableSelect', 'pulseTableSelect', 'filterTableSelect', 'speedTableSelect'].forEach(selectId => {
        document.getElementById(selectId).addEventListener('change', updateCurrentInstrument);
    });

    // Open table editor button
    document.getElementById('openTableEditorFromInstrument').addEventListener('click', () => {
        // This will open the table editor modal
        document.getElementById('tableEditorButton').click();
    });
}

function updateSliderDisplay(param, value) {
    const displayElement = document.getElementById(`${param}Value`);
    if (displayElement) {
        if (param.includes('Depth')) {
            displayElement.textContent = Math.round(value);
        } else if (param.includes('Freq')) {
            displayElement.textContent = parseFloat(value).toFixed(1);
        } else {
            displayElement.textContent = value;
        }
    }
}

function updateCurrentInstrument() {
    const instrument = instruments[currentInstrumentIndex];
    if (!instrument) return;
    
    // Update instrument properties from UI
    instrument.name = document.getElementById('instrumentName').value;
    instrument.waveform = parseInt(document.getElementById('waveformSelect').value);
    
    // Combine ADSR values
    const attack = parseInt(document.getElementById('attackSlider').value);
    const decay = parseInt(document.getElementById('decaySlider').value);
    const sustain = parseInt(document.getElementById('sustainSlider').value);
    const release = parseInt(document.getElementById('releaseSlider').value);
    
    instrument.ad = (attack << 4) | decay;
    instrument.sr = (sustain << 4) | release;
    
    // Pulse width
    instrument.pulseWidth = parseInt(document.getElementById('pulseWidthSlider').value);

    // SID Features
    instrument.sync = document.getElementById('syncEnabled').checked;
    instrument.ringMod = document.getElementById('ringModEnabled').checked;

    // Tables
    if (!instrument.tables) {
        instrument.tables = { wave: -1, pulse: -1, filter: -1, speed: -1 };
    }
    instrument.tables.wave = parseInt(document.getElementById('waveTableSelect').value);
    instrument.tables.pulse = parseInt(document.getElementById('pulseTableSelect').value);
    instrument.tables.filter = parseInt(document.getElementById('filterTableSelect').value);
    instrument.tables.speed = parseInt(document.getElementById('speedTableSelect').value);

    // Update instrument selector display
    populateInstrumentSelector();
    
    // Push live instruments to worklet so LFO/Arp updates reflect changes during playback
    try { workletUpdateInstruments(instruments); } catch(_) {}

    // Notify keyboard input to use updated instrument
    if (isEditorOpen && keyboardInput.isEnabled) {
        keyboardInput.setInstrument(currentInstrumentIndex);
        console.log(`Updated keyboard to use modified instrument: ${instrument.name}`);
    }
}

function createNewInstrument() {
    // GT2-compatible instrument with only authentic GoatTracker2 parameters
    const newInstrument = {
        name: `Custom ${instruments.length}`,
        waveform: 0x10,        // Triangle (0x10, 0x20=saw, 0x40=pulse, 0x80=noise)
        ad: 0x0F,              // Attack=0, Decay=15
        sr: 0xF0,              // Sustain=15, Release=0
        pulseWidth: 0x0800,    // 50% duty cycle (12-bit value)
        sync: false,           // Oscillator sync
        ringMod: false,        // Ring modulation
        tables: { wave: -1, pulse: -1, filter: -1, speed: -1 }  // GT2 table pointers
    };

    instruments.push(newInstrument);
    currentInstrumentIndex = instruments.length - 1;

    populateInstrumentSelector();
    loadInstrumentToEditor();

    // Update all instrument dropdowns in the tracker
    updateTrackerInstrumentDropdowns();
}

function populateTableSelectors() {
    // Populate all table selectors with available tables
    const tableTypes = ['wave', 'pulse', 'filter', 'speed'];

    tableTypes.forEach(type => {
        const selectElement = document.getElementById(`${type}TableSelect`);
        const currentValue = selectElement.value;

        // Clear existing options except "None"
        selectElement.innerHTML = '<option value="-1">None</option>';

        // Add options for each table of this type
        const tableNames = tableManager.getTableNames(type);
        tableNames.forEach(({ index, name, length }) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${index}: ${name} (${length})`;
            selectElement.appendChild(option);
        });

        // Restore previous selection if still valid
        if (currentValue !== null && currentValue !== '') {
            selectElement.value = currentValue;
        }
    });
}

function duplicateInstrument() {
    const source = instruments[currentInstrumentIndex];
    const duplicate = JSON.parse(JSON.stringify(source));
    duplicate.name = `${source.name} Copy`;
    
    instruments.push(duplicate);
    currentInstrumentIndex = instruments.length - 1;
    
    populateInstrumentSelector();
    loadInstrumentToEditor();
    updateTrackerInstrumentDropdowns();
}

function deleteInstrument() {
    if (instruments.length <= 1) {
        alert('Cannot delete the last instrument!');
        return;
    }
    
    if (confirm(`Delete instrument "${instruments[currentInstrumentIndex].name}"?`)) {
        instruments.splice(currentInstrumentIndex, 1);
        
        // Adjust current index if needed
        if (currentInstrumentIndex >= instruments.length) {
            currentInstrumentIndex = instruments.length - 1;
        }
        
        populateInstrumentSelector();
        loadInstrumentToEditor();
        updateTrackerInstrumentDropdowns();
    }
}

async function testCurrentInstrument() {
    // Ensure audio is initialized
    if (!window.audioContext) {
        initSynth();
    }

    // Ensure audio context is running
    if (window.audioContext && window.audioContext.state === 'suspended') {
        await window.audioContext.resume();
    }

    // Test note A-4 (440 Hz) for 2 seconds
    const instrument = instruments[currentInstrumentIndex];
    const testFreq = 440.0; // A-4, standard concert pitch

    // Set master volume to max
    setGlobalSIDRegister(0x18, 0x0F);

    // Play the note with current instrument
    // Tables will be triggered automatically if instrument has table pointers
    playNoteWithInstrument(0, testFreq, 2000, currentInstrumentIndex);

    console.log(`Testing GT2 instrument: ${instrument.name}`);

    // Stop the test note after duration
    setTimeout(() => {
        // Stop voice 0 properly
        if (isWorkletActive && isWorkletActive()) {
            const instrument2 = instruments[currentInstrumentIndex];
            workletNoteOff(0, instrument2.waveform);
        } else {
            stopVoice(0);
        }
        console.log("Test note stopped");
    }, 2000);
}

function saveInstrumentChanges() {
    // Update original instruments reference
    originalInstruments = JSON.parse(JSON.stringify(instruments));
    
    // Update all tracker instrument dropdowns
    updateTrackerInstrumentDropdowns();
    
    console.log('Instrument changes saved!');
    closeInstrumentEditor();
}

function cancelInstrumentChanges() {
    // Restore original instruments
    instruments.length = 0;
    instruments.push(...JSON.parse(JSON.stringify(originalInstruments)));
    
    // Update tracker dropdowns
    updateTrackerInstrumentDropdowns();
    
    console.log('Instrument changes cancelled.');
    closeInstrumentEditor();
}

function updateTrackerInstrumentDropdowns() {
    // Update all instrument dropdowns in the tracker
    const NUM_VOICES = 3;
    const NUM_STEPS = 16;
    
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        for (let step = 0; step < NUM_STEPS; step++) {
            const select = document.getElementById(`instrument-${voice}-${step}`);
            if (select) {
                const currentValue = select.value;
                select.innerHTML = '';
                
                instruments.forEach((inst, index) => {
                    const option = document.createElement('option');
                    option.value = index;
                    option.textContent = inst.name;
                    select.appendChild(option);
                });
                
                // Restore selection if still valid
                if (currentValue < instruments.length) {
                    select.value = currentValue;
                } else {
                    select.value = 0; // Default to first instrument
                }
            }
        }
    }
}

// Export functions that might be needed elsewhere
export { updateTrackerInstrumentDropdowns };
