// gt2-frame-engine.js - GoatTracker2 frame-based table execution engine

import { gt2TableManager, GT2TablePlaybackState, TABLE_TYPES } from './table-manager-gt2.js';
import { setSIDRegister, setGlobalSIDRegister } from './synth.js';
import { patternCommandEngine } from './pattern-commands.js';

// Frame timing constants
const PAL_FRAME_RATE = 50;   // Hz (C64 PAL)
const NTSC_FRAME_RATE = 60;  // Hz (C64 NTSC)

export class GT2FrameEngine {
    constructor(frameRate = PAL_FRAME_RATE) {
        this.frameRate = frameRate;
        this.frameInterval = 1000 / frameRate; // ms per frame
        this.lastFrameTime = 0;
        this.isRunning = false;
        this.frameId = null;

        // Per-voice table playback states
        this.voiceStates = [
            new GT2TablePlaybackState(),
            new GT2TablePlaybackState(),
            new GT2TablePlaybackState()
        ];

        // Current voice parameters (for integration with playback)
        this.voiceParams = [
            { baseNote: 0, baseFreq: 0, instrument: 0, lastWaveform: null },
            { baseNote: 0, baseFreq: 0, instrument: 0, lastWaveform: null },
            { baseNote: 0, baseFreq: 0, instrument: 0, lastWaveform: null }
        ];
    }

    // Start frame engine
    start() {
        if (this.isRunning) {
            console.log('GT2 Frame Engine already running');
            return;
        }

        this.isRunning = true;
        this.lastFrameTime = performance.now();
        this.runFrameLoop();

        console.log(`✅ GT2 Frame Engine started at ${this.frameRate}Hz`);
    }

    // Stop frame engine
    stop() {
        this.isRunning = false;
        if (this.frameId) {
            cancelAnimationFrame(this.frameId);
            this.frameId = null;
        }

        // Reset all voice states
        this.voiceStates.forEach(state => state.reset());

        console.log('GT2 Frame Engine stopped');
    }

    // Main frame loop
    runFrameLoop() {
        if (!this.isRunning) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastFrameTime;

        // Execute frame if enough time has passed
        if (deltaTime >= this.frameInterval) {
            this.executeFrame();
            this.lastFrameTime = currentTime;
        }

        // Schedule next frame
        this.frameId = requestAnimationFrame(() => this.runFrameLoop());
    }

    // Execute one frame for all active voices
    executeFrame() {
        let anyActive = false;

        for (let voice = 0; voice < 3; voice++) {
            const state = this.voiceStates[voice];
            const params = this.voiceParams[voice];

            // Execute wavetable
            if (state.waveActive) {
                anyActive = true;
                const waveResult = state.executeWavetable(gt2TableManager, params.baseNote);
                if (waveResult) {
                    // Apply waveform EVERY frame like GoatTracker does (sidreg[0x4] = wave & gate)
                    console.log(`📊 V${voice} Wave: waveform=0x${waveResult.wave.toString(16)}, note=${waveResult.note}, pos=${state.wavePos}`);
                    this.applyWaveformChange(voice, waveResult, params);
                }
            }

            // Execute pulsetable
            if (state.pulseActive) {
                anyActive = true;
                const pulseValue = state.executePulsetable(gt2TableManager);
                console.log(`📊 V${voice} Pulse: $${pulseValue.toString(16).padStart(3, '0')}`);
                this.applyPulseChange(voice, pulseValue);
            }

            // Execute filtertable
            if (state.filterActive) {
                anyActive = true;
                const filterValue = state.executeFiltertable(gt2TableManager);
                console.log(`📊 V${voice} Filter: $${filterValue.toString(16).padStart(3, '0')}`);
                this.applyFilterChange(voice, filterValue);
            }

            // Execute speedtable (affects sequencer timing)
            if (state.speedActive) {
                anyActive = true;
                const speedValue = state.executeSpeedtable(gt2TableManager);
                // Speed changes would be communicated to sequencer
                if (window.gt2SpeedCallback) {
                    window.gt2SpeedCallback(voice, speedValue);
                }
            }

            // Execute Pattern Command Realtime Effects (Portamento, Vibrato)
            // We pass tick=1 because tick 0 is handled by sequencer-gt2.js
            patternCommandEngine.updateRealtimeEffects(voice, 1);
            // Check if effects are active to keep engine running/logging
            if (patternCommandEngine.voiceStates[voice].activeCommand > 0) {
                anyActive = true;
            }
        }

        // Auto-stop if nothing is active
        if (!anyActive && this.isRunning) {
            console.log('⏸️ GT2 Frame Engine: No active tables, pausing...');
        }
    }

    // Apply waveform changes from wavetable
    applyWaveformChange(voice, waveResult, params) {
        // GT2 tables store waveform WITH gate bit (like 0x21, 0x41, etc.)
        // Write EVERY frame like GoatTracker: sidreg[0x4+7*c] = cptr->wave & cptr->gate
        setSIDRegister(voice, 4, waveResult.wave);
        console.log(`🎛️ Setting waveform 0x${waveResult.wave.toString(16)} on voice ${voice}`);
        params.lastWaveform = waveResult.wave;

        // Calculate and set frequency based on note offset
        if (waveResult.note !== undefined) {
            let targetNote = params.baseNote;

            if (waveResult.absolute) {
                // Absolute note (overrides base note)
                targetNote = waveResult.note;
            } else {
                // Relative note offset
                targetNote = params.baseNote + waveResult.note;
            }

            // Convert note to frequency
            const frequency = this.noteToFrequency(targetNote);
            const sidFreq = Math.round(frequency * 16.777216); // C64 frequency conversion

            setSIDRegister(voice, 0, sidFreq & 0xFF);        // Freq low (register 0)
            setSIDRegister(voice, 1, (sidFreq >> 8) & 0xFF); // Freq high (register 1)

            console.log(`🎛️ Setting frequency ${frequency.toFixed(2)}Hz (note ${targetNote}) on voice ${voice}`);
        }
    }

    // Apply pulse width changes from pulsetable
    applyPulseChange(voice, pulseValue) {
        setSIDRegister(voice, 2, pulseValue & 0xFF);        // PW low (register 2)
        setSIDRegister(voice, 3, (pulseValue >> 8) & 0x0F); // PW high (register 3, 4 bits)
    }

    // Apply filter changes from filtertable
    applyFilterChange(voice, filterValue) {
        // Filter is global in SID, but we apply it if this voice is using it
        setGlobalSIDRegister(0x15, filterValue & 0x07);           // Filter cutoff low 3 bits
        setGlobalSIDRegister(0x16, (filterValue >> 3) & 0xFF);    // Filter cutoff high 8 bits
    }

    // Start tables for a voice (called when note is triggered)
    triggerNoteTables(voice, baseNote, instrument) {
        const state = this.voiceStates[voice];
        const params = this.voiceParams[voice];

        // Store base note and instrument
        params.baseNote = baseNote;
        params.instrument = instrument;

        // Check if instrument has table assignments
        // Tables use 1-based pointers (0 = no table, 1+ = position in table array)
        if (instrument && instrument.tables) {
            const tables = instrument.tables;

            state.startTables(
                tables.wave || 0,
                tables.pulse || 0,
                tables.filter || 0,
                tables.speed || 0
            );

            console.log(`🎵 GT2 Frame Engine: Triggered tables for voice ${voice} - wave:${tables.wave}, pulse:${tables.pulse}, filter:${tables.filter}, speed:${tables.speed}`);
        }

        // Ensure frame engine is running
        if (!this.isRunning) {
            this.start();
        }
    }

    // Stop tables for a voice (called on note off)
    stopVoiceTables(voice) {
        this.voiceStates[voice].reset();
        this.voiceParams[voice] = { baseNote: 0, baseFreq: 0, instrument: 0 };
    }

    // Note to frequency conversion (equal temperament, A4=440Hz)
    noteToFrequency(note) {
        // note 0 = C-0
        // A4 = note 57 (A-4)
        return 440 * Math.pow(2, (note - 57) / 12);
    }

    // Set frame rate (PAL/NTSC)
    setFrameRate(rate) {
        this.frameRate = rate;
        this.frameInterval = 1000 / rate;
        console.log(`Frame rate set to ${rate}Hz (${rate === 50 ? 'PAL' : 'NTSC'})`);
    }

    // Get current frame rate
    getFrameRate() {
        return this.frameRate;
    }
}

// Global frame engine instance
export const gt2FrameEngine = new GT2FrameEngine(PAL_FRAME_RATE);

// Expose globally for worklet communication
if (typeof window !== 'undefined') {
    window.gt2FrameEngine = gt2FrameEngine;
}

// Export frame rates for UI
export { PAL_FRAME_RATE, NTSC_FRAME_RATE };
