// gt2-frame-engine.js - GoatTracker2 frame-based table execution engine

import { gt2TableManager, GT2TablePlaybackState, TABLE_TYPES } from './table-manager-gt2.js';
import { setSIDRegister, setGlobalSIDRegister } from './synth.js';
import { patternCommandEngine } from './pattern-commands.js';

// Frame timing constants
const PAL_FRAME_RATE = 50;   // Hz (C64 PAL)
const NTSC_FRAME_RATE = 60;  // Hz (C64 NTSC)

// GT2 frequency tables (copied from gplay.c) - used for accurate note-to-frequency conversion
const freqtbllo = [
  0x17,0x27,0x39,0x4b,0x5f,0x74,0x8a,0xa1,0xba,0xd4,0xf0,0x0e,
  0x2d,0x4e,0x71,0x96,0xbe,0xe8,0x14,0x43,0x74,0xa9,0xe1,0x1c,
  0x5a,0x9c,0xe2,0x2d,0x7c,0xd1,0x28,0x85,0xe8,0x52,0xc1,0x37,
  0xb4,0x39,0xc5,0x5a,0xf9,0xa2,0x51,0x0b,0xd0,0xa4,0x82,0x6f,
  0x69,0x72,0x8a,0xb3,0xf2,0x44,0xa2,0x16,0xa1,0x48,0x04,0xdf,
  0xd2,0xe5,0x14,0x67,0xe4,0x88,0x45,0x2c,0x41,0x90,0x09,0xbe,
  0xa4,0xca,0x29,0xce,0xc8,0x10,0x8a,0x59,0x83,0x20,0x12,0x7c,
  0x48,0x94,0x53,0x9c,0x90,0x20,0x14,0xb1,0x06,0x3f,0x23,0xf8
];

const freqtblhi = [
  0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x02,
  0x02,0x02,0x02,0x02,0x02,0x02,0x03,0x03,0x03,0x03,0x03,0x04,
  0x04,0x04,0x04,0x05,0x05,0x05,0x06,0x06,0x06,0x07,0x07,0x08,
  0x08,0x09,0x09,0x0a,0x0a,0x0b,0x0c,0x0d,0x0d,0x0e,0x0f,0x10,
  0x11,0x12,0x13,0x14,0x15,0x17,0x18,0x1a,0x1b,0x1d,0x1f,0x20,
  0x22,0x24,0x26,0x29,0x2b,0x2e,0x31,0x34,0x37,0x3a,0x3e,0x41,
  0x45,0x49,0x4d,0x52,0x57,0x5c,0x62,0x68,0x6e,0x75,0x7c,0x83,
  0x8b,0x93,0x9c,0xa5,0xaf,0xb9,0xc4,0xd0,0xdd,0xea,0xf8,0xff
];

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
                    console.log(`📊 V${voice} Wave: waveform=0x${waveResult.wave.toString(16)}, note=${waveResult.note}, pos=${state.ptr[TABLE_TYPES.WAVE]}`);
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
                // Absolute note (from wavetable, already 0-based)
                targetNote = waveResult.note & 0x7F;
            } else {
                // Relative note offset - GT2 uses addition with overflow mask
                targetNote = (params.baseNote + waveResult.note) & 0x7F;
            }

            // Clamp to valid GT2 note range (0-95)
            targetNote = Math.min(Math.max(targetNote, 0), 95);

            // Use GT2 frequency tables (not mathematical calculation)
            const sidFreq = freqtbllo[targetNote] | (freqtblhi[targetNote] << 8);

            setSIDRegister(voice, 0, sidFreq & 0xFF);        // Freq low (register 0)
            setSIDRegister(voice, 1, (sidFreq >> 8) & 0xFF); // Freq high (register 1)

            console.log(`🎛️ Setting freq from GT2 tables: note=${targetNote}, freq=0x${sidFreq.toString(16)} on voice ${voice}`);
        }
    }

    // Apply pulse width changes from pulsetable
    applyPulseChange(voice, pulseValue) {
        setSIDRegister(voice, 2, pulseValue & 0xFF);        // PW low (register 2)
        setSIDRegister(voice, 3, (pulseValue >> 8) & 0x0F); // PW high (register 3, 4 bits)
    }

    // Apply filter changes from filtertable
    // GT2 gplay.c lines 301-304 (FILTERSTOP): writes all 4 filter registers every frame
    applyFilterChange(voice, filterResult) {
        if (typeof filterResult === 'object') {
            setGlobalSIDRegister(0x15, 0x00);                              // GT2 always writes 0
            setGlobalSIDRegister(0x16, filterResult.cutoff & 0xFF);       // 8-bit cutoff
            setGlobalSIDRegister(0x17, filterResult.ctrl & 0xFF);         // Resonance + routing
            // Preserve volume from register 0x18
            const currentVol = 0x0F; // Default max volume
            setGlobalSIDRegister(0x18, (filterResult.type & 0x70) | currentVol); // Filter type + volume
        } else {
            // Legacy: simple cutoff value
            setGlobalSIDRegister(0x15, 0x00);
            setGlobalSIDRegister(0x16, filterResult & 0xFF);
        }
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
