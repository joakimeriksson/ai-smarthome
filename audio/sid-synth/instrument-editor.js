// instrument-editor.js - GT2-only version
import { instruments, initSynth, playNote, playNoteWithInstrument, stopVoice, stopAllVoices, setGlobalSIDRegister, isWorkletActive, workletNoteOff, workletUpdateInstruments, workletLoadTables } from './synth.js';
import { keyboardInput } from './keyboard-input.js';
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

    // Load first instrument
    currentInstrumentIndex = 0;
    loadInstrumentToEditor();

    console.log('Instrument Editor opened - Use keyboard to test instruments!');
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


function loadInstrumentToEditor() {
    const instrument = instruments[currentInstrumentIndex];
    if (!instrument) return;

    // Basic parameters
    document.getElementById('instrumentName').value = instrument.name;

    // GT2 Voice Parameters
    const firstWave = instrument.firstWave || 0x09; // Default: gate + no waveform
    document.getElementById('firstWaveInput').value = firstWave.toString(16).toUpperCase().padStart(2, '0');

    // Gate Timer: bits 0-5 = timer, bit 6 = no gate-off, bit 7 = no hard restart
    const gateTimer = instrument.gateTimer || 0x02;
    document.getElementById('gateTimerInput').value = gateTimer & 0x3F;
    document.getElementById('noHardRestartCheck').checked = (gateTimer & 0x80) !== 0;
    document.getElementById('noGateOffCheck').checked = (gateTimer & 0x40) !== 0;

    // Vibrato delay
    document.getElementById('vibratoDelayInput').value = instrument.vibratoDelay || 0;

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

    // GT2 Table Pointers (0 = none, 1-255 = position)
    const tables = instrument.tables || { wave: 0, pulse: 0, filter: 0, speed: 0 };
    document.getElementById('waveTableInput').value = tables.wave || 0;
    document.getElementById('pulseTableInput').value = tables.pulse || 0;
    document.getElementById('filterTableInput').value = tables.filter || 0;
    document.getElementById('speedTableInput').value = tables.speed || 0;
}

function setupParameterHandlers() {
    // Helper to safely add event listener
    const addListener = (id, event, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener(event, handler);
        } else {
            console.warn(`Element not found: ${id}`);
        }
    };

    // Name input
    addListener('instrumentName', 'input', updateCurrentInstrument);

    // GT2 Voice Parameters
    addListener('firstWaveInput', 'input', updateCurrentInstrument);
    addListener('gateTimerInput', 'input', updateCurrentInstrument);
    addListener('noHardRestartCheck', 'change', updateCurrentInstrument);
    addListener('noGateOffCheck', 'change', updateCurrentInstrument);
    addListener('vibratoDelayInput', 'input', updateCurrentInstrument);

    // ADSR sliders
    ['attack', 'decay', 'sustain', 'release'].forEach(param => {
        const slider = document.getElementById(`${param}Slider`);
        if (slider) {
            slider.addEventListener('input', (e) => {
                updateSliderDisplay(param, e.target.value);
                updateCurrentInstrument();
            });
        }
    });

    // GT2 Table pointer inputs
    ['waveTableInput', 'pulseTableInput', 'filterTableInput', 'speedTableInput'].forEach(inputId => {
        addListener(inputId, 'input', updateCurrentInstrument);
    });

    // Open table editor button
    const tableEditorBtn = document.getElementById('openTableEditorFromInstrument');
    const mainTableBtn = document.getElementById('tableEditorButton');
    if (tableEditorBtn && mainTableBtn) {
        tableEditorBtn.addEventListener('click', () => {
            mainTableBtn.click();
        });
    }
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

    // GT2 Voice Parameters
    const firstWaveHex = document.getElementById('firstWaveInput').value;
    instrument.firstWave = parseInt(firstWaveHex, 16) || 0x09;

    // Derive waveform from firstWave for compatibility
    instrument.waveform = instrument.firstWave & 0xF0;
    instrument.sync = (instrument.firstWave & 0x02) !== 0;
    instrument.ringMod = (instrument.firstWave & 0x04) !== 0;

    // Gate Timer: bits 0-5 = timer, bit 6 = no gate-off, bit 7 = no hard restart
    let gateTimer = parseInt(document.getElementById('gateTimerInput').value) & 0x3F;
    if (document.getElementById('noHardRestartCheck').checked) gateTimer |= 0x80;
    if (document.getElementById('noGateOffCheck').checked) gateTimer |= 0x40;
    instrument.gateTimer = gateTimer;

    // Vibrato delay
    instrument.vibratoDelay = parseInt(document.getElementById('vibratoDelayInput').value) || 0;

    // Combine ADSR values
    const attack = parseInt(document.getElementById('attackSlider').value);
    const decay = parseInt(document.getElementById('decaySlider').value);
    const sustain = parseInt(document.getElementById('sustainSlider').value);
    const release = parseInt(document.getElementById('releaseSlider').value);

    instrument.ad = (attack << 4) | decay;
    instrument.sr = (sustain << 4) | release;

    // GT2 Table Pointers (0 = none, 1-255 = position)
    if (!instrument.tables) {
        instrument.tables = { wave: 0, pulse: 0, filter: 0, speed: 0 };
    }
    instrument.tables.wave = parseInt(document.getElementById('waveTableInput').value) || 0;
    instrument.tables.pulse = parseInt(document.getElementById('pulseTableInput').value) || 0;
    instrument.tables.filter = parseInt(document.getElementById('filterTableInput').value) || 0;
    instrument.tables.speed = parseInt(document.getElementById('speedTableInput').value) || 0;

    // Update instrument selector display
    populateInstrumentSelector();

    // Push live instruments to worklet so updates reflect changes during playback
    try { workletUpdateInstruments(instruments); } catch(_) {}

    // Notify keyboard input to use updated instrument
    if (isEditorOpen && keyboardInput.isEnabled) {
        keyboardInput.setInstrument(currentInstrumentIndex);
        console.log(`Updated keyboard to use modified instrument: ${instrument.name}`);
    }
}

function createNewInstrument() {
    // GT2-compatible instrument with authentic GoatTracker2 parameters
    const newInstrument = {
        name: `Custom ${instruments.length}`,
        // GT2 Voice Parameters
        firstWave: 0x09,       // Gate bit set, no waveform (0x09 = testbit+gate)
        gateTimer: 0x02,       // 2 frames gate timer, no HR, no gate-off
        vibratoDelay: 0x00,    // No vibrato delay
        // Legacy waveform (used if firstWave is 0x00)
        waveform: 0x10,        // Triangle (0x10, 0x20=saw, 0x40=pulse, 0x80=noise)
        // ADSR
        ad: 0x0F,              // Attack=0, Decay=15
        sr: 0xF0,              // Sustain=15, Release=0
        // Pulse width
        pulseWidth: 0x0800,    // 50% duty cycle (12-bit value)
        // Legacy SID features (can also be set via firstWave bits)
        sync: false,           // Oscillator sync (bit 1 of firstWave)
        ringMod: false,        // Ring modulation (bit 2 of firstWave)
        // GT2 table pointers (0 = none, 1-255 = table position)
        tables: { wave: 0, pulse: 0, filter: 0, speed: 0 }
    };

    instruments.push(newInstrument);
    currentInstrumentIndex = instruments.length - 1;

    populateInstrumentSelector();
    loadInstrumentToEditor();

    // Update all instrument dropdowns in the tracker
    updateTrackerInstrumentDropdowns();
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

    // Load tables to worklet before testing (so instrument tables work)
    const tables = {
        ltable: gt2TableManager.ltable,
        rtable: gt2TableManager.rtable
    };
    workletLoadTables(tables);

    // Set master volume to max
    setGlobalSIDRegister(0x18, 0x0F);

    // Play the note with current instrument
    // Tables will be triggered automatically if instrument has table pointers
    playNoteWithInstrument(0, testFreq, 2000, currentInstrumentIndex);

    console.log(`Testing GT2 instrument: ${instrument.name} (tables loaded)`);

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
