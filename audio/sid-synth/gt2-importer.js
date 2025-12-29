// gt2-importer.js - Import complete songs from GoatTracker2 .sng files

import { instruments } from './synth.js';
import { gt2TableManager, TABLE_TYPES } from './table-manager-gt2.js';
import { gt2PatternManager, MAX_PATTERNS, NOTE_EMPTY, NOTE_REST, NOTE_KEYOFF } from './pattern-manager-gt2.js';

const MAX_INSTRNAMELEN = 16;
const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

export class GT2Importer {
    constructor() {
        this.songName = '';
        this.authorName = '';
        this.copyrightName = '';
    }

    /**
     * Import a GoatTracker2 .sng file
     * @param {File} file - The .sng file to import
     * @returns {Promise<Object>} - Imported data
     */
    async importSongFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const dataView = new DataView(arrayBuffer);
        let offset = 0;

        // Read header (4 bytes)
        const header = String.fromCharCode(
            dataView.getUint8(offset++),
            dataView.getUint8(offset++),
            dataView.getUint8(offset++),
            dataView.getUint8(offset++)
        );

        if (!['GTS3', 'GTS4', 'GTS5'].includes(header)) {
            throw new Error(`Invalid GoatTracker file format: ${header}`);
        }

        console.log(`📁 Importing ${header} format file: ${file.name}`);

        // Read song info texts (32 bytes each)
        this.songName = this.readString(dataView, offset, 32);
        offset += 32;
        this.authorName = this.readString(dataView, offset, 32);
        offset += 32;
        this.copyrightName = this.readString(dataView, offset, 32);
        offset += 32;

        console.log(`🎵 Song: ${this.songName} by ${this.authorName}`);

        // Read song order lists
        const numOrderLists = dataView.getUint8(offset++);
        const songOrders = [];

        console.log(`📋 Reading ${numOrderLists} song order lists...`);

        for (let d = 0; d < numOrderLists; d++) {
            const songOrder = [];
            for (let c = 0; c < 3; c++) { // MAX_CHN = 3
                const length = dataView.getUint8(offset++);
                const orderList = [];

                // Read order list entries (length + 1 bytes, includes end marker)
                for (let i = 0; i <= length; i++) {
                    orderList.push(dataView.getUint8(offset++));
                }

                songOrder.push(orderList);
                console.log(`  Song ${d}, Voice ${c}: ${orderList.length} entries`);
            }
            songOrders.push(songOrder);
        }

        // Read instruments
        const numInstruments = dataView.getUint8(offset++);
        const importedInstruments = [];

        console.log(`🎹 Importing ${numInstruments} instruments...`);

        for (let i = 1; i <= numInstruments; i++) {
            const instr = {
                ad: dataView.getUint8(offset++),
                sr: dataView.getUint8(offset++),
                waveTablePtr: dataView.getUint8(offset++),
                pulseTablePtr: dataView.getUint8(offset++),
                filterTablePtr: dataView.getUint8(offset++),
                speedTablePtr: dataView.getUint8(offset++),
                vibDelay: dataView.getUint8(offset++),
                gateTimer: dataView.getUint8(offset++),
                firstWave: dataView.getUint8(offset++),
                name: this.readString(dataView, offset, MAX_INSTRNAMELEN)
            };
            offset += MAX_INSTRNAMELEN;

            importedInstruments.push(instr);
            console.log(`  ${i}. ${instr.name.trim() || '(unnamed)'} - ADSR: ${instr.ad.toString(16)}/${instr.sr.toString(16)}, Wave:${instr.firstWave.toString(16)}, Tables: W${instr.waveTablePtr} P${instr.pulseTablePtr} F${instr.filterTablePtr} S${instr.speedTablePtr}`);
        }

        // Read tables (4 tables: WTBL, PTBL, FTBL, STBL)
        const importedTables = [];
        for (let tableType = 0; tableType < 4; tableType++) {
            const tableSize = dataView.getUint8(offset++);
            const leftData = [];
            const rightData = [];

            for (let i = 0; i < tableSize; i++) {
                leftData.push(dataView.getUint8(offset++));
            }
            for (let i = 0; i < tableSize; i++) {
                rightData.push(dataView.getUint8(offset++));
            }

            importedTables.push({
                type: tableType,
                length: tableSize,
                leftData,
                rightData
            });

            const tableNames = ['WTBL', 'PTBL', 'FTBL', 'STBL'];
            console.log(`📊 ${tableNames[tableType]}: ${tableSize} entries`);

            // Debug: dump PTBL entries for pulse width analysis
            if (tableType === 1 && tableSize > 0) {
                console.log(`📊 PTBL dump (all ${tableSize} entries):`);
                for (let i = 0; i < tableSize; i++) {
                    const L = leftData[i];
                    const R = rightData[i];
                    let desc = '';
                    if (L >= 0x01 && L <= 0x7F) {
                        const speed = (R & 0x80) ? (R - 256) : R;
                        desc = `MODULATE ${L} ticks, speed=${speed}`;
                    }
                    else if (L >= 0x80 && L <= 0xFE) {
                        const pulseVal = ((L & 0x0F) << 8) | R;
                        desc = `SET PULSE = 0x${pulseVal.toString(16)} (${pulseVal})`;
                    }
                    else if (L === 0xFF) desc = `JUMP → ${R}`;
                    else if (L === 0x00) desc = `NOP`;
                    else desc = `??? 0x${L.toString(16)}`;
                    console.log(`  [${i}] L=0x${L.toString(16).padStart(2,'0')} R=0x${R.toString(16).padStart(2,'0')} | ${desc}`);
                }

                // Show what pulsetable entries each instrument points to
                console.log(`📌 Instrument pulsetable start positions:`);
                for (let i = 0; i < importedInstruments.length; i++) {
                    const inst = importedInstruments[i];
                    if (inst.pulseTablePtr > 0) {
                        const ptr = inst.pulseTablePtr;
                        const idx = ptr - 1;
                        if (idx >= 0 && idx < leftData.length) {
                            const L = leftData[idx];
                            const R = rightData[idx];
                            console.log(`  Inst ${i+1} "${inst.name.trim()}" → PTBL[${ptr}] = L:0x${L.toString(16).padStart(2,'0')} R:0x${R.toString(16).padStart(2,'0')}`);
                        }
                    }
                }
            }

            // Debug: dump FTBL entries for filter analysis
            if (tableType === 2 && tableSize > 0) {
                console.log(`📊 FTBL dump (all ${tableSize} entries):`);
                for (let i = 0; i < tableSize; i++) {
                    const L = leftData[i];
                    const R = rightData[i];
                    let desc = '';
                    if (L === 0x00) desc = `SET CUTOFF = 0x${R.toString(16)}`;
                    else if (L >= 0x01 && L <= 0x7F) {
                        const speed = (R & 0x80) ? (R - 256) : R;
                        desc = `MODULATE ${L} ticks, speed=${speed}`;
                    }
                    else if (L >= 0x80 && L <= 0xFE) {
                        const type = L & 0x70;
                        const typeName = type === 0x10 ? 'LOW' : type === 0x20 ? 'BAND' : type === 0x40 ? 'HIGH' : type === 0x30 ? 'LOW+BAND' : type === 0x50 ? 'LOW+HIGH' : type === 0x60 ? 'BAND+HIGH' : type === 0x70 ? 'ALL' : 'NONE';
                        desc = `SET FILTER type=${typeName}(0x${type.toString(16)}), ctrl=0x${R.toString(16)}`;
                    }
                    else if (L === 0xFF) desc = `JUMP → ${R}`;
                    else desc = `??? 0x${L.toString(16)}`;
                    console.log(`  [${i}] L=0x${L.toString(16).padStart(2,'0')} R=0x${R.toString(16).padStart(2,'0')} | ${desc}`);
                }

                // Show what filtertable entries each instrument points to
                console.log(`📌 Instrument filtertable start positions:`);
                for (let i = 0; i < importedInstruments.length; i++) {
                    const inst = importedInstruments[i];
                    if (inst.filterTablePtr > 0) {
                        const ptr = inst.filterTablePtr;
                        const idx = ptr - 1;  // Convert 1-based to 0-based
                        if (idx >= 0 && idx < leftData.length) {
                            const L = leftData[idx];
                            const R = rightData[idx];
                            console.log(`  Inst ${i+1} "${inst.name.trim()}" → FTBL[${ptr}] = L:0x${L.toString(16).padStart(2,'0')} R:0x${R.toString(16).padStart(2,'0')}`);
                        }
                    }
                }
            }

            // Debug: dump ALL WTBL entries to check for delays
            if (tableType === 0 && tableSize > 0) {
                console.log(`📊 WTBL dump (all ${tableSize} entries):`);
                for (let i = 0; i < tableSize; i++) {
                    const L = leftData[i];
                    const R = rightData[i];
                    let desc = '';
                    if (L >= 0x01 && L <= 0x0F) desc = `DELAY ${L} frames`;
                    else if (L >= 0x10 && L <= 0xDF) desc = `WAVE 0x${L.toString(16)} ${(L & 0x01) ? '+gate' : 'NO-gate'}`;
                    else if (L === 0xFF) desc = `JUMP→${R}`;
                    else if (L === 0x00) desc = `ARPEGGIO (keep wave, note offset ${R})`;
                    else desc = `??? 0x${L.toString(16)}`;
                    console.log(`  [${i}] L=0x${L.toString(16).padStart(2,'0')} R=0x${R.toString(16).padStart(2,'0')} | ${desc}`);
                }

                // Show what wavetable entries each instrument points to
                console.log(`📌 Instrument wavetable start positions:`);
                for (let i = 0; i < importedInstruments.length; i++) {
                    const inst = importedInstruments[i];
                    if (inst.waveTablePtr > 0) {
                        const ptr = inst.waveTablePtr;
                        const idx = ptr - 1;  // Convert 1-based to 0-based
                        if (idx >= 0 && idx < leftData.length) {
                            const L = leftData[idx];
                            const R = rightData[idx];
                            const hasGate = (L >= 0x10 && L <= 0xDF) ? ((L & 0x01) ? 'GATE-ON' : 'GATE-OFF!') : '';
                            console.log(`  Inst ${i+1} "${inst.name.trim()}" → WTBL[${ptr}] = L:0x${L.toString(16).padStart(2,'0')} ${hasGate}`);
                        }
                    }
                }
            }
        }

        // GT2 META-DATA HACK: Check if the 64th instrument (index 63) contains the default speed
        // This is a common way for GT2 to store the initial tempo when it's not 6.
        let initialSpeed = 6;
        let initialTempo = 0;
        if (importedInstruments.length >= 63) {
            const metaInstr = importedInstruments[62]; // Index 62 is instrument 63
            // If it's a "dummy" instrument (no wavetable) and AD >= 2, it's a tempo marker
            if (metaInstr.waveTablePtr === 0 && metaInstr.ad >= 2) {
                initialSpeed = metaInstr.ad - 1;
                console.log(`💡 GT2 Meta-data: Found initial speed ${initialSpeed} in instrument 63 (AD=${metaInstr.ad})`);
            }
        }
        // Check instrument 64 too (some versions might use it)
        if (importedInstruments.length >= 64) {
            const metaInstr = importedInstruments[63];
            if (metaInstr.waveTablePtr === 0 && metaInstr.ad >= 2) {
                initialSpeed = metaInstr.ad - 1;
                console.log(`💡 GT2 Meta-data: Found initial speed ${initialSpeed} in instrument 64 (AD=${metaInstr.ad})`);
            }
        }

        console.log(`🚀 IMPORT DIAGNOSTIC: numInstruments=${numInstruments}, initialSpeed=${initialSpeed}`);

        // Read patterns
        const numPatterns = dataView.getUint8(offset++);
        const importedPatterns = [];

        console.log(`🎼 Importing ${numPatterns} patterns...`);

        for (let p = 0; p < numPatterns; p++) {
            const pattLength = dataView.getUint8(offset++);

            // GT2 stores patterns as a flat array of 4 bytes per step
            // It's actually stored with all 3 voices interleaved in the pattern data
            // But the length is rows per pattern, and we read length*4 bytes
            // Each pattern is for ONE track, so we read it as single-voice data
            const patternBytes = [];

            // Read length * 4 bytes (4 bytes per row: note, instr, cmd, cmdData)
            for (let i = 0; i < pattLength * 4; i++) {
                patternBytes.push(dataView.getUint8(offset++));
            }

            // Parse the bytes into rows (4 bytes per row)
            const patternData = [];
            for (let row = 0; row < pattLength; row++) {
                const baseIdx = row * 4;

                patternData.push([{
                    note: patternBytes[baseIdx],
                    instrument: patternBytes[baseIdx + 1],
                    command: patternBytes[baseIdx + 2],
                    cmdData: patternBytes[baseIdx + 3]
                }]);
            }

            importedPatterns.push({
                length: pattLength,
                data: patternData  // Array of rows, each row has 1-element array (for compatibility)
            });

            // Debug first pattern's first row
            if (p < 3) {
                const firstRow = patternData[0][0];
                console.log(`  Pattern ${p}: ${pattLength} rows - Row 0: note=0x${firstRow.note.toString(16)}, inst=${firstRow.instrument}, cmd=0x${firstRow.command.toString(16)}, data=0x${firstRow.cmdData.toString(16)}`);
            } else if (p === 3) {
                console.log(`  ... (${numPatterns - 3} more patterns)`);
            }
        }

        return {
            header,
            songName: this.songName,
            authorName: this.authorName,
            copyrightName: this.copyrightName,
            songOrders: songOrders,
            instruments: importedInstruments,
            tables: importedTables,
            patterns: importedPatterns,
            initialTempo: initialTempo,
            initialSpeed: initialSpeed
        };
    }

    /**
     * Read a null-terminated or fixed-length string from DataView
     */
    readString(dataView, offset, maxLength) {
        let str = '';
        for (let i = 0; i < maxLength; i++) {
            const char = dataView.getUint8(offset + i);
            if (char === 0) break;
            str += String.fromCharCode(char);
        }
        return str;
    }

    /**
     * Convert GoatTracker instrument to SID Tracker format
     * GT2-pure: Only authentic GoatTracker2 parameters, no LFO/arpeggio engines
     */
    convertInstrument(gtInstr) {
        // GT2 firstWave contains waveform + gate bit (e.g., 0x21 = sawtooth + gate)
        // Extract waveform from high nibble, but also check for common patterns
        let waveform = gtInstr.firstWave & 0xF0;

        // If firstWave has no waveform bits (0x00 or 0x01), the instrument
        // relies entirely on wavetable. In this case, try to get waveform
        // from the first wavetable entry if available.
        if (waveform === 0 && gtInstr.waveTablePtr > 0) {
            // Will be set by wavetable execution - use sawtooth as sensible default
            // since most GT2 instruments use sawtooth or pulse
            waveform = 0x20; // Sawtooth default for table-driven instruments
            console.log(`  Instrument "${gtInstr.name}" has no firstWave waveform, using sawtooth default (wavetable will override)`);
        } else if (waveform === 0) {
            // No wavetable and no waveform - default to triangle
            waveform = 0x10;
        }

        // GT2-pure instrument format - no LFO/arpeggio fields
        // Debug: show gateTimer for each instrument
        const gateTimerValue = gtInstr.gateTimer & 0x3F;
        const noHR = (gtInstr.gateTimer & 0x40) !== 0;
        const noHRADSR = (gtInstr.gateTimer & 0x80) !== 0;
        console.log(`  Instrument "${gtInstr.name}": gateTimer=0x${(gtInstr.gateTimer || 0).toString(16)} (value=${gateTimerValue}, noHR=${noHR}, noHRADSR=${noHRADSR}), AD=0x${gtInstr.ad.toString(16)}, SR=0x${gtInstr.sr.toString(16)}, FTBL=${gtInstr.filterTablePtr}`);

        return {
            name: gtInstr.name.trim() || 'GT2 Import',
            waveform: waveform,
            firstWave: gtInstr.firstWave,  // Full GT2 firstWave byte for first frame
            ad: gtInstr.ad,
            sr: gtInstr.sr,
            pulseWidth: 0x0800, // Default, will be set by PTBL if used
            sync: false,
            ringMod: false,
            gateTimer: gtInstr.gateTimer,  // Full byte: bits 0-5 = timer, bit 6 = no HR, bit 7 = no HR ADSR
            // GT2 table pointers (0 = no table, 1+ = table position)
            tables: {
                wave: gtInstr.waveTablePtr,
                pulse: gtInstr.pulseTablePtr,
                filter: gtInstr.filterTablePtr,
                speed: gtInstr.speedTablePtr
            }
        };
    }

    /**
     * Apply imported tables to the GT2 table manager
     */
    applyTables(importedTables) {
        importedTables.forEach((tableData, index) => {
            // Use new GT2-compatible importTable method
            gt2TableManager.importTable(tableData.type, tableData.leftData, tableData.rightData);
        });
    }

    /**
     * Add imported instruments to the instruments array
     * @param {Object} importedData - Imported data from GT2 file
     * @param {boolean} replace - If true, replace existing instruments. If false, append.
     */
    addInstruments(importedData, replace = false) {
        const convertedInstruments = importedData.instruments.map(gtInstr =>
            this.convertInstrument(gtInstr)
        );

        if (replace) {
            // Keep only the first instrument (Lead Tri) and replace the rest
            instruments.length = 1;
            instruments.push(...convertedInstruments);
            console.log(`✅ Replaced instruments with ${convertedInstruments.length} from GT2`);
        } else {
            // Append to existing instruments
            instruments.push(...convertedInstruments);
            console.log(`✅ Added ${convertedInstruments.length} instruments to SID Tracker`);
        }

        return convertedInstruments;
    }

    /**
     * Legacy method name for compatibility
     */
    appendInstruments(importedData) {
        return this.addInstruments(importedData, false);
    }

    /**
     * Import patterns from GT2 file into GT2 pattern manager
     * GT2 patterns are single-voice already, we import them directly
     */
    applyPatterns(importedData) {
        if (!importedData.patterns) {
            console.warn('No patterns in imported data');
            return;
        }

        console.log(`📝 Importing ${importedData.patterns.length} patterns...`);

        // GT2 patterns are already single-voice (4 bytes per row)
        // Import them directly
        importedData.patterns.forEach((gtPattern, sourceIndex) => {
            if (sourceIndex >= MAX_PATTERNS) {
                console.warn(`Reached maximum patterns (${MAX_PATTERNS}), stopping import`);
                return;
            }

            const pattern = gt2PatternManager.patterns[sourceIndex];
            pattern.length = gtPattern.length;

            // Copy data - GoatTracker uses different note encoding
            let hasNotes = false;
            for (let row = 0; row < gtPattern.length; row++) {
                const rowData = gtPattern.data[row][0];  // Data is wrapped in single-element array

                // GT2 note encoding (from official readme.txt section 6.1.6):
                // $00       = empty (no note data)
                // $60-$BC   = notes C-0 to G#7
                // $BD (189) = REST ("...") - sustain, no gate change
                // $BE (190) = KEYOFF ("---") - clear gate bit, trigger release
                // $BF (191) = KEYON ("+++") - set gate bit
                // $FF       = pattern end
                // Note: We store raw GT2 values and handle them in playback code
                const note = rowData.note;
                pattern.setRow(row, note, rowData.instrument, rowData.command, rowData.cmdData);
                if (note >= 0x60 && note <= 0xBC) hasNotes = true;
            }

            if (hasNotes || sourceIndex < 5) {
                // Show first pattern or any pattern with notes
                const firstRow = gtPattern.data[0][0];
                const storedRow = pattern.getRow(0);
                console.log(`  GT2 Pattern ${sourceIndex} → SID Pattern ${sourceIndex} (${gtPattern.length} rows)`);
                console.log(`    Import: note=${firstRow.note.toString(16)}, inst=${firstRow.instrument}`);
                console.log(`    Stored: note=${storedRow.note}, inst=${storedRow.instrument}`);
            }
        });

        console.log(`✅ Imported ${importedData.patterns.length} patterns`);
    }

    /**
     * Import song order lists from GT2 file
     * GT2 has per-voice order lists which we support natively!
     * @param {Object} importedData - Imported data
     * @param {number} songIndex - Which subsong to import (default 0)
     */
    applySongOrders(importedData, songIndex = 0) {
        if (!importedData.songOrders || importedData.songOrders.length === 0) {
            console.warn('No song order data in imported file');
            return;
        }

        if (songIndex >= importedData.songOrders.length) {
            console.warn(`Song index ${songIndex} out of range (max ${importedData.songOrders.length - 1})`);
            songIndex = 0;
        }

        const songOrder = importedData.songOrders[songIndex];

        console.log(`🎵 Importing song order lists (subsong ${songIndex + 1}/${importedData.songOrders.length})...`);

        // GT2 patterns map 1:1 to our patterns (both are single-voice)
        for (let voice = 0; voice < 3; voice++) {
            const gtOrderList = songOrder[voice];
            const newOrderList = [];

            for (let i = 0; i < gtOrderList.length; i++) {
                const entry = gtOrderList[i];

                // Check for special commands
                if (entry === 0xFF) {
                    // End marker
                    newOrderList.push(0xFF);
                    break;
                } else if (entry === 0xFE) {
                    // Loop marker
                    newOrderList.push(0xFE);
                    // Next byte is loop position
                    if (i + 1 < gtOrderList.length) {
                        newOrderList.push(gtOrderList[i + 1]);
                        i++; // Skip next byte
                    }
                } else if (entry >= 0xD0) {
                    // Special command (transpose, repeat, etc.)
                    newOrderList.push(entry);
                    if (i + 1 < gtOrderList.length) {
                        newOrderList.push(gtOrderList[i + 1]);
                        i++;
                    }
                } else {
                    // Regular pattern entry - direct 1:1 mapping
                    if (entry < MAX_PATTERNS) {
                        newOrderList.push(entry);
                    } else {
                        console.warn(`Pattern ${entry} exceeds MAX_PATTERNS (${MAX_PATTERNS})`);
                        newOrderList.push(0); // Fallback to pattern 0
                    }
                }
            }

            gt2PatternManager.song.setOrderList(voice, newOrderList);
            console.log(`  Voice ${voice}: ${newOrderList.length} order entries`);
        }

        console.log(`✅ Song order lists imported`);
    }

    /**
     * Import complete song (patterns, orders, instruments, tables)
     * @param {Object} importedData - Imported data
     * @param {number} songIndex - Which subsong to import (default 0)
     */
    importCompleteSong(importedData, songIndex = 0) {
        const subsongInfo = importedData.songOrders.length > 1 ? ` (subsong ${songIndex + 1}/${importedData.songOrders.length})` : '';
        console.log(`🎼 Importing complete GT2 song: ${importedData.songName}${subsongInfo}`);

        // Set song metadata
        gt2PatternManager.song.title = importedData.songName || "Imported GT2 Song";
        gt2PatternManager.song.author = importedData.authorName || "";
        gt2PatternManager.song.copyright = importedData.copyrightName || "";

        // Import tables
        this.applyTables(importedData.tables);

        // Import patterns
        this.applyPatterns(importedData);

        // Import song orders (with subsong selection)
        this.applySongOrders(importedData, songIndex);

        // Import instruments
        this.addInstruments(importedData, true);  // Replace instruments

        // Apply initial speed/tempo to sequencer
        if (typeof window.setGT2Tempo === 'function') {
            const speed = importedData.initialSpeed || 6;
            const tempo = importedData.initialTempo || 0;
            console.log(`🚀 Applying initial GT2 Speed: ${speed}, Tempo: ${tempo}`);
            window.setGT2Tempo(speed, tempo);
        }

        console.log(`✅ Complete song imported successfully!`);
        console.log(`   Title: ${gt2PatternManager.song.title}`);
        console.log(`   Author: ${gt2PatternManager.song.author}`);
    }
}

// Global instance
export const gt2Importer = new GT2Importer();

// File input handler for UI
export function setupGT2ImportUI() {
    // Find the export button to insert GT2 import after it
    const exportButton = document.getElementById('exportButton');
    if (!exportButton || !exportButton.parentNode) {
        console.warn('Export button not found, cannot add GT2 import');
        return;
    }

    // Create GT2 import button
    const gt2ImportButton = document.createElement('button');
    gt2ImportButton.id = 'importGT2Button';
    gt2ImportButton.textContent = 'Import GT2';
    gt2ImportButton.title = 'Import GoatTracker2 .sng file';

    // Create hidden file input for GT2 files
    const gt2FileInput = document.createElement('input');
    gt2FileInput.type = 'file';
    gt2FileInput.id = 'importGT2FileInput';
    gt2FileInput.accept = '.sng';
    gt2FileInput.style.display = 'none';

    // Handle GT2 import with single modal dialog
    gt2FileInput.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const importedData = await gt2Importer.importSongFile(file);
            const numSubsongs = importedData.songOrders.length;

            // Create and show import modal
            showGT2ImportModal(importedData, numSubsongs, (result) => {
                if (!result) {
                    gt2FileInput.value = '';
                    return;
                }

                const { fullImport, selectedSubsong } = result;

                if (fullImport) {
                    gt2Importer.importCompleteSong(importedData, selectedSubsong);
                } else {
                    gt2Importer.applyTables(importedData.tables);
                    gt2Importer.addInstruments(importedData, true);
                }

                // Refresh instrument selector
                const instrumentSelect = document.getElementById('recordInstrumentSelect');
                if (instrumentSelect) {
                    const currentValue = instrumentSelect.value;
                    instrumentSelect.innerHTML = '';
                    instruments.forEach((inst, i) => {
                        const option = document.createElement('option');
                        option.value = i;
                        option.textContent = `${i}: ${inst.name}`;
                        instrumentSelect.appendChild(option);
                    });
                    instrumentSelect.value = Math.min(currentValue, instruments.length - 1);
                }

                updateSongInfo(importedData);

                if (window.gt2PatternEditor) {
                    window.gt2PatternEditor.renderPattern();
                }
                if (window.gt2OrderEditor) {
                    window.gt2OrderEditor.renderOrderLists();
                }

                gt2FileInput.value = '';
            });
        } catch (error) {
            console.error('GT2 import error:', error);
            showGT2ImportError(error.message);
            gt2FileInput.value = '';
        }
    };

    // Create modal for GT2 import options
    function showGT2ImportModal(data, numSubsongs, callback) {
        // Remove existing modal if any
        const existing = document.getElementById('gt2ImportModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'gt2ImportModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); display: flex; align-items: center;
            justify-content: center; z-index: 10000;
        `;

        const subsongOptions = numSubsongs > 1
            ? Array.from({length: numSubsongs}, (_, i) =>
                `<option value="${i}">Subsong ${i + 1}</option>`).join('')
            : '';

        modal.innerHTML = `
            <div style="background: #1a1a2e; border: 2px solid #4a4a6a; border-radius: 8px;
                        padding: 20px; min-width: 320px; color: #e0e0e0; font-family: monospace;">
                <h3 style="margin: 0 0 15px 0; color: #00ff88;">Import GT2 Song</h3>
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 14px; color: #aaa;">Title:</div>
                    <div style="font-size: 16px; color: #fff;">${data.songName || 'Untitled'}</div>
                </div>
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 14px; color: #aaa;">Author:</div>
                    <div style="font-size: 16px; color: #fff;">${data.authorName || 'Unknown'}</div>
                </div>
                <div style="margin-bottom: 15px; display: flex; gap: 20px;">
                    <div><span style="color: #aaa;">Patterns:</span> ${data.patterns.length}</div>
                    <div><span style="color: #aaa;">Instruments:</span> ${data.instruments.length}</div>
                </div>
                ${numSubsongs > 1 ? `
                <div style="margin-bottom: 15px;">
                    <label style="color: #aaa;">Subsong:</label>
                    <select id="gt2SubsongSelect" style="margin-left: 10px; padding: 4px;">
                        ${subsongOptions}
                    </select>
                </div>` : ''}
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 8px; cursor: pointer;">
                        <input type="radio" name="gt2ImportType" value="full" checked>
                        <span style="color: #00ff88;">Complete Song</span>
                        <span style="color: #888; font-size: 12px;"> (patterns, orders, instruments, tables)</span>
                    </label>
                    <label style="display: block; cursor: pointer;">
                        <input type="radio" name="gt2ImportType" value="partial">
                        <span style="color: #ffaa00;">Instruments + Tables Only</span>
                    </label>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="gt2ImportCancel" style="padding: 8px 16px; cursor: pointer;">Cancel</button>
                    <button id="gt2ImportOK" style="padding: 8px 16px; background: #00aa66; color: white;
                            border: none; cursor: pointer;">Import</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Handle buttons
        document.getElementById('gt2ImportCancel').onclick = () => {
            modal.remove();
            callback(null);
        };

        document.getElementById('gt2ImportOK').onclick = () => {
            const fullImport = document.querySelector('input[name="gt2ImportType"]:checked').value === 'full';
            const subsongSelect = document.getElementById('gt2SubsongSelect');
            const selectedSubsong = subsongSelect ? parseInt(subsongSelect.value) : 0;
            modal.remove();
            callback({ fullImport, selectedSubsong });
        };

        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
                callback(null);
            }
        };
    }

    // Show error in modal style
    function showGT2ImportError(message) {
        const existing = document.getElementById('gt2ImportModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'gt2ImportModal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.8); display: flex; align-items: center;
            justify-content: center; z-index: 10000;
        `;

        modal.innerHTML = `
            <div style="background: #2e1a1a; border: 2px solid #6a4a4a; border-radius: 8px;
                        padding: 20px; min-width: 300px; color: #e0e0e0; font-family: monospace;">
                <h3 style="margin: 0 0 15px 0; color: #ff4444;">Import Failed</h3>
                <div style="margin-bottom: 20px; color: #ffaaaa;">${message}</div>
                <div style="text-align: right;">
                    <button onclick="this.closest('#gt2ImportModal').remove()"
                            style="padding: 8px 16px; cursor: pointer;">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    }

    // Button click triggers file input
    gt2ImportButton.onclick = () => {
        gt2FileInput.click();
    };

    // Insert GT2 button right after the export button
    exportButton.parentNode.insertBefore(gt2ImportButton, exportButton.nextSibling);
    // Also insert the file input
    exportButton.parentNode.insertBefore(gt2FileInput, gt2ImportButton.nextSibling);

    console.log('✅ GT2 Import button added to UI');
}

// Update song info display
function updateSongInfo(importedData) {
    const title = importedData.songName || 'Imported GT2 Song';
    const author = importedData.authorName || 'Unknown';
    const numPatterns = importedData.patterns.filter(p => p && p.length > 0).length;
    const numInstruments = importedData.instruments.filter(i => i && i.name).length;
    const speed = importedData.initialSpeed || 6;

    // Update GT2 Pattern Editor song info section
    if (window.gt2PatternEditor) {
        window.gt2PatternEditor.updateSongInfo(
            title,
            author,
            `| Patterns: ${numPatterns} | Instruments: ${numInstruments} | Speed: ${speed}`
        );
    }

    // Also update legacy elements if they exist
    const songTitleEl = document.getElementById('songTitle');
    if (songTitleEl) {
        songTitleEl.textContent = title;
    }

    const songStatsEl = document.getElementById('songStats');
    if (songStatsEl) {
        songStatsEl.textContent = `${numPatterns} patterns, ${numInstruments} instruments`;
    }

    console.log(`✅ Song info updated: ${title} by ${author}`);
}

// Export for use by other modules
export { updateSongInfo };
