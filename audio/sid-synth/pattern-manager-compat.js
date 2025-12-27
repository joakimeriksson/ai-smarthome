// pattern-manager-compat.js - Compatibility layer to make GT2 system work with existing UI
// This allows gradual migration from old unified-pattern system to GT2 per-voice system

import { gt2PatternManager, MAX_PATTERNS as GT2_MAX_PATTERNS, NOTE_EMPTY, NOTE_REST, NOTE_KEYOFF } from './pattern-manager-gt2.js';

// Export constants for compatibility
export const NUM_VOICES = 3;
export const MAX_PATTERNS = 16;  // UI shows 16 patterns (A-P) but they map to GT2 patterns
export const DEFAULT_PATTERN_LENGTH = 16;
export const MAX_PATTERN_LENGTH = 128;

// Compatibility wrapper that presents GT2 system as old unified pattern system
class CompatibilityPatternManager {
    constructor() {
        this.currentPatternIndex = 0;  // Which of our 16 UI patterns (A-P)
        this.currentVoice = 0;         // Which voice we're editing (0-2)

        // Map our 16 UI patterns to GT2 patterns (each UI pattern uses 3 GT2 patterns)
        // UI Pattern A (0) → GT2 patterns 0,1,2 (one per voice)
        // UI Pattern B (1) → GT2 patterns 3,4,5
        // etc.
    }

    // Get current "unified" pattern (actually combines 3 GT2 patterns)
    getCurrentPattern() {
        const basePattern = this.currentPatternIndex * 3;

        return {
            name: String.fromCharCode(65 + this.currentPatternIndex), // A, B, C, etc.
            length: gt2PatternManager.patterns[basePattern].length,

            // Provide a unified view of 3 separate patterns
            getStepData(voice, step) {
                const gt2PatternIndex = basePattern + voice;
                const pattern = gt2PatternManager.patterns[gt2PatternIndex];
                const row = pattern.getRow(step);

                return {
                    note: gt2PatternManager.noteNumberToName(row.note),
                    instrument: row.instrument || 0
                };
            },

            setStepData(voice, step, note, instrument) {
                const gt2PatternIndex = basePattern + voice;
                const pattern = gt2PatternManager.patterns[gt2PatternIndex];
                const noteNum = gt2PatternManager.noteNameToNumber(note);
                pattern.setRow(step, noteNum, instrument || 0, 0, 0);
            },

            clear() {
                for (let voice = 0; voice < 3; voice++) {
                    const gt2PatternIndex = basePattern + voice;
                    gt2PatternManager.patterns[gt2PatternIndex].clear();
                }
            }
        };
    }

    // Select pattern for editing
    selectPattern(index) {
        if (index >= 0 && index < MAX_PATTERNS) {
            this.currentPatternIndex = index;
            return this.getCurrentPattern();
        }
        return null;
    }

    // Copy current pattern
    copyPattern() {
        const basePattern = this.currentPatternIndex * 3;
        return {
            patterns: [
                { ...gt2PatternManager.patterns[basePattern] },
                { ...gt2PatternManager.patterns[basePattern + 1] },
                { ...gt2PatternManager.patterns[basePattern + 2] }
            ],
            length: gt2PatternManager.patterns[basePattern].length
        };
    }

    // Paste pattern
    pastePattern(copiedData, targetIndex = null) {
        const index = targetIndex !== null ? targetIndex : this.currentPatternIndex;
        const basePattern = index * 3;

        if (copiedData && copiedData.patterns) {
            for (let voice = 0; voice < 3; voice++) {
                gt2PatternManager.patterns[basePattern + voice].copyFrom(copiedData.patterns[voice]);
            }
        }
    }

    // Clear current pattern
    clearCurrentPattern() {
        this.getCurrentPattern().clear();
    }

    // Export song (converts GT2 format to old format)
    exportSong() {
        // For now, export a simplified version
        return {
            version: 'GT2-COMPAT',
            gt2Data: gt2PatternManager.exportSong(),
            currentPatternIndex: this.currentPatternIndex
        };
    }

    // Import song (handles both old and new formats)
    importSong(songData) {
        if (songData.version === 'GT2' || songData.version === 'GT2-COMPAT') {
            if (songData.gt2Data) {
                gt2PatternManager.importSong(songData.gt2Data);
            }
            this.currentPatternIndex = songData.currentPatternIndex || 0;
        } else {
            // Old format - convert to GT2
            console.warn('Old format import not fully implemented yet');
        }
    }

    // Access to underlying song
    get song() {
        // Return a compatibility wrapper for the song
        return {
            title: gt2PatternManager.song.title,
            sequence: [0], // Simplified - just show pattern A
            currentPosition: 0,
            loopStart: 0,
            loopEnd: 0,

            getCurrentPatternIndex() {
                return compatPatternManager.currentPatternIndex;
            }
        };
    }

    // Access to patterns array
    get patterns() {
        // Return virtual array of 16 patterns
        const virtualPatterns = [];
        for (let i = 0; i < MAX_PATTERNS; i++) {
            virtualPatterns.push({
                name: String.fromCharCode(65 + i),
                length: gt2PatternManager.patterns[i * 3].length
            });
        }
        return virtualPatterns;
    }
}

// Global compatibility pattern manager
export const compatPatternManager = new CompatibilityPatternManager();

// Export as 'patternManager' for drop-in replacement
export const patternManager = compatPatternManager;

// Helper functions for compatibility
export function getCurrentPatternLength() {
    const basePattern = compatPatternManager.currentPatternIndex * 3;
    return gt2PatternManager.patterns[basePattern].length;
}

export function setSongMode(enabled) {
    // Song mode would show order list editor
    console.log(`Song mode ${enabled ? 'enabled' : 'disabled'}`);
    // TODO: Implement order list UI
}

export function selectPattern(index) {
    return compatPatternManager.selectPattern(index);
}

// Make it globally available
if (typeof window !== 'undefined') {
    window.patternManager = compatPatternManager;
    window.compatPatternManager = compatPatternManager;
    window.getCurrentPatternLength = getCurrentPatternLength;
    window.setSongMode = setSongMode;
    window.selectPattern = selectPattern;
}
