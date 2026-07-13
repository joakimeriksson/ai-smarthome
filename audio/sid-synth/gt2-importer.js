// gt2-importer.js - Import complete songs from GoatTracker2 .sng files
// Parsing core lives in gt2-sng-parser.js (pure, Node-safe).
// This module keeps the UI (import modal) and applies parsed data to the app.

import { parseSng } from './gt2-sng-parser.js';
import { instruments } from './synth.js';
import { gt2TableManager } from './table-manager-gt2.js';
import { gt2PatternManager, MAX_PATTERNS } from './pattern-manager-gt2.js';

export class GT2Importer {
    constructor() {
        this.songName = '';
        this.authorName = '';
        this.copyrightName = '';
    }

    /**
     * Import a GoatTracker2 .sng file
     * @param {File} file - The .sng file to import
     * @returns {Promise<Object>} - Parsed data (see gt2-sng-parser.js)
     */
    async importSongFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const parsed = parseSng(new Uint8Array(arrayBuffer));

        console.log(`📁 Importing ${parsed.header} format file: ${file.name}`);
        console.log(`🎵 Song: ${parsed.name} by ${parsed.author}`);

        this.songName = parsed.name;
        this.authorName = parsed.author;
        this.copyrightName = parsed.copyright;

        return parsed;
    }

    /**
     * Apply imported tables to the GT2 table manager
     * @param {Object} tables - { ltable: [4][255], rtable: [4][255] } from parseSng
     */
    applyTables(tables) {
        for (let tableType = 0; tableType < 4; tableType++) {
            gt2TableManager.importTable(tableType, tables.ltable[tableType], tables.rtable[tableType]);
        }
    }

    /**
     * Add imported instruments to the instruments array
     * @param {Object} importedData - Parsed data from GT2 file
     * @param {boolean} replace - If true, replace existing instruments. If false, append.
     */
    addInstruments(importedData, replace = false) {
        // Parser already converted instruments to the tracker's internal format
        // (0-based array: importedData.instruments[0] = GT2 instrument 1)
        const convertedInstruments = importedData.instruments;

        if (replace) {
            // Replace ALL instruments with GT2 imports (1-based indexing)
            // GT2 patterns use 1-based instrument numbers (0 = "no change").
            // Store null at index 0 so instrument N maps to instruments[N].
            // The SID exporter filters out the null when packing for 6502.
            instruments.length = 0;
            instruments.push(null, ...convertedInstruments);
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

        const numFilePatterns = importedData.numFilePatterns;
        console.log(`📝 Importing ${numFilePatterns} patterns...`);

        // Only apply the patterns that were actually stored in the file
        // (the parser pads the array to MAX_PATTERNS with empty patterns)
        const count = Math.min(numFilePatterns, MAX_PATTERNS);
        for (let sourceIndex = 0; sourceIndex < count; sourceIndex++) {
            const gtPattern = importedData.patterns[sourceIndex];
            const pattern = gt2PatternManager.patterns[sourceIndex];
            pattern.length = gtPattern.length;

            // Copy data - notes are stored as raw GT2 values (see gt2-sng-parser.js):
            // $00=empty, $60-$BC=notes C-0 to G#7, $BD=REST, $BE=KEYOFF, $BF=KEYON, $FF=pattern end
            let hasNotes = false;
            for (let row = 0; row < gtPattern.length; row++) {
                const rowData = gtPattern.data[row];
                pattern.setRow(row, rowData.note, rowData.instrument, rowData.command, rowData.cmdData);
                if (rowData.note >= 0x60 && rowData.note <= 0xBC) hasNotes = true;
            }

            if (hasNotes || sourceIndex < 5) {
                // Show first pattern or any pattern with notes
                const firstRow = gtPattern.data[0];
                const storedRow = pattern.getRow(0);
                console.log(`  GT2 Pattern ${sourceIndex} → SID Pattern ${sourceIndex} (${gtPattern.length} rows)`);
                console.log(`    Import: note=${firstRow.note.toString(16)}, inst=${firstRow.instrument}`);
                console.log(`    Stored: note=${storedRow.note}, inst=${storedRow.instrument}`);
            }
        }

        console.log(`✅ Imported ${numFilePatterns} patterns`);
    }

    /**
     * Import song order lists from GT2 file
     * GT2 has per-voice order lists which we support natively!
     * The parser already converted them to the editor's internal convention.
     * @param {Object} importedData - Parsed data
     * @param {number} songIndex - Which subsong to import (default 0)
     */
    applySongOrders(importedData, songIndex = 0) {
        if (!importedData.subtunes || importedData.subtunes.length === 0) {
            console.warn('No song order data in imported file');
            return;
        }

        if (songIndex >= importedData.subtunes.length) {
            console.warn(`Song index ${songIndex} out of range (max ${importedData.subtunes.length - 1})`);
            songIndex = 0;
        }

        console.log(`🎵 Importing ${importedData.subtunes.length} subtune(s), starting on ${songIndex + 1}...`);

        // Keep ALL subtunes in the song model; songIndex becomes the active one
        gt2PatternManager.song.setSubtunes(importedData.subtunes, songIndex);

        // Refresh the subtune selector if the order editor registered one
        if (typeof window.updateSubtuneSelector === 'function') {
            window.updateSubtuneSelector();
        }

        console.log(`✅ Song order lists imported`);
    }

    /**
     * Import complete song (patterns, orders, instruments, tables)
     * @param {Object} importedData - Parsed data
     * @param {number} songIndex - Which subsong to import (default 0)
     */
    importCompleteSong(importedData, songIndex = 0) {
        const subsongInfo = importedData.subtunes.length > 1 ? ` (subsong ${songIndex + 1}/${importedData.subtunes.length})` : '';
        console.log(`🎼 Importing complete GT2 song: ${importedData.name}${subsongInfo}`);

        // Set song metadata
        gt2PatternManager.song.title = importedData.name || "Imported GT2 Song";
        gt2PatternManager.song.author = importedData.author || "";
        gt2PatternManager.song.copyright = importedData.copyright || "";

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
            const numSubsongs = importedData.subtunes.length;

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
                        if (!inst) return; // Skip null entries
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
                    <div style="font-size: 16px; color: #fff;">${data.name || 'Untitled'}</div>
                </div>
                <div style="margin-bottom: 15px;">
                    <div style="font-size: 14px; color: #aaa;">Author:</div>
                    <div style="font-size: 16px; color: #fff;">${data.author || 'Unknown'}</div>
                </div>
                <div style="margin-bottom: 15px; display: flex; gap: 20px;">
                    <div><span style="color: #aaa;">Patterns:</span> ${data.numFilePatterns}</div>
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
    const title = importedData.name || 'Imported GT2 Song';
    const author = importedData.author || 'Unknown';
    const numPatterns = importedData.numFilePatterns;
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
