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
        // GT2 convention: pointer 0 = no table, pointer 1 = array[0], pointer 2 = array[1], etc.
        // All sample tables start at array index 0 (GT2 pointer 1)

        // WTBL: Simple sawtooth arpeggio at position 1 (array index 0)
        const wtbl = TABLE_TYPES.WAVE;
        this.ltable[wtbl][0] = 0x21;  // Sawtooth + gate, base note
        this.rtable[wtbl][0] = 0x00;
        this.ltable[wtbl][1] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][1] = 0x80;  // Keep freq
        this.ltable[wtbl][2] = 0x21;  // Sawtooth + gate, +4 semitones
        this.rtable[wtbl][2] = 0x04;
        this.ltable[wtbl][3] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][3] = 0x80;
        this.ltable[wtbl][4] = 0x21;  // Sawtooth + gate, +7 semitones
        this.rtable[wtbl][4] = 0x07;
        this.ltable[wtbl][5] = 0x08;  // Delay 8 frames
        this.rtable[wtbl][5] = 0x80;
        this.ltable[wtbl][6] = 0xFF;  // Jump to position 1 (array[0])
        this.rtable[wtbl][6] = 0x01;

        // PTBL: PWM sweep at position 1 (array index 0)
        const ptbl = TABLE_TYPES.PULSE;
        this.ltable[ptbl][0] = 0x88;  // Set pulse $800
        this.rtable[ptbl][0] = 0x00;
        this.ltable[ptbl][1] = 0x20;  // 32 ticks, speed +$40
        this.rtable[ptbl][1] = 0x40;
        this.ltable[ptbl][2] = 0x40;  // 64 ticks, speed -$20
        this.rtable[ptbl][2] = 0xE0;
        this.ltable[ptbl][3] = 0xFF;  // Jump to position 2 (array[1])
        this.rtable[ptbl][3] = 0x02;

        // FTBL: Filter sweep at position 1 (array index 0)
        const ftbl = TABLE_TYPES.FILTER;
        this.ltable[ftbl][0] = 0x90;  // Set filter params: lowpass + resonance
        this.rtable[ftbl][0] = 0xF1;  // Res=F, route voice 0
        this.ltable[ftbl][1] = 0x00;  // Set cutoff
        this.rtable[ftbl][1] = 0x20;  // Cutoff = $20
        this.ltable[ftbl][2] = 0x40;  // 64 ticks, speed +$10
        this.rtable[ftbl][2] = 0x10;
        this.ltable[ftbl][3] = 0xFF;  // Jump to position 3 (array[2])
        this.rtable[ftbl][3] = 0x03;

        // STBL: Vibrato params at position 1 (array index 0)
        const stbl = TABLE_TYPES.SPEED;
        this.ltable[stbl][0] = 0x40;  // Vibrato speed
        this.rtable[stbl][0] = 0x20;  // Vibrato depth
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

        // Filter state (GT2 global filter params)
        this.filterType = 0;
        this.filterCtrl = 0;

        // Active flags
        this.waveActive = false;
        this.pulseActive = false;
        this.filterActive = false;
        this.speedActive = false;
    }

    // Execute wavetable step (matches GT2 gplay.c wavetable logic)
    // GT2 uses 1-based pointers: ptr=1 reads array index 0
    executeWavetable(tableManager, baseNote) {
        if (!this.waveActive || this.ptr[TABLE_TYPES.WAVE] === 0) return null;

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.WAVE];
            const entry = tableManager.getEntry(TABLE_TYPES.WAVE, pos - 1); // 1-based to 0-based
            const left = entry.left;
            const right = entry.right;

            // GT2: if (wave > WAVELASTDELAY) - i.e. wave > 0x0F
            if (left > 0x0F) {
                // Normal waveform (0x10-0xDF)
                if (left < 0xE0) {
                    this.wave = left;
                }
                // Silent waveform (0xE0-0xEF) - GT2: cptr->wave = wave & 0xf
                else if (left >= 0xE0 && left <= 0xEF) {
                    this.wave = left & 0x0F;
                }
                // Commands (0xF0-0xFE) - execute pattern command from wavetable
                else if (left >= 0xF0 && left <= 0xFE) {
                    // TODO: Execute embedded pattern commands
                    this.wavetime = 0;
                    this.ptr[TABLE_TYPES.WAVE]++;
                    return { wave: this.wave, note: this.note, changed: false };
                }
                // Jump (0xFF)
                else if (left === 0xFF) {
                    if (right === 0x00 || right >= MAX_TABLELEN) {
                        this.waveActive = false;
                        return null;
                    }
                    this.ptr[TABLE_TYPES.WAVE] = right;
                    this.wavetime = 0;
                    jumpCount++;
                    continue;
                }
            } else {
                // Delay (0x00-0x0F) - GT2: if (wavetime != wave) wavetime++; else advance
                if (this.wavetime !== left) {
                    this.wavetime++;
                    return { wave: this.wave, note: this.note, changed: false };
                }
            }

            // Advance pointer and process note
            this.wavetime = 0;
            this.ptr[TABLE_TYPES.WAVE]++;

            // Parse note parameter (GT2 gplay.c lines 716-725)
            let noteChanged = false;
            let absolute = false;
            if (right !== 0x80) {
                if (right < 0x80) {
                    // Relative note - GT2 uses addition with overflow mask
                    this.note = (right + baseNote) & 0x7F;
                    noteChanged = true;
                } else {
                    // Absolute note (0x81-0xFF)
                    this.note = right & 0x7F;
                    noteChanged = true;
                    absolute = true;
                }
            }

            return { wave: this.wave, note: this.note, absolute, changed: noteChanged };
        }

        if (jumpCount >= MAX_JUMPS) {
            console.warn('Wavetable: Maximum jump limit reached, stopping execution');
            this.waveActive = false;
        }

        return null;
    }

    // Execute pulsetable step
    // GT2 uses 1-based pointers: ptr=1 reads array index 0
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
            const entry = tableManager.getEntry(TABLE_TYPES.PULSE, pos - 1); // 1-based to 0-based
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

    // Execute filtertable step - GT2 GLOBAL filter (gplay.c lines 255-304)
    // GT2 uses 1-based pointers: ptr=1 reads array index 0
    // In GT2, filter is GLOBAL (not per-voice), executed once per frame
    executeFiltertable(tableManager) {
        if (!this.filterActive || this.ptr[TABLE_TYPES.FILTER] === 0) return this.filter;

        // Handle ongoing modulation
        if (this.filterModTicks > 0) {
            this.filterModTicks--;
            this.filter = Math.max(0, Math.min(0xFF, this.filter + this.filterModSpeed));
            return this.filter;
        }

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.FILTER];
            const entry = tableManager.getEntry(TABLE_TYPES.FILTER, pos - 1); // 1-based to 0-based
            const left = entry.left;
            const right = entry.right;

            // Set cutoff (left = 0x00) - GT2 gplay.c lines 285-288
            if (left === 0x00) {
                this.filter = right;  // 8-bit cutoff
                this.ptr[TABLE_TYPES.FILTER]++;
                break;
            }
            // Modulation (0x01-0x7F) - GT2 gplay.c lines 282-283
            else if (left >= 0x01 && left <= 0x7F) {
                this.filterModTicks = left;
                this.filterModSpeed = (right & 0x80) ? (right - 256) : right;
                this.ptr[TABLE_TYPES.FILTER]++;
                break;
            }
            // Set filter params (0x80-0xFE) - GT2 gplay.c lines 267-278
            // left & 0x70 = filter type, right = resonance + voice routing
            else if (left >= 0x80 && left <= 0xFE) {
                this.filterType = left & 0x70;
                this.filterCtrl = right;  // GT2 doesn't auto-add voice
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
                continue;
            }
            else {
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
    // NOTE: In GT2, speedtable is a STATIC lookup (not executable) for vibrato/portamento.
    // Commands 1-4 read from speedtable directly. This method is kept for compatibility.
    // GT2 uses 1-based pointers: ptr=1 reads array index 0
    executeSpeedtable(tableManager) {
        if (!this.speedActive || this.ptr[TABLE_TYPES.SPEED] === 0) return this.speed;

        // Protect against infinite jump loops
        let jumpCount = 0;
        const MAX_JUMPS = 10;

        while (jumpCount < MAX_JUMPS) {
            const pos = this.ptr[TABLE_TYPES.SPEED];
            const entry = tableManager.getEntry(TABLE_TYPES.SPEED, pos - 1); // 1-based to 0-based
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
