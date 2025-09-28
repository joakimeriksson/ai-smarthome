// pattern-manager.js - Multi-pattern and song mode management
export const NUM_VOICES = 3;
export const MAX_PATTERNS = 16; // A-P patterns
export const DEFAULT_PATTERN_LENGTH = 16;
export const MAX_PATTERN_LENGTH = 64;

// Pattern data structure
export class Pattern {
    constructor(name = "New Pattern", length = DEFAULT_PATTERN_LENGTH) {
        this.name = name;
        this.length = length;
        this.data = Array(NUM_VOICES).fill(null).map(() => 
            Array(MAX_PATTERN_LENGTH).fill(null).map(() => ({
                note: '',
                instrument: 0
            }))
        );
    }
    
    // Get pattern data for a specific step range
    getStepData(voice, step) {
        if (voice >= 0 && voice < NUM_VOICES && step >= 0 && step < this.length) {
            return this.data[voice][step];
        }
        return { note: '', instrument: 0 };
    }
    
    // Set pattern data for a specific step
    setStepData(voice, step, note, instrument) {
        if (voice >= 0 && voice < NUM_VOICES && step >= 0 && step < MAX_PATTERN_LENGTH) {
            this.data[voice][step] = { note: note || '', instrument: instrument || 0 };
        }
    }
    
    // Clear the entire pattern
    clear() {
        for (let voice = 0; voice < NUM_VOICES; voice++) {
            for (let step = 0; step < MAX_PATTERN_LENGTH; step++) {
                this.data[voice][step] = { note: '', instrument: 0 };
            }
        }
    }
    
    // Copy pattern data from another pattern
    copyFrom(sourcePattern) {
        this.length = sourcePattern.length;
        for (let voice = 0; voice < NUM_VOICES; voice++) {
            for (let step = 0; step < MAX_PATTERN_LENGTH; step++) {
                this.data[voice][step] = { ...sourcePattern.data[voice][step] };
            }
        }
    }
}

// Song sequence management
export class Song {
    constructor() {
        this.sequence = [0]; // Start with pattern 0
        this.currentPosition = 0;
        this.loopStart = 0;
        this.loopEnd = 0;
        this.title = "SID Tracker";
    }
    
    // Get the current pattern index
    getCurrentPatternIndex() {
        if (this.currentPosition >= 0 && this.currentPosition < this.sequence.length) {
            return this.sequence[this.currentPosition];
        }
        return 0;
    }
    
    // Move to next pattern in sequence
    nextPattern() {
        this.currentPosition++;
        if (this.currentPosition >= this.sequence.length) {
            // Loop back to start or loop point
            this.currentPosition = this.loopStart;
        }
        return this.getCurrentPatternIndex();
    }
    
    // Move to previous pattern
    previousPattern() {
        this.currentPosition--;
        if (this.currentPosition < 0) {
            this.currentPosition = Math.max(0, this.sequence.length - 1);
        }
        return this.getCurrentPatternIndex();
    }
    
    // Jump to specific position
    jumpToPosition(position) {
        if (position >= 0 && position < this.sequence.length) {
            this.currentPosition = position;
        }
        return this.getCurrentPatternIndex();
    }
    
    // Add pattern to sequence
    addToSequence(patternIndex) {
        if (patternIndex >= 0 && patternIndex < MAX_PATTERNS) {
            this.sequence.push(patternIndex);
        }
    }
    
    // Remove pattern from sequence at position
    removeFromSequence(position) {
        if (position >= 0 && position < this.sequence.length && this.sequence.length > 1) {
            this.sequence.splice(position, 1);
            if (this.currentPosition >= this.sequence.length) {
                this.currentPosition = this.sequence.length - 1;
            }
        }
    }
    
    // Set loop points
    setLoop(start, end) {
        this.loopStart = Math.max(0, Math.min(start, this.sequence.length - 1));
        this.loopEnd = Math.max(this.loopStart, Math.min(end, this.sequence.length - 1));
    }
}

// Global pattern and song management
class PatternManager {
    constructor() {
        this.patterns = [];
        this.currentPatternIndex = 0;
        this.song = new Song();
        this.isPlayingSequence = false;
        
        // Initialize with default patterns
        this.initializePatterns();
    }
    
    initializePatterns() {
        // Create 16 patterns (A-P)
        const patternNames = 'ABCDEFGHIJKLMNOP';
        for (let i = 0; i < MAX_PATTERNS; i++) {
            const pattern = new Pattern(`Pattern ${patternNames[i]}`, DEFAULT_PATTERN_LENGTH);
            this.patterns.push(pattern);
        }
        
        // Load the initial pattern data into Pattern A
        this.loadInitialPattern();
    }
    
    loadInitialPattern() {
        // 8-bit style starter pattern (16 steps), voice 0 only
        const patternA = this.patterns[0];
        patternA.length = 16;
        // Instruments
        const leadInst = 0; // Lead (Tri)
        const bassInst = 1; // Bass (Pulse)
        const percInst = 3; // Perc (Noise)
        // Clear all
        patternA.clear();
        // Voice 0: Lead melody
        [
            { s: 0,  n: 'C-4' }, { s: 1,  n: '---' },
            { s: 2,  n: 'E-4' }, { s: 3,  n: '---' },
            { s: 4,  n: 'G-4' }, { s: 5,  n: '---' },
            { s: 6,  n: 'C-5' }, { s: 7,  n: 'R'   },
            { s: 8,  n: 'A-4' }, { s: 9,  n: '---' },
            { s: 10, n: 'F-4' }, { s: 11, n: '---' },
            { s: 12, n: 'G-4' }, { s: 13, n: '---' },
            { s: 14, n: 'E-4' }, { s: 15, n: 'R'   }
        ].forEach(x => patternA.setStepData(0, x.s, x.n, leadInst));
        // Voice 1: Bassline (simple 8-bit bass that follows the lead)
        [
            { s: 0,  n: 'C-2' }, { s: 1,  n: '---' },
            { s: 2,  n: 'E-2' }, { s: 3,  n: '---' },
            { s: 4,  n: 'G-2' }, { s: 5,  n: '---' },
            { s: 6,  n: 'C-3' }, { s: 7,  n: 'R'   },
            { s: 8,  n: 'A-2' }, { s: 9,  n: '---' },
            { s: 10, n: 'F-2' }, { s: 11, n: '---' },
            { s: 12, n: 'G-2' }, { s: 13, n: '---' },
            { s: 14, n: 'E-2' }, { s: 15, n: 'R'   }
        ].forEach(x => patternA.setStepData(1, x.s, x.n, bassInst));
        // Voice 2: Rhythm (noise hits every second step)
        for (let s = 0; s < 16; s++) {
            if (s % 2 === 0) {
                patternA.setStepData(2, s, 'C-3', percInst); // note ignored for noise timbre
            } else {
                patternA.setStepData(2, s, 'R', percInst);
            }
        }
        // Keep the song sequence to a single pattern A
        this.song.sequence = [0];
        this.song.currentPosition = 0;
        this.song.setLoop(0, 0);
    }
    
    // Get current active pattern
    getCurrentPattern() {
        return this.patterns[this.currentPatternIndex];
    }
    
    // Switch to a different pattern
    selectPattern(index) {
        if (index >= 0 && index < MAX_PATTERNS) {
            this.currentPatternIndex = index;
            return this.getCurrentPattern();
        }
        return null;
    }
    
    // Copy current pattern to clipboard
    copyPattern() {
        return JSON.parse(JSON.stringify(this.getCurrentPattern()));
    }
    
    // Paste pattern from clipboard
    pastePattern(patternData, targetIndex = null) {
        const index = targetIndex !== null ? targetIndex : this.currentPatternIndex;
        if (index >= 0 && index < MAX_PATTERNS && patternData) {
            this.patterns[index].copyFrom(patternData);
        }
    }
    
    // Clear current pattern
    clearCurrentPattern() {
        this.getCurrentPattern().clear();
    }
    
    // Export all patterns and song data
    exportSong() {
        return {
            patterns: this.patterns.map(p => ({
                name: p.name,
                length: p.length,
                data: p.data
            })),
            song: {
                sequence: this.song.sequence.slice(),
                loopStart: this.song.loopStart,
                loopEnd: this.song.loopEnd,
                title: this.song.title
            },
            currentPatternIndex: this.currentPatternIndex
        };
    }
    
    // Import song data
    importSong(songData) {
        if (songData.patterns) {
            this.patterns = songData.patterns.map(p => {
                const pattern = new Pattern(p.name, p.length);
                pattern.data = p.data;
                return pattern;
            });
            
            // Pad with empty patterns if needed
            while (this.patterns.length < MAX_PATTERNS) {
                this.patterns.push(new Pattern(`Pattern ${String.fromCharCode(65 + this.patterns.length)}`));
            }
        }
        
        if (songData.song) {
            this.song.sequence = songData.song.sequence.slice();
            this.song.loopStart = songData.song.loopStart || 0;
            this.song.loopEnd = songData.song.loopEnd || 0;
            this.song.title = songData.song.title || "Imported Song";
        }
        
        this.currentPatternIndex = songData.currentPatternIndex || 0;
    }
}

// Global pattern manager instance
export const patternManager = new PatternManager();

// Make it globally available
if (typeof window !== 'undefined') {
    window.patternManager = patternManager;
}
