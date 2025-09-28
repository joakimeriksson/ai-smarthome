// instrument-editor.js
import { instruments, initSynth, playNote, playNoteWithInstrument, stopVoice, stopAllVoices, setGlobalSIDRegister, isWorkletActive, workletNoteOff, workletUpdateInstruments } from './synth.js';
import { lfoEngine } from './lfo-engine.js';
import { arpeggioEngine } from './arpeggio-engine.js';
import { keyboardInput } from './keyboard-input.js';

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
    
    // PWM LFO
    document.getElementById('pwmLFOEnabled').checked = instrument.pwmLFO.enabled;
    document.getElementById('pwmLFOFreq').value = instrument.pwmLFO.freq;
    document.getElementById('pwmLFODepth').value = instrument.pwmLFO.depth * 100;
    updateSliderDisplay('pwmLFOFreq', instrument.pwmLFO.freq);
    updateSliderDisplay('pwmLFODepth', Math.round(instrument.pwmLFO.depth * 100));
    
    // FM LFO
    document.getElementById('fmLFOEnabled').checked = instrument.fmLFO.enabled;
    document.getElementById('fmLFOFreq').value = instrument.fmLFO.freq;
    document.getElementById('fmLFODepth').value = instrument.fmLFO.depth * 100;
    updateSliderDisplay('fmLFOFreq', instrument.fmLFO.freq);
    updateSliderDisplay('fmLFODepth', Math.round(instrument.fmLFO.depth * 100));
    
    // SID Features
    document.getElementById('syncEnabled').checked = instrument.sync || false;
    document.getElementById('ringModEnabled').checked = instrument.ringMod || false;
    
    // Arpeggio
    document.getElementById('arpeggioEnabled').checked = instrument.arpeggio?.enabled || false;
    document.getElementById('arpeggioSpeed').value = instrument.arpeggio?.speed || 4;
    updateSliderDisplay('arpeggioSpeed', instrument.arpeggio?.speed || 4);
    
    // Set arpeggio pattern based on notes array
    const notes = instrument.arpeggio?.notes || [0, 4, 7];
    const patternSelect = document.getElementById('arpeggioPattern');
    // Find matching pattern or default to major
    let matchingPattern = 'major';
    for (const option of patternSelect.options) {
        const pattern = arpeggioEngine.constructor.getChordPattern(option.value);
        if (JSON.stringify(pattern) === JSON.stringify(notes)) {
            matchingPattern = option.value;
            break;
        }
    }
    patternSelect.value = matchingPattern;
    
    // Filter
    const filter = instrument.filter || { enabled: false, frequency: 0x400, resonance: 0, type: 0x10 };
    document.getElementById('filterEnabled').checked = filter.enabled;
    document.getElementById('filterFrequency').value = filter.frequency;
    document.getElementById('filterResonance').value = filter.resonance;
    document.getElementById('filterType').value = filter.type;
    updateSliderDisplay('filterFrequency', filter.frequency);
    updateSliderDisplay('filterResonance', filter.resonance);
    
    // Filter LFO
    const filterLFO = instrument.filterLFO || { enabled: false, freq: 0, depth: 0, continuous: false };
    document.getElementById('filterLFOEnabled').checked = filterLFO.enabled;
    document.getElementById('filterLFOFreq').value = filterLFO.freq;
    document.getElementById('filterLFODepth').value = filterLFO.depth * 100;
    document.getElementById('filterLFOContinuous').checked = filterLFO.continuous || false;
    updateSliderDisplay('filterLFOFreq', filterLFO.freq);
    updateSliderDisplay('filterLFODepth', Math.round(filterLFO.depth * 100));
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
    
    // LFO controls
    ['pwmLFOEnabled', 'pwmLFOFreq', 'pwmLFODepth', 'fmLFOEnabled', 'fmLFOFreq', 'fmLFODepth'].forEach(id => {
        const element = document.getElementById(id);
        element.addEventListener(element.type === 'checkbox' ? 'change' : 'input', (e) => {
            if (id.includes('Freq') || id.includes('Depth')) {
                const param = id.replace('LFO', '').replace('LFO', '');
                updateSliderDisplay(id.replace('Slider', ''), e.target.value);
            }
            updateCurrentInstrument();
        });
    });
    
    // SID Features
    ['syncEnabled', 'ringModEnabled'].forEach(id => {
        document.getElementById(id).addEventListener('change', updateCurrentInstrument);
    });
    
    // Arpeggio controls
    document.getElementById('arpeggioEnabled').addEventListener('change', updateCurrentInstrument);
    document.getElementById('arpeggioSpeed').addEventListener('input', (e) => {
        updateSliderDisplay('arpeggioSpeed', e.target.value);
        updateCurrentInstrument();
    });
    document.getElementById('arpeggioPattern').addEventListener('change', updateCurrentInstrument);
    
    // Filter controls
    document.getElementById('filterEnabled').addEventListener('change', updateCurrentInstrument);
    document.getElementById('filterFrequency').addEventListener('input', (e) => {
        updateSliderDisplay('filterFrequency', e.target.value);
        updateCurrentInstrument();
    });
    document.getElementById('filterResonance').addEventListener('input', (e) => {
        updateSliderDisplay('filterResonance', e.target.value);
        updateCurrentInstrument();
    });
    document.getElementById('filterType').addEventListener('change', updateCurrentInstrument);
    
    // Filter LFO controls
    document.getElementById('filterLFOEnabled').addEventListener('change', updateCurrentInstrument);
    document.getElementById('filterLFOFreq').addEventListener('input', (e) => {
        updateSliderDisplay('filterLFOFreq', e.target.value);
        updateCurrentInstrument();
    });
    document.getElementById('filterLFODepth').addEventListener('input', (e) => {
        updateSliderDisplay('filterLFODepth', e.target.value);
        updateCurrentInstrument();
    });
    document.getElementById('filterLFOContinuous').addEventListener('change', updateCurrentInstrument);
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
    
    // PWM LFO
    instrument.pwmLFO.enabled = document.getElementById('pwmLFOEnabled').checked;
    instrument.pwmLFO.freq = parseFloat(document.getElementById('pwmLFOFreq').value);
    instrument.pwmLFO.depth = parseFloat(document.getElementById('pwmLFODepth').value) / 100;
    
    // FM LFO
    instrument.fmLFO.enabled = document.getElementById('fmLFOEnabled').checked;
    instrument.fmLFO.freq = parseFloat(document.getElementById('fmLFOFreq').value);
    instrument.fmLFO.depth = parseFloat(document.getElementById('fmLFODepth').value) / 100;
    
    // SID Features
    instrument.sync = document.getElementById('syncEnabled').checked;
    instrument.ringMod = document.getElementById('ringModEnabled').checked;
    
    // Arpeggio
    if (!instrument.arpeggio) {
        instrument.arpeggio = { enabled: false, notes: [0, 4, 7], speed: 4 };
    }
    instrument.arpeggio.enabled = document.getElementById('arpeggioEnabled').checked;
    instrument.arpeggio.speed = parseInt(document.getElementById('arpeggioSpeed').value);
    
    // Get notes from selected pattern
    const pattern = document.getElementById('arpeggioPattern').value;
    instrument.arpeggio.notes = arpeggioEngine.constructor.getChordPattern(pattern);
    
    // Filter
    if (!instrument.filter) {
        instrument.filter = { enabled: false, frequency: 0x400, resonance: 0, type: 0x10 };
    }
    instrument.filter.enabled = document.getElementById('filterEnabled').checked;
    instrument.filter.frequency = parseInt(document.getElementById('filterFrequency').value);
    instrument.filter.resonance = parseInt(document.getElementById('filterResonance').value);
    instrument.filter.type = parseInt(document.getElementById('filterType').value);
    
    // Filter LFO
    if (!instrument.filterLFO) {
        instrument.filterLFO = { enabled: false, freq: 0, depth: 0, continuous: false };
    }
    instrument.filterLFO.enabled = document.getElementById('filterLFOEnabled').checked;
    instrument.filterLFO.freq = parseFloat(document.getElementById('filterLFOFreq').value);
    instrument.filterLFO.depth = parseFloat(document.getElementById('filterLFODepth').value) / 100;
    instrument.filterLFO.continuous = document.getElementById('filterLFOContinuous').checked;
    
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
    const newInstrument = {
        name: `Custom ${instruments.length}`,
        waveform: 16, // Triangle
        ad: 0x0F,
        sr: 0xF0,
        pulseWidth: 0x0800,
        pwmLFO: { enabled: false, freq: 0, depth: 0 },
        fmLFO: { enabled: false, freq: 0, depth: 0 },
        sync: false,
        ringMod: false,
        arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 }
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
    // Ensure audio is initialized (worklet or fallback)
    if (!window.audioContext) {
        initSynth();
    }
    
    // Ensure audio context is running
    if (window.audioContext && window.audioContext.state === 'suspended') {
        await window.audioContext.resume();
    }
    
    // Test note A-4 (440 Hz) for 2 seconds to hear LFO effects - this should sound like concert pitch A
    const instrument = instruments[currentInstrumentIndex];
    const testFreq = 440.0; // A-4, standard concert pitch
    
    // Start LFO engine for testing
    lfoEngine.start();
    lfoEngine.setVoice(0, instrument, testFreq, instrument.pulseWidth);
    
    // Start arpeggio engine if needed
    if (instrument.arpeggio?.enabled) {
        arpeggioEngine.start();
        arpeggioEngine.setVoice(0, true, testFreq, instrument.arpeggio.notes, instrument.arpeggio.speed);
    }
    
    // Set master volume to max
    setGlobalSIDRegister(0x18, 0x0F);
    
    // Play the note with current instrument (worklet-aware via playNote)
    playNoteWithInstrument(0, testFreq, 2000, currentInstrumentIndex);
    
    console.log(`Testing instrument: ${instrument.name}`);
    
    // Stop the test note after duration
    setTimeout(() => {
        // Stop voice 0 properly
        if (isWorkletActive && isWorkletActive()) {
            const instrument2 = instruments[currentInstrumentIndex];
            workletNoteOff(0, instrument2.waveform);
        } else {
            stopVoice(0);
        }
        lfoEngine.clearVoice(0);
        lfoEngine.stop();
        arpeggioEngine.clearVoice(0);
        arpeggioEngine.stop();
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
