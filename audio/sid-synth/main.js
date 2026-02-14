import { initSynth, audioContext, instruments, setSIDRegister, playNote, lfoPhase, calculateTriangleLFO, setGlobalSIDRegister, workletSetSidModel } from './synth.js';
import { NUM_VOICES, currentStep, noteToHz, stopPlayback, startPlayback, togglePause, isPaused, getPlaybackState, voiceState, resetVoiceState } from './sequencer-gt2.js';
import { patternManager, MAX_PATTERNS, MAX_PATTERN_LENGTH as MAX_STEPS, getCurrentPatternLength, setSongMode, selectPattern } from './pattern-manager-compat.js';
import { gt2PatternManager } from './pattern-manager-gt2.js';
import { tempoControl } from './tempo-control.js';
import { initInstrumentEditor } from './instrument-editor.js';
import { initGT2TableEditor } from './table-editor-gt2.js';
import { gt2TableManager } from './table-manager-gt2.js';
import { recordMode } from './record-mode.js';
import { keyboardInput } from './keyboard-input.js';
import { gt2FrameEngine } from './gt2-frame-engine.js';
import { setupGT2ImportUI } from './gt2-importer.js';
import { initGT2PatternEditor } from './gt2-pattern-editor.js';
import { initGT2OrderEditor } from './gt2-order-editor.js';
import { downloadSIDFile } from './exporters/gt2/sid-exporter-gt2.js';

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

    // Export .SID file
    const exportSidButton = document.getElementById('exportSidButton');
    if (exportSidButton) {
        exportSidButton.addEventListener('click', () => {
            try {
                const songTitle = gt2PatternManager.song.title || 'SID Export';
                const songAuthor = gt2PatternManager.song.author || 'sid-synth';

                downloadSIDFile({
                    title: songTitle,
                    author: songAuthor,
                    instruments: instruments,
                    patternManager: gt2PatternManager,
                    tableManager: gt2TableManager,
                });

                console.log(`Exported .SID file: ${songTitle}`);
            } catch (e) {
                console.error('SID export failed:', e);
                alert('SID export failed: ' + e.message);
            }
        });
    }

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

    // Check for SID Ripper import
    checkSIDRipperImport();

    // Manual SID Rip import button
    const importSidRipButton = document.getElementById('importSidRipButton');
    if (importSidRipButton) {
        importSidRipButton.addEventListener('click', () => {
            importSIDRipperData();
        });
    }

    // Listen for storage events (when SID Ripper adds data from another tab)
    window.addEventListener('storage', (e) => {
        if (e.key === 'sidRipperData' && e.newValue) {
            console.log('📡 Detected SID Ripper data from another tab');
            if (confirm('SID Ripper data detected! Import now?')) {
                importSIDRipperData();
            }
        }
    });
};

/**
 * Check for URL-based SID Ripper import on page load
 */
function checkSIDRipperImport() {
    const urlParams = new URLSearchParams(window.location.search);
    console.log('🔍 Checking for SID Ripper import, URL params:', urlParams.toString());

    if (urlParams.get('import') === 'sidrip') {
        // Clear the URL parameter first
        window.history.replaceState({}, document.title, window.location.pathname);
        importSIDRipperData();
    } else {
        console.log('No sidrip import parameter');
    }
}

/**
 * Import SID Ripper data from localStorage
 */
function importSIDRipperData() {
    const dataStr = localStorage.getItem('sidRipperData');
    if (!dataStr) {
        console.log('❌ No SID Ripper data found in localStorage');
        alert('No SID Ripper data found. Please convert a SID file in the SID Ripper first.');
        return;
    }

    console.log('📦 Found SID Ripper data in localStorage, length:', dataStr.length);

    try {
        const data = JSON.parse(dataStr);
        console.log('📀 Importing SID Ripper data:', data);
        console.log('  Name:', data.name);
        console.log('  Patterns:', data.patterns?.length);
        console.log('  Instruments:', data.instruments?.length);
        console.log('  Orders:', data.orders);

        // Clear the local storage after reading
        localStorage.removeItem('sidRipperData');

        // Import instruments - extend array if needed
        if (data.instruments && data.instruments.length > 0) {
            console.log(`Importing ${data.instruments.length} instruments...`);

            // Extend instruments array if needed
            while (instruments.length < data.instruments.length) {
                instruments.push({
                    name: `Inst ${instruments.length}`,
                    waveform: 0x41,
                    ad: 0x0A,
                    sr: 0xA0,
                    pulseWidth: 0x0800,
                    sync: false,
                    ringMod: false,
                    tables: { wave: 0, pulse: 0, filter: 0, speed: 0 }
                });
            }

            data.instruments.forEach((inst, i) => {
                const newInst = {
                    name: inst.name || `Inst ${i}`,
                    waveform: inst.waveform || 0x41,
                    ad: inst.ad || 0x0A,
                    sr: inst.sr || 0xA0,
                    pulseWidth: inst.pulseWidth || 0x0800,
                    sync: false,
                    ringMod: false,
                    tables: inst.tables || { wave: 0, pulse: 0, filter: 0, speed: 0 }
                };
                instruments[i] = newInst;
                console.log(`  [${i}] ${newInst.name}: wave=$${newInst.waveform.toString(16)}, AD=$${newInst.ad.toString(16)}, SR=$${newInst.sr.toString(16)}`);
            });
            console.log(`Imported ${data.instruments.length} instruments`);
        }

        // Validate patterns array exists
        if (!data.patterns || !Array.isArray(data.patterns) || data.patterns.length === 0) {
            throw new Error('No valid patterns found in SID Ripper data');
        }

        // Convert SID Ripper format to GT2 pattern manager format
        const songData = {
            version: 'GT2',
            title: data.name || 'Ripped Song',
            author: data.author || 'SID Ripper',
            copyright: '',
            patterns: data.patterns.map((pat, patIdx) => {
                if (!pat || !pat.data) {
                    console.warn(`Pattern ${patIdx} has no data, creating empty pattern`);
                    return { length: 32, data: Array(32).fill({ note: 0, instrument: 0, command: 0, cmdData: 0 }) };
                }
                return {
                    length: pat.length || pat.data.length || 32,
                    data: pat.data.map(row => ({
                        note: row.note || 0,
                        instrument: row.inst || 0,
                        command: row.cmd || 0,
                        cmdData: row.cmdData || 0
                    }))
                };
            }),
            orderLists: data.orders || [[0, 0xFF], [0, 0xFF], [0, 0xFF]],
            currentPatternIndex: 0,
            currentVoice: 0
        };

        console.log('Importing song data to GT2 pattern manager...');
        console.log('  Patterns:', songData.patterns.length);
        console.log('  Order lists:', songData.orderLists);

        // Debug: Show first pattern's first few rows
        if (songData.patterns.length > 0 && songData.patterns[0].data) {
            console.log('  First pattern sample:');
            songData.patterns[0].data.slice(0, 4).forEach((row, i) => {
                console.log(`    Row ${i}: note=${row.note}, inst=${row.instrument}`);
            });
        }

        // Use GT2PatternManager's importSong method
        gt2PatternManager.importSong(songData);
        console.log('Song data imported successfully');

        // Verify import worked - check first pattern
        const verifyPat = gt2PatternManager.patterns[0];
        console.log('Verification - Pattern 0:');
        console.log(`  Length: ${verifyPat.length}`);
        if (verifyPat.data) {
            verifyPat.data.slice(0, 4).forEach((row, i) => {
                console.log(`    Row ${i}: note=${row.note}, inst=${row.instrument}`);
            });
        }
        console.log('Verification - Order lists:');
        gt2PatternManager.song.orderLists.forEach((ol, v) => {
            console.log(`  Voice ${v}: [${ol.slice(0, 5).join(', ')}${ol.length > 5 ? '...' : ''}]`);
        });

        // Reset voice state to reflect new order lists
        resetVoiceState();
        console.log('Voice state reset for new song');

        // Import wavetables if present
        if (data.wavetables && data.wavetables.length > 0 && window.gt2TableManager) {
            console.log(`Importing ${data.wavetables.length} wavetables...`);
            const TABLE_WAVE = 0;  // WTBL

            // Each wavetable needs contiguous space in the table
            // GT2 pointer = array index + 1 (pointer 1 = array[0])
            // Pattern command 8XY uses pointer value, so cmdData=1 means array[0]
            let nextPos = 0;  // Next available position in the wavetable array

            data.wavetables.forEach((wt, wtIdx) => {
                const startPos = nextPos;
                const gtPointer = startPos + 1;  // GT2 uses 1-based pointers
                console.log(`  Wavetable ${wtIdx + 1} (voice ${wt.voice + 1}): ${wt.entries.length} entries at pos ${startPos} (pointer $${gtPointer.toString(16).toUpperCase().padStart(2, '0')})`);

                wt.entries.forEach((entry, entryIdx) => {
                    const pos = startPos + entryIdx;
                    if (pos < 255) {
                        window.gt2TableManager.setEntry(TABLE_WAVE, pos, entry.left, entry.right);
                    }
                });

                nextPos = startPos + wt.entries.length;
            });
            console.log(`Wavetables imported, using ${nextPos} table entries`);
        }

        // Refresh GT2 editors
        if (window.gt2PatternEditor && window.gt2PatternEditor.renderPattern) {
            console.log('Refreshing GT2 Pattern Editor...');
            window.gt2PatternEditor.renderPattern();
        }
        if (window.gt2OrderEditor && window.gt2OrderEditor.renderOrderLists) {
            console.log('Refreshing GT2 Order Editor...');
            window.gt2OrderEditor.renderOrderLists();
        }

        // Update instrument selectors
        const event = new CustomEvent('instrumentsUpdated');
        document.dispatchEvent(event);

        // Show success message
        const wtCount = data.wavetables?.length || 0;
        alert(`SID Rip imported successfully!\n\nSong: ${data.name}\nPatterns: ${data.patterns?.length || 0}\nInstruments: ${data.instruments?.length || 0}${wtCount > 0 ? `\nWavetables: ${wtCount}` : ''}`);

    } catch (error) {
        console.error('Failed to import SID Ripper data:', error);
        alert('Failed to import SID Ripper data: ' + error.message);
    }
}

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
                    if (!inst) return; // Skip null entries (index 0 = "no change")
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
        if (!inst) return; // Skip null entries (index 0 = "no change")
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
    const colors = ['#0f0', '#0ff', '#f0f'];
    let cachedScopes = null;

    function getScopes() {
        // Get canvases lazily since they're created dynamically by gt2-pattern-editor
        const scope1 = document.getElementById('scope1');
        const scope2 = document.getElementById('scope2');
        const scope3 = document.getElementById('scope3');
        if (scope1 && scope2 && scope3) {
            return [
                { canvas: scope1, color: colors[0] },
                { canvas: scope2, color: colors[1] },
                { canvas: scope3, color: colors[2] }
            ];
        }
        return null;
    }

    return function (payload) {
        if (!payload || !payload.regs) return;

        // Get scopes lazily
        if (!cachedScopes) {
            cachedScopes = getScopes();
        }
        if (!cachedScopes) return;

        const regs = payload.regs;
        const voiceSamples = payload.voiceSamples; // Per-voice audio samples (pre-filter, with ADSR)

        cachedScopes.forEach((scope, v) => {
            if (!scope.canvas) return;
            const ctx = scope.canvas.getContext('2d');
            const w = scope.canvas.width;
            const h = scope.canvas.height;
            const base = v * 7;

            // Control from reg 4
            const control = regs[base + 4];
            const gate = control & 0x01;

            // Clear
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, w, h);

            // Draw center line
            ctx.beginPath();
            ctx.strokeStyle = '#222';
            ctx.moveTo(0, h / 2);
            ctx.lineTo(w, h / 2);
            ctx.stroke();

            // Use per-voice samples for this voice (shows ADSR envelope, pre-filter)
            const samples = voiceSamples && voiceSamples[v] ? voiceSamples[v] : null;
            if (samples && samples.length > 0) {
                ctx.beginPath();
                ctx.strokeStyle = gate ? scope.color : '#444';
                ctx.lineWidth = 1.5;

                const samplesPerPixel = samples.length / w;
                const scale = h * 0.45;

                for (let x = 0; x < w; x++) {
                    const sampleIndex = Math.floor(x * samplesPerPixel);
                    const sample = samples[sampleIndex] || 0;
                    const screenY = h / 2 - sample * scale;

                    if (x === 0) ctx.moveTo(x, screenY);
                    else ctx.lineTo(x, screenY);
                }
                ctx.stroke();
            }
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
