// sequencer-gt2.js - GoatTracker2-compatible sequencer with per-voice patterns
// Supports 3 independent order lists and per-voice pattern playback

import { instruments, playNoteWithInstrument, stopVoice, stopAllVoices, setGlobalSIDRegister, isWorkletActive, workletStartSequencer, workletStopSequencer, workletSetBPM, onWorkletReady, workletPanic, stopAudioDrivenTiming, getJSTimerStatus } from './synth.js';
import { gt2PatternManager, NUM_VOICES, MAX_PATTERNS, NOTE_EMPTY, NOTE_REST, NOTE_KEYOFF, LOOPSONG, ENDSONG } from './pattern-manager-gt2.js';
import { gt2TableManager } from './table-manager-gt2.js';
import { tempoControl } from './tempo-control.js';
import { gt2FrameEngine } from './gt2-frame-engine.js';
import { patternCommandEngine } from './pattern-commands.js';

export { NUM_VOICES };

export let isSequencePlaying = false;
export let isPaused = false;
export let songMode = false; // Pattern mode vs Song mode (order list playback)
export let currentStep = 0;

// Per-voice playback state
export let voiceState = Array(NUM_VOICES).fill(null).map(() => ({
    orderPosition: 0,      // Current position in order list
    patternIndex: 0,       // Current pattern being played
    patternRow: 0,         // Current row in pattern
    transpose: 0,          // Transpose amount
    instrument: 0,         // Last instrument used
    isPlaying: false,
    sustain: false         // Sustain mode (--- continues note)
}));

// Expose voiceState globally for worklet position updates
if (typeof window !== 'undefined') {
    window.voiceState = voiceState;
}

let playbackInterval = null;
let tempoChangeHandler = null;
let workletStartWatch = null;

// Note number to frequency conversion (GT2 style: note 1 = C-0, note 95 = B-7)
export function noteNumberToHz(noteNum) {
    if (noteNum === NOTE_EMPTY || noteNum === 0) return 0;
    if (noteNum === NOTE_REST) return 0;  // Rest
    if (noteNum === NOTE_KEYOFF) return 0; // Key off

    // Note 1 = C-0 (16.35 Hz), note 13 = C-1, etc.
    // A-4 (440 Hz) = note 58
    const A4_NOTE = 58;  // A-4 in GT2 numbering (1-based)
    const A4_FREQ = 440.0;

    // Calculate semitones from A-4
    const semitones = noteNum - A4_NOTE;

    // Equal temperament: freq = 440 * 2^(semitones/12)
    return A4_FREQ * Math.pow(2, semitones / 12.0);
}

// Convert note name to frequency (for compatibility)
export function noteToHz(noteString) {
    if (!noteString || noteString === '' || noteString === '---') return 0;
    if (noteString.toUpperCase() === 'R') return 0;
    if (noteString === '===') return 0;  // Key off

    // Convert note name to number
    const noteNum = gt2PatternManager.noteNameToNumber(noteString);
    return noteNumberToHz(noteNum);
}

// Reset voice state after import or to sync with pattern manager
export function resetVoiceState() {
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        voiceState[voice].patternRow = 0;
        voiceState[voice].isPlaying = false;
        voiceState[voice].sustain = false;
        voiceState[voice].transpose = 0;

        // Get starting pattern from order list
        const orderList = gt2PatternManager.song.orderLists[voice];
        if (orderList && orderList.length > 0) {
            // Find first actual pattern in order list (skip any commands)
            let patIdx = 0;
            for (let i = 0; i < orderList.length; i++) {
                const entry = orderList[i];
                if (entry < 0xD0) {  // Valid pattern index (0-207)
                    patIdx = entry;
                    voiceState[voice].orderPosition = i;
                    break;
                }
            }
            voiceState[voice].patternIndex = patIdx;
        } else {
            voiceState[voice].orderPosition = 0;
            voiceState[voice].patternIndex = 0;
        }
    }
    console.log('Voice state reset:', voiceState.map(v => ({ orderPos: v.orderPosition, patIdx: v.patternIndex })));
}

export function stopPlayback() {
    const wasPlaying = isSequencePlaying;
    isSequencePlaying = false;
    isPaused = false;

    // Resume audio context if it was suspended (paused)
    if (window.audioContext && window.audioContext.state === 'suspended') {
        window.audioContext.resume();
    }

    if (!wasPlaying && !playbackInterval && !workletStartWatch) {
        console.log("Playback already stopped.");
        return;
    }

    console.log("Stopping GT2 playback...");

    // Clear worklet start watchdog
    if (workletStartWatch) {
        clearTimeout(workletStartWatch);
        workletStartWatch = null;
    }

    // Stop all timing sources
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    stopAudioDrivenTiming();

    // Stop worklet and frame engine
    try { workletStopSequencer && workletStopSequencer(); } catch (e) { }
    try { workletPanic && workletPanic(); } catch (e) { }
    gt2FrameEngine.stop();

    // Remove tempo change handler
    if (tempoChangeHandler) {
        try { tempoControl.removeTempoChangeCallback(tempoChangeHandler); } catch (e) { }
        tempoChangeHandler = null;
    }

    // Stop all voices
    stopAllVoices();

    // Restore master volume
    try { setGlobalSIDRegister(0x18, 0x0F); } catch (_) { }

    // Reset voice states
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        voiceState[voice].isPlaying = false;
        voiceState[voice].patternRow = 0;
    }

    // Remove step highlights
    try {
        removeAllStepHighlights();
    } catch (e) { }

    console.log("GT2 playback stopped.");
}

export function pausePlayback() {
    if (!isSequencePlaying) {
        console.log("Not playing, cannot pause.");
        return;
    }

    if (isPaused) {
        console.log("Already paused.");
        return;
    }

    console.log("Pausing GT2 playback...");
    isPaused = true;

    // Suspend audio context - this pauses all audio processing including worklet
    if (window.audioContext && window.audioContext.state === 'running') {
        window.audioContext.suspend().then(() => {
            console.log("Audio context suspended - playback paused.");
        });
    }
}

export function resumePlayback() {
    if (!isSequencePlaying) {
        console.log("Not playing, cannot resume. Use play instead.");
        return;
    }

    if (!isPaused) {
        console.log("Not paused, nothing to resume.");
        return;
    }

    console.log("Resuming GT2 playback...");
    isPaused = false;

    // Resume audio context - this resumes all audio processing
    if (window.audioContext && window.audioContext.state === 'suspended') {
        window.audioContext.resume().then(() => {
            console.log("Audio context resumed - playback resumed.");
        });
    }
}

export function togglePause() {
    if (isPaused) {
        resumePlayback();
    } else {
        pausePlayback();
    }
}

export function startPlayback() {
    if (isSequencePlaying) {
        console.log('Playback already running');
        return;
    }

    // Stop any existing playback
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    stopAudioDrivenTiming();
    try { workletStopSequencer && workletStopSequencer(); } catch (_) { }
    try { workletPanic && workletPanic(); } catch (_) { }
    if (workletStartWatch) {
        clearTimeout(workletStartWatch);
        workletStartWatch = null;
    }
    stopAllVoices();

    // Reset playback state
    currentStep = 0;
    isSequencePlaying = true;

    // Reset voice states
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        voiceState[voice].patternRow = 0;
        voiceState[voice].isPlaying = false;
        voiceState[voice].sustain = false;

        // Get starting pattern from order list, processing any commands
        const orderList = gt2PatternManager.song.orderLists[voice];
        const result = processOrderlistCommands(orderList, 0);
        voiceState[voice].orderPosition = result.nextPosition;
        voiceState[voice].patternIndex = result.patternIndex;
        voiceState[voice].transpose = result.transpose;
    }

    // Start GT2 frame engine for table execution
    // DISABLED: Logic moved to AudioWorklet (SidProcessor)
    // gt2FrameEngine.start();

    if (isWorkletActive()) {
        startWorkletPlayback();
    } else if (typeof window !== 'undefined' && window.sidWorkletNode) {
        // Worklet is initializing
        let started = false;
        onWorkletReady(() => {
            if (!isSequencePlaying) return;
            started = true;

            if (workletStartWatch) {
                clearTimeout(workletStartWatch);
                workletStartWatch = null;
            }

            startWorkletPlayback();
        });

        // Watchdog
        workletStartWatch = setTimeout(() => {
            if (!isSequencePlaying || started) {
                workletStartWatch = null;
                return;
            }
            console.error('AudioWorklet not ready in time');
            workletStartWatch = null;
            isSequencePlaying = false;
            alert('AudioWorklet failed to initialize. Please refresh.');
        }, 700);
    } else {
        console.error('No AudioWorklet available');
        isSequencePlaying = false;
        alert('AudioWorklet is required. Please use a modern browser.');
        return;
    }

    setGlobalSIDRegister(0x18, 0x0F);
    console.log(`GT2 playback started at ${tempoControl.bpm} BPM`);
}

function startWorkletPlayback() {
    // Convert ALL patterns to worklet format
    const allPatterns = [];

    for (let p = 0; p < MAX_PATTERNS; p++) {
        const pat = gt2PatternManager.patterns[p];
        const rows = [];

        for (let step = 0; step < pat.length; step++) {
            const rowData = pat.getRow(step);
            rows.push({
                note: rowData.note,  // Keep as raw byte
                instrument: rowData.instrument !== undefined ? rowData.instrument : 0,
                command: rowData.command || 0,
                cmdData: rowData.cmdData || 0
            });
        }

        allPatterns.push(rows);

        // Debug first few patterns
        if (p < 3) {
            const preview = rows.slice(0, 4).map(r => {
                const noteName = gt2PatternManager.noteNumberToName(r.note);
                return `${noteName || '...'}:${r.instrument}`;
            }).join(' ');
            const hasNotes = rows.some(r => r.note && r.note !== 0);
            console.log(`Pattern ${p} (${pat.length} rows, ${hasNotes ? 'HAS NOTES' : 'EMPTY'}): ${preview}`);
        }
    }

    // Send order lists to worklet
    const orderLists = [
        [...gt2PatternManager.song.orderLists[0]],
        [...gt2PatternManager.song.orderLists[1]],
        [...gt2PatternManager.song.orderLists[2]]
    ];

    console.log(`Starting playback with order lists:`, orderLists.map((ol, i) => `V${i}:${ol.slice(0, 5).join(',')}`));

    workletStartSequencer({
        allPatterns,           // All patterns in the song
        orderLists,            // Per-voice order lists
        instruments,
        tables: {
            ltable: gt2TableManager.ltable,
            rtable: gt2TableManager.rtable
        },
        bpm: tempoControl.bpm
    });

    if (tempoChangeHandler) {
        try { tempoControl.removeTempoChangeCallback(tempoChangeHandler); } catch (_) { }
    }
    tempoChangeHandler = (bpm) => {
        if (isSequencePlaying) workletSetBPM(bpm);
    };
    tempoControl.onTempoChange(tempoChangeHandler);

    // Trigger first step
    setTimeout(() => {
        if (isSequencePlaying && typeof window.updateWorkletStep === 'function') {
            window.updateWorkletStep(0);
        }
    }, 10);
}

// Play just the current track position (patterns at given order positions) in a loop
// This is useful for debugging specific sounds without hearing the whole song
export function startTrackPlayback(orderPositions) {
    // Get the pattern indices at the specified order positions
    const patternIndices = [];
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        const orderList = gt2PatternManager.song.orderLists[voice];
        const pos = orderPositions ? orderPositions[voice] : voiceState[voice].orderPosition;

        // Find the pattern at this position (skip transpose commands)
        let patIdx = 0;
        let p = pos;
        while (p < orderList.length) {
            const entry = orderList[p];
            if (entry < MAX_PATTERNS) {
                patIdx = entry;
                break;
            } else if (entry >= 0xD0 && entry <= 0xDF) {
                // Transpose command - skip to next
                p++;
            } else {
                break;
            }
        }
        patternIndices.push(patIdx);
    }

    console.log(`🎵 Starting track playback at patterns: ${patternIndices.join(', ')}`);

    // Stop any existing playback
    if (isSequencePlaying) {
        stopPlayback();
    }

    isSequencePlaying = true;
    isPaused = false;
    songMode = true;
    currentStep = 0;

    // Reset voice state
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        voiceState[voice].orderPosition = 0;
        voiceState[voice].patternIndex = patternIndices[voice];
        voiceState[voice].patternRow = 0;
        voiceState[voice].transpose = 0;
        voiceState[voice].isPlaying = true;
    }

    // Build all patterns array (same as startPlayback)
    const allPatterns = [];
    for (let p = 0; p < MAX_PATTERNS; p++) {
        const pat = gt2PatternManager.patterns[p];
        const rows = [];
        for (let step = 0; step < pat.length; step++) {
            const rowData = pat.getRow(step);
            rows.push({
                note: rowData.note,
                instrument: rowData.instrument !== undefined ? rowData.instrument : 0,
                command: rowData.command || 0,
                cmdData: rowData.cmdData || 0
            });
        }
        allPatterns.push(rows);
    }

    // Create simple order lists that just loop the current patterns
    // Format: [patternIndex, LOOPSONG, 0] = play pattern, then loop to position 0
    const trackOrderLists = [
        [patternIndices[0], LOOPSONG, 0],
        [patternIndices[1], LOOPSONG, 0],
        [patternIndices[2], LOOPSONG, 0]
    ];

    console.log(`Track order lists:`, trackOrderLists);

    workletStartSequencer({
        allPatterns,
        orderLists: trackOrderLists,
        instruments,
        tables: {
            ltable: gt2TableManager.ltable,
            rtable: gt2TableManager.rtable
        },
        bpm: tempoControl.bpm
    });

    if (tempoChangeHandler) {
        try { tempoControl.removeTempoChangeCallback(tempoChangeHandler); } catch (_) { }
    }
    tempoChangeHandler = (bpm) => {
        if (isSequencePlaying) workletSetBPM(bpm);
    };
    tempoControl.onTempoChange(tempoChangeHandler);
}

// Play a single step (called by worklet or timer)
export function playStep() {
    if (!isSequencePlaying) return;

    console.log(`playStep: currentStep=${currentStep}`);

    // Play each voice independently
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        playVoiceStep(voice);
    }

    // Update step highlight
    highlightStep(currentStep);

    // Advance step counter
    currentStep++;

    // Check if all voices have reached end of their patterns
    let allEnded = true;
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        const pattern = gt2PatternManager.patterns[voiceState[voice].patternIndex];
        if (voiceState[voice].patternRow < pattern.length) {
            allEnded = false;
            break;
        }
    }

    if (allEnded) {
        // All patterns ended, advance order lists
        for (let voice = 0; voice < NUM_VOICES; voice++) {
            advanceOrderList(voice);
        }
        currentStep = 0;
    }
}

// Play one voice for current step
function playVoiceStep(voice) {
    const state = voiceState[voice];
    const pattern = gt2PatternManager.patterns[state.patternIndex];
    const rowData = pattern.getRow(state.patternRow);

    if (!rowData) {
        state.patternRow++;
        return;
    }

    const { note, instrument, command, cmdData } = rowData;

    // Handle note
    if (note === NOTE_EMPTY) {
        // Empty note - do nothing (sustain previous note if playing)
        if (state.sustain) {
            // Continue previous note
        }
    } else if (note === NOTE_REST) {
        // Rest - stop voice
        stopVoice(voice);
        state.isPlaying = false;
        state.sustain = false;
        patternCommandEngine.stopRealtimeEffects(voice);
    } else if (note === NOTE_KEYOFF) {
        // Key off - release note
        stopVoice(voice);
        state.isPlaying = false;
        state.sustain = false;
        patternCommandEngine.stopRealtimeEffects(voice);
    } else {
        // Play note
        // Calculate base frequency (used for pitch slides)
        const noteNum = note + state.transpose;
        const freq = noteNumberToHz(noteNum);

        // Update instrument if specified
        if (instrument >= 0 && instrument < instruments.length) {
            state.instrument = instrument;
        }

        // Play note with instrument
        if (freq > 0 && state.instrument >= 0 && state.instrument < instruments.length) {
            const instr = instruments[state.instrument];

            // Register note start with command engine (for portamento base)
            patternCommandEngine.setBaseFrequency(voice, freq);
            // Default: stop old effects unless portamento will take over
            if (command !== 0x3) { // 3 = Toneportamento (keeps effects running potentially)
                patternCommandEngine.stopRealtimeEffects(voice);
            }

            // Normal note trigger (unless toneportamento is active, handled by executeCommand)
            // But we trigger it anyway, and let the engine modify frequency on next frame?
            // GT2 usually keys on unless it's a tie-note.
            // For now, trigger standard note, but if Toneportamento (3xx), we might suppress attack?
            // Simple integration: Play note, then let command engine modify pitch immediately if needed.

            if (command === 0x3 && cmdData !== 0) {
                // Toneportamento start: Don't re-trigger attack/voice if we are sliding
                // (This is a simplified view; real GT2 checking is more complex)
            } else {
                playNoteWithInstrument(voice, freq, 1000, state.instrument);

                // Trigger GT2 tables if instrument has them
                if (instr && instr.tables) {
                    gt2FrameEngine.triggerNoteTables(voice, noteNum, instr);
                }

                state.isPlaying = true;
                state.sustain = true;
            }
        }
    }

    // Handle commands
    if (command !== undefined) {
        // Pass current frequency for Toneportamento reference
        const currentFreq = noteNumberToHz(note + state.transpose);
        patternCommandEngine.executeCommand(voice, command, cmdData || 0, 0, currentFreq);
    }

    // Advance row
    state.patternRow++;
}

// Process orderlist commands starting at a position and return pattern info
// Returns: { patternIndex, transpose, nextPosition }
function processOrderlistCommands(orderList, startPos) {
    let pos = startPos;
    let transpose = 0;
    let repeatCount = 1;

    // Process commands until we find a pattern number
    while (pos < orderList.length) {
        const entry = orderList[pos];

        if (entry === ENDSONG || entry === LOOPSONG) {
            // Can't start here, return default
            return { patternIndex: 0, transpose: 0, nextPosition: 0 };
        } else if (entry >= 0xD0 && entry <= 0xDF) {
            // REPEAT command (GT2 gplay.c lines 979-982)
            // repeat count = entry - 0xD0 (0 = play once, 1+ = additional plays)
            repeatCount = entry - 0xD0;
            pos++; // Advance past REPEAT to pattern number
        } else if (entry >= 0xE0 && entry <= 0xFD) {
            // Transpose (GT2 gplay.c line 975: trans = entry - TRANSUP)
            // 0xE0 = -16, 0xEF = -1, 0xF0 = 0, 0xF1 = +1, 0xFD = +13
            transpose = entry - 0xF0;  // Signed: -16 to +13
            pos++;
        } else if (entry < MAX_PATTERNS) {
            // Found a pattern!
            return { patternIndex: entry, transpose, nextPosition: pos };
        } else {
            // Unknown command, skip it
            console.warn(`Unknown orderlist entry 0x${entry.toString(16)} at position ${pos}`);
            pos++;
        }
    }

    // Reached end without finding pattern
    return { patternIndex: 0, transpose: 0, nextPosition: 0 };
}

// Advance order list for a voice
function advanceOrderList(voice) {
    const state = voiceState[voice];
    const orderList = gt2PatternManager.song.orderLists[voice];

    state.orderPosition++;

    // Check for special order list commands
    if (state.orderPosition >= orderList.length) {
        // End of order list - process from start
        const result = processOrderlistCommands(orderList, 0);
        state.orderPosition = result.nextPosition;
        state.patternRow = 0;
        state.patternIndex = result.patternIndex;
        state.transpose = result.transpose;
        return;
    }

    const entry = orderList[state.orderPosition];

    if (entry === ENDSONG) {
        // End marker - process from start
        const result = processOrderlistCommands(orderList, 0);
        state.orderPosition = result.nextPosition;
        state.patternRow = 0;
        state.patternIndex = result.patternIndex;
        state.transpose = result.transpose;
    } else if (entry === LOOPSONG) {
        // Loop to specific position
        const loopPos = orderList[state.orderPosition + 1];
        const result = processOrderlistCommands(orderList, loopPos);
        state.orderPosition = result.nextPosition;
        state.patternRow = 0;
        state.patternIndex = result.patternIndex;
        state.transpose = result.transpose;
    } else {
        // Process commands from current position
        const result = processOrderlistCommands(orderList, state.orderPosition);
        state.orderPosition = result.nextPosition;
        state.patternRow = 0;
        state.patternIndex = result.patternIndex;
        state.transpose = result.transpose;
    }
}

// UI helpers
function highlightStep(step) {
    try {
        const stepElements = document.querySelectorAll(`.pattern-step[data-step="${step}"]`);
        stepElements.forEach(el => el.classList.add('playing'));
    } catch (e) { }
}

function removeAllStepHighlights() {
    try {
        const stepElements = document.querySelectorAll('.pattern-step.playing');
        stepElements.forEach(el => el.classList.remove('playing'));
    } catch (e) { }
}

// Export state for UI
export function getPlaybackState() {
    return {
        isPlaying: isSequencePlaying,
        currentStep,
        voiceState: voiceState.map(v => ({
            orderPosition: v.orderPosition,
            patternIndex: v.patternIndex,
            patternRow: v.patternRow,
            transpose: v.transpose
        }))
    };
}
