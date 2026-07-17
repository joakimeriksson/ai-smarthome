// sid-exporter-gt2.js - Generate authentic .SID files with GT2 6502 player
// Produces PSID v2NG files playable in SIDPLAY2, VICE, or on real C64 hardware.

import { getDriverTemplate, DRIVER_META } from './driver/gt2-driver-data.js';

// ============================================================================
// PAL frequency table (96 notes: C-0 to B-7)
// Exact GT2 hardcoded values from gplay.c / player.s — must match the player.
// ============================================================================

function getGT2FreqTable() {
    const lo = new Uint8Array([
        0x17,0x27,0x39,0x4b,0x5f,0x74,0x8a,0xa1,0xba,0xd4,0xf0,0x0e,
        0x2d,0x4e,0x71,0x96,0xbe,0xe8,0x14,0x43,0x74,0xa9,0xe1,0x1c,
        0x5a,0x9c,0xe2,0x2d,0x7c,0xcf,0x28,0x85,0xe8,0x52,0xc1,0x37,
        0xb4,0x39,0xc5,0x5a,0xf7,0x9e,0x4f,0x0a,0xd1,0xa3,0x82,0x6e,
        0x68,0x71,0x8a,0xb3,0xee,0x3c,0x9e,0x15,0xa2,0x46,0x04,0xdc,
        0xd0,0xe2,0x14,0x67,0xdd,0x79,0x3c,0x29,0x44,0x8d,0x08,0xb8,
        0xa1,0xc5,0x28,0xcd,0xba,0xf1,0x78,0x53,0x87,0x1a,0x10,0x71,
        0x42,0x89,0x4f,0x9b,0x74,0xe2,0xf0,0xa6,0x0e,0x33,0x20,0xff,
    ]);
    const hi = new Uint8Array([
        0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x01,0x02,
        0x02,0x02,0x02,0x02,0x02,0x02,0x03,0x03,0x03,0x03,0x03,0x04,
        0x04,0x04,0x04,0x05,0x05,0x05,0x06,0x06,0x06,0x07,0x07,0x08,
        0x08,0x09,0x09,0x0a,0x0a,0x0b,0x0c,0x0d,0x0d,0x0e,0x0f,0x10,
        0x11,0x12,0x13,0x14,0x15,0x17,0x18,0x1a,0x1b,0x1d,0x1f,0x20,
        0x22,0x24,0x27,0x29,0x2b,0x2e,0x31,0x34,0x37,0x3a,0x3e,0x41,
        0x45,0x49,0x4e,0x52,0x57,0x5c,0x62,0x68,0x6e,0x75,0x7c,0x83,
        0x8b,0x93,0x9c,0xa5,0xaf,0xb9,0xc4,0xd0,0xdd,0xea,0xf8,0xff,
    ]);
    return { lo, hi };
}

// ============================================================================
// Pack instruments into 9 parallel arrays (GT2 format)
// Player uses 1-based indexing: mt_insad-1,y where y = instrument number
// ============================================================================

function packInstruments(instruments) {
    // Filter out null entries (index 0 is null for GT2 1-based convention)
    const validInstruments = instruments.filter(i => i != null);
    const count = Math.min(validInstruments.length, 63); // Max 63 instruments (1-based, 64 slots)
    const arrays = {
        insad: new Uint8Array(64),
        inssr: new Uint8Array(64),
        inswaveptr: new Uint8Array(64),
        inspulseptr: new Uint8Array(64),
        insfiltptr: new Uint8Array(64),
        insvibparam: new Uint8Array(64),
        insvibdelay: new Uint8Array(64),
        insgatetimer: new Uint8Array(64),
        insfirstwave: new Uint8Array(64),
    };

    for (let i = 0; i < count; i++) {
        const inst = validInstruments[i];
        // Index i in the packed array = instrument number i+1 in the player (1-based)
        // (explicit undefined checks: 0 is a valid value for all these fields)
        arrays.insad[i] = inst.ad !== undefined ? (inst.ad & 0xFF) : 0x00;
        arrays.inssr[i] = inst.sr !== undefined ? (inst.sr & 0xFF) : 0xF0;
        arrays.inswaveptr[i] = (inst.tables && inst.tables.wave) || 0;
        arrays.inspulseptr[i] = (inst.tables && inst.tables.pulse) || 0;
        arrays.insfiltptr[i] = (inst.tables && inst.tables.filter) || 0;

        // Instrument vibrato: GT2's ptr[STBL] doubles as the vibrato param
        // (tables.speed in our model; vibParam kept as legacy alias).
        // greloc.c lines 777-786: vibdelay is stored -1 for the player, and
        // vibdelay 0 disables instrument vibrato entirely (param forced 0).
        const vibParam = (inst.tables && inst.tables.speed) || inst.vibParam || 0;
        const vibDelay = inst.vibratoDelay || 0;
        if (vibDelay > 0) {
            arrays.insvibparam[i] = vibParam;
            arrays.insvibdelay[i] = vibDelay - 1;
        } else {
            arrays.insvibparam[i] = 0;
            arrays.insvibdelay[i] = 0;
        }

        // Gate timer: bits 0-5 = timer ticks, bit 6 = no gate-off, bit 7 = no HR
        arrays.insgatetimer[i] = inst.gateTimer || 0x02;

        // First wave: waveform|gate|sync|ringmod for the attack frame
        // (firstWave 0 = legato instrument, a valid GT2 value)
        if (inst.firstWave !== undefined && inst.firstWave !== null) {
            arrays.insfirstwave[i] = inst.firstWave;
        } else {
            // Derive from waveform + gate
            let fw = (inst.waveform || 0x10) | 0x01; // add gate bit
            if (inst.sync) fw |= 0x02;
            if (inst.ringMod) fw |= 0x04;
            arrays.insfirstwave[i] = fw;
        }
    }

    return arrays;
}

// ============================================================================
// Pack GT2 tables (WTBL, PTBL, FTBL, STBL)
// ============================================================================

function packTables(tableManager) {
    const result = {
        wavetbl: new Uint8Array(255),
        pulsetimetbl: new Uint8Array(255),
        pulsespdtbl: new Uint8Array(255),
        filttimetbl: new Uint8Array(255),
        filtspdtbl: new Uint8Array(255),
        speedlefttbl: new Uint8Array(255),
        speedrighttbl: new Uint8Array(255),
        notetbl: new Uint8Array(256),
    };

    if (!tableManager) return result;

    const WAVE = 0, PULSE = 1, FILTER = 2, SPEED = 3;

    // Wavetable: left = waveform command, right = note value
    // GT2 player format: values 0-15 are delay counters, so waveform bytes
    // are stored with +$10 offset (player subtracts $10). $FF = loop marker.
    // Right bytes get XOR $80 to convert editor relative/absolute to player format,
    // BUT only for note values — when left=$FF (loop), right is a position index.
    for (let i = 0; i < 255; i++) {
        let left = tableManager.ltable[WAVE][i] || 0;
        const right = tableManager.rtable[WAVE][i] || 0;
        // Add +$10 offset for waveform values (not 0 and not $FF loop marker)
        if (left > 0 && left < 0xFF) {
            left += 0x10;
        }
        result.wavetbl[i] = left;
        // Right byte goes into notetbl (used by wavetable for frequency changes)
        if (left === 0xFF) {
            // Loop command: right byte is a position index, NOT a note — no XOR
            result.notetbl[i] = right;
        } else {
            // Note value: XOR $80 flips relative/absolute flag (greloc.c convention)
            result.notetbl[i] = right ^ 0x80;
        }
    }

    // Pulse table: left = time/set command, right = speed/value
    // When left=$FF (loop), right byte is a position index (don't transform)
    for (let i = 0; i < 255; i++) {
        const pLeft = tableManager.ltable[PULSE][i] || 0;
        result.pulsetimetbl[i] = pLeft;
        result.pulsespdtbl[i] = tableManager.rtable[PULSE][i] || 0;
    }

    // Filter table: left = time/set command, right = speed/value
    // GT2 convention: filter set-params encoding from greloc.c:
    // If left byte has bit 7 set (set filter params), encode as: ((left & 0x70) >> 1) | 0x80
    // When left=$FF (loop), right byte is a position index (don't transform)
    for (let i = 0; i < 255; i++) {
        let left = tableManager.ltable[FILTER][i] || 0;
        const right = tableManager.rtable[FILTER][i] || 0;
        // Transform filter set-params for the player (but not loop markers)
        if (left >= 0x80 && left !== 0xFF) {
            // Set filter params: passband in bits 4-6, re-encode for player
            left = ((left & 0x70) >> 1) | 0x80;
        }
        result.filttimetbl[i] = left;
        result.filtspdtbl[i] = right;
    }

    // Speed table
    for (let i = 0; i < 255; i++) {
        result.speedlefttbl[i] = tableManager.ltable[SPEED][i] || 0;
        result.speedrighttbl[i] = tableManager.rtable[SPEED][i] || 0;
    }

    return result;
}

// ============================================================================
// Pack a single pattern into GT2 variable-length encoding
// GT2 packed pattern format:
//   $01-$3F = instrument change (followed by note or effect)
//   $40+cmd = effect + data byte + note follows
//   $50+cmd = effect + data byte only (rest row)
//   $60-$BC = notes (C-0 to B-7)
//   $BD     = REST
//   $BE     = KEYOFF
//   $BF     = KEYON
//   $C0-$FF = packed rest (RLE, count = byte - $C0)
//   $00     = end of pattern
// ============================================================================

function packPattern(pattern) {
    // Two-pass packing matching GT2 greloc.c packpattern():
    // Pass 1: emit instrument, FX/FXONLY, and note bytes (with effect state tracking)
    // Pass 2: convert consecutive REST runs (2+) into packed rest bytes,
    //         but never pack the first row.

    const CMD_SETTEMPO = 0x0F;

    // --- Pass 1: build intermediate stream (like GT2's temp2[]) ---
    const temp = [];
    let prevCommand = 0;
    let prevData = 0;

    for (let row = 0; row < pattern.length; row++) {
        const { note, instrument, command, cmdData } = pattern.data[row];

        // GT2 end-of-pattern marker: stop packing here (imported patterns
        // store the end marker as their final row, so length includes it)
        if (note === 0xFF) break;

        // Convert note value to GT2 packed format
        let packedNote = 0xBD; // default: REST (empty row = REST in GT2)
        if (note >= 0x60 && note <= 0xBF) {
            packedNote = note;
        } else if (note >= 1 && note <= 95) {
            packedNote = note + 0x5F; // Legacy 1-95 → $60+
        } else if (note === 0xBD || note === 254) {
            packedNote = 0xBD; // REST
        } else if (note === 0xBE || note === 255) {
            packedNote = 0xBE; // KEYOFF
        } else if (note === 0xBF) {
            packedNote = 0xBF; // KEYON
        }
        // note === 0 (empty) → packedNote stays 0xBD (REST)

        // Adjust tempo command data for the 6502 player (greloc.c line 1828)
        let adjCmdData = cmdData;
        if (command === CMD_SETTEMPO && (cmdData & 0x7F) >= 3) {
            adjCmdData = cmdData - 1;
        }

        const hasInst = instrument > 0 && instrument <= 0x3F;
        const effectChanged = (command !== prevCommand) || (adjCmdData !== prevData);

        // Emit instrument change
        if (hasInst) {
            temp.push(instrument & 0x3F);
        }

        // Emit effect if changed (GT2 tracks effect state to avoid redundant bytes)
        if (packedNote === 0xBD) {
            // REST row: use FXONLY if effect changed, else just REST
            if (effectChanged) {
                prevCommand = command;
                prevData = adjCmdData;
                temp.push(0x50 | (command & 0x0F)); // FXONLY
                if (command > 0) {
                    temp.push(adjCmdData & 0xFF);
                }
            } else {
                temp.push(0xBD); // REST
            }
        } else {
            // Normal note / KEYOFF / KEYON
            if (effectChanged) {
                prevCommand = command;
                prevData = adjCmdData;
                temp.push(0x40 | (command & 0x0F)); // FX (note follows)
                if (command > 0) {
                    temp.push(adjCmdData & 0xFF);
                }
            }
            temp.push(packedNote);
        }
    }

    // --- Pass 2: packed rest optimization (like GT2's final step) ---
    // "Never pack first row or sequencer goes crazy" (greloc.c line 1884)
    // Only pack runs of 2+ consecutive REST ($BD) bytes.
    const bytes = [];
    let i = 0;
    while (i < temp.length) {
        let canPack = true;

        // Never pack the first row — scan past any initial non-REST prefix bytes
        if (i === 0) canPack = false;

        // Instrument or FX/FXONLY bytes break packability
        if (temp[i] < 0x40) {
            // Instrument byte ($01-$3F) — emit and continue
            bytes.push(temp[i++]);
            canPack = false;
            continue;
        }
        if (temp[i] >= 0x50 && temp[i] < 0x60) {
            // FXONLY ($50-$5F) — emit + optional data byte
            const fxnum = temp[i] - 0x50;
            bytes.push(temp[i++]);
            if (fxnum && i < temp.length) bytes.push(temp[i++]);
            canPack = false;
            continue;
        }
        if (temp[i] >= 0x40 && temp[i] < 0x50) {
            // FX ($40-$4F) — emit + optional data byte, note follows
            const fxnum = temp[i] - 0x40;
            bytes.push(temp[i++]);
            if (fxnum && i < temp.length) bytes.push(temp[i++]);
            canPack = false;
            continue;
        }

        // At this point temp[i] should be a note ($60-$BF) or REST ($BD)
        if (temp[i] !== 0xBD) canPack = false;

        if (!canPack) {
            bytes.push(temp[i++]);
        } else {
            // Count consecutive REST bytes
            let runStart = i;
            while (i < temp.length && temp[i] === 0xBD && (i - runStart) < 64) {
                i++;
            }
            const count = i - runStart;
            if (count > 1) {
                // Packed rest: $FF=1, $FE=2, ..., $C0=64
                bytes.push(0x100 - count);
            } else {
                // Single REST: keep as $BD (GT2 only packs 2+)
                bytes.push(0xBD);
            }
        }
    }

    // End of pattern marker
    bytes.push(0x00);

    return new Uint8Array(bytes);
}

// ============================================================================
// Pack order list for a single voice
// GT2 order list format: pattern numbers, with special commands
// $FF = LOOPSONG (next byte = loop position)
// $FE = LOOPSONG (alternative)
// $D0-$DF = REPEAT
// $E0-$EF = TRANSPOSE DOWN
// $F0-$FD = TRANSPOSE UP
// ============================================================================

function packOrderList(orderList) {
    const bytes = [];

    for (let i = 0; i < orderList.length; i++) {
        const entry = orderList[i];

        if (entry === 0xFF || entry === 0xFE) {
            // LOOPSONG / ENDSONG: next byte is the loop position
            bytes.push(0xFF);
            if (i + 1 < orderList.length) {
                bytes.push(orderList[i + 1]);
                i++;
            } else {
                bytes.push(0x00); // Loop to start
            }
            break; // LOOPSONG terminates the orderlist
        } else if (entry >= 0xE0) {
            // TRANSPOSE ($E0-$FD): emit as-is, next byte (pattern) follows naturally
            bytes.push(entry);
        } else if (entry > 0xD0 && entry < 0xE0) {
            // REPEAT ($D1-$DF): GT2 greloc.c swaps [repeat, pattern] → [pattern, repeat]
            // Editor format: entry=REPEAT+count, next=pattern number
            if (i + 1 < orderList.length && orderList[i + 1] < 0xD0) {
                bytes.push(orderList[i + 1]); // Pattern number FIRST
                bytes.push(entry);             // Repeat count SECOND
                i++; // Skip the pattern byte (already emitted)
            } else {
                // No valid pattern follows — emit as-is (shouldn't happen)
                bytes.push(entry);
            }
        } else if (entry === 0xD0) {
            // REPEAT with count 0 = no extra repeats, skip it (GT2 behavior)
            // (entry == REPEAT exactly means repeat 0 extra times, no-op)
        } else {
            // Pattern number ($00-$CF)
            bytes.push(entry & 0xFF);
        }
    }

    // Ensure orderlist is terminated with LOOPSONG + position
    if (bytes.length < 2 || bytes[bytes.length - 2] !== 0xFF) {
        bytes.push(0xFF);
        bytes.push(0x00);
    }

    return new Uint8Array(bytes);
}

// ============================================================================
// Create PSID v2NG header (124 bytes)
// ============================================================================

function createPSIDHeader({ loadAddr, initAddr, playAddr, title, author, released, sidModel,
                            songs = 1, startSong = 1 }) {
    const header = new Uint8Array(124);
    const view = new DataView(header.buffer);

    let p = 0;
    // Magic: "PSID"
    header[p++] = 0x50; header[p++] = 0x53; header[p++] = 0x49; header[p++] = 0x44;
    view.setUint16(p, 0x0002); p += 2;    // Version 2NG
    view.setUint16(p, 0x007C); p += 2;    // Data offset (124)
    view.setUint16(p, loadAddr); p += 2;   // Load address (0 = use first 2 bytes of data)
    view.setUint16(p, initAddr); p += 2;   // Init address
    view.setUint16(p, playAddr); p += 2;   // Play address
    view.setUint16(p, songs); p += 2;      // Number of songs
    view.setUint16(p, startSong); p += 2;  // Start song (1-based)
    view.setUint32(p, 0); p += 4;          // Speed (0 = 50Hz VBlank)

    // Title (32 bytes, null-terminated)
    const titleBytes = new TextEncoder().encode((title || 'SID Export').slice(0, 31));
    header.set(titleBytes, p); p += 32;

    // Author (32 bytes)
    const authorBytes = new TextEncoder().encode((author || 'sid-synth').slice(0, 31));
    header.set(authorBytes, p); p += 32;

    // Released (32 bytes)
    const releasedStr = released || new Date().getFullYear().toString();
    const releasedBytes = new TextEncoder().encode(releasedStr.slice(0, 31));
    header.set(releasedBytes, p); p += 32;

    // Flags (PSID v2NG): bits 2-3 = clock (01 = PAL), bits 4-5 = SID model
    // (01 = MOS6581, 10 = MOS8580)
    const modelBits = sidModel === 8580 ? 0x20 : 0x10;
    view.setUint16(p, 0x0004 | modelBits); p += 2;

    // Reserved
    view.setUint16(p, 0x0000); p += 2;

    return header;
}

// ============================================================================
// Main export function
// ============================================================================

/**
 * Export the current song as a .SID file (PSID v2NG format)
 *
 * @param {Object} options
 * @param {string} options.title - Song title (max 31 chars)
 * @param {string} options.author - Author name (max 31 chars)
 * @param {Array} options.instruments - Instrument array from synth.js
 * @param {Object} options.patternManager - GT2 pattern manager instance
 * @param {Object} options.tableManager - GT2 table manager instance (window.gt2TableManager)
 * @returns {Uint8Array} Complete .SID file data
 */
export function exportSIDFile({ title, author, instruments, patternManager, tableManager,
                                tempo, funktempo, adparam, sidModel, subtunes, startSong }) {
    // 1. Get driver template
    const driver = getDriverTemplate();
    const meta = DRIVER_META;

    // 2. Patch frequency tables (exact GT2 hardcoded values)
    const freq = getGT2FreqTable();
    driver.set(freq.lo, meta.tables.freqtbllo.offset);
    driver.set(freq.hi, meta.tables.freqtblhi.offset);

    // 2b. Patch playback defaults.
    // Initial tempo: player counter reload semantics give a step period of
    // reload+1 frames, so editor tempo N is stored as N-1 (same adjustment
    // greloc.c applies to FXY command data).
    const songTempo = (tempo && tempo >= 1) ? (tempo & 0x7F) : 6;
    if (meta.tables.defaulttempo) {
        driver[meta.tables.defaulttempo.offset] = songTempo >= 3 ? songTempo - 1 : songTempo;
    }
    // Initial funktempo table: raw editor values (the player's reload path
    // subtracts 1 itself via the cleared-carry SBC).
    if (funktempo && meta.tables.funktempotbl) {
        driver[meta.tables.funktempotbl.offset] = funktempo.left & 0xFF;
        driver[meta.tables.funktempotbl.offset + 1] = funktempo.right & 0xFF;
    }
    // Hard-restart ADSR (GT2 editor adparam, default $0F00: AD=$0F, SR=$00)
    const hrParam = (adparam !== undefined) ? (adparam & 0xFFFF) : 0x0F00;
    if (meta.tables.hradparam) driver[meta.tables.hradparam.offset] = (hrParam >> 8) & 0xFF;
    if (meta.tables.hrsrparam) driver[meta.tables.hrsrparam.offset] = hrParam & 0xFF;

    // 3. Pack and patch instruments
    const instArrays = packInstruments(instruments);
    for (const [name, data] of Object.entries(instArrays)) {
        if (meta.tables[name]) {
            driver.set(data, meta.tables[name].offset);
        }
    }

    // 3b. Auto-generate wavetable entries for instruments without wave pointers.
    // The GT2 player sets frequency ONLY via wavetable execution, so every
    // instrument needs at least a minimal wavetable: [waveform, loop-to-self].
    const tables = packTables(tableManager);
    let nextFreeWavePos = 1; // 1-based, find first free slot
    // Find next free position after any existing wavetable entries
    for (let i = 0; i < 255; i++) {
        if (tables.wavetbl[i] !== 0) nextFreeWavePos = i + 2; // 1-based
    }
    const validInstruments = instruments.filter(i => i != null);
    const count = Math.min(validInstruments.length, 63);
    for (let i = 0; i < count; i++) {
        if (instArrays.inswaveptr[i] === 0 && nextFreeWavePos + 1 <= 255) {
            // Create minimal 2-entry wavetable:
            // Entry 1: waveform|gate, note = $80 (relative 0 = use current note)
            // Entry 2: $FF (loop), target = entry 1
            const pos = nextFreeWavePos; // 1-based position
            // Add the gate bit unless the instrument is deliberately
            // gate-less (silent sync/ring modulator: firstWave without bit 0)
            const inst = validInstruments[i];
            const gateBit = (inst.firstWave !== undefined && inst.firstWave !== null)
                ? (inst.firstWave & 0x01) : 0x01;
            let wf = ((inst.waveform || 0x10) & 0xFE) | gateBit;
            if (inst.sync) wf |= 0x02;
            if (inst.ringMod) wf |= 0x04;
            // GT2 wavetable format: values 0-15 are delay counters,
            // so waveform bytes are stored with +$10 offset (player subtracts $10)
            tables.wavetbl[pos - 1] = wf + 0x10; // left: waveform+gate with +$10 bias
            tables.notetbl[pos - 1] = 0x80;      // right: relative 0 (use current note)
            tables.wavetbl[pos] = 0xFF;           // left: loop marker
            tables.notetbl[pos] = pos;            // right: loop target (1-based, loop to entry 1)
            instArrays.inswaveptr[i] = pos;       // point instrument to this entry
            nextFreeWavePos = pos + 2;
        }
    }
    // Re-patch instruments with updated wave pointers
    driver.set(instArrays.inswaveptr, meta.tables.inswaveptr.offset);

    // 4. Pack and patch modulation tables
    for (const [name, data] of Object.entries(tables)) {
        if (meta.tables[name]) {
            driver.set(data.subarray(0, meta.tables[name].length), meta.tables[name].offset);
        }
    }

    // 5. Pack patterns and collect their byte data
    const packedPatterns = [];
    let usedPatterns = new Set();

    // The song is one or more subtunes, each with 3 order lists. Callers can
    // pass an explicit subtunes array; default is the pattern manager's
    // single current song. The driver's songtbl holds 3 pointers per subtune
    // (NUMSONGS=32 in the driver = GT2's MAX_SONGS).
    const songList = (subtunes && subtunes.length)
        ? subtunes
        : [{ orderLists: patternManager.song.orderLists }];
    if (songList.length > 32) {
        throw new Error(`Too many subtunes (${songList.length}, driver supports 32)`);
    }

    // Find which patterns are actually used in any subtune's order lists
    // Skip special commands (REPEAT $D0-$DF, TRANSPOSE $E0-$FD, LOOPSONG $FE-$FF)
    for (const st of songList) {
        for (let v = 0; v < 3; v++) {
            const ol = st.orderLists[v];
            for (let j = 0; j < ol.length; j++) {
                const entry = ol[j];
                if (entry < 0xD0) {
                    usedPatterns.add(entry);
                } else if (entry >= 0xD0 && entry < 0xE0) {
                    // REPEAT: next byte is the pattern number
                    if (j + 1 < ol.length) usedPatterns.add(ol[j + 1]);
                    j++; // skip pattern byte
                } else if (entry >= 0xE0 && entry < 0xFE) {
                    // TRANSPOSE: next byte is the pattern number
                    if (j + 1 < ol.length) usedPatterns.add(ol[j + 1]);
                    j++; // skip pattern byte
                } else {
                    // LOOPSONG ($FE/$FF): next byte is loop position, skip both
                    j++;
                    break;
                }
            }
        }
    }

    // Pack all used patterns
    for (let i = 0; i < 208; i++) {
        if (usedPatterns.has(i)) {
            packedPatterns[i] = packPattern(patternManager.patterns[i]);
        } else {
            // Empty pattern: just end marker
            packedPatterns[i] = new Uint8Array([0x00]);
        }
    }

    // 6. Pack order lists (3 per subtune)
    const packedOrders = [];
    for (const st of songList) {
        for (let v = 0; v < 3; v++) {
            packedOrders.push(packOrderList(st.orderLists[v]));
        }
    }

    // 7. Calculate addresses for appended data
    // Data is appended after the driver binary
    const BASE = meta.base;
    let appendOffset = driver.length;
    let appendAddr = BASE + appendOffset;

    // Order lists
    const orderAddrs = [];
    const orderData = [];
    for (let i = 0; i < packedOrders.length; i++) {
        orderAddrs[i] = appendAddr;
        orderData.push(packedOrders[i]);
        appendAddr += packedOrders[i].length;
    }

    // Pattern data
    const patternAddrs = new Array(256).fill(0);
    const patternData = [];
    for (let i = 0; i < 208; i++) {
        patternAddrs[i] = appendAddr;
        patternData.push(packedPatterns[i]);
        appendAddr += packedPatterns[i].length;
    }
    // Fill remaining pattern slots (208-255) with address of a dummy empty pattern
    const dummyAddr = appendAddr;
    const dummyPattern = new Uint8Array([0x00]);
    patternData.push(dummyPattern);
    appendAddr += 1;
    for (let i = 208; i < 256; i++) {
        patternAddrs[i] = dummyAddr;
    }

    // 8. Patch song table (3 order list pointers per subtune)
    for (let i = 0; i < orderAddrs.length; i++) {
        driver[meta.tables.songtbllo.offset + i] = orderAddrs[i] & 0xFF;
        driver[meta.tables.songtblhi.offset + i] = (orderAddrs[i] >> 8) & 0xFF;
    }

    // 9. Patch pattern pointer tables
    for (let i = 0; i < 256; i++) {
        driver[meta.tables.patttbllo.offset + i] = patternAddrs[i] & 0xFF;
        driver[meta.tables.patttblhi.offset + i] = (patternAddrs[i] >> 8) & 0xFF;
    }

    // 10. Assemble the complete binary: driver + order lists + patterns
    const totalSize = appendAddr - BASE;
    const prgData = new Uint8Array(totalSize);
    prgData.set(driver, 0);

    let writePos = driver.length;
    for (const data of orderData) {
        prgData.set(data, writePos);
        writePos += data.length;
    }
    for (const data of patternData) {
        prgData.set(data, writePos);
        writePos += data.length;
    }

    // 11. Create PRG with load address header (2 bytes little-endian)
    const prg = new Uint8Array(2 + prgData.length);
    prg[0] = BASE & 0xFF;
    prg[1] = (BASE >> 8) & 0xFF;
    prg.set(prgData, 2);

    // 12. Create PSID header and combine
    const psidHeader = createPSIDHeader({
        loadAddr: 0,     // 0 = use load address from PRG data
        initAddr: meta.init,
        playAddr: meta.play,
        title: title || 'SID Export',
        author: author || 'sid-synth',
        sidModel,
        songs: songList.length,
        startSong: Math.min(Math.max(startSong || 1, 1), songList.length),
    });

    // 13. Combine PSID header + PRG data
    const sid = new Uint8Array(psidHeader.length + prg.length);
    sid.set(psidHeader, 0);
    sid.set(prg, psidHeader.length);

    console.log(`SID export: ${sid.length} bytes (driver: ${driver.length}, patterns: ${writePos - driver.length}, total PRG: ${prg.length})`);
    console.log(`  Load: $${BASE.toString(16)}, Init: $${meta.init.toString(16)}, Play: $${meta.play.toString(16)}`);
    console.log(`  Patterns used: ${usedPatterns.size}, End addr: $${appendAddr.toString(16)}`);

    // Diagnostic: instrument filter pointers and vibrato
    console.log('  Instrument data:');
    const diagInstruments = instruments.filter(i => i != null);
    for (let i = 0; i < Math.min(diagInstruments.length, 10); i++) {
        const inst = diagInstruments[i];
        console.log(`    [${i+1}] "${inst.name}" AD=$${instArrays.insad[i].toString(16)} SR=$${instArrays.inssr[i].toString(16)} wave=${instArrays.inswaveptr[i]} pulse=${instArrays.inspulseptr[i]} filt=${instArrays.insfiltptr[i]} vibP=$${instArrays.insvibparam[i].toString(16)} vibD=${instArrays.insvibdelay[i]} gate=$${instArrays.insgatetimer[i].toString(16)} fw=$${instArrays.insfirstwave[i].toString(16)}`);
    }

    // Diagnostic: filter table contents
    let filtEntries = 0;
    for (let i = 0; i < 255; i++) {
        if (tables.filttimetbl[i] !== 0 || tables.filtspdtbl[i] !== 0) filtEntries = i + 1;
    }
    if (filtEntries > 0) {
        console.log(`  Filter table (${filtEntries} entries):`);
        for (let i = 0; i < filtEntries; i++) {
            const L = tables.filttimetbl[i];
            const R = tables.filtspdtbl[i];
            let desc = '';
            if (L === 0x00) desc = `SET-CUTOFF val=$${R.toString(16)}`;
            else if (L === 0xFF) desc = `LOOP → ${R}`;
            else if (L >= 0x80) desc = `SET-FILT packed=$${L.toString(16)} (ASL→$${((L<<1)&0xFF).toString(16)}) ctrl=$${R.toString(16)}`;
            else desc = `MOD time=${L} speed=${R >= 0x80 ? R-256 : R}`;
            console.log(`    [${i}] L=$${L.toString(16).padStart(2,'0')} R=$${R.toString(16).padStart(2,'0')} | ${desc}`);
        }
    } else {
        console.log('  Filter table: EMPTY (no filter data)');
    }

    // Diagnostic: order lists
    for (let v = 0; v < 3; v++) {
        const ol = packedOrders[v];
        const hex = Array.from(ol).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`  Order V${v+1} (${ol.length} bytes): ${hex}`);
    }

    return sid;
}

/**
 * Trigger a browser download of the .SID file
 */
export function downloadSIDFile(options) {
    const sid = exportSIDFile(options);
    const blob = new Blob([sid], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (options.title || 'export').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safeName}.sid`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return sid;
}
