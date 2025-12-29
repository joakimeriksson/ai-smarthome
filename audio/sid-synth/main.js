import { initSynth, audioContext, instruments, setSIDRegister, playNote, lfoPhase, calculateTriangleLFO, setGlobalSIDRegister, workletSetSidModel } from './synth.js';
import { NUM_VOICES, currentStep, noteToHz, stopPlayback, startPlayback, togglePause, isPaused, getPlaybackState, voiceState } from './sequencer-gt2.js';
import { patternManager, MAX_PATTERNS, MAX_PATTERN_LENGTH as MAX_STEPS, getCurrentPatternLength, setSongMode, selectPattern } from './pattern-manager-compat.js';
import { gt2PatternManager } from './pattern-manager-gt2.js';
import { tempoControl } from './tempo-control.js';
import { initInstrumentEditor } from './instrument-editor.js';
import { initGT2TableEditor } from './table-editor-gt2.js';
import { recordMode } from './record-mode.js';
import { keyboardInput } from './keyboard-input.js';
import { gt2FrameEngine } from './gt2-frame-engine.js';
import { setupGT2ImportUI } from './gt2-importer.js';
import { initGT2PatternEditor } from './gt2-pattern-editor.js';
import { initGT2OrderEditor } from './gt2-order-editor.js';

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

// (Pattern and song controls removed - now handled by GT2 editors)
// (Tempo controls removed - GT2 uses tempo from imported songs)

// Project controls
const saveButton = document.getElementById('saveButton');
const loadButton = document.getElementById('loadButton');
const exportButton = document.getElementById('exportButton');

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
    initGT2TableEditor();
    setupGT2ImportUI(); // GoatTracker2 .sng import
    initGT2PatternEditor(); // GoatTracker2 pattern editor
    initGT2OrderEditor(); // GoatTracker2 order list editor

    // Initialize pattern manager and UI
    initializePatternUI();
    initializeTempoControls();
    initializeRecordingControls();

    // Update song info for default song
    updateDefaultSongInfo();

    // Show GT2 help
    console.log(`
🎵 SID TRACKER - GoatTracker2 Mode 🎵

GT2 Pattern System:
• 208 single-voice patterns (0-207)
• 3 independent order lists (one per voice)
• Pattern format: Note | Inst | Cmd | Data

GT2 Notes:
• C-0 to B-7  → Play note
• R--         → Rest (silence)
• ===         → Key off
• ...         → Empty

🎹 RECORDING MODE:
• Click "Record" to start recording
• Play piano keyboard to record notes
• Use arrow keys to navigate
• Press Space for Rest, Enter for Sustain
• Press Escape to stop recording
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
        pauseButton.textContent = '⏸ Pause';
    });

    stopButton.addEventListener('click', () => {
        stopPlayback();
        pauseButton.textContent = '⏸ Pause';
    });

    pauseButton.addEventListener('click', () => {
        togglePause();
        // Update button text to show state
        pauseButton.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    });

    // SID chip model selector
    const sidModelSelect = document.getElementById('sidModelSelect');
    if (sidModelSelect) {
        sidModelSelect.addEventListener('change', (e) => {
            const model = parseInt(e.target.value);
            workletSetSidModel(model);
        });
    }

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

    // (Pattern and song controls removed - now handled by GT2 editors)
    // (Tempo controls removed - GT2 uses tempo from imported songs)
    // (Clear button removed - use GT2 pattern editor)

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
    // Pattern UI is now handled by GT2 editors - no-op for compatibility
}

function initializeTempoControls() {
    // Tempo controls removed - GT2 uses tempo from imported songs
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

// Legacy tracker UI functions (stubbed - GT2 editors are now used)
function updatePatternData(voice, step) {
    // GT2 pattern editor handles this now
}

function saveCurrentPatternFromUI() {
    // GT2 pattern editor handles this now
}

function refreshTrackerFromPattern() {
    // GT2 pattern editor handles this now - no-op for compatibility
}

function updatePatternLengthDisplay() {
    // No longer used - GT2 pattern editor handles this
}

function updatePatternSelector() {
    // No longer used - GT2 pattern editor handles this
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

// Optional: step highlight updater for AudioWorklet-driven sequencing (GT2 version)
window.updateWorkletStep = (function () {
    let lastStep = null;
    return function (payload) {
        // Handle both old (step number only) and new (object) formats
        const step = (typeof payload === 'number') ? payload : payload.step;

        // Update Tempo Display if available
        if (payload && payload.isGT2) {
            const speedEl = document.getElementById('speedDisplay');
            if (speedEl) {
                // GT2: 1 tick = 1/50th sec. (Note: standard PAL C64)
                // BPM approx = 750 / ticks.
                const ticks = payload.ticks || 6;
                const approxBPM = Math.round(750 / ticks);

                speedEl.style.display = 'block';
                speedEl.textContent = `GT2 Speed: ${ticks} (${approxBPM} BPM)`;
            }
        }
        // Update GT2 voice states with current playback position
        if (payload && payload.isGT2 && payload.voicePositions) {
            for (let voice = 0; voice < Math.min(NUM_VOICES, payload.voicePositions.length); voice++) {
                const pos = payload.voicePositions[voice];
                if (pos) {
                    const state = voiceState[voice];
                    state.patternIndex = pos.patternIndex;
                    state.patternRow = pos.patternRow;
                    state.orderPosition = pos.orderPos;

                    // Update isPlaying based on current row
                    const pattern = gt2PatternManager.patterns[state.patternIndex];
                    if (pattern) {
                        const rowData = pattern.getRow(state.patternRow);
                        if (rowData && rowData.note > 0 && rowData.note < 0xBD) {
                            state.isPlaying = true;
                        } else if (rowData && (rowData.note >= 0xBD)) {
                            state.isPlaying = false;
                        }
                    }
                }
            }
        } else {
            // Fallback for non-GT2 or legacy
            for (let voice = 0; voice < NUM_VOICES; voice++) {
                const state = voiceState[voice];
                const pattern = gt2PatternManager.patterns[state.patternIndex];
                if (pattern) {
                    state.patternRow = step % pattern.length;
                }
            }
        }
        lastStep = step;
    };
})();

// --- Oscilloscope Visualization ---
window.updateWorkletTelemetry = (function () {
    const scopes = [
        { canvas: document.getElementById('scope1'), color: '#0f0' },
        { canvas: document.getElementById('scope2'), color: '#0ff' },
        { canvas: document.getElementById('scope3'), color: '#f0f' }
    ];

    return function (payload) {
        if (!payload || !payload.regs) return;
        const regs = payload.regs;

        scopes.forEach((scope, v) => {
            if (!scope.canvas) return;
            const ctx = scope.canvas.getContext('2d');
            const w = scope.canvas.width;
            const h = scope.canvas.height;
            const base = v * 7;

            // Freq from regs 0,1
            const freq = regs[base + 0] | (regs[base + 1] << 8);
            // Control from reg 4
            const control = regs[base + 4];
            const gate = control & 0x01;
            const waveform = control & 0xF0; // Pulse=0x40, Saw=0x20, Tri=0x10, Noise=0x80

            // Clear
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);

            // Draw status info
            ctx.fillStyle = scope.color;
            ctx.font = '10px monospace';
            let label = `F:${freq.toString(16).padStart(4, '0')} W:${waveform.toString(16).padStart(2, '0')} G:${gate}`;

            if (payload.filterConfig) {
                const f = payload.filterConfig;
                let fType = '';
                if (f.type & 0x01) fType += 'L';
                if (f.type & 0x02) fType += 'B';
                if (f.type & 0x04) fType += 'H';
                if (fType) label += ` [${fType} R:${f.res}]`;
            }

            ctx.fillText(label, 5, 12);

            if (gate === 0) {
                // Draw flat line if gate is off
                ctx.beginPath();
                ctx.strokeStyle = '#444';
                ctx.moveTo(0, h / 2);
                ctx.lineTo(w, h / 2);
                ctx.stroke();
                return;
            }

            // Draw simple representative waveform
            ctx.beginPath();
            ctx.strokeStyle = scope.color;
            ctx.lineWidth = 1;

            const scale = 30; // Amplitude
            const period = Math.max(10, 400 - (freq / 100)); // Visual period

            for (let x = 0; x < w; x++) {
                let y = 0;
                const phase = (x / period) % 1;

                if (waveform === 0x40) { // Pulse
                    y = phase < 0.5 ? -1 : 1;
                } else if (waveform === 0x20) { // Saw
                    y = phase * 2 - 1;
                } else if (waveform === 0x10) { // Triangle
                    y = Math.abs(phase * 4 - 2) - 1;
                } else if (waveform === 0x80) { // Noise
                    y = Math.random() * 2 - 1;
                } else {
                    y = 0;
                }

                const screenY = h / 2 + y * scale;
                if (x === 0) ctx.moveTo(x, screenY);
                else ctx.lineTo(x, screenY);
            }
            ctx.stroke();
        });
    };
})();

// Update song info display for default/current song
function updateDefaultSongInfo() {
    const songTitleEl = document.getElementById('songTitle');
    const songStatsEl = document.getElementById('songStats');

    if (songTitleEl) {
        songTitleEl.textContent = 'Default Demo Song';
    }

    if (songStatsEl) {
        // Count used patterns (patterns with actual note data)
        let usedPatterns = 0;
        for (let i = 0; i < 208; i++) {
            const pattern = gt2PatternManager.patterns[i];
            let hasNotes = false;
            for (let row = 0; row < pattern.length; row++) {
                const rowData = pattern.getRow(row);
                if (rowData.note > 0) {
                    hasNotes = true;
                    break;
                }
            }
            if (hasNotes) usedPatterns++;
        }

        songStatsEl.textContent = `${usedPatterns} patterns, ${instruments.length} instruments`;
    }
}
