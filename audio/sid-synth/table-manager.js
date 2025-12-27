// table-manager.js - GoatTracker-style table system for parameter automation

// Table types matching GoatTracker functionality
export const TABLE_TYPES = {
    WAVE: 'wave',           // Waveform automation
    PULSE: 'pulse',         // Pulse width automation
    FILTER: 'filter',       // Filter automation
    SPEED: 'speed'          // Speed/timing automation
};

// Maximum table length (GoatTracker uses 255)
export const MAX_TABLE_LENGTH = 255;

// Number of tables per type (GoatTracker has multiple numbered tables)
export const TABLES_PER_TYPE = 32;

// Table data structure
class Table {
    constructor(type, length = 16) {
        this.type = type;
        this.length = Math.min(length, MAX_TABLE_LENGTH);
        this.data = new Array(this.length).fill(0);
        this.loop = false;
        this.loopStart = 0;
        this.loopEnd = this.length - 1;
        this.name = `${type}_table`;
    }

    // Set table value at position
    setValue(pos, value) {
        if (pos >= 0 && pos < this.length) {
            this.data[pos] = this.validateValue(value);
        }
    }

    // Get table value at position
    getValue(pos) {
        if (pos >= 0 && pos < this.length) {
            return this.data[pos];
        }
        return 0;
    }

    // Validate value based on table type
    validateValue(value) {
        switch (this.type) {
            case TABLE_TYPES.WAVE:
                // Wave values: 0x10=Triangle, 0x20=Sawtooth, 0x40=Pulse, 0x80=Noise
                const validWaves = [0x10, 0x20, 0x40, 0x80];
                return validWaves.includes(value) ? value : 0x10;

            case TABLE_TYPES.PULSE:
                // Pulse width: 0x000 to 0xFFF (12-bit)
                return Math.max(0, Math.min(0xFFF, Math.floor(value)));

            case TABLE_TYPES.FILTER:
                // Filter frequency: 0x000 to 0x7FF (11-bit)
                return Math.max(0, Math.min(0x7FF, Math.floor(value)));

            case TABLE_TYPES.SPEED:
                // Speed multiplier: 1-255 (0 = stop)
                return Math.max(0, Math.min(255, Math.floor(value)));

            default:
                return 0;
        }
    }

    // Resize table
    resize(newLength) {
        newLength = Math.min(newLength, MAX_TABLE_LENGTH);
        if (newLength > this.length) {
            // Extend with zeros
            this.data = this.data.concat(new Array(newLength - this.length).fill(0));
        } else if (newLength < this.length) {
            // Truncate
            this.data = this.data.slice(0, newLength);
        }
        this.length = newLength;

        // Adjust loop points if necessary
        this.loopEnd = Math.min(this.loopEnd, this.length - 1);
        this.loopStart = Math.min(this.loopStart, this.loopEnd);
    }

    // Set loop points
    setLoop(start, end) {
        this.loopStart = Math.max(0, Math.min(start, this.length - 1));
        this.loopEnd = Math.max(this.loopStart, Math.min(end, this.length - 1));
        this.loop = true;
    }

    // Clear loop
    clearLoop() {
        this.loop = false;
        this.loopStart = 0;
        this.loopEnd = this.length - 1;
    }

    // Export table data
    export() {
        return {
            type: this.type,
            length: this.length,
            data: [...this.data],
            loop: this.loop,
            loopStart: this.loopStart,
            loopEnd: this.loopEnd,
            name: this.name
        };
    }

    // Import table data
    import(tableData) {
        this.type = tableData.type || this.type;
        this.length = Math.min(tableData.length || 16, MAX_TABLE_LENGTH);
        this.data = (tableData.data || []).slice(0, this.length);

        // Pad with zeros if needed
        while (this.data.length < this.length) {
            this.data.push(0);
        }

        this.loop = tableData.loop || false;
        this.loopStart = Math.max(0, Math.min(tableData.loopStart || 0, this.length - 1));
        this.loopEnd = Math.max(this.loopStart, Math.min(tableData.loopEnd || this.length - 1, this.length - 1));
        this.name = tableData.name || this.name;
    }
}

// Table manager class
export class TableManager {
    constructor() {
        this.tables = {};

        // Initialize tables for each type
        Object.values(TABLE_TYPES).forEach(type => {
            this.tables[type] = [];
            for (let i = 0; i < TABLES_PER_TYPE; i++) {
                this.tables[type][i] = new Table(type);
            }
        });

        // Initialize with some default tables
        this.initializeDefaultTables();
    }

    // Initialize some useful default tables
    initializeDefaultTables() {
        // Wave table 0: Triangle to Sawtooth sweep
        const waveTable0 = this.getTable(TABLE_TYPES.WAVE, 0);
        waveTable0.resize(8);
        waveTable0.setValue(0, 0x10); // Triangle
        waveTable0.setValue(1, 0x10);
        waveTable0.setValue(2, 0x20); // Sawtooth
        waveTable0.setValue(3, 0x20);
        waveTable0.setValue(4, 0x40); // Pulse
        waveTable0.setValue(5, 0x40);
        waveTable0.setValue(6, 0x80); // Noise
        waveTable0.setValue(7, 0x10); // Back to triangle
        waveTable0.name = "Wave Sweep";

        // Pulse table 0: PWM sweep
        const pulseTable0 = this.getTable(TABLE_TYPES.PULSE, 0);
        pulseTable0.resize(16);
        for (let i = 0; i < 16; i++) {
            // Create a sine-like PWM sweep
            const angle = (i / 16) * Math.PI * 2;
            const pulseWidth = Math.floor(0x800 + Math.sin(angle) * 0x400);
            pulseTable0.setValue(i, pulseWidth);
        }
        pulseTable0.name = "PWM Sweep";

        // Filter table 0: Filter sweep
        const filterTable0 = this.getTable(TABLE_TYPES.FILTER, 0);
        filterTable0.resize(32);
        for (let i = 0; i < 32; i++) {
            // Create a filter frequency sweep
            const freq = Math.floor(0x100 + (i / 32) * 0x600);
            filterTable0.setValue(i, freq);
        }
        filterTable0.name = "Filter Sweep";

        // Speed table 0: Accelerando
        const speedTable0 = this.getTable(TABLE_TYPES.SPEED, 0);
        speedTable0.resize(8);
        speedTable0.setValue(0, 4); // Slow
        speedTable0.setValue(1, 3);
        speedTable0.setValue(2, 2);
        speedTable0.setValue(3, 1); // Normal
        speedTable0.setValue(4, 1);
        speedTable0.setValue(5, 1);
        speedTable0.setValue(6, 1);
        speedTable0.setValue(7, 1);
        speedTable0.name = "Accelerando";
    }

    // Get table by type and index
    getTable(type, index) {
        if (this.tables[type] && index >= 0 && index < TABLES_PER_TYPE) {
            return this.tables[type][index];
        }
        return null;
    }

    // Create new table
    createTable(type, index, length = 16) {
        if (this.tables[type] && index >= 0 && index < TABLES_PER_TYPE) {
            this.tables[type][index] = new Table(type, length);
            return this.tables[type][index];
        }
        return null;
    }

    // Copy table
    copyTable(sourceType, sourceIndex, targetType, targetIndex) {
        const source = this.getTable(sourceType, sourceIndex);
        const target = this.getTable(targetType, targetIndex);

        if (source && target) {
            target.import(source.export());
            return true;
        }
        return false;
    }

    // Clear table
    clearTable(type, index) {
        const table = this.getTable(type, index);
        if (table) {
            table.data.fill(0);
            table.clearLoop();
            return true;
        }
        return false;
    }

    // Get all tables of a specific type
    getTablesOfType(type) {
        return this.tables[type] || [];
    }

    // Export all tables
    exportTables() {
        const exported = {};
        Object.keys(this.tables).forEach(type => {
            exported[type] = this.tables[type].map(table => table.export());
        });
        return exported;
    }

    // Import all tables
    importTables(tablesData) {
        Object.keys(tablesData).forEach(type => {
            if (this.tables[type] && Array.isArray(tablesData[type])) {
                tablesData[type].forEach((tableData, index) => {
                    if (index < TABLES_PER_TYPE) {
                        if (!this.tables[type][index]) {
                            this.tables[type][index] = new Table(type);
                        }
                        this.tables[type][index].import(tableData);
                    }
                });
            }
        });
    }

    // Get table names for UI
    getTableNames(type) {
        if (!this.tables[type]) return [];

        return this.tables[type].map((table, index) => ({
            index,
            name: table.name || `${type} ${index}`,
            length: table.length
        }));
    }
}

// Table playback state for each voice
export class TablePlaybackState {
    constructor() {
        this.reset();
    }

    reset() {
        this.waveTableIndex = -1;
        this.waveTablePos = 0;
        this.pulseTableIndex = -1;
        this.pulseTablePos = 0;
        this.filterTableIndex = -1;
        this.filterTablePos = 0;
        this.speedTableIndex = -1;
        this.speedTablePos = 0;
        this.active = false;
    }

    // Set table for playback
    setTable(type, tableIndex) {
        switch (type) {
            case TABLE_TYPES.WAVE:
                this.waveTableIndex = tableIndex;
                this.waveTablePos = 0;
                break;
            case TABLE_TYPES.PULSE:
                this.pulseTableIndex = tableIndex;
                this.pulseTablePos = 0;
                break;
            case TABLE_TYPES.FILTER:
                this.filterTableIndex = tableIndex;
                this.filterTablePos = 0;
                break;
            case TABLE_TYPES.SPEED:
                this.speedTableIndex = tableIndex;
                this.speedTablePos = 0;
                break;
        }
        this.active = true;
    }

    // Clear table playback
    clearTable(type) {
        switch (type) {
            case TABLE_TYPES.WAVE:
                this.waveTableIndex = -1;
                break;
            case TABLE_TYPES.PULSE:
                this.pulseTableIndex = -1;
                break;
            case TABLE_TYPES.FILTER:
                this.filterTableIndex = -1;
                break;
            case TABLE_TYPES.SPEED:
                this.speedTableIndex = -1;
                break;
        }
    }

    // Advance table position
    advance(tableManager) {
        let hasActiveTables = false;

        // Advance wave table
        if (this.waveTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.WAVE, this.waveTableIndex);
            if (table) {
                this.waveTablePos++;
                if (this.waveTablePos >= table.length) {
                    if (table.loop) {
                        this.waveTablePos = table.loopStart;
                    } else {
                        this.waveTableIndex = -1;
                    }
                }
                hasActiveTables = true;
            }
        }

        // Advance pulse table
        if (this.pulseTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.PULSE, this.pulseTableIndex);
            if (table) {
                this.pulseTablePos++;
                if (this.pulseTablePos >= table.length) {
                    if (table.loop) {
                        this.pulseTablePos = table.loopStart;
                    } else {
                        this.pulseTableIndex = -1;
                    }
                }
                hasActiveTables = true;
            }
        }

        // Advance filter table
        if (this.filterTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.FILTER, this.filterTableIndex);
            if (table) {
                this.filterTablePos++;
                if (this.filterTablePos >= table.length) {
                    if (table.loop) {
                        this.filterTablePos = table.loopStart;
                    } else {
                        this.filterTableIndex = -1;
                    }
                }
                hasActiveTables = true;
            }
        }

        // Advance speed table
        if (this.speedTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.SPEED, this.speedTableIndex);
            if (table) {
                this.speedTablePos++;
                if (this.speedTablePos >= table.length) {
                    if (table.loop) {
                        this.speedTablePos = table.loopStart;
                    } else {
                        this.speedTableIndex = -1;
                    }
                }
                hasActiveTables = true;
            }
        }

        this.active = hasActiveTables;
    }

    // Get current table values
    getCurrentValues(tableManager) {
        const values = {};

        if (this.waveTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.WAVE, this.waveTableIndex);
            if (table) {
                values.waveform = table.getValue(this.waveTablePos);
            }
        }

        if (this.pulseTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.PULSE, this.pulseTableIndex);
            if (table) {
                values.pulseWidth = table.getValue(this.pulseTablePos);
            }
        }

        if (this.filterTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.FILTER, this.filterTableIndex);
            if (table) {
                values.filterFreq = table.getValue(this.filterTablePos);
            }
        }

        if (this.speedTableIndex >= 0) {
            const table = tableManager.getTable(TABLE_TYPES.SPEED, this.speedTableIndex);
            if (table) {
                values.speed = table.getValue(this.speedTablePos);
            }
        }

        return values;
    }
}

// Global table manager instance
export const tableManager = new TableManager();