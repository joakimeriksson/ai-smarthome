// pattern-commands.js - GoatTracker2 Pattern Command Engine
// Implements all 16 pattern commands (0XY-FXY) with GT2-compatible behavior

import { setGlobalSIDRegister, instruments, sidPlayer } from './synth.js';
import { gt2TableManager, TABLE_TYPES } from './table-manager-gt2.js';
import { tempoControl } from './tempo-control.js';

const NUM_VOICES = 3;

/**
 * Pattern Command Engine
 * Executes GoatTracker2 pattern commands with tick-based timing
 */
export class PatternCommandEngine {
    constructor() {
        // Per-voice command state
        this.voiceStates = Array(NUM_VOICES).fill(null).map(() => ({
            // Realtime command tracking
            activeCommand: 0,           // Current command (0-F)
            commandData: 0,             // Command parameter

            // Portamento state
            portamentoSpeed: 0,         // 16-bit signed speed
            portamentoActive: false,

            // Toneportamento state
            toneportaActive: false,
            toneportaTarget: 0,         // Target frequency
            toneportaSpeed: 0,          // Speed from speedtable

            // Vibrato state
            vibratoActive: false,
            vibratoSpeed: 0,            // How fast vibrato oscillates
            vibratoDepth: 0,            // How much pitch change
            vibratoPhase: 0,            // Current phase (0 to vibratoSpeed*2)
            vibratoDirection: 1,        // 1 = up, -1 = down

            // Current frequency tracking
            baseFrequency: 0,           // Base frequency without modulation
            currentFrequency: 0,        // Current modulated frequency

            // Table pointers (for 8XY, 9XY, AXY commands)
            wavetablePtr: 0,
            pulsetablePtr: 0,
            filtertablePtr: 0,

            // Funktempo state
            funktempo: false,
            funktempoValues: [0, 0],    // Two alternating tempo values
            funktempoIndex: 0,          // Which value to use
        }));

        // Global state
        this.masterVolume = 15;         // Default max volume
        this.globalTempo = 6;           // Default tempo (in ticks per row)
        this.funktempoActive = false;   // Global funktempo state

        // Optimization flags (command line options in GT2)
        this.pulseOptimization = true;  // Skip pulse on tick 0 (/O)
        this.realtimeOptimization = true; // Skip realtime on tick 0 (/R)
    }

    /**
     * Execute a pattern command at the current tick
     * @param {number} voice - Voice index (0-2)
     * @param {number} command - Command number (0x0-0xF)
     * @param {number} data - Command parameter (0x00-0xFF)
     * @param {number} tick - Current tick in pattern row
     * @param {number} frequency - Current note frequency (for toneportamento)
     */
    executeCommand(voice, command, data, tick, frequency = 0) {
        const state = this.voiceStates[voice];

        // Skip realtime commands on tick 0 if optimization enabled
        if (tick === 0 && this.realtimeOptimization && command >= 0x1 && command <= 0x4) {
            // Store command for subsequent ticks
            state.activeCommand = command;
            state.commandData = data;
            return;
        }

        // Execute command based on type
        switch (command) {
            case 0x0: return this.cmd0_doNothing(voice, data);
            case 0x1: return this.cmd1_portamentoUp(voice, data, tick);
            case 0x2: return this.cmd2_portamentoDown(voice, data, tick);
            case 0x3: return this.cmd3_toneportamento(voice, data, tick, frequency);
            case 0x4: return this.cmd4_vibrato(voice, data, tick);
            case 0x5: return this.cmd5_setAttackDecay(voice, data);
            case 0x6: return this.cmd6_setSustainRelease(voice, data);
            case 0x7: return this.cmd7_setWaveform(voice, data);
            case 0x8: return this.cmd8_setWavetablePtr(voice, data);
            case 0x9: return this.cmd9_setPulsetablePtr(voice, data);
            case 0xA: return this.cmdA_setFiltertablePtr(voice, data);
            case 0xB: return this.cmdB_setFilterControl(voice, data);
            case 0xC: return this.cmdC_setFilterCutoff(voice, data);
            case 0xD: return this.cmdD_setMasterVolume(voice, data);
            case 0xE: return this.cmdE_funktempo(voice, data);
            case 0xF: return this.cmdF_setTempo(voice, data);
            default:
                console.warn(`Unknown command: ${command.toString(16)} ${data.toString(16)}`);
        }
    }

    /**
     * Update realtime effects on each tick (called for active realtime commands)
     * @param {number} voice - Voice index
     * @param {number} tick - Current tick
     */
    updateRealtimeEffects(voice, tick) {
        const state = this.voiceStates[voice];

        // Execute active realtime command
        if (state.activeCommand >= 0x1 && state.activeCommand <= 0x4) {
            this.executeCommand(voice, state.activeCommand, state.commandData, tick);
        }
    }

    /**
     * Stop realtime effects on a voice (when command 0 or new note encountered)
     * @param {number} voice - Voice index
     */
    stopRealtimeEffects(voice) {
        const state = this.voiceStates[voice];
        state.activeCommand = 0;
        state.portamentoActive = false;
        state.toneportaActive = false;
        state.vibratoActive = false;
    }

    /**
     * Set base frequency for a voice (when new note plays)
     * @param {number} voice - Voice index
     * @param {number} frequency - Frequency in Hz
     */
    setBaseFrequency(voice, frequency) {
        const state = this.voiceStates[voice];
        state.baseFrequency = frequency;
        state.currentFrequency = frequency;
    }

    // ============================================================================
    // COMMAND IMPLEMENTATIONS
    // ============================================================================

    /**
     * Command 0XY: Do nothing (empty command)
     */
    cmd0_doNothing(voice, data) {
        // Stop any active realtime effects
        this.stopRealtimeEffects(voice);
    }

    /**
     * Command 1XY: Portamento up
     * XY is index to speedtable (16-bit speed value)
     */
    cmd1_portamentoUp(voice, speedtableIndex, tick) {
        const state = this.voiceStates[voice];

        if (tick === 0 && this.realtimeOptimization) {
            // Just store for next tick
            return;
        }

        // Read speedtable entry (16-bit value)
        const speed = this.readSpeedtable16bit(speedtableIndex);

        if (speed === 0) {
            state.portamentoActive = false;
            return;
        }

        // Enable portamento and increase frequency
        state.portamentoActive = true;
        state.portamentoSpeed = speed;

        // Add to current frequency (frequency is in Hz, speed is in SID freq units)
        // GT2 adds directly to 16-bit SID frequency registers
        // We need to convert: SID freq units to Hz adjustment
        const hzAdjustment = this.sidFreqUnitsToHz(speed);
        state.currentFrequency += hzAdjustment;

        // Apply frequency to SID
        this.applyFrequencyToSID(voice, state.currentFrequency);
    }

    /**
     * Command 2XY: Portamento down
     * XY is index to speedtable (16-bit speed value)
     */
    cmd2_portamentoDown(voice, speedtableIndex, tick) {
        const state = this.voiceStates[voice];

        if (tick === 0 && this.realtimeOptimization) {
            return;
        }

        // Read speedtable entry (16-bit value)
        const speed = this.readSpeedtable16bit(speedtableIndex);

        if (speed === 0) {
            state.portamentoActive = false;
            return;
        }

        // Enable portamento and decrease frequency
        state.portamentoActive = true;
        state.portamentoSpeed = -speed; // Negative for down

        // Subtract from current frequency
        const hzAdjustment = this.sidFreqUnitsToHz(speed);
        state.currentFrequency -= hzAdjustment;

        // Apply frequency to SID
        this.applyFrequencyToSID(voice, state.currentFrequency);
    }

    /**
     * Command 3XY: Toneportamento (slide to target note)
     * XY is speedtable index, or 00 for instant tie-note
     */
    cmd3_toneportamento(voice, speedtableIndex, tick, targetFrequency) {
        const state = this.voiceStates[voice];

        // Special case: 3 00 = instant tie-note (jump to target)
        if (speedtableIndex === 0) {
            state.currentFrequency = targetFrequency;
            state.baseFrequency = targetFrequency;
            this.applyFrequencyToSID(voice, targetFrequency);
            state.toneportaActive = false;
            return;
        }

        if (tick === 0 && this.realtimeOptimization) {
            // Set target and store for next tick
            state.toneportaTarget = targetFrequency;
            return;
        }

        // Read speedtable entry
        const speed = this.readSpeedtable16bit(speedtableIndex);

        if (speed === 0) {
            state.toneportaActive = false;
            return;
        }

        // Activate toneportamento
        state.toneportaActive = true;
        state.toneportaTarget = targetFrequency;
        state.toneportaSpeed = speed;

        // Calculate direction and apply portamento
        const hzAdjustment = this.sidFreqUnitsToHz(speed);

        if (state.currentFrequency < targetFrequency) {
            // Slide up
            state.currentFrequency += hzAdjustment;
            if (state.currentFrequency > targetFrequency) {
                state.currentFrequency = targetFrequency;
                state.toneportaActive = false;
            }
        } else if (state.currentFrequency > targetFrequency) {
            // Slide down
            state.currentFrequency -= hzAdjustment;
            if (state.currentFrequency < targetFrequency) {
                state.currentFrequency = targetFrequency;
                state.toneportaActive = false;
            }
        }

        // Apply frequency to SID
        this.applyFrequencyToSID(voice, state.currentFrequency);
    }

    /**
     * Command 4XY: Vibrato
     * XY is index to speedtable (left=speed, right=depth)
     */
    cmd4_vibrato(voice, speedtableIndex, tick) {
        const state = this.voiceStates[voice];

        if (tick === 0 && this.realtimeOptimization) {
            return;
        }

        // Read speedtable entry (dual-byte format)
        const speedtableEntry = this.readSpeedtableDual(speedtableIndex);
        const speed = speedtableEntry.left;   // How fast vibrato oscillates
        const depth = speedtableEntry.right;  // How much pitch change

        if (speed === 0 || depth === 0) {
            state.vibratoActive = false;
            return;
        }

        // Check for note-independent mode (high bit set)
        const noteIndependent = (speed & 0x80) !== 0;

        if (noteIndependent) {
            // Note-independent vibrato: scale depth by frequency
            // This makes vibrato sound consistent across different notes
            const actualSpeed = speed & 0x7F;
            let actualDepth = depth;

            // Get current frequency for scaling
            const currentFreq = state.currentFrequency || 0;
            if (currentFreq > 0 && depth > 0) {
                const divisor = currentFreq >> depth;
                if (divisor > 0) {
                    actualDepth = Math.max(1, Math.floor(256 / divisor));
                }
            }

            state.vibratoSpeed = actualSpeed;
            state.vibratoDepth = actualDepth;
        } else {
            // Standard vibrato
            state.vibratoSpeed = speed;
            state.vibratoDepth = depth;
        }

        state.vibratoActive = true;

        // Update vibrato phase
        state.vibratoPhase++;
        if (state.vibratoPhase >= state.vibratoSpeed) {
            state.vibratoPhase = 0;
            state.vibratoDirection = -state.vibratoDirection; // Toggle direction
        }

        // Apply vibrato modulation to frequency
        const hzAdjustment = this.sidFreqUnitsToHz(state.vibratoDepth) * state.vibratoDirection;
        state.currentFrequency = state.baseFrequency + hzAdjustment;

        // Apply frequency to SID
        this.applyFrequencyToSID(voice, state.currentFrequency);
    }

    /**
     * Command 5XY: Set attack/decay register
     */
    cmd5_setAttackDecay(voice, value) {
        // Set SID attack/decay register (voice * 7 + 5)
        const register = voice * 7 + 5;
        sidPlayer.synth.poke(register, value);
    }

    /**
     * Command 6XY: Set sustain/release register
     */
    cmd6_setSustainRelease(voice, value) {
        // Set SID sustain/release register (voice * 7 + 6)
        const register = voice * 7 + 6;
        sidPlayer.synth.poke(register, value);
    }

    /**
     * Command 7XY: Set waveform register
     * May be ineffective if wavetable is actively changing waveform
     */
    cmd7_setWaveform(voice, value) {
        // Set SID waveform register (voice * 7 + 4)
        const register = voice * 7 + 4;
        sidPlayer.synth.poke(register, value);
    }

    /**
     * Command 8XY: Set wavetable pointer
     * $00 stops wavetable execution
     */
    cmd8_setWavetablePtr(voice, ptr) {
        const state = this.voiceStates[voice];
        state.wavetablePtr = ptr;

        if (ptr === 0) {
            // Stop wavetable execution
            // This should be communicated to the frame engine
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.stopTable(voice, TABLE_TYPES.WAVE);
            }
        } else {
            // Start wavetable execution at new position
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.setTablePosition(voice, TABLE_TYPES.WAVE, ptr);
            }
        }
    }

    /**
     * Command 9XY: Set pulsetable pointer
     * $00 stops pulsetable execution
     */
    cmd9_setPulsetablePtr(voice, ptr) {
        const state = this.voiceStates[voice];
        state.pulsetablePtr = ptr;

        if (ptr === 0) {
            // Stop pulsetable execution
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.stopTable(voice, TABLE_TYPES.PULSE);
            }
        } else {
            // Start pulsetable execution at new position
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.setTablePosition(voice, TABLE_TYPES.PULSE, ptr);
            }
        }
    }

    /**
     * Command AXY: Set filtertable pointer
     * $00 stops filtertable execution
     */
    cmdA_setFiltertablePtr(voice, ptr) {
        const state = this.voiceStates[voice];
        state.filtertablePtr = ptr;

        if (ptr === 0) {
            // Stop filtertable execution
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.stopTable(voice, TABLE_TYPES.FILTER);
            }
        } else {
            // Start filtertable execution at new position
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.setTablePosition(voice, TABLE_TYPES.FILTER, ptr);
            }
        }
    }

    /**
     * Command BXY: Set filter control
     * X = resonance (0-F), Y = channel bitmask (0-7)
     * $00 turns filter off and stops filtertable execution
     */
    cmdB_setFilterControl(voice, value) {
        if (value === 0) {
            // Turn off filter completely
            setGlobalSIDRegister(0x17, 0x00); // Resonance = 0, no voices filtered
            setGlobalSIDRegister(0x18, 0x00); // Filter off

            // Stop filtertable execution
            if (window.gt2FrameEngine) {
                window.gt2FrameEngine.stopTable(voice, TABLE_TYPES.FILTER);
            }
        } else {
            // Set resonance and channel bitmask
            const resonance = (value >> 4) & 0x0F;  // High nibble
            const channelMask = value & 0x07;        // Low 3 bits

            // Resonance in bits 4-7, channel mask in bits 0-2
            const registerValue = (resonance << 4) | channelMask;
            setGlobalSIDRegister(0x17, registerValue);
        }
    }

    /**
     * Command CXY: Set filter cutoff
     * May be ineffective if filtertable is actively changing cutoff
     */
    cmdC_setFilterCutoff(voice, value) {
        // Filter cutoff is 11-bit across two registers
        // Value is 8-bit, so use as high 8 bits
        setGlobalSIDRegister(0x15, 0x00);        // Low 3 bits = 0
        setGlobalSIDRegister(0x16, value);       // High 8 bits
    }

    /**
     * Command DXY: Set master volume / timing mark
     * If X is $0, set master volume to Y
     * If X is not $0, copy XY to timing mark location (playeraddress+$3F)
     */
    cmdD_setMasterVolume(voice, value) {
        const highNibble = (value >> 4) & 0x0F;
        const lowNibble = value & 0x0F;

        if (highNibble === 0) {
            // Set master volume
            this.masterVolume = lowNibble;

            // Apply to SID register $18 (filter mode + volume)
            const currentFilter = sidPlayer.synth.peek(0x18) & 0xF0;
            setGlobalSIDRegister(0x18, currentFilter | lowNibble);
        } else {
            // Timing mark - not applicable in browser implementation
            // This was used for synchronization in C64 player
            console.log(`Timing mark: ${value.toString(16)}`);
        }
    }

    /**
     * Command EXY: Funktempo
     * XY is index to speedtable (left=tempo1, right=tempo2)
     * Tempos alternate on subsequent pattern rows
     */
    cmdE_funktempo(voice, speedtableIndex) {
        // Read speedtable entry
        const speedtableEntry = this.readSpeedtableDual(speedtableIndex);

        this.funktempoActive = true;
        this.voiceStates.forEach(state => {
            state.funktempo = true;
            state.funktempoValues = [speedtableEntry.left, speedtableEntry.right];
            state.funktempoIndex = 0; // Start with first tempo
        });
    }

    /**
     * Command FXY: Set tempo
     * Values $03-$7F set tempo on all channels
     * Values $83-$FF set tempo only on current channel (subtract $80)
     * Tempos $00-$01 recall funktempo values
     */
    cmdF_setTempo(voice, value) {
        if (value === 0x00 || value === 0x01) {
            // Recall funktempo value (if funktempo is active)
            const state = this.voiceStates[voice];
            if (state.funktempo) {
                const tempo = state.funktempoValues[value];
                // Set tempo for this voice only
                // TODO: Implement per-voice tempo in sequencer
                tempoControl.setTempo(tempo * 10); // Convert GT2 tempo to BPM (rough)
            }
        } else if (value >= 0x03 && value <= 0x7F) {
            // Set global tempo
            this.globalTempo = value;
            tempoControl.setTempo(value * 10); // Convert GT2 tempo to BPM (rough)
        } else if (value >= 0x83 && value <= 0xFF) {
            // Set tempo only on current channel
            const channelTempo = value - 0x80;
            // TODO: Implement per-voice tempo in sequencer
            console.log(`Per-voice tempo for voice ${voice}: ${channelTempo}`);
        }
    }

    // ============================================================================
    // HELPER FUNCTIONS
    // ============================================================================

    /**
     * Read 16-bit value from speedtable (for portamento)
     * @param {number} index - Speedtable index
     * @returns {number} 16-bit speed value
     */
    readSpeedtable16bit(index) {
        if (index === 0) return 0;

        const left = gt2TableManager.getTableValue(TABLE_TYPES.SPEED, index, true);
        const right = gt2TableManager.getTableValue(TABLE_TYPES.SPEED, index, false);

        // Combine into 16-bit value (left = MSB, right = LSB)
        return (left << 8) | right;
    }

    /**
     * Read dual-byte value from speedtable (for vibrato/funktempo)
     * @param {number} index - Speedtable index
     * @returns {object} {left, right}
     */
    readSpeedtableDual(index) {
        if (index === 0) return { left: 0, right: 0 };

        const left = gt2TableManager.getTableValue(TABLE_TYPES.SPEED, index, true);
        const right = gt2TableManager.getTableValue(TABLE_TYPES.SPEED, index, false);

        return { left, right };
    }

    /**
     * Convert SID frequency units to Hz adjustment
     * SID frequency register is 16-bit, range 0-65535
     * Frequency formula: Hz = (register * clockFreq) / (16777216)
     * For PAL C64: clockFreq = 985248 Hz
     */
    sidFreqUnitsToHz(sidUnits) {
        const PAL_CLOCK = 985248;
        return (sidUnits * PAL_CLOCK) / 16777216;
    }

    /**
     * Apply frequency to SID registers
     * @param {number} voice - Voice index (0-2)
     * @param {number} frequencyHz - Frequency in Hz
     */
    applyFrequencyToSID(voice, frequencyHz) {
        // Convert Hz to SID frequency units
        const PAL_CLOCK = 985248;
        const sidFreq = Math.round((frequencyHz * 16777216) / PAL_CLOCK);

        // Clamp to 16-bit range
        const clampedFreq = Math.max(0, Math.min(65535, sidFreq));

        // Split into low and high bytes
        const freqLo = clampedFreq & 0xFF;
        const freqHi = (clampedFreq >> 8) & 0xFF;

        // Write to SID registers (voice * 7 + 0 and voice * 7 + 1)
        sidPlayer.synth.poke(voice * 7 + 0, freqLo);
        sidPlayer.synth.poke(voice * 7 + 1, freqHi);
    }
}

// Create singleton instance
export const patternCommandEngine = new PatternCommandEngine();
