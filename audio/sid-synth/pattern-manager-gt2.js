// pattern-manager-gt2.js - GoatTracker2-compatible pattern and song management
// 100% compatible with GT2 architecture: per-voice patterns and independent order lists

export const NUM_VOICES = 3;
export const MAX_PATTERNS = 208;  // GT2 supports 208 patterns
export const MAX_PATTERN_ROWS = 128;  // GT2 max pattern length
export const MAX_ORDER_LEN = 254;  // GT2 max order list length

// GT2 special order list values
export const LOOPSONG = 0xFE;     // Loop marker (next byte = loop position)
export const ENDSONG = 0xFF;      // End of song marker
export const REPEAT = 0xD0;       // Repeat marker (0xD0-0xDF, +1 to get count)
export const TRANSDOWN = 0xE0;    // Transpose down (0xE0-0xEF, formula: entry - 0xF0 = -16 to -1)
export const TRANSUP = 0xF0;      // Transpose up (0xF0-0xFD, formula: entry - 0xF0 = 0 to +13)

// GT2 note values (must match GT2 encoding used by the worklet)
export const NOTE_EMPTY = 0;
export const NOTE_REST = 0xBD;     // 189 - sustain previous note, no gate change
export const NOTE_KEYOFF = 0xBE;   // 190 - clear gate bit, trigger release
export const NOTE_KEYON = 0xBF;    // 191 - set gate bit (retrigger without new note)

// GT2-style Pattern (single voice data)
export class GT2Pattern {
    constructor(length = 16) {
        this.length = length;  // Actual pattern length (1-128)
        this.data = Array(MAX_PATTERN_ROWS).fill(null).map(() => ({
            note: NOTE_EMPTY,      // 0=empty, 1-95=notes C-0 to B-7, 254=rest, 255=keyoff
            instrument: 0,         // 0-63 instrument number (0=no change)
            command: 0,            // Effect command
            cmdData: 0             // Command parameter
        }));
    }

    // Get row data
    getRow(row) {
        if (row >= 0 && row < this.length) {
            return this.data[row];
        }
        return { note: NOTE_EMPTY, instrument: 0, command: 0, cmdData: 0 };
    }

    // Set row data
    setRow(row, note, instrument, command = 0, cmdData = 0) {
        if (row >= 0 && row < MAX_PATTERN_ROWS) {
            this.data[row] = {
                note: note !== undefined && note !== null ? note : NOTE_EMPTY,
                instrument: instrument !== undefined && instrument !== null ? instrument : 0,
                command: command !== undefined && command !== null ? command : 0,
                cmdData: cmdData !== undefined && cmdData !== null ? cmdData : 0
            };
        }
    }

    // Clear entire pattern
    clear() {
        for (let row = 0; row < MAX_PATTERN_ROWS; row++) {
            this.data[row] = {
                note: NOTE_EMPTY,
                instrument: 0,
                command: 0,
                cmdData: 0
            };
        }
    }

    // Copy from another pattern
    copyFrom(sourcePattern) {
        this.length = sourcePattern.length;
        for (let row = 0; row < MAX_PATTERN_ROWS; row++) {
            this.data[row] = { ...sourcePattern.data[row] };
        }
    }
}

// GT2-style Song (3 independent order lists)
export class GT2Song {
    constructor() {
        this.title = "SID Tracker";
        this.author = "";
        this.copyright = "";

        // 3 independent order lists (one per voice)
        this.orderLists = [
            [0, ENDSONG],  // Voice 0: play pattern 0, then end
            [0, ENDSONG],  // Voice 1: play pattern 0, then end
            [0, ENDSONG]   // Voice 2: play pattern 0, then end
        ];

        // Current playback positions (one per voice)
        this.orderPositions = [0, 0, 0];

        // Pattern positions within each pattern (one per voice)
        this.patternPositions = [0, 0, 0];

        // Current pattern numbers being played (one per voice)
        this.currentPatterns = [0, 0, 0];

        // Transpose values for each voice
        this.transpose = [0, 0, 0];
    }

    // Get current pattern index for a voice
    getCurrentPatternIndex(voice) {
        if (voice >= 0 && voice < NUM_VOICES) {
            const orderPos = this.orderPositions[voice];
            if (orderPos >= 0 && orderPos < this.orderLists[voice].length) {
                const entry = this.orderLists[voice][orderPos];
                if (entry < MAX_PATTERNS) {
                    return entry;
                }
            }
        }
        return 0;
    }

    // Advance to next order list entry for a voice
    nextOrder(voice) {
        if (voice >= 0 && voice < NUM_VOICES) {
            this.orderPositions[voice]++;
            const orderList = this.orderLists[voice];
            const pos = this.orderPositions[voice];

            // Handle special order list commands
            if (pos >= orderList.length || orderList[pos] === ENDSONG) {
                // Loop back to start
                this.orderPositions[voice] = 0;
                this.patternPositions[voice] = 0;
                return this.getCurrentPatternIndex(voice);
            }

            if (orderList[pos] === LOOPSONG) {
                // Jump to loop position
                const loopPos = orderList[pos + 1];
                this.orderPositions[voice] = loopPos;
                this.patternPositions[voice] = 0;
                return this.getCurrentPatternIndex(voice);
            }

            // Reset pattern position when advancing to new order entry
            this.patternPositions[voice] = 0;
            return this.getCurrentPatternIndex(voice);
        }
        return 0;
    }

    // Set order list for a voice
    setOrderList(voice, orderList) {
        if (voice >= 0 && voice < NUM_VOICES) {
            this.orderLists[voice] = orderList.slice();
        }
    }

    // Add pattern to order list for a voice
    addToOrder(voice, patternIndex) {
        if (voice >= 0 && voice < NUM_VOICES && patternIndex >= 0 && patternIndex < MAX_PATTERNS) {
            const orderList = this.orderLists[voice];
            // Insert before the end marker
            const endPos = orderList.indexOf(ENDSONG);
            if (endPos >= 0) {
                orderList.splice(endPos, 0, patternIndex);
            } else {
                orderList.push(patternIndex);
            }
        }
    }

    // Reset playback positions
    reset() {
        this.orderPositions = [0, 0, 0];
        this.patternPositions = [0, 0, 0];
        this.currentPatterns = [
            this.getCurrentPatternIndex(0),
            this.getCurrentPatternIndex(1),
            this.getCurrentPatternIndex(2)
        ];
        this.transpose = [0, 0, 0];
    }
}

// GT2-style Pattern Manager
class GT2PatternManager {
    constructor() {
        this.patterns = [];
        this.song = new GT2Song();
        this.currentPatternIndex = 0;
        this.currentVoice = 0;  // Which voice we're editing (0-2)

        // Initialize patterns
        this.initializePatterns();
    }

    initializePatterns() {
        // Create 208 empty patterns
        for (let i = 0; i < MAX_PATTERNS; i++) {
            this.patterns.push(new GT2Pattern(16));
        }

        // Load initial demo patterns
        this.loadInitialPatterns();
    }

    loadInitialPatterns() {
        // Pattern 0: Lead melody (16 rows)
        // GT2 note encoding: C-4 = 0x84, E-4 = 0x88, G-4 = 0x8B, etc.
        // Formula: (octave - 1) * 12 + noteIndex + 0x60
        const leadPattern = this.patterns[0];
        leadPattern.length = 16;
        const leadNotes = [
            0x84, 0, 0x88, 0, 0x8B, 0, 0x90, NOTE_KEYOFF,  // C-4, E-4, G-4, C-5, keyoff
            0x8D, 0, 0x89, 0, 0x8B, 0, 0x88, NOTE_KEYOFF    // A-4, F-4, G-4, E-4, keyoff
        ];
        leadNotes.forEach((note, row) => {
            if (note === 0) {
                leadPattern.setRow(row, NOTE_EMPTY, 0);
            } else {
                leadPattern.setRow(row, note, 1);  // Instrument 1 (Lead Tri)
            }
        });

        // Pattern 1: Bass line (16 rows)
        const bassPattern = this.patterns[1];
        bassPattern.length = 16;
        const bassNotes = [
            0x6C, 0, 0x70, 0, 0x73, 0, 0x78, NOTE_KEYOFF,  // C-2, E-2, G-2, C-3, keyoff
            0x75, 0, 0x71, 0, 0x73, 0, 0x70, NOTE_KEYOFF    // A-2, F-2, G-2, E-2, keyoff
        ];
        bassNotes.forEach((note, row) => {
            if (note === 0) {
                bassPattern.setRow(row, NOTE_EMPTY, 0);
            } else {
                bassPattern.setRow(row, note, 2);  // Instrument 2 (Bass Pulse)
            }
        });

        // Pattern 2: Rhythm (16 rows)
        const rhythmPattern = this.patterns[2];
        rhythmPattern.length = 16;
        for (let row = 0; row < 16; row++) {
            if (row % 2 === 0) {
                rhythmPattern.setRow(row, 0x78, 4);  // C-3, Instrument 4 (Perc Noise)
            } else {
                rhythmPattern.setRow(row, NOTE_KEYOFF, 0);
            }
        }

        // Setup initial song order lists
        this.song.orderLists[0] = [0, LOOPSONG, 0];  // Voice 0: pattern 0, loop
        this.song.orderLists[1] = [1, LOOPSONG, 0];  // Voice 1: pattern 1, loop
        this.song.orderLists[2] = [2, LOOPSONG, 0];  // Voice 2: pattern 2, loop
        this.song.reset();
    }

    // Get current pattern being edited
    getCurrentPattern() {
        return this.patterns[this.currentPatternIndex];
    }

    // Select pattern for editing
    selectPattern(index) {
        if (index >= 0 && index < MAX_PATTERNS) {
            this.currentPatternIndex = index;
            return this.getCurrentPattern();
        }
        return null;
    }

    // Select voice for editing
    selectVoice(voice) {
        if (voice >= 0 && voice < NUM_VOICES) {
            this.currentVoice = voice;
        }
    }

    // Copy pattern
    copyPattern(fromIndex, toIndex) {
        if (fromIndex >= 0 && fromIndex < MAX_PATTERNS &&
            toIndex >= 0 && toIndex < MAX_PATTERNS) {
            this.patterns[toIndex].copyFrom(this.patterns[fromIndex]);
        }
    }

    // Clear pattern
    clearPattern(index) {
        if (index >= 0 && index < MAX_PATTERNS) {
            this.patterns[index].clear();
        }
    }

    // Export song data
    exportSong() {
        return {
            version: 'GT2',
            title: this.song.title,
            author: this.song.author,
            copyright: this.song.copyright,
            patterns: this.patterns.map(p => ({
                length: p.length,
                data: p.data.slice(0, p.length)  // Only export used rows
            })),
            orderLists: this.song.orderLists.map(ol => ol.slice()),
            currentPatternIndex: this.currentPatternIndex,
            currentVoice: this.currentVoice
        };
    }

    // Import song data
    importSong(songData) {
        if (songData.version === 'GT2') {
            // Import patterns
            if (songData.patterns) {
                songData.patterns.forEach((pData, i) => {
                    if (i < MAX_PATTERNS) {
                        this.patterns[i].length = pData.length;
                        pData.data.forEach((row, r) => {
                            this.patterns[i].data[r] = { ...row };
                        });
                    }
                });
            }

            // Import order lists
            if (songData.orderLists) {
                songData.orderLists.forEach((ol, voice) => {
                    if (voice < NUM_VOICES) {
                        this.song.orderLists[voice] = ol.slice();
                    }
                });
            }

            // Import metadata
            this.song.title = songData.title || "Imported Song";
            this.song.author = songData.author || "";
            this.song.copyright = songData.copyright || "";

            this.currentPatternIndex = songData.currentPatternIndex || 0;
            this.currentVoice = songData.currentVoice || 0;

            this.song.reset();
        }
    }

    // Convert note number to note name (C-0 to B-8)
    // Supports legacy 1-95 mapping AND raw GT2 bytes (0x60-0xBC)
    noteNumberToName(noteNum) {
        if (noteNum === NOTE_EMPTY || noteNum === 0) return '';
        if (noteNum === NOTE_REST) return 'R';
        if (noteNum === NOTE_KEYOFF) return '===';

        const noteNames = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

        let octave, note;

        if (noteNum >= 0x60 && noteNum <= 0xBC) {
            // Raw GT2 byte: 0x60 is C-1
            note = (noteNum - 0x60) % 12;
            octave = Math.floor((noteNum - 0x60) / 12) + 1;
        } else if (noteNum >= 1 && noteNum <= 95) {
            // Legacy mapping: 1 is C-0
            note = (noteNum - 1) % 12;
            octave = Math.floor((noteNum - 1) / 12);
        } else {
            return '';
        }

        return noteNames[note] + octave;
    }

    // Convert note name (C-0 to B-8) to note number
    // Defaults to returning raw GT2 bytes (0x60+) for new edits
    noteNameToNumber(noteName) {
        if (!noteName || noteName === '') return NOTE_EMPTY;
        if (noteName === 'R' || noteName === '---') return NOTE_REST;
        if (noteName === '===' || noteName === 'K') return NOTE_KEYOFF;

        const noteMap = {
            'C-': 0, 'C#': 1, 'D-': 2, 'D#': 3, 'E-': 4, 'F-': 5,
            'F#': 6, 'G-': 7, 'G#': 8, 'A-': 9, 'A#': 10, 'B-': 11
        };

        const notePart = noteName.substring(0, 2);
        const octaveStr = noteName.substring(2);
        const octave = parseInt(octaveStr, 10);

        if (noteMap.hasOwnProperty(notePart) && !isNaN(octave) && octave >= 0 && octave <= 8) {
            // Return raw GT2 byte format
            // C-1 = 0x60 (96). C-0 = 0x60 - 12 = 0x54 (84).
            // Actually GT2 0x60 is C-1.
            return (octave - 1) * 12 + noteMap[notePart] + 0x60;
        }

        return NOTE_EMPTY;
    }
}

// Global GT2 pattern manager instance
export const gt2PatternManager = new GT2PatternManager();

// Make it globally available
if (typeof window !== 'undefined') {
    window.gt2PatternManager = gt2PatternManager;
}
