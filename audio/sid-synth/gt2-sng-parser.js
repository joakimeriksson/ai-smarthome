// gt2-sng-parser.js - Pure GoatTracker2 .sng parsing core (GTS3/GTS4/GTS5)
//
// NO DOM/window references: this module runs both in the browser and under
// plain Node (`node --input-type=module`). It is the parsing half of the old
// gt2-importer.js; the importer keeps the UI and the "apply to managers" logic.
//
// parseSng(uint8Array) returns EXACTLY the data the importer feeds into the
// app (see CLAUDE.md for the data model):
//   {
//     header,                    // 'GTS3' | 'GTS4' | 'GTS5'
//     name, author, copyright,
//     subtunes: [ { orderLists: [v0[], v1[], v2[]] }, ... ],
//     patterns: [ ...MAX_PATTERNS entries of {length, data:[{note,instrument,command,cmdData}...]} ],
//     numFilePatterns,           // patterns actually stored in the file (rest are padding)
//     instruments: [ ... ],      // converted tracker instruments, 0-based (index 0 = GT2 instrument 1)
//     tables: { ltable: [4][255], rtable: [4][255] },
//     initialSpeed, initialTempo
//   }
//
// Conventions preserved from the original importer (do not "fix" these):
// - Pattern length includes GT2's end-marker row (GT2 saves pattlen+1 rows,
//   the last row has note=0xFF).
// - Order lists are in the editor's internal convention: LOOPSONG (0xFE) and
//   ENDSONG (0xFF) both become 0xFF followed by the restart position byte;
//   TRANSPOSE (0xE0-0xFD) and REPEAT (0xD0-0xDF) bytes pass through raw;
//   pattern numbers >= MAX_PATTERNS fall back to pattern 0.
// - Table pointers are 1-based (0 = no table), instruments keep vibParam and
//   tables.speed = 0 (GT2 has no per-instrument speed table pointer).

const MAX_INSTRNAMELEN = 16;
const MAX_PATTERNS = 208;   // must match pattern-manager-gt2.js
const MAX_TABLES = 4;       // WTBL, PTBL, FTBL, STBL
const MAX_TABLELEN = 255;   // must match table-manager-gt2.js
const TABLE_NAMES = ['WTBL', 'PTBL', 'FTBL', 'STBL'];

/**
 * Read a null-terminated or fixed-length string from a Uint8Array
 */
function readString(u8, offset, maxLength) {
    let str = '';
    for (let i = 0; i < maxLength; i++) {
        const char = u8[offset + i];
        if (char === 0) break;
        str += String.fromCharCode(char);
    }
    return str;
}

/**
 * Convert GoatTracker instrument to SID Tracker format
 * GT2-pure: Only authentic GoatTracker2 parameters, no LFO/arpeggio engines
 */
function convertInstrument(gtInstr) {
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
        vibParam: gtInstr.vibParam,     // Legacy alias of tables.speed (kept for compat)
        vibratoDelay: gtInstr.vibDelay, // Vibrato delay in frames
        // GT2 table pointers (0 = no table, 1+ = table position).
        // In GT2, INSTR.ptr[STBL] doubles as the instrument vibrato
        // parameter — the .sng field the parser calls vibParam IS the
        // speedtable pointer. The worklet and instrument editor read
        // tables.speed, so map it here.
        tables: {
            wave: gtInstr.waveTablePtr,
            pulse: gtInstr.pulseTablePtr,
            filter: gtInstr.filterTablePtr,
            speed: gtInstr.vibParam
        }
    };
}

/**
 * Convert a raw .sng order list (per voice) to the editor's internal
 * convention (same logic the importer previously ran in applySongOrders)
 */
function convertOrderList(gtOrderList) {
    const newOrderList = [];

    for (let i = 0; i < gtOrderList.length; i++) {
        const entry = gtOrderList[i];

        // Check for special commands
        if (entry === 0xFF || entry === 0xFE) {
            // LOOPSONG/ENDSONG: next byte is the restart position
            newOrderList.push(0xFF);
            if (i + 1 < gtOrderList.length) {
                newOrderList.push(gtOrderList[i + 1]);
                i++; // Skip restart position byte
            }
            break;
        } else if (entry >= 0xE0) {
            // Transpose command ($E0-$FD): single byte encoding
            // In GT2 player, transpose is followed by the next pattern number
            // Both bytes are stored sequentially in the .sng
            newOrderList.push(entry);
        } else if (entry >= 0xD0) {
            // Repeat command ($D0-$DF): single byte encoding
            // Player replays current pattern, no parameter byte
            newOrderList.push(entry);
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

    return newOrderList;
}

/**
 * Create an empty pattern in GT2's default shape (64 empty rows + end marker),
 * used to pad the pattern list up to MAX_PATTERNS entries
 */
function emptyPattern() {
    const data = [];
    for (let row = 0; row < 64; row++) {
        data.push({ note: 0, instrument: 0, command: 0, cmdData: 0 });
    }
    data.push({ note: 0xFF, instrument: 0, command: 0, cmdData: 0 });
    return { length: 65, data };
}

/**
 * Parse a GoatTracker2 .sng file
 * @param {Uint8Array} u8 - Raw .sng file bytes
 * @returns {Object} - Parsed song data (see module header)
 */
export function parseSng(u8) {
    let offset = 0;

    // Read header (4 bytes)
    const header = String.fromCharCode(
        u8[offset++],
        u8[offset++],
        u8[offset++],
        u8[offset++]
    );

    if (!['GTS3', 'GTS4', 'GTS5'].includes(header)) {
        throw new Error(`Invalid GoatTracker file format: ${header}`);
    }

    // Read song info texts (32 bytes each)
    const songName = readString(u8, offset, 32);
    offset += 32;
    const authorName = readString(u8, offset, 32);
    offset += 32;
    const copyrightName = readString(u8, offset, 32);
    offset += 32;

    console.log(`🎵 Song: ${songName} by ${authorName}`);

    // Read song order lists
    const numOrderLists = u8[offset++];
    const songOrders = [];

    console.log(`📋 Reading ${numOrderLists} song order lists...`);

    for (let d = 0; d < numOrderLists; d++) {
        const songOrder = [];
        for (let c = 0; c < 3; c++) { // MAX_CHN = 3
            const length = u8[offset++];
            const orderList = [];

            // Read order list entries (length + 1 bytes, includes end marker)
            for (let i = 0; i <= length; i++) {
                orderList.push(u8[offset++]);
            }

            songOrder.push(orderList);
            console.log(`  Song ${d}, Voice ${c}: ${orderList.length} entries`);
        }
        songOrders.push(songOrder);
    }

    // Read instruments
    const numInstruments = u8[offset++];
    const rawInstruments = [];

    console.log(`🎹 Importing ${numInstruments} instruments...`);

    for (let i = 1; i <= numInstruments; i++) {
        const instr = {
            ad: u8[offset++],
            sr: u8[offset++],
            waveTablePtr: u8[offset++],
            pulseTablePtr: u8[offset++],
            filterTablePtr: u8[offset++],
            vibParam: u8[offset++],
            vibDelay: u8[offset++],
            gateTimer: u8[offset++],
            firstWave: u8[offset++],
            name: readString(u8, offset, MAX_INSTRNAMELEN)
        };
        offset += MAX_INSTRNAMELEN;

        rawInstruments.push(instr);
        console.log(`  ${i}. ${instr.name.trim() || '(unnamed)'} - ADSR: ${instr.ad.toString(16)}/${instr.sr.toString(16)}, Wave:${instr.firstWave.toString(16)}, Tables: W${instr.waveTablePtr} P${instr.pulseTablePtr} F${instr.filterTablePtr}, VibParam:${instr.vibParam} VibDelay:${instr.vibDelay}`);
    }

    // Read tables (4 tables: WTBL, PTBL, FTBL, STBL)
    const importedTables = [];
    for (let tableType = 0; tableType < MAX_TABLES; tableType++) {
        const tableSize = u8[offset++];
        const leftData = [];
        const rightData = [];

        for (let i = 0; i < tableSize; i++) {
            leftData.push(u8[offset++]);
        }
        for (let i = 0; i < tableSize; i++) {
            rightData.push(u8[offset++]);
        }

        importedTables.push({
            type: tableType,
            length: tableSize,
            leftData,
            rightData
        });

        console.log(`📊 ${TABLE_NAMES[tableType]}: ${tableSize} entries`);

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
            for (let i = 0; i < rawInstruments.length; i++) {
                const inst = rawInstruments[i];
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
            for (let i = 0; i < rawInstruments.length; i++) {
                const inst = rawInstruments[i];
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
            for (let i = 0; i < rawInstruments.length; i++) {
                const inst = rawInstruments[i];
                if (inst.waveTablePtr > 0) {
                    const ptr = inst.waveTablePtr;
                    const idx = ptr - 1;  // Convert 1-based to 0-based
                    if (idx >= 0 && idx < leftData.length) {
                        const L = leftData[idx];
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
    if (rawInstruments.length >= 63) {
        const metaInstr = rawInstruments[62]; // Index 62 is instrument 63
        // If it's a "dummy" instrument (no wavetable) and AD >= 2, it's a tempo marker
        if (metaInstr.waveTablePtr === 0 && metaInstr.ad >= 2) {
            initialSpeed = metaInstr.ad - 1;
            console.log(`💡 GT2 Meta-data: Found initial speed ${initialSpeed} in instrument 63 (AD=${metaInstr.ad})`);
        }
    }
    // Check instrument 64 too (some versions might use it)
    if (rawInstruments.length >= 64) {
        const metaInstr = rawInstruments[63];
        if (metaInstr.waveTablePtr === 0 && metaInstr.ad >= 2) {
            initialSpeed = metaInstr.ad - 1;
            console.log(`💡 GT2 Meta-data: Found initial speed ${initialSpeed} in instrument 64 (AD=${metaInstr.ad})`);
        }
    }

    console.log(`🚀 IMPORT DIAGNOSTIC: numInstruments=${numInstruments}, initialSpeed=${initialSpeed}`);

    // Read patterns
    const numPatterns = u8[offset++];
    const patterns = [];

    console.log(`🎼 Importing ${numPatterns} patterns...`);

    for (let p = 0; p < numPatterns; p++) {
        // GT2 stores the pattern length INCLUDING the end-marker row
        // (gfile.c saves pattlen+1 rows, the last row has note=0xFF)
        const pattLength = u8[offset++];

        // Each pattern is single-voice, 4 bytes per row: note, instr, cmd, cmdData
        const patternData = [];
        for (let row = 0; row < pattLength; row++) {
            patternData.push({
                note: u8[offset++],
                instrument: u8[offset++],
                command: u8[offset++],
                cmdData: u8[offset++]
            });
        }

        patterns.push({
            length: pattLength,
            data: patternData
        });

        // Debug first patterns' first row
        if (p < 3) {
            const firstRow = patternData[0];
            console.log(`  Pattern ${p}: ${pattLength} rows - Row 0: note=0x${firstRow.note.toString(16)}, inst=${firstRow.instrument}, cmd=0x${firstRow.command.toString(16)}, data=0x${firstRow.cmdData.toString(16)}`);
        } else if (p === 3) {
            console.log(`  ... (${numPatterns - 3} more patterns)`);
        }
    }

    // Pad to MAX_PATTERNS entries with empty patterns (GT2 default shape)
    while (patterns.length < MAX_PATTERNS) {
        patterns.push(emptyPattern());
    }

    // Convert per-subtune order lists to the editor's internal convention
    const subtunes = songOrders.map(songOrder => ({
        orderLists: songOrder.map(convertOrderList)
    }));

    // Convert instruments to the tracker's internal format
    // (0-based array: instruments[0] = GT2 instrument 1)
    const instruments = rawInstruments.map(convertInstrument);

    // Build zero-padded [4][255] ltable/rtable (same result as
    // gt2TableManager.importTable applied per table type)
    const ltable = [];
    const rtable = [];
    for (let t = 0; t < MAX_TABLES; t++) {
        ltable[t] = new Array(MAX_TABLELEN).fill(0);
        rtable[t] = new Array(MAX_TABLELEN).fill(0);
        const len = Math.min(importedTables[t].length, MAX_TABLELEN);
        for (let i = 0; i < len; i++) {
            ltable[t][i] = importedTables[t].leftData[i] & 0xFF;
            rtable[t][i] = importedTables[t].rightData[i] & 0xFF;
        }
    }

    return {
        header,
        name: songName,
        author: authorName,
        copyright: copyrightName,
        subtunes,
        patterns,
        numFilePatterns: numPatterns,
        instruments,
        tables: { ltable, rtable },
        initialSpeed,
        initialTempo
    };
}
