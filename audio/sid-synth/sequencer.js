// sequencer.js

import { instruments, hzToSid, setSIDRegister, playNote, playNoteWithInstrument, lfoPhase, calculateTriangleLFO, stopVoice, stopAllVoices, stopAudioDrivenTiming, setGlobalSIDRegister, isWorkletActive, workletStartSequencer, workletStopSequencer, workletSetBPM, onWorkletReady, workletPanic, getJSTimerStatus } from './synth.js';
import { lfoEngine } from './lfo-engine.js';
import { arpeggioEngine } from './arpeggio-engine.js';
import { patternManager, NUM_VOICES, MAX_PATTERN_LENGTH } from './pattern-manager.js';
import { tempoControl } from './tempo-control.js';

export { NUM_VOICES };
export const MAX_STEPS = MAX_PATTERN_LENGTH;

export let playbackInterval = null;
export let currentStep = 0;
export let isSequencePlaying = false;
export let songMode = false; // Pattern mode vs Song mode
export let currentPatternInSong = 0;
let tempoChangeHandler = null;
let workletStartWatch = null;

// Track current instruments and base frequencies for each voice
export let currentVoiceState = Array(3).fill(null).map(() => ({
    instrument: null,
    baseFrequency: 0,
    isPlaying: false,
    startTime: 0
}));

export const noteFrequencies = {
    'C-0': 16.35,
    'C#0': 17.32,
    'D-0': 18.35,
    'D#0': 19.45,
    'E-0': 20.60,
    'F-0': 21.83,
    'F#0': 23.12,
    'G-0': 24.50,
    'G#0': 25.96,
    'A-0': 27.50,
    'A#0': 29.14,
    'B-0': 30.87,
    'C-1': 32.70,
    'C#1': 34.65,
    'D-1': 36.71,
    'D#1': 38.89,
    'E-1': 41.20,
    'F-1': 43.65,
    'F#1': 46.25,
    'G-1': 49.00,
    'G#1': 51.91,
    'A-1': 55.00,
    'A#1': 58.27,
    'B-1': 61.74,
    'C-2': 65.41,
    'C#2': 69.30,
    'D-2': 73.42,
    'D#2': 77.78,
    'E-2': 82.41,
    'F-2': 87.31,
    'F#2': 92.50,
    'G-2': 98.00,
    'G#2': 103.83,
    'A-2': 110.00,
    'A#2': 116.54,
    'B-2': 123.47,
    'C-3': 130.81,
    'C#3': 138.59,
    'D-3': 146.83,
    'D#3': 155.56,
    'E-3': 164.81,
    'F-3': 174.61,
    'F#3': 185.00,
    'G-3': 196.00,
    'G#3': 207.65,
    'A-3': 220.00,
    'A#3': 233.08,
    'B-3': 246.94,
    'C-4': 261.63,
    'C#4': 277.18,
    'D-4': 293.66,
    'D#4': 311.13,
    'E-4': 329.63,
    'F-4': 349.23,
    'F#4': 369.99,
    'G-4': 392.00,
    'G#4': 415.30,
    'A-4': 440.00,
    'A#4': 466.16,
    'B-4': 493.88,
    'C-5': 523.25,
    'C#5': 554.37,
    'D-5': 587.33,
    'D#5': 622.25,
    'E-5': 659.25,
    'F-5': 698.46,
    'F#5': 739.99,
    'G-5': 783.99,
    'G#5': 830.61,
    'A-5': 880.00,
    'A#5': 932.33,
    'B-5': 987.77,
    'C-6': 1046.50,
    'C#6': 1108.73,
    'D-6': 1174.66,
    'D#6': 1244.51,
    'E-6': 1318.51,
    'F-6': 1396.91,
    'F#6': 1479.98,
    'G-6': 1567.98,
    'G#6': 1661.22,
    'A-6': 1760.00,
    'A#6': 1864.66,
    'B-6': 1975.53,
    'C-7': 2093.00,
    'C#7': 2217.46,
    'D-7': 2349.32,
    'D#7': 2489.02,
    'E-7': 2637.02,
    'F-7': 2793.83,
    'F#7': 2959.96,
    'G-7': 3135.96,
    'G#7': 3322.44,
    'A-7': 3520.00,
    'A#7': 3729.31,
    'B-7': 3951.07,
    'C-8': 4186.01
};

export function noteToHz(noteString) {
    if (noteString.toUpperCase() === 'R') {
        return 0; // Rest
    }
    const freq = noteFrequencies[noteString];
    if (freq === undefined) {
        console.warn(`Unknown note: ${noteString}. Returning 0 Hz.`);
        return 0;
    }
    return freq;
}

export function stopPlayback() {
    // Always set isSequencePlaying to false first to prevent any new operations
    const wasPlaying = isSequencePlaying;
    isSequencePlaying = false;
    
    // Check if there's actually anything to stop
    const timerStatus = getJSTimerStatus();
    if (!wasPlaying && !playbackInterval && !timerStatus.stepTimer && !timerStatus.lfoTimer && !workletStartWatch) {
        console.log("Playback already stopped.");
        return;
    }

    console.log("Stopping playback...");

    // Clear any pending worklet start watchdog FIRST to prevent race conditions
    if (workletStartWatch) {
        clearTimeout(workletStartWatch);
        workletStartWatch = null;
        console.log("Cleared worklet start watchdog");
    }

    // Stop old setInterval-based timing
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
        console.log("Cleared interval-based timing");
    }
    
    // Stop new audio-driven timing (includes JS timers)
    stopAudioDrivenTiming();
    
    // Stop worklet sequencer if available
    try { 
        if (workletStopSequencer) {
            workletStopSequencer();
            console.log("Stopped worklet sequencer");
        }
    } catch(e) { 
        console.warn("Error stopping worklet sequencer:", e);
    }
    
    // Hard stop to ensure silence in all cases
    try { 
        if (workletPanic) {
            workletPanic();
            console.log("Worklet panic called");
        }
    } catch(e) { 
        console.warn("Error calling worklet panic:", e);
    }
    
    // Remove tempo change handler to prevent callbacks
    if (tempoChangeHandler) {
        try { 
            tempoControl.removeTempoChangeCallback(tempoChangeHandler);
            tempoChangeHandler = null;
            console.log("Removed tempo change handler");
        } catch(e) {
            console.warn("Error removing tempo change handler:", e);
        }
    }
    
    // Stop LFO and arpeggio engines
    lfoEngine.stop();
    arpeggioEngine.stop();
    
    // Stop all voices properly
    stopAllVoices();
    
    // Restore master volume
    try { setGlobalSIDRegister(0x18, 0x0F); } catch(_) {}
    
    // Remove highlight from all steps (using current pattern length)
    try {
        const currentPattern = patternManager.getCurrentPattern();
        for (let step = 0; step < currentPattern.length; step++) {
            removeStepHighlight(step);
        }
    } catch(e) {
        console.warn("Error removing step highlights:", e);
    }
    
    // Reset LFO phases on stop
    lfoPhase.forEach(phase => { phase.pwm = 0; phase.fm = 0; });
    
    // Reset voice states
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        currentVoiceState[voice].isPlaying = false;
        currentVoiceState[voice].instrument = null;
    }
    
    console.log("Playback completely stopped.");
}

export function startPlayback() {
    // Prevent overlapping starts
    if (isSequencePlaying) {
        console.log('Playback already running; ignoring duplicate start');
        return;
    }
    
    // Stop any existing playback first (safety) - but don't reset isSequencePlaying yet
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    stopAudioDrivenTiming();
    try { workletStopSequencer && workletStopSequencer(); } catch(_) {}
    try { workletPanic && workletPanic(); } catch(_) {}
    if (workletStartWatch) {
        clearTimeout(workletStartWatch);
        workletStartWatch = null;
    }
    lfoEngine.stop();
    arpeggioEngine.stop();
    stopAllVoices();
    
    // Now set the state and begin
    currentStep = 0;
    isSequencePlaying = true;
    
    if (isWorkletActive()) {
        const pat = patternManager.getCurrentPattern();
        const pattern = [];
        for (let v = 0; v < NUM_VOICES; v++) {
            const row = [];
            for (let s = 0; s < pat.length; s++) {
                const sd = pat.getStepData(v, s);
                row.push({ note: sd.note, instrument: sd.instrument });
            }
            pattern.push(row);
        }
        workletStartSequencer({ pattern, patternLength: pat.length, instruments, bpm: tempoControl.bpm });
        if (tempoChangeHandler) try { tempoControl.removeTempoChangeCallback(tempoChangeHandler); } catch(_) {}
        tempoChangeHandler = (bpm) => { if (isSequencePlaying) workletSetBPM(bpm); };
        tempoControl.onTempoChange(tempoChangeHandler);
        
        // Trigger first step immediately for worklet engine
        setTimeout(() => {
            if (isSequencePlaying && typeof window.updateWorkletStep === 'function') {
                window.updateWorkletStep(0);
            }
        }, 10);
    } else if (typeof window !== 'undefined' && window.sidWorkletNode) {
        // Worklet is initializing: start when ready
        const pat = patternManager.getCurrentPattern();
        const pattern = [];
        for (let v = 0; v < NUM_VOICES; v++) {
            const row = [];
            for (let s = 0; s < pat.length; s++) {
                const sd = pat.getStepData(v, s);
                row.push({ note: sd.note, instrument: sd.instrument });
            }
            pattern.push(row);
        }
        let started = false;
        onWorkletReady(() => {
            if (!isSequencePlaying) {
                console.log('Worklet ready but playback stopped, ignoring');
                return;
            }
            started = true;
            
            // Clear the watchdog since we're now ready
            if (workletStartWatch) {
                clearTimeout(workletStartWatch);
                workletStartWatch = null;
                console.log('Cleared worklet watchdog - worklet is ready');
            }
            
            workletStartSequencer({ pattern, patternLength: pat.length, instruments, bpm: tempoControl.bpm });
            if (tempoChangeHandler) try { tempoControl.removeTempoChangeCallback(tempoChangeHandler); } catch(_) {}
            tempoChangeHandler = (bpm) => { if (isSequencePlaying) workletSetBPM(bpm); };
            tempoControl.onTempoChange(tempoChangeHandler);
            
            console.log('Worklet sequencer started successfully');
            
            // Trigger first step immediately for worklet engine
            setTimeout(() => {
                if (isSequencePlaying && typeof window.updateWorkletStep === 'function') {
                    window.updateWorkletStep(0);
                }
            }, 10);
        });
        // Watchdog: if worklet doesn't become ready soon, report error
        workletStartWatch = setTimeout(() => {
            if (!isSequencePlaying || started) {
                console.log('Worklet watchdog: playback stopped or already started');
                workletStartWatch = null;
                return;
            }
            console.error('AudioWorklet not ready in time - playback failed');
            workletStartWatch = null;
            isSequencePlaying = false;
            alert('AudioWorklet failed to initialize in time. Please refresh the page and try again.');
        }, 700);
    } else {
        // AudioWorklet is required
        console.error('No AudioWorklet available - cannot start playback');
        isSequencePlaying = false;
        alert('AudioWorklet is required but not available. Please use a modern browser.');
        return;
    }
    
    // AudioWorklet handles LFO and arpeggio internally - no need for main-thread engines
    
    // Final engine detection and debug output
    const engineType = isWorkletActive() ? 'AudioWorklet' : 'main-thread';
    console.log(`Playback started at ${tempoControl.bpm} BPM using ${engineType} engine`);
    console.log(`isWorkletActive() returns: ${isWorkletActive()}`);
    if (typeof window !== 'undefined') {
        console.log(`window.sidWorkletNode exists: ${!!window.sidWorkletNode}`);
        console.log(`window.audioContext exists: ${!!window.audioContext}`);
        console.log(`window.audioContext.state: ${window.audioContext?.state}`);
    }
    
    setGlobalSIDRegister(0x18, 0x0F);
    console.log("Master volume set to 15.");
}

// Audio-driven callbacks removed - AudioWorklet handles timing internally

// Legacy function - kept for compatibility but no longer used
function playStepWithTempo() {
    playStep();
    
    // This function is no longer used with audio-driven timing
    console.warn("playStepWithTempo called - should use audio-driven timing instead");
}

export function playStep() {
    const currentPattern = patternManager.getCurrentPattern();
    const patternLength = currentPattern.length;
    
    console.log(`playStep: currentStep=${currentStep}, patternLength=${patternLength}`);
    
    // Remove highlight from previous step
    const previousStep = (currentStep - 1 + patternLength) % patternLength; // Use pattern length for wrap-around
    if (currentStep !== 0 || playbackInterval !== null) {
        removeStepHighlight(previousStep);
    }

    // Add highlight to current step
    addStepHighlight(currentStep);

    for (let voice = 0; voice < NUM_VOICES; voice++) {
        // Get note data from pattern manager instead of DOM
        const stepData = currentPattern.getStepData(voice, currentStep);
        const note = stepData.note.trim().toUpperCase();
        
        console.log(`playStep: voice=${voice}, step=${currentStep}, note="${note}", instrument=${stepData.instrument}`);
        
        if (note !== '' && note !== 'R') {
            // Check for sustain note
            if (note === '---' || note === 'SUS') {
                // Sustain - continue previous note, don't retrigger
                if (currentVoiceState[voice].isPlaying && currentVoiceState[voice].baseFrequency > 0) {
                    // Keep playing the current note, don't retrigger
                    console.log(`Voice ${voice}: Sustaining note at ${currentVoiceState[voice].baseFrequency.toFixed(2)} Hz`);
                    // Note continues playing, no action needed
                } else {
                    // No previous note to sustain, treat as rest
                    currentVoiceState[voice].isPlaying = false;
                    currentVoiceState[voice].instrument = null;
                    stopVoice(voice);
                }
            } else {
                // Regular note - play new note
                const freq = noteToHz(note);
                const instrumentIndex = stepData.instrument;
                const instrument = instruments[instrumentIndex];

                if (freq > 0 && instrument) {
                    console.log(`playStep: Playing note ${note} on voice ${voice} at ${freq.toFixed(2)} Hz with instrument "${instrument.name}"`);
                    
                    // Update voice state
                    currentVoiceState[voice].instrument = instrument;
                    currentVoiceState[voice].baseFrequency = freq;
                    currentVoiceState[voice].isPlaying = true;
                    currentVoiceState[voice].startTime = performance.now();
                    
                    // Set up LFO engine for this voice
                    lfoEngine.setVoice(voice, instrument, freq, instrument.pulseWidth);
                    
                    // Set up arpeggio engine if enabled
                    if (instrument.arpeggio?.enabled) {
                        arpeggioEngine.setVoice(voice, true, freq, instrument.arpeggio.notes, instrument.arpeggio.speed);
                    } else {
                        arpeggioEngine.clearVoice(voice);
                    }
                    
                    // Play the note with instrument (LFO and arpeggio engines will handle modulation)
                    playNoteWithInstrument(voice, freq, tempoControl.stepDurationMs, instrumentIndex);
                } else {
                    // Invalid note, treat as rest
                    currentVoiceState[voice].isPlaying = false;
                    currentVoiceState[voice].instrument = null;
                    stopVoice(voice);
                }
            }
        } else if (note === 'R') {
            // Rest - trigger release phase first, then stop after release time
            if (currentVoiceState[voice].isPlaying && currentVoiceState[voice].instrument) {
                const instrument = currentVoiceState[voice].instrument;
                const release = instrument.sr & 0x0F; // Extract release value
                
                // Trigger release by clearing GATE bit but keeping waveform
                const controlReg = (voice * 7) + 0x04;
                setGlobalSIDRegister(controlReg, instrument.waveform);
                console.log(`Voice ${voice}: Rest - triggering release phase (R=${release})`);
                
                // Stop the voice after release time has elapsed
                const releaseTimeMs = Math.max(50, release * 50); // Minimum 50ms, scale with release value
                setTimeout(() => {
                    stopVoice(voice);
                }, releaseTimeMs);
            } else {
                // No note was playing, just ensure voice is stopped
                stopVoice(voice);
            }
            
            currentVoiceState[voice].isPlaying = false;
            currentVoiceState[voice].instrument = null;
        } else {
            // Empty note - keep any currently playing note (sustain behavior)
            // Don't stop the voice, let the previous note continue
            console.log(`Voice ${voice}: Empty note - sustaining current state`);
        }
    }

    // Move to next step, handle pattern/song progression
    currentStep = (currentStep + 1) % patternLength;
    
    // If we completed a pattern and we're in song mode, advance to next pattern
    if (currentStep === 0 && songMode) {
        advanceToNextPatternInSong();
    }
}

// Helper functions for step highlighting
function removeStepHighlight(step) {
    const stepElement = document.querySelector(`.step-number:nth-child(${step + 2})`);
    if (stepElement) stepElement.classList.remove('highlight');
    
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        const noteElement = document.getElementById(`note-${voice}-${step}`);
        const instElement = document.getElementById(`instrument-${voice}-${step}`);
        if (noteElement) noteElement.classList.remove('highlight');
        if (instElement) instElement.classList.remove('highlight');
    }
}

function addStepHighlight(step) {
    const stepElement = document.querySelector(`.step-number:nth-child(${step + 2})`);
    if (stepElement) stepElement.classList.add('highlight');
    
    for (let voice = 0; voice < NUM_VOICES; voice++) {
        const noteElement = document.getElementById(`note-${voice}-${step}`);
        const instElement = document.getElementById(`instrument-${voice}-${step}`);
        if (noteElement) noteElement.classList.add('highlight');
        if (instElement) instElement.classList.add('highlight');
    }
}

function advanceToNextPatternInSong() {
    const nextPatternIndex = patternManager.song.nextPattern();
    patternManager.selectPattern(nextPatternIndex);
    
    console.log(`Song mode: Advanced to pattern ${String.fromCharCode(65 + nextPatternIndex)}`);
    
    // Update UI to show current song position
    updateSongPositionDisplay();
}

function updateSongPositionDisplay() {
    const positionElement = document.getElementById('songPosition');
    if (positionElement) {
        const current = patternManager.song.currentPosition + 1;
        const total = patternManager.song.sequence.length;
        positionElement.textContent = `Pos: ${current}/${total}`;
    }
}

// Song mode control functions
export function setSongMode(enabled) {
    songMode = enabled;
    const songModeButton = document.getElementById('songModeButton');
    if (songModeButton) {
        songModeButton.textContent = songMode ? 'Song Mode' : 'Pattern Mode';
        songModeButton.style.backgroundColor = songMode ? '#0A0' : '#050';
    }
    
    updateSongPositionDisplay();
    console.log(`Switched to ${songMode ? 'Song' : 'Pattern'} mode`);
}

export function getCurrentPatternLength() {
    return patternManager.getCurrentPattern().length;
}

// Pattern switching functions
export function selectPattern(index) {
    if (!isSequencePlaying) {  // Don't switch patterns during playback in pattern mode
        patternManager.selectPattern(index);
        refreshPatternUI();
        console.log(`Selected pattern ${String.fromCharCode(65 + index)}`);
    }
}

function refreshPatternUI() {
    // This will be called by main.js to refresh the tracker UI
    if (window.refreshTrackerFromPattern) {
        window.refreshTrackerFromPattern();
    }
}

export const initialPattern = [
    { voice: 0, step: 0, note: 'C-5', instrument: 0 }, // Lead (Tri)
    { voice: 0, step: 1, note: '---', instrument: 0 }, // Sustain C-5
    { voice: 0, step: 2, note: 'E-5', instrument: 0 },
    { voice: 0, step: 3, note: '---', instrument: 0 }, // Sustain E-5
    { voice: 0, step: 4, note: 'G-5', instrument: 0 },
    { voice: 0, step: 5, note: 'R', instrument: 0 },   // Rest

    { voice: 1, step: 0, note: 'C-3', instrument: 1 }, // Bass (Pulse)
    { voice: 1, step: 1, note: '---', instrument: 1 }, // Sustain C-3 for longer bass note
    { voice: 1, step: 2, note: '---', instrument: 1 }, // Continue sustaining
    { voice: 1, step: 3, note: 'E-3', instrument: 1 },

    { voice: 0, step: 6, note: 'A-5', instrument: 0 },
    { voice: 0, step: 7, note: '---', instrument: 0 }, // Sustain A-5
    { voice: 0, step: 8, note: 'C-6', instrument: 0 },
    { voice: 0, step: 9, note: 'R', instrument: 0 },

    { voice: 1, step: 4, note: '---', instrument: 1 }, // Sustain E-3
    { voice: 1, step: 5, note: 'R', instrument: 1 },
];
