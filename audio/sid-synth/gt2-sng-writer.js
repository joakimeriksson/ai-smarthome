// gt2-sng-writer.js - Pure GoatTracker2 .sng (GTS5) writer
//
// NO DOM/window references: runs in the browser and under plain Node.
// Mirrors gt2-src/gsong.c savesong() byte-for-byte:
//   'GTS5' + 3x 32-byte strings
//   subtune count, then per subtune x 3 voices: length byte L, L+1 bytes
//     (orderlist entries + $FF + restart position)
//   instrument count, then per instrument: ad, sr, ptr[WTBL], ptr[PTBL],
//     ptr[FTBL], ptr[STBL], vibdelay, gatetimer, firstwave, name[16]
//   4 tables: size, left[size], right[size]
//   pattern count, then per pattern: rowCount (INCLUDING the $FF end-marker
//     row), rows x (note, instrument, command, cmdData)
//
// Input is the same shape parseSng() returns (and the shape the live app
// holds): writeSng(parseSng(bytes)) round-trips.

const MAX_INSTRNAMELEN = 16;
const MAX_TABLES = 4;
const MAX_PATTERN_ROWS = 128;

function putString(bytes, s, len) {
    for (let i = 0; i < len; i++) {
        bytes.push(i < (s || '').length ? s.charCodeAt(i) & 0xFF : 0);
    }
}

/**
 * Normalize an editor-internal order list to the on-disk byte sequence:
 * entries + 0xFF + restart position. The editor convention keeps
 * [..., 0xFF, restart] at the end, but hand-built lists (e.g. the default
 * song's [0, 0xFF]) may lack the restart byte.
 */
function orderListBytes(orderList) {
    const entries = [];
    let restart = 0;
    for (let i = 0; i < orderList.length; i++) {
        const entry = orderList[i] & 0xFF;
        if (entry === 0xFF || entry === 0xFE) {
            restart = i + 1 < orderList.length ? orderList[i + 1] & 0xFF : 0;
            break;
        }
        entries.push(entry);
    }
    if (entries.length === 0) entries.push(0); // GT2 requires songlen >= 1
    // Restart must point inside the entry list
    if (restart >= entries.length) restart = 0;
    return [...entries, 0xFF, restart];
}

/**
 * Serialize one pattern to on-disk rows. Accepts both imported patterns
 * (end-marker row stored inside `length`) and editor-created patterns
 * (no marker row). Returns rows INCLUDING the final end-marker row.
 */
function patternRows(pattern) {
    const rows = [];
    const len = Math.min(pattern.length, MAX_PATTERN_ROWS);
    for (let r = 0; r < len; r++) {
        const row = pattern.data[r] || { note: 0, instrument: 0, command: 0, cmdData: 0 };
        if ((row.note & 0xFF) === 0xFF) break; // existing end marker
        rows.push([row.note & 0xFF, row.instrument & 0xFF, row.command & 0xFF, row.cmdData & 0xFF]);
    }
    rows.push([0xFF, 0, 0, 0]);
    return rows;
}

function isDefaultEmptyPattern(pattern) {
    for (let r = 0; r < Math.min(pattern.length, MAX_PATTERN_ROWS); r++) {
        const row = pattern.data[r];
        if (!row) continue;
        const note = row.note & 0xFF;
        if (note === 0xFF) break;
        if (note !== 0 || row.instrument || row.command || row.cmdData) return false;
    }
    return true;
}

function tableLength(ltable, rtable) {
    for (let i = ltable.length - 1; i >= 0; i--) {
        if (ltable[i] || rtable[i]) return i + 1;
    }
    return 0;
}

/**
 * Write a GTS5 .sng file.
 * @param {Object} song
 * @param {string} song.name / song.author / song.copyright
 * @param {Array}  song.subtunes - [{ orderLists: [v0[], v1[], v2[]] }, ...]
 * @param {Array}  song.patterns - [{ length, data: [{note, instrument, command, cmdData}] }]
 * @param {Array}  song.instruments - 0-based (index 0 = GT2 instrument 1)
 * @param {Object} song.tables - { ltable: [4][255], rtable: [4][255] }
 * @returns {Uint8Array}
 */
export function writeSng(song) {
    const bytes = [];
    const put = (...b) => bytes.push(...b.map(x => x & 0xFF));

    putString(bytes, 'GTS5', 4);
    putString(bytes, song.name, 32);
    putString(bytes, song.author, 32);
    putString(bytes, song.copyright, 32);

    // Order lists
    const subtunes = song.subtunes && song.subtunes.length
        ? song.subtunes
        : [{ orderLists: [[0, 0xFF, 0], [0, 0xFF, 0], [0, 0xFF, 0]] }];
    put(subtunes.length);
    for (const st of subtunes) {
        for (let voice = 0; voice < 3; voice++) {
            const entries = orderListBytes(st.orderLists[voice] || [0, 0xFF, 0]);
            put(entries.length - 1); // gsong.c: length byte = songlen+1, reads L+1 bytes
            put(...entries);
        }
    }

    // Instruments. Accepts both conventions: the parser's 0-based array
    // (instruments[0] = GT2 instrument 1) and the live app's 1-based array
    // (instruments[0] = null placeholder). Interior nulls become blanks.
    let instruments = song.instruments || [];
    if (instruments.length > 0 && instruments[0] == null) {
        instruments = instruments.slice(1);
    }
    put(instruments.length);
    for (let inst of instruments) {
        if (inst == null) inst = {};
        const tables = inst.tables || {};
        const stbl = tables.speed !== undefined ? tables.speed : (inst.vibParam || 0);
        put(
            inst.ad !== undefined ? inst.ad : 0,
            inst.sr !== undefined ? inst.sr : 0,
            tables.wave || 0,
            tables.pulse || 0,
            tables.filter || 0,
            stbl || 0,
            inst.vibratoDelay || 0,
            inst.gateTimer !== undefined ? inst.gateTimer : 0x02,
            inst.firstWave !== undefined && inst.firstWave !== null ? inst.firstWave : 0x09
        );
        putString(bytes, inst.name || '', MAX_INSTRNAMELEN);
    }

    // Tables
    for (let t = 0; t < MAX_TABLES; t++) {
        const l = song.tables.ltable[t];
        const r = song.tables.rtable[t];
        const len = tableLength(l, r);
        put(len);
        for (let i = 0; i < len; i++) put(l[i]);
        for (let i = 0; i < len; i++) put(r[i]);
    }

    // Patterns: save up to the highest pattern that is used (referenced by an
    // order list) or non-empty, like GT2's countpatternlengths()
    let highest = 0;
    for (const st of subtunes) {
        for (let voice = 0; voice < 3; voice++) {
            for (const entry of orderListBytes(st.orderLists[voice] || [])) {
                if (entry < 0xD0 && entry > highest) highest = entry;
            }
        }
    }
    for (let p = song.patterns.length - 1; p > highest; p--) {
        if (!isDefaultEmptyPattern(song.patterns[p])) { highest = p; break; }
    }

    put(highest + 1);
    for (let p = 0; p <= highest; p++) {
        const rows = patternRows(song.patterns[p] || { length: 0, data: [] });
        put(rows.length);
        for (const row of rows) put(...row);
    }

    return new Uint8Array(bytes);
}
