import { initSynth, audioContext, instruments, setSIDRegister, playNote, lfoPhase, calculateTriangleLFO, setGlobalSIDRegister } from './synth.js';
import { NUM_VOICES, MAX_STEPS, playbackInterval, currentStep, noteToHz, stopPlayback, startPlayback, playStep, initialPattern, setSongMode, selectPattern, getCurrentPatternLength } from './sequencer.js';
import { patternManager, MAX_PATTERNS } from './pattern-manager.js';
import { tempoControl } from './tempo-control.js';
import { initInstrumentEditor } from './instrument-editor.js';
import { initSongEditor } from './song-editor.js';
import { recordMode } from './record-mode.js';
import { keyboardInput } from './keyboard-input.js';
import { sidExporter } from './sid-exporter.js';
import { sidTester } from './sid-tester.js';

// Transport controls
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const pauseButton = document.getElementById('pauseButton');

// Recording controls
const recordButton = document.getElementById('recordButton');
const recordVoiceSelect = document.getElementById('recordVoiceSelect');
const recordInstrumentSelect = document.getElementById('recordInstrumentSelect');
const autoAdvanceCheck = document.getElementById('autoAdvanceCheck');
const recordStatus = document.getElementById('recordStatus');

// Pattern controls
const patternSelect = document.getElementById('patternSelect');
const clearButton = document.getElementById('clearButton');
const copyPatternButton = document.getElementById('copyPatternButton');
const pastePatternButton = document.getElementById('pastePatternButton');
const patternLength = document.getElementById('patternLength');

// Song controls
const songModeButton = document.getElementById('songModeButton');
const songPosition = document.getElementById('songPosition');
const songEditorButton = document.getElementById('songEditorButton');

// Tempo controls
const bpmSlider = document.getElementById('bpmSlider');
const bpmDisplay = document.getElementById('bpmDisplay');
const tapTempoButton = document.getElementById('tapTempoButton');

// Project controls
const saveButton = document.getElementById('saveButton');
const loadButton = document.getElementById('loadButton');
const exportButton = document.getElementById('exportButton');
const exportSIDButton = document.getElementById('exportSIDButton');
const testSIDButton = document.getElementById('testSIDButton');
const importButton = document.getElementById('importButton');
const importFileInput = document.getElementById('importFileInput');

// Tool controls
const instrumentEditorButton = document.getElementById('instrumentEditorButton');
const keyboardToggleButton = document.getElementById('keyboardToggleButton');
const helpButton = document.getElementById('helpButton');

// Global state
let copiedPattern = null;
let currentPatternIndex = 0;

window.onload = () => {
    // Initialize editors
    initInstrumentEditor();
    initSongEditor();
    
    // Initialize pattern manager and UI
    initializePatternUI();
    initializeTempoControls();
    initializeRecordingControls();
    
    // Dynamically create tracker UI
    const trackerContainer = document.getElementById('tracker-container');

    // Create step number column
    const stepNumbersColumn = document.createElement('div');
    stepNumbersColumn.classList.add('step-numbers-column');
    const stepNumbersHeader = document.createElement('div');
    stepNumbersHeader.classList.add('step-label');
    stepNumbersHeader.textContent = 'Step';
    stepNumbersColumn.appendChild(stepNumbersHeader);

    for (let step = 0; step < MAX_STEPS; step++) {
        const stepLabel = document.createElement('div');
        stepLabel.textContent = step.toString().padStart(2, '0');
        stepLabel.classList.add('step-number');
        stepLabel.style.display = step < getCurrentPatternLength() ? 'block' : 'none';
        stepNumbersColumn.appendChild(stepLabel);
    }
    trackerContainer.prepend(stepNumbersColumn); // Add to the beginning of the container

    for (let voice = 0; voice < NUM_VOICES; voice++) {
        const trackDiv = document.getElementById(`track-${voice}`);
        // Add column headers for each track
        const trackHeader = document.createElement('div');
        trackHeader.classList.add('track-column-header');
        trackHeader.innerHTML = `
            <div class="note-label">Note</div>
            <div class="instrument-label">Inst</div>
        `;
        trackDiv.prepend(trackHeader);

        for (let step = 0; step < MAX_STEPS; step++) {
            const stepDiv = document.createElement('div');
            stepDiv.classList.add('step');
            stepDiv.style.display = step < getCurrentPatternLength() ? 'block' : 'none';

            const noteInput = document.createElement('input');
            noteInput.type = 'text';
            noteInput.placeholder = 'Note';
            noteInput.id = `note-${voice}-${step}`;
            noteInput.addEventListener('input', () => updatePatternData(voice, step));
            stepDiv.appendChild(noteInput);

            const instrumentSelect = document.createElement('select');
            instrumentSelect.id = `instrument-${voice}-${step}`;
            instrumentSelect.addEventListener('change', () => updatePatternData(voice, step));
            instruments.forEach((inst, index) => {
                const option = document.createElement('option');
                option.value = index; // Store index as value
                option.textContent = inst.name;
                instrumentSelect.appendChild(option);
            });
            stepDiv.appendChild(instrumentSelect);

            trackDiv.appendChild(stepDiv);
        }
    }

    // Load current pattern data into UI
    refreshTrackerFromPattern();

    // Show note entry help
    console.log(`
🎵 SID TRACKER - NOTE ENTRY HELP 🎵

Note Entry Formats:
• C-4, D#5, F-3  → Play note (note + octave)
• R              → Rest (silence)
• ---            → Sustain (continue previous note)
• (empty)        → Silence

🎹 RECORDING MODE:
• Click "Record" to start recording
• Play piano keyboard to record notes
• Use arrow keys to navigate: ←→ (voices), ↑↓ (steps)
• Press Space for Rest, Enter for Sustain
• Press Escape to stop recording

Recording Shortcuts:
• Space          → Record Rest
• Enter          → Record Sustain
• ←→             → Switch voices
• ↑↓             → Move between steps
• Escape         → Stop recording

Examples:
• C-4, ---, ---, E-4  → C-4 plays for 3 steps, then E-4
• C-3, R, D-3, ---    → C-3, silence, D-3 for 2 steps
    `);

    // Transport controls
    playButton.addEventListener('click', async () => {
        console.log('Play button clicked - initializing audio...');
        
        // Always initialize synth on each play to ensure it's ready
        try {
            initSynth();
            console.log('Synth initialized');
        } catch (e) {
            console.error('Synth initialization failed:', e);
            return;
        }
        
        // Ensure AudioContext is running
        if (window.audioContext) {
            console.log('AudioContext state:', window.audioContext.state);
            if (window.audioContext.state === 'suspended') {
                try { 
                    await window.audioContext.resume(); 
                    console.log('AudioContext resumed');
                } catch (e) { 
                    console.error('Audio resume failed:', e); 
                    return;
                }
            }
        } else {
            console.error('No AudioContext available');
            return;
        }
        
        // Set master volume
        try {
            setGlobalSIDRegister(0x18, 0x0F);
            console.log('Master volume set to 15');
        } catch (e) {
            console.error('Failed to set master volume:', e);
        }
        
        // Start playback
        console.log('Starting playback...');
        startPlayback();
    });

    stopButton.addEventListener('click', stopPlayback);
    
    pauseButton.addEventListener('click', () => {
        // TODO: Implement pause functionality
        console.log('Pause functionality coming soon!');
    });

    // Recording controls
    recordButton.addEventListener('click', () => {
        recordMode.toggle();
    });

    recordVoiceSelect.addEventListener('change', (e) => {
        const voice = parseInt(e.target.value);
        recordMode.setVoice(voice);
    });

    recordInstrumentSelect.addEventListener('change', (e) => {
        const instrument = parseInt(e.target.value);
        recordMode.setInstrument(instrument);
    });

    autoAdvanceCheck.addEventListener('change', (e) => {
        recordMode.setAutoAdvance(e.target.checked);
    });

    // Pattern controls
    patternSelect.addEventListener('change', (e) => {
        const patternIndex = parseInt(e.target.value);
        selectPattern(patternIndex);
        currentPatternIndex = patternIndex;
    });

    copyPatternButton.addEventListener('click', () => {
        copiedPattern = patternManager.copyPattern();
        console.log(`Pattern ${String.fromCharCode(65 + currentPatternIndex)} copied to clipboard`);
    });

    pastePatternButton.addEventListener('click', () => {
        if (copiedPattern) {
            patternManager.pastePattern(copiedPattern, currentPatternIndex);
            refreshTrackerFromPattern();
            console.log(`Pattern pasted to ${String.fromCharCode(65 + currentPatternIndex)}`);
        } else {
            console.log('No pattern in clipboard');
        }
    });

    // Song controls
    songModeButton.addEventListener('click', () => {
        const currentMode = songModeButton.textContent;
        const newSongMode = currentMode === 'Pattern Mode';
        setSongMode(newSongMode);
    });

    // Song Editor button is now handled by initSongEditor()

    // Tempo controls
    bpmSlider.addEventListener('input', (e) => {
        const bpm = parseInt(e.target.value);
        tempoControl.setBPM(bpm);
        bpmDisplay.textContent = `${bpm} BPM`;
    });

    tapTempoButton.addEventListener('click', () => {
        tempoControl.tapTempo();
        bpmSlider.value = tempoControl.bpm;
        bpmDisplay.textContent = `${tempoControl.bpm} BPM`;
    });

    clearButton.addEventListener('click', () => {
        stopPlayback();
        patternManager.clearCurrentPattern();
        refreshTrackerFromPattern();
        console.log(`Pattern ${String.fromCharCode(65 + currentPatternIndex)} cleared.`);
    });

    saveButton.addEventListener('click', () => {
        // Save current UI data to pattern manager first
        saveCurrentPatternFromUI();
        
        // Save complete project data
        const saveData = {
            songData: patternManager.exportSong(),
            instruments: JSON.parse(JSON.stringify(instruments)),
            tempo: {
                bpm: tempoControl.bpm,
                stepResolution: tempoControl.stepResolution,
                swing: tempoControl.swing
            },
            version: '2.0'
        };
        
        localStorage.setItem('sidTrackerData', JSON.stringify(saveData));
        console.log("Complete project saved to local storage.");
    });

    loadButton.addEventListener('click', () => {
        stopPlayback();
        
        const savedData = localStorage.getItem('sidTrackerData');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                
                if (data.version === '2.0' && data.songData) {
                    // Load new format with full song data
                    patternManager.importSong(data.songData);
                    
                    // Load instruments
                    if (data.instruments) {
                        instruments.length = 0;
                        instruments.push(...data.instruments);
                        updateAllInstrumentDropdowns();
                    }
                    
                    // Load tempo settings
                    if (data.tempo) {
                        tempoControl.setBPM(data.tempo.bpm);
                        tempoControl.setStepResolution(data.tempo.stepResolution);
                        tempoControl.setSwing(data.tempo.swing);
                    }
                    
                    // Refresh UI
                    refreshTrackerFromPattern();
                    console.log(`Loaded complete project (version ${data.version})`);
                } else {
                    // Handle legacy formats
                    handleLegacyLoad(data);
                }
                
            } catch (e) {
                console.error("Failed to load data:", e);
            }
        } else {
            console.log("No saved data found.");
        }
    });

    // Export functionality
    exportButton.addEventListener('click', () => {
        // Save current UI data first
        saveCurrentPatternFromUI();
        
        // Create complete export data
        const exportData = {
            songData: patternManager.exportSong(),
            instruments: JSON.parse(JSON.stringify(instruments)),
            tempo: {
                bpm: tempoControl.bpm,
                stepResolution: tempoControl.stepResolution,
                swing: tempoControl.swing
            },
            metadata: {
                title: patternManager.song.title,
                author: "SID Tracker User",
                created: new Date().toISOString(),
                version: "2.0",
                application: "SID Tracker"
            }
        };
        
        // Create filename with timestamp
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
        const filename = `sid-tracker-${timestamp}.json`;
        
        // Create and download file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log(`Exported complete project as ${filename}`);
    });

    // Export SID functionality
    exportSIDButton.addEventListener('click', () => {
        // Save current UI data first
        saveCurrentPatternFromUI();
        
        // Get song title from song editor or use default
        const songTitle = patternManager.song.title || "SID Tracker Song";
        
        // Export as SID file
        sidExporter.downloadSID(songTitle);
        
        console.log(`Exported SID file: ${songTitle}`);
    });

    // Test SID functionality
    testSIDButton.addEventListener('click', () => {
        // Save current UI data first
        saveCurrentPatternFromUI();
        
        // Toggle test playback
        sidTester.toggleTest();
    });

    // Import functionality
    importButton.addEventListener('click', () => {
        importFileInput.click();
    });

    importFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedData = JSON.parse(e.target.result);
                
                // Validate the imported data
                if (!importedData.pattern || !importedData.instruments) {
                    alert('Invalid file format. Please select a valid SID Tracker export file.');
                    return;
                }

                // Stop any current playback
                stopPlayback();

                // Load instruments
                instruments.length = 0;
                instruments.push(...importedData.instruments);

                // Update all instrument dropdowns
                for (let voice = 0; voice < NUM_VOICES; voice++) {
                    for (let step = 0; step < NUM_STEPS; step++) {
                        const select = document.getElementById(`instrument-${voice}-${step}`);
                        if (select) {
                            select.innerHTML = '';
                            
                            instruments.forEach((inst, index) => {
                                const option = document.createElement('option');
                                option.value = index;
                                option.textContent = inst.name;
                                select.appendChild(option);
                            });
                        }
                    }
                }

                // Load pattern
                // Clear existing pattern first
                for (let voice = 0; voice < NUM_VOICES; voice++) {
                    for (let step = 0; step < NUM_STEPS; step++) {
                        document.getElementById(`note-${voice}-${step}`).value = '';
                        document.getElementById(`instrument-${voice}-${step}`).value = 0;
                    }
                }

                // Load imported pattern
                importedData.pattern.forEach(item => {
                    if (item.voice < NUM_VOICES && item.step < NUM_STEPS) {
                        document.getElementById(`note-${item.voice}-${item.step}`).value = item.note || '';
                        document.getElementById(`instrument-${item.voice}-${item.step}`).value = item.instrument || 0;
                    }
                });

                // Show metadata if available
                if (importedData.metadata) {
                    console.log(`Imported: ${importedData.metadata.title || 'Untitled'}`);
                    console.log(`Author: ${importedData.metadata.author || 'Unknown'}`);
                    console.log(`Created: ${importedData.metadata.created || 'Unknown'}`);
                }

                console.log(`Successfully imported ${importedData.instruments.length} instruments and pattern.`);
                alert(`Successfully imported "${importedData.metadata?.title || 'SID Tracker Song'}"!`);

            } catch (error) {
                console.error('Import failed:', error);
                alert('Failed to import file. Please check the file format.');
            }
        };

        reader.readAsText(file);
        
        // Clear the input so the same file can be imported again
        event.target.value = '';
    });

    // Keyboard input toggle
    let keyboardEnabled = false;
    keyboardToggleButton.addEventListener('click', () => {
        keyboardEnabled = !keyboardEnabled;
        
        if (keyboardEnabled) {
            keyboardInput.enable();
            keyboardToggleButton.textContent = 'Disable Keyboard';
            keyboardToggleButton.style.backgroundColor = '#0A0';
            
            // Set current instrument from first instrument select
            const firstInstrumentSelect = document.getElementById('instrument-0-0');
            if (firstInstrumentSelect) {
                keyboardInput.setInstrument(parseInt(firstInstrumentSelect.value));
            }
        } else {
            keyboardInput.disable();
            keyboardToggleButton.textContent = 'Enable Keyboard';
            keyboardToggleButton.style.backgroundColor = '#050';
        }
    });

    // Update keyboard instrument when any instrument selector changes
    document.addEventListener('change', (event) => {
        if (keyboardEnabled && event.target.id && event.target.id.startsWith('instrument-')) {
            keyboardInput.setInstrument(parseInt(event.target.value));
        }
    });

    // Help modal controls
    const helpModal = document.getElementById('helpModal');
    const closeHelp = document.getElementById('closeHelp');
    const closeHelpButton = document.getElementById('closeHelpButton');

    helpButton.addEventListener('click', () => {
        helpModal.style.display = 'block';
    });

    closeHelp.addEventListener('click', () => {
        helpModal.style.display = 'none';
    });

    closeHelpButton.addEventListener('click', () => {
        helpModal.style.display = 'none';
    });

    // Close help modal when clicking outside
    window.addEventListener('click', (event) => {
        if (event.target === helpModal) {
            helpModal.style.display = 'none';
        }
    });
};

// Helper functions for pattern management
function initializePatternUI() {
    // Populate pattern selector
    for (let i = 0; i < MAX_PATTERNS; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = String.fromCharCode(65 + i); // A, B, C, etc.
        patternSelect.appendChild(option);
    }
    
    // Set initial pattern length display
    updatePatternLengthDisplay();
}

function initializeTempoControls() {
    // Set initial tempo display
    bpmDisplay.textContent = `${tempoControl.bpm} BPM`;
    bpmSlider.value = tempoControl.bpm;
    
    // Listen for tempo changes from other sources
    tempoControl.onTempoChange((bpm, stepDuration, resolution) => {
        bpmDisplay.textContent = `${bpm} BPM`;
        bpmSlider.value = bpm;
    });
}

function initializeRecordingControls() {
    // Setup recording shortcuts
    recordMode.setupRecordingShortcuts();
    
    // Initialize record instrument selector
    updateRecordInstrumentSelector();
    
    // Set initial instrument for recording
    recordMode.setInstrument(0);
    
    // Listen for recording events
    recordMode.onRecordingEvent((eventType, data) => {
        if (eventType === 'noteRecorded') {
            console.log(`🎵 Note recorded: ${data.note} in Voice ${data.voice + 1}, Step ${data.step + 1}`);
        }
    });
}

function updatePatternData(voice, step) {
    const noteElement = document.getElementById(`note-${voice}-${step}`);
    const instElement = document.getElementById(`instrument-${voice}-${step}`);
    
    if (noteElement && instElement) {
        const currentPattern = patternManager.getCurrentPattern();
        currentPattern.setStepData(voice, step, noteElement.value.trim(), parseInt(instElement.value));
    }
}

function saveCurrentPatternFromUI() {
    const currentPattern = patternManager.getCurrentPattern();
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        for (let step = 0; step < currentPattern.length; step++) {
            const noteElement = document.getElementById(`note-${voice}-${step}`);
            const instElement = document.getElementById(`instrument-${voice}-${step}`);
            
            if (noteElement && instElement) {
                currentPattern.setStepData(voice, step, noteElement.value.trim(), parseInt(instElement.value));
            }
        }
    }
}

function refreshTrackerFromPattern() {
    const currentPattern = patternManager.getCurrentPattern();
    const patternLength = currentPattern.length;
    
    // Update step visibility
    for (let step = 0; step < MAX_STEPS; step++) {
        const isVisible = step < patternLength;
        
        // Update step numbers
        const stepElement = document.querySelector(`.step-number:nth-child(${step + 2})`);
        if (stepElement) {
            stepElement.style.display = isVisible ? 'block' : 'none';
        }
        
        // Update tracker inputs
        for (let voice = 0; voice < NUM_VOICES; voice++) {
            const stepDiv = document.getElementById(`note-${voice}-${step}`).parentElement;
            stepDiv.style.display = isVisible ? 'block' : 'none';
            
            if (isVisible) {
                const stepData = currentPattern.getStepData(voice, step);
                document.getElementById(`note-${voice}-${step}`).value = stepData.note;
                document.getElementById(`instrument-${voice}-${step}`).value = stepData.instrument;
            }
        }
    }
    
    updatePatternLengthDisplay();
    updatePatternSelector();
}

function updatePatternLengthDisplay() {
    const length = getCurrentPatternLength();
    patternLength.textContent = `Length: ${length}`;
}

function updatePatternSelector() {
    patternSelect.value = patternManager.currentPatternIndex;
}

function updateAllInstrumentDropdowns() {
    // Update tracker instrument dropdowns
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        for (let step = 0; step < MAX_STEPS; step++) {
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
                }
            }
        }
    }
    
    // Update record instrument dropdown
    updateRecordInstrumentSelector();
    
    console.log(`Updated ${instruments.length} instruments in all dropdowns.`);
}

function updateRecordInstrumentSelector() {
    const currentValue = recordInstrumentSelect.value;
    recordInstrumentSelect.innerHTML = '';
    
    instruments.forEach((inst, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = inst.name;
        recordInstrumentSelect.appendChild(option);
    });
    
    // Restore selection if still valid
    if (currentValue < instruments.length) {
        recordInstrumentSelect.value = currentValue;
    }
}

function handleLegacyLoad(data) {
    // Handle version 1.0 and older formats
    if (data.instruments) {
        instruments.length = 0;
        instruments.push(...data.instruments);
        updateAllInstrumentDropdowns();
    }
    
    if (data.pattern) {
        // Load into Pattern A
        const patternA = patternManager.patterns[0];
        data.pattern.forEach(item => {
            if (item.voice < NUM_VOICES && item.step < 64) {
                patternA.setStepData(item.voice, item.step, item.note || '', item.instrument || 0);
            }
        });
        refreshTrackerFromPattern();
        console.log("Legacy pattern loaded into Pattern A");
    }
}

function updateSongPositionDisplay() {
    const positionElement = document.getElementById('songPosition');
    if (positionElement) {
        const current = patternManager.song.currentPosition + 1;
        const total = patternManager.song.sequence.length;
        positionElement.textContent = `Pos: ${current}/${total}`;
    }
}

// Make functions globally available for sequencer and song editor
window.refreshTrackerFromPattern = refreshTrackerFromPattern;
window.updateSongPositionDisplay = updateSongPositionDisplay;

// Optional: step highlight updater for AudioWorklet-driven sequencing
window.updateWorkletStep = (function() {
    let lastStep = null;
    return function(step) {
        const currentPattern = patternManager.getCurrentPattern();
        const length = currentPattern.length;
        if (lastStep !== null) {
            const prev = ((step - 1 + length) % length);
            const stepElement = document.querySelector(`.step-number:nth-child(${prev + 2})`);
            if (stepElement) stepElement.classList.remove('highlight');
            for (let voice = 0; voice < NUM_VOICES; voice++) {
                const noteElement = document.getElementById(`note-${voice}-${prev}`);
                const instElement = document.getElementById(`instrument-${voice}-${prev}`);
                if (noteElement) noteElement.classList.remove('highlight');
                if (instElement) instElement.classList.remove('highlight');
            }
        }
        const stepElement = document.querySelector(`.step-number:nth-child(${step + 2})`);
        if (stepElement) stepElement.classList.add('highlight');
        for (let voice = 0; voice < NUM_VOICES; voice++) {
            const noteElement = document.getElementById(`note-${voice}-${step}`);
            const instElement = document.getElementById(`instrument-${voice}-${step}`);
            if (noteElement) noteElement.classList.add('highlight');
            if (instElement) instElement.classList.add('highlight');
        }
        lastStep = step;
    };
})();
