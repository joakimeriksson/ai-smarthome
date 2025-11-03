// table-manager-gt2.js - 100% GoatTracker2-compatible table system

// Table types matching GoatTracker2
export const TABLE_TYPES = {
    WAVE: 0,    // WTBL - Waveform + arpeggio
    PULSE: 1,   // PTBL - Pulse width modulation
    FILTER: 2,  // FTBL - Filter automation
    SPEED: 3    // STBL - Speed/tempo automation
};

export const TABLE_NAMES = ['WTBL', 'PTBL', 'FTBL', 'STBL'];
export const MAX_TABLELEN = 255;  // Maximum table length (matching GT2)
export const MAX_TABLES = 4;      // 4 table types

// GoatTracker2 table manager - ONE large array per table type
export class GT2TableManager {
    constructor() {
        // Initialize large table arrays (matching GoatTracker2 exactly)
        // Each table type has ONE array of 255 entries
        this.ltable = []; // Left bytes (commands/waveforms)
        this.rtable = []; // Right bytes (parameters/notes)

        for (let i = 0; i < MAX_TABLES; i++) {
            this.ltable[i] = new Array(MAX_TABLELEN).fill(0);
            this.rtable[i] = new Array(MAX_TABLELEN).fill(0);
        }

        this.initializeDefaultTables();
    }

    initializeDefaultTables() {
        // WTBL: Simple sawtooth arpeggio starting at position 1 (GT2 style, 0 = no table)
        const wtbl = TABLE_TYPES.WAVE;
        this.ltable[wtbl][1] = 0x21;  // Sawtooth + gate, base note
        this.rtable[wtbl][1] = 0x00;
        this.ltable[wtbl][2] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][2] = 0x80;  // Keep freq
        this.ltable[wtbl][3] = 0x21;  // Sawtooth + gate, +4 semitones
        this.rtable[wtbl][3] = 0x04;
        this.ltable[wtbl][4] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][4] = 0x80;
        this.ltable[wtbl][5] = 0x21;  // Sawtooth + gate, +7 semitones
        this.rtable[wtbl][5] = 0x07;
        this.ltable[wtbl][6] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][6] = 0x80;
        this.ltable[wtbl][7] = 0xFF;  // Jump to position 1
        this.rtable[wtbl][7] = 0x01;

        // PTBL: PWM sweep at position 0
        const ptbl = TABLE_TYPES.PULSE;
        this.ltable[ptbl][0] = 0x88;  // Set pulse $800
        this.rtable[ptbl][0] = 0x00;
        this.ltable[ptbl][1] = 0x20;  // 32 ticks, speed +$40
        this.rtable[ptbl][1] = 0x40;
        this.ltable[ptbl][2] = 0x40;  // 64 ticks, speed -$20
        this.rtable[ptbl][2] = 0xE0;
        this.ltable[ptbl][3] = 0xFF;  // Jump to position 1
        this.rtable[ptbl][3] = 0x01;

        // FTBL: Filter sweep at position 0
        const ftbl = TABLE_TYPES.FILTER;
        this.ltable[ftbl][0] = 0x80;  // Set filter $010
        this.rtable[ftbl][0] = 0x10;
        this.ltable[ftbl][1] = 0x40;  // 64 ticks, speed +$20
        this.rtable[ftbl][1] = 0x20;
        this.ltable[ftbl][2] = 0xFF;  // Jump to position 1
        this.rtable[ftbl][2] = 0x01;

        // STBL: No speed change at position 0
        const stbl = TABLE_TYPES.SPEED;
        this.ltable[stbl][0] = 0x00;  // Speed 1
        this.rtable[stbl][0] = 0x00;
        this.ltable[stbl][1] = 0xFF;  // Stop
        this.rtable[stbl][1] = 0x00;
    }

    // Get entry from table (GoatTracker style: ltable[type][pos], rtable[type][pos])
    getEntry(tableType, position) {
        if (tableType >= 0 && tableType < MAX_TABLES && position >= 0 && position < MAX_TABLELEN) {
            return {
                left: this.ltable[tableType][position],
                right: this.rtable[tableType][position]
            };
        }
        return { left: 0, right: 0 };
    }

    // Set entry in table
    setEntry(tableType, position, leftByte, rightByte) {
        if (tableType >= 0 && tableType < MAX_TABLES && position >= 0 && position < MAX_TABLELEN) {
            this.ltable[tableType][position] = leftByte & 0xFF;
            this.rtable[tableType][position] = rightByte & 0xFF;
        }
    }

    // Import complete table data from GoatTracker (replaces entire table)
    importTable(tableType, leftData, rightData) {
        if (tableType >= 0 && tableType < MAX_TABLES) {
            const len = Math.min(leftData.length, rightData.length, MAX_TABLELEN);

            // Clear table first
            this.ltable[tableType].fill(0);
            this.rtable[tableType].fill(0);

            // Copy data
            for (let i = 0; i < len; i++) {
                this.ltable[tableType][i] = leftData[i] & 0xFF;
                this.rtable[tableType][i] = rightData[i] & 0xFF;
            }

            console.log(`📊 Imported ${TABLE_NAMES[tableType]}: ${len} entries`);
        }
    }

    // Export complete table data
    exportTable(tableType) {
        if (tableType >= 0 && tableType < MAX_TABLES) {
            return {
                type: tableType,
                leftData: [...this.ltable[tableType]],
                rightData: [...this.rtable[tableType]]
            };
        }
        return null;
    }

    // Clear entire table
    clearTable(tableType) {
        if (tableType >= 0 && tableType < MAX_TABLES) {
            this.ltable[tableType].fill(0);
            this.rtable[tableType].fill(0);
        }
    }
}

// Table execution state for each voice (matches GoatTracker CHN struct)
export class GT2TablePlaybackState {
    constructor() {
        this.reset();
    }

    reset() {
        // Table positions (ptr[WTBL], ptr[PTBL], ptr[FTBL], ptr[STBL] in GT2)
        this.ptr = [0, 0, 0, 0];

        // Delay/time counters (wavetime, pulsetime, etc.)
        this.wavetime = 0;
        this.pulsetime = 0;
        this.filtertime = 0;
        this.speedtime = 0;

        // Current values
        this.wave = 0;
        this.note = 0;
        this.pulse = 0x800;
        this.filter = 0;
        this.speed = 1;

        // Pulse/filter modulation state
        this.pulseModSpeed = 0;
        this.pulseModTicks = 0;
        this.filterModSpeed = 0;
        this.filterModTicks = 0;

        // Active flags
        this.waveActive = false;
        this.pulseActive = false;
        this.filterActive = false;
        this.speedActive = false;
    }

    // Execute wavetable step (matches GT2 gplay.c wavetable logic)
    executeWavetable(tableManager, baseNote) {
        if (!this.waveActive || this.ptr[TABLE_TYPES.WAVE] === 0) return null;

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.WAVE];
            const entry = tableManager.getEntry(TABLE_TYPES.WAVE, pos);
            const left = entry.left;
            const right = entry.right;

            // Delay handling (0x01-0x0F)
            if (left >= 0x01 && left <= 0x0F) {
                if (this.wavetime !== left) {
                    this.wavetime++;
                    return { wave: this.wave, note: this.note, changed: false };
                }
                this.wavetime = 0;
                this.ptr[TABLE_TYPES.WAVE]++;
                return { wave: this.wave, note: this.note, changed: false };
            }

            // Waveform change (0x10-0xDF)
            if (left >= 0x10 && left <= 0xDF) {
                this.wave = left;

                // Parse note parameter
                if (right >= 0x00 && right <= 0x5F) {
                    this.note = right; // Relative note
                } else if (right >= 0x60 && right <= 0x7F) {
                    this.note = -(right - 0x60); // Negative offset
                } else if (right === 0x80) {
                    // Keep frequency unchanged
                } else if (right >= 0x81 && right <= 0xDF) {
                    this.note = right - 0x81; // Absolute note
                }

                this.ptr[TABLE_TYPES.WAVE]++;
                return { wave: this.wave, note: this.note, absolute: right >= 0x81, changed: true };
            }

            // Silent waveform (0xE0-0xEF)
            if (left >= 0xE0 && left <= 0xEF) {
                this.wave = (left & 0x0F) | 0x08;
                this.ptr[TABLE_TYPES.WAVE]++;
                return { wave: this.wave, note: this.note, changed: true };
            }

            // Jump (0xFF)
            if (left === 0xFF) {
                if (right === 0x00 || right >= MAX_TABLELEN) {
                    this.waveActive = false;
                    return null;
                }
                this.ptr[TABLE_TYPES.WAVE] = right;
                jumpCount++;
                continue; // Process jump target
            }

            // Unknown/end
            this.ptr[TABLE_TYPES.WAVE]++;
            return { wave: this.wave, note: this.note, changed: false };
        }

        if (jumpCount >= MAX_JUMPS) {
            console.warn('Wavetable: Maximum jump limit reached, stopping execution');
            this.waveActive = false;
        }

        return null;
    }

    // Execute pulsetable step
    executePulsetable(tableManager) {
        if (!this.pulseActive || this.ptr[TABLE_TYPES.PULSE] === 0) return this.pulse;

        // Handle ongoing modulation
        if (this.pulseModTicks > 0) {
            this.pulseModTicks--;
            this.pulse = (this.pulse + this.pulseModSpeed) & 0xFFF;
            return this.pulse;
        }

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.PULSE];
            const entry = tableManager.getEntry(TABLE_TYPES.PULSE, pos);
            const left = entry.left;
            const right = entry.right;

            // Modulation (0x01-0x7F)
            if (left >= 0x01 && left <= 0x7F) {
                this.pulseModTicks = left;
                this.pulseModSpeed = (right & 0x80) ? (right - 256) : right;
                this.ptr[TABLE_TYPES.PULSE]++;
                break;
            }
            // Set pulse (0x80-0xFE)
            else if (left >= 0x80 && left <= 0xFE) {
                const highNibble = (left & 0x0F) << 8;
                this.pulse = highNibble | right;
                this.ptr[TABLE_TYPES.PULSE]++;
                break;
            }
            // Jump (0xFF)
            else if (left === 0xFF) {
                if (right === 0x00 || right >= MAX_TABLELEN) {
                    this.pulseActive = false;
                    break;
                }
                this.ptr[TABLE_TYPES.PULSE] = right;
                jumpCount++;
                // Continue loop to process jump target
            }
            else {
                // Unknown command, advance
                this.ptr[TABLE_TYPES.PULSE]++;
                break;
            }
        }

        if (jumpCount >= MAX_JUMPS) {
            console.warn('Pulsetable: Maximum jump limit reached, stopping execution');
            this.pulseActive = false;
        }

        return this.pulse;
    }

    // Execute filtertable step
    executeFiltertable(tableManager) {
        if (!this.filterActive || this.ptr[TABLE_TYPES.FILTER] === 0) return this.filter;

        // Handle ongoing modulation
        if (this.filterModTicks > 0) {
            this.filterModTicks--;
            this.filter = Math.max(0, Math.min(0x7FF, this.filter + this.filterModSpeed));
            return this.filter;
        }

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.FILTER];
            const entry = tableManager.getEntry(TABLE_TYPES.FILTER, pos);
            const left = entry.left;
            const right = entry.right;

            // Modulation (0x01-0x7F)
            if (left >= 0x01 && left <= 0x7F) {
                this.filterModTicks = left;
                this.filterModSpeed = (right & 0x80) ? (right - 256) : right;
                this.ptr[TABLE_TYPES.FILTER]++;
                break;
            }
            // Set filter (0x80-0xFE)
            else if (left >= 0x80 && left <= 0xFE) {
                const highBits = (left & 0x07) << 8;
                this.filter = highBits | right;
                this.ptr[TABLE_TYPES.FILTER]++;
                break;
            }
            // Jump (0xFF)
            else if (left === 0xFF) {
                if (right === 0x00 || right >= MAX_TABLELEN) {
                    this.filterActive = false;
                    break;
                }
                this.ptr[TABLE_TYPES.FILTER] = right;
                jumpCount++;
                continue; // Process jump target
            }
            else {
                // Unknown command
                this.ptr[TABLE_TYPES.FILTER]++;
                break;
            }
        }

        if (jumpCount >= MAX_JUMPS) {
            console.warn('Filtertable: Maximum jump limit reached, stopping execution');
            this.filterActive = false;
        }

        return this.filter;
    }

    // Execute speedtable step
    executeSpeedtable(tableManager) {
        if (!this.speedActive || this.ptr[TABLE_TYPES.SPEED] === 0) return this.speed;

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.SPEED];
            const entry = tableManager.getEntry(TABLE_TYPES.SPEED, pos);
            const left = entry.left;
            const right = entry.right;

            // Jump (0xFF)
            if (left === 0xFF) {
                if (right === 0x00 || right >= MAX_TABLELEN) {
                    this.speedActive = false;
                    break;
                } else {
                    this.ptr[TABLE_TYPES.SPEED] = right;
                    jumpCount++;
                    continue; // Process jump target
                }
            } else {
                this.speed = left || 1;
                this.ptr[TABLE_TYPES.SPEED]++;
                break;
            }
        }

        if (jumpCount >= MAX_JUMPS) {
            console.warn('Speedtable: Maximum jump limit reached, stopping execution');
            this.speedActive = false;
        }

        return this.speed;
    }

    // Start tables from instrument (ptr values are 1-based in GT2, 0 = no table)
    startTables(wavePtr, pulsePtr, filterPtr, speedPtr) {
        if (wavePtr > 0) {
            this.ptr[TABLE_TYPES.WAVE] = wavePtr;
            this.waveActive = true;
            this.wavetime = 0;
        }
        if (pulsePtr > 0) {
            this.ptr[TABLE_TYPES.PULSE] = pulsePtr;
            this.pulseActive = true;
            this.pulsetime = 0;
        }
        if (filterPtr > 0) {
            this.ptr[TABLE_TYPES.FILTER] = filterPtr;
            this.filterActive = true;
            this.filtertime = 0;
        }
        if (speedPtr > 0) {
            this.ptr[TABLE_TYPES.SPEED] = speedPtr;
            this.speedActive = true;
            this.speedtime = 0;
        }
    }
}

// Global GT2 table manager instance
export const gt2TableManager = new GT2TableManager();
