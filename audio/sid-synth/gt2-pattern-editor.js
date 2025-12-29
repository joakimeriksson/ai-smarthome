// gt2-pattern-editor.js - GoatTracker2-style pattern editor
// Shows one pattern with all 3 voices side-by-side

import { gt2PatternManager, MAX_PATTERNS, NOTE_EMPTY, NOTE_REST, NOTE_KEYOFF } from './pattern-manager-gt2.js';
import { instruments, setGlobalSIDRegister } from './synth.js';
import { voiceState, getPlaybackState, startPlayback, stopPlayback, togglePause, isPaused } from './sequencer-gt2.js';

export class GT2PatternEditor {
    constructor() {
        this.currentPattern = 0;  // Which pattern we're editing (0-207)
        this.currentVoice = 0;    // Which voice cursor is on (0-2)
        this.currentRow = 0;      // Which row cursor is on
        this.currentColumn = 0;   // Which column: 0=note, 1=instrument, 2=command, 3=cmdData
        this.playbackInterval = null;
        this.editMode = false;    // Whether we're currently editing a cell
        this.editInput = null;    // The input element for editing
        this.mutedVoices = [false, false, false];  // Track muted state per voice
        this.startPlaybackTracking();
        this.setupKeyboardHandler();
    }

    startPlaybackTracking() {
        // Track which patterns are currently displayed
        this.displayedPatterns = [0, 0, 0];

        // Update playback position every 50ms
        this.playbackInterval = setInterval(() => {
            const playbackState = getPlaybackState();

            // Update transport button states
            this.updateTransportButtons();

            if (playbackState.isPlaying) {
                // Check if any playing pattern has changed
                let patternsChanged = false;
                for (let voice = 0; voice < 3; voice++) {
                    const state = voiceState[voice];
                    if (state.isPlaying && state.patternIndex !== this.displayedPatterns[voice]) {
                        patternsChanged = true;
                        this.displayedPatterns[voice] = state.patternIndex;
                    }
                }

                // Re-render if patterns changed to show the new playing patterns
                if (patternsChanged) {
                    console.log(`🔄 Pattern changed during playback, re-rendering track view`);
                    this.renderPattern();
                }

                this.updatePlaybackHighlight();
            } else {
                this.clearPlaybackHighlight();
            }
        }, 50);
    }

    setupKeyboardHandler() {
        document.addEventListener('keydown', (e) => {
            // Don't handle if typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Don't handle if currently editing a cell
            if (this.editMode) {
                return;
            }

            // Don't handle if any modal is open (instrument editor, song editor, etc.)
            const modals = document.querySelectorAll('.modal[style*="display: block"], .modal.show');
            if (modals.length > 0) {
                return;
            }

            // Arrow keys for navigation
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.currentRow = Math.max(0, this.currentRow - 1);
                this.highlightCurrentCell();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.currentRow = Math.min(15, this.currentRow + 1);
                this.highlightCurrentCell();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                if (this.currentColumn > 0) {
                    this.currentColumn--;
                } else if (this.currentVoice > 0) {
                    this.currentVoice--;
                    this.currentColumn = 3;
                }
                this.highlightCurrentCell();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                if (this.currentColumn < 3) {
                    this.currentColumn++;
                } else if (this.currentVoice < 2) {
                    this.currentVoice++;
                    this.currentColumn = 0;
                }
                this.highlightCurrentCell();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault();
                this.clearCurrentCell();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                // Move to next row
                this.currentRow = Math.min(15, this.currentRow + 1);
                this.highlightCurrentCell();
            } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Any printable character - start editing
                e.preventDefault();
                this.startEditing(e.key);
            }
        });
    }

    // Create the GT2-style pattern editor UI
    createUI(containerElement) {
        const editorDiv = document.createElement('div');
        editorDiv.id = 'gt2-pattern-editor';
        editorDiv.innerHTML = `
            <div class="gt2-song-info">
                <div class="gt2-song-info-left">
                    <div class="gt2-transport-buttons">
                        <button class="gt2-transport-btn" id="gt2-play-btn" title="Play">▶</button>
                        <button class="gt2-transport-btn" id="gt2-pause-btn" title="Pause">⏸</button>
                        <button class="gt2-transport-btn" id="gt2-stop-btn" title="Stop">⏹</button>
                    </div>
                    <div class="gt2-song-title" id="gt2-song-title">Untitled</div>
                </div>
                <div class="gt2-song-meta">
                    <span id="gt2-song-author">Author: Unknown</span>
                    <span id="gt2-song-stats">| Patterns: 0 | Speed: 6</span>
                </div>
            </div>
            <div class="gt2-editor-header">
                <h3>Track View</h3>
                <div class="pattern-controls">
                    <span id="gt2-song-position">Song Position: 00</span>
                </div>
            </div>
            <div class="gt2-pattern-view">
                <div class="gt2-pattern-headers">
                    <div class="gt2-row-number-header-fixed">Row</div>
                    <div class="gt2-voice-headers-container">
                        <div class="gt2-voice-header" id="gt2-voice-0-header">Voice 0</div>
                        <div class="gt2-voice-header" id="gt2-voice-1-header">Voice 1</div>
                        <div class="gt2-voice-header" id="gt2-voice-2-header">Voice 2</div>
                    </div>
                </div>
                <div class="gt2-pattern-grid-container">
                    <div class="gt2-row-numbers" id="gt2-row-numbers"></div>
                    <div class="gt2-pattern-grid" id="gt2-pattern-grid">
                        <div class="gt2-voice-column" id="gt2-voice-0"></div>
                        <div class="gt2-voice-column" id="gt2-voice-1"></div>
                        <div class="gt2-voice-column" id="gt2-voice-2"></div>
                    </div>
                </div>
            </div>
            <div class="gt2-editor-help">
                <strong>Track View:</strong> Shows the 3 patterns playing at current song position |
                Each voice plays its own pattern from the order list
            </div>
        `;

        containerElement.appendChild(editorDiv);

        // Setup event handlers
        this.setupEventHandlers();

        // Initial render
        this.renderPattern();

        // Add CSS
        this.injectCSS();
    }

    setupEventHandlers() {
        // Transport buttons
        const playBtn = document.getElementById('gt2-play-btn');
        const pauseBtn = document.getElementById('gt2-pause-btn');
        const stopBtn = document.getElementById('gt2-stop-btn');

        if (playBtn) {
            playBtn.addEventListener('click', () => {
                startPlayback();
                this.updateTransportButtons();
            });
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                togglePause();
                this.updateTransportButtons();
            });
        }

        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                stopPlayback();
                this.updateTransportButtons();
            });
        }
    }

    updateTransportButtons() {
        const playBtn = document.getElementById('gt2-play-btn');
        const pauseBtn = document.getElementById('gt2-pause-btn');
        const stopBtn = document.getElementById('gt2-stop-btn');
        const playbackState = getPlaybackState();

        if (playBtn) {
            playBtn.classList.toggle('active', playbackState.isPlaying && !isPaused);
        }
        if (pauseBtn) {
            pauseBtn.classList.toggle('active', isPaused);
        }
        if (stopBtn) {
            stopBtn.classList.toggle('active', !playbackState.isPlaying);
        }
    }

    renderPattern() {
        console.log(`🔵 renderPattern called`);

        // Get patterns for each voice from the order list at current order position
        const voicePatterns = [];
        const maxLength = 16;

        for (let voice = 0; voice < 3; voice++) {
            const state = voiceState[voice];
            const orderList = gt2PatternManager.song.orderLists[voice];

            // Use playing pattern if available, otherwise first pattern in order list
            let patternIndex = 0;
            if (state.isPlaying) {
                patternIndex = state.patternIndex;
            } else {
                // Get first pattern from order list
                if (orderList[state.orderPosition] < MAX_PATTERNS) {
                    patternIndex = orderList[state.orderPosition];
                }
            }

            // Update displayed patterns tracking
            this.displayedPatterns[voice] = patternIndex;

            console.log(`  Voice ${voice}: showing pattern ${patternIndex} (orderPos=${state.orderPosition})`);

            voicePatterns.push({
                index: patternIndex,
                pattern: gt2PatternManager.patterns[patternIndex]
            });

            // Debug: check what row 3 contains for voice 0
            if (voice === 0) {
                const testRow = gt2PatternManager.patterns[patternIndex].getRow(3);
                console.log(`  Voice 0, pattern ${patternIndex}, row 3: note=${testRow?.note}, instr=${testRow?.instrument}`);
            }
        }

        // Find maximum length among the 3 patterns
        const displayLength = Math.max(
            voicePatterns[0].pattern.length,
            voicePatterns[1].pattern.length,
            voicePatterns[2].pattern.length
        );

        // Update song position display
        const songPosEl = document.getElementById('gt2-song-position');
        if (songPosEl) {
            const pos0 = voiceState[0].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const pos1 = voiceState[1].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const pos2 = voiceState[2].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const isPlaying = getPlaybackState().isPlaying;
            const playSymbol = isPlaying ? '▶' : '■';
            songPosEl.textContent = `${playSymbol} Pos: ${pos0} ${pos1} ${pos2}`;
        }

        // Update fixed voice headers to show pattern numbers and mute buttons
        for (let voice = 0; voice < 3; voice++) {
            const header = document.getElementById(`gt2-voice-${voice}-header`);
            if (header) {
                const patNum = voicePatterns[voice].index.toString(10).padStart(2, '0');

                // Check if mute button already exists
                let muteBtn = header.querySelector('.gt2-mute-btn');

                if (!muteBtn) {
                    // First time - create the full header with mute button
                    header.innerHTML = `
                        <span>Voice ${voice} [${patNum}]</span>
                        <button class="gt2-mute-btn ${this.mutedVoices[voice] ? 'muted' : ''}" data-voice="${voice}">
                            ${this.mutedVoices[voice] ? '🔇' : '🔊'}
                        </button>
                    `;

                    // Add click handler for mute button
                    muteBtn = header.querySelector('.gt2-mute-btn');
                    muteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleMute(voice);
                    });
                } else {
                    // Button exists - just update the text span
                    const textSpan = header.querySelector('span');
                    if (textSpan) {
                        textSpan.textContent = `Voice ${voice} [${patNum}]`;
                    }
                    // Update button state if mute status changed
                    muteBtn.className = `gt2-mute-btn ${this.mutedVoices[voice] ? 'muted' : ''}`;
                    muteBtn.textContent = this.mutedVoices[voice] ? '🔇' : '🔊';
                }
            }
        }

        // Render row numbers (no header - it's in the fixed header row)
        const rowNumbersDiv = document.getElementById('gt2-row-numbers');
        rowNumbersDiv.innerHTML = '';
        for (let row = 0; row < displayLength; row++) {
            const rowNum = document.createElement('div');
            rowNum.className = 'gt2-row-number';
            rowNum.textContent = row.toString(10).padStart(2, '0');
            rowNumbersDiv.appendChild(rowNum);
        }

        // Render each voice column with its own pattern
        for (let voice = 0; voice < 3; voice++) {
            const voiceDiv = document.getElementById(`gt2-voice-${voice}`);
            const voicePattern = voicePatterns[voice].pattern;
            const voicePatternIndex = voicePatterns[voice].index;

            // Clear all existing rows (no header in this div anymore)
            voiceDiv.innerHTML = '';

            // Render rows
            for (let row = 0; row < displayLength; row++) {
                const rowDiv = document.createElement('div');
                rowDiv.className = 'gt2-pattern-row';
                rowDiv.dataset.voice = voice;
                rowDiv.dataset.row = row;
                rowDiv.dataset.patternIndex = voicePatternIndex;

                // Get row data if within this pattern's length
                const rowData = row < voicePattern.length ? voicePattern.getRow(row) : { note: 0, instrument: 0, command: 0, cmdData: 0 };

                // Debug: log a few rows to see what we're rendering
                if (row <= 5 && voice === 0) {
                    console.log(`  Rendering voice ${voice}, row ${row}: note=${rowData.note}, instr=${rowData.instrument}`);
                }

                // Note
                const noteSpan = document.createElement('span');
                noteSpan.className = 'gt2-note';
                noteSpan.textContent = this.formatNote(rowData.note);
                rowDiv.appendChild(noteSpan);

                // Instrument
                const instrSpan = document.createElement('span');
                instrSpan.className = 'gt2-instrument';
                instrSpan.textContent = this.formatHex(rowData.instrument, 2);
                rowDiv.appendChild(instrSpan);

                // Command
                const cmdSpan = document.createElement('span');
                cmdSpan.className = 'gt2-command';
                cmdSpan.textContent = this.formatHex(rowData.command, 2);
                rowDiv.appendChild(cmdSpan);

                // Command data
                const cmdDataSpan = document.createElement('span');
                cmdDataSpan.className = 'gt2-cmddata';
                cmdDataSpan.textContent = this.formatHex(rowData.cmdData, 2);
                rowDiv.appendChild(cmdDataSpan);

                // Click to edit
                rowDiv.addEventListener('click', (e) => {
                    this.currentVoice = voice;
                    this.currentRow = row;

                    // Determine which column was clicked
                    if (e.target.classList.contains('gt2-note')) {
                        this.currentColumn = 0;
                    } else if (e.target.classList.contains('gt2-instrument')) {
                        this.currentColumn = 1;
                    } else if (e.target.classList.contains('gt2-command')) {
                        this.currentColumn = 2;
                    } else if (e.target.classList.contains('gt2-cmddata')) {
                        this.currentColumn = 3;
                    }

                    this.highlightCurrentCell();
                });

                voiceDiv.appendChild(rowDiv);
            }
        }

        this.highlightCurrentCell();
    }

    highlightCurrentCell() {
        // Remove previous edit highlights
        document.querySelectorAll('.gt2-pattern-row').forEach(el => el.classList.remove('gt2-current-row'));
        document.querySelectorAll('.gt2-current-cell').forEach(el => el.classList.remove('gt2-current-cell'));

        // Highlight current edit row
        const selector = `.gt2-pattern-row[data-voice="${this.currentVoice}"][data-row="${this.currentRow}"]`;
        const currentRow = document.querySelector(selector);
        if (currentRow) {
            currentRow.classList.add('gt2-current-row');

            // Highlight specific column
            const columnClasses = ['gt2-note', 'gt2-instrument', 'gt2-command', 'gt2-cmddata'];
            const cellSelector = `.${columnClasses[this.currentColumn]}`;
            const cell = currentRow.querySelector(cellSelector);
            if (cell) {
                cell.classList.add('gt2-current-cell');
            }

            currentRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    startEditing(initialChar = null) {
        const selector = `.gt2-pattern-row[data-voice="${this.currentVoice}"][data-row="${this.currentRow}"]`;
        const currentRow = document.querySelector(selector);
        if (!currentRow) return;

        const columnClasses = ['gt2-note', 'gt2-instrument', 'gt2-command', 'gt2-cmddata'];
        const cell = currentRow.querySelector(`.${columnClasses[this.currentColumn]}`);
        if (!cell) return;

        // Create input for editing
        const input = document.createElement('input');
        input.type = 'text';
        // If we have an initial character, start with it; otherwise use existing value
        input.value = initialChar !== null ? initialChar.toUpperCase() : cell.textContent;
        input.style.width = '100%';
        input.style.background = '#000';
        input.style.color = '#0ff';
        input.style.border = '1px solid #0ff';
        input.style.fontFamily = 'inherit';
        input.style.fontSize = 'inherit';

        this.editInput = input;
        this.editMode = true;

        // Replace cell content with input
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();

        // If initial char, move cursor to end; otherwise select all
        if (initialChar !== null) {
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            input.select();
        }

        // Handle input events
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.finishEditing(true);
                this.currentRow = Math.min(15, this.currentRow + 1);
                this.highlightCurrentCell();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.finishEditing(false);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.finishEditing(true);
                this.currentRow = Math.min(15, this.currentRow + 1);
                this.highlightCurrentCell();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.finishEditing(true);
                this.currentRow = Math.max(0, this.currentRow - 1);
                this.highlightCurrentCell();
            }
        });

        input.addEventListener('blur', () => {
            this.finishEditing(true);
        });
    }

    finishEditing(save) {
        if (!this.editMode || !this.editInput) return;

        const value = this.editInput.value.trim().toUpperCase();
        console.log(`🔵 finishEditing: save=${save}, value="${value}"`);
        this.editMode = false;

        if (save && value && value !== '.' && value !== '..') {
            console.log(`  Calling setCellValue...`);
            this.setCellValue(value);
        } else {
            console.log(`  NOT saving (save=${save}, value="${value}")`);
        }

        this.editInput = null;
        console.log(`  Calling renderPattern...`);
        this.renderPattern();
        this.highlightCurrentCell();
    }

    setCellValue(value) {
        console.log(`🔵 setCellValue: value="${value}", column=${this.currentColumn}, voice=${this.currentVoice}, row=${this.currentRow}`);

        // Get the pattern for this voice - same logic as renderPattern
        const state = voiceState[this.currentVoice];
        const orderList = gt2PatternManager.song.orderLists[this.currentVoice];

        let patternIndex = 0;
        if (state.isPlaying) {
            patternIndex = state.patternIndex;
        } else {
            // Get pattern from order list at current position
            if (orderList[state.orderPosition] < MAX_PATTERNS) {
                patternIndex = orderList[state.orderPosition];
            }
        }

        console.log(`  Editing pattern ${patternIndex} (orderPosition=${state.orderPosition})`);

        const pattern = gt2PatternManager.patterns[patternIndex];
        const existingRow = pattern.getRow(this.currentRow);
        // Make a copy to avoid mutating the original
        const rowData = existingRow ? { ...existingRow } : { note: 0, instrument: 0, command: 0, cmdData: 0 };

        console.log(`  Before: rowData=`, rowData);

        // Update the appropriate field
        if (this.currentColumn === 0) {
            // Note column
            if (value === '---' || value === 'R') {
                rowData.note = NOTE_REST;
            } else if (value === '===' || value === 'K') {
                rowData.note = NOTE_KEYOFF;
            } else if (value === '...' || value === '') {
                rowData.note = NOTE_EMPTY;
            } else {
                // Try to parse as note name (e.g., C-4, A#3)
                const noteNum = gt2PatternManager.noteNameToNumber(value);
                console.log(`  noteNameToNumber("${value}") = ${noteNum}`);
                if (noteNum > 0) {
                    rowData.note = noteNum;
                }
            }
        } else if (this.currentColumn === 1) {
            // Instrument column
            const num = parseInt(value, 16);
            console.log(`  parseInt("${value}", 16) = ${num}`);
            if (!isNaN(num) && num >= 0 && num < 256) {
                rowData.instrument = num;
            }
        } else if (this.currentColumn === 2) {
            // Command column
            const num = parseInt(value, 16);
            console.log(`  parseInt("${value}", 16) = ${num}`);
            if (!isNaN(num) && num >= 0 && num < 256) {
                rowData.command = num;
            }
        } else if (this.currentColumn === 3) {
            // Command data column
            const num = parseInt(value, 16);
            console.log(`  parseInt("${value}", 16) = ${num}`);
            if (!isNaN(num) && num >= 0 && num < 256) {
                rowData.cmdData = num;
            }
        }

        console.log(`  After: rowData=`, rowData);

        // Write back to pattern - setRow expects individual parameters, not an object
        pattern.setRow(this.currentRow, rowData.note, rowData.instrument, rowData.command, rowData.cmdData);
    }

    clearCurrentCell() {
        // Get the pattern for this voice - same logic as renderPattern
        const state = voiceState[this.currentVoice];
        const orderList = gt2PatternManager.song.orderLists[this.currentVoice];

        let patternIndex = 0;
        if (state.isPlaying) {
            patternIndex = state.patternIndex;
        } else {
            // Get pattern from order list at current position
            if (orderList[state.orderPosition] < MAX_PATTERNS) {
                patternIndex = orderList[state.orderPosition];
            }
        }

        const pattern = gt2PatternManager.patterns[patternIndex];
        const existingRow = pattern.getRow(this.currentRow);
        // Make a copy to avoid mutating the original
        const rowData = existingRow ? { ...existingRow } : { note: 0, instrument: 0, command: 0, cmdData: 0 };

        // Clear the appropriate field
        if (this.currentColumn === 0) {
            rowData.note = NOTE_EMPTY;
        } else if (this.currentColumn === 1) {
            rowData.instrument = 0;
        } else if (this.currentColumn === 2) {
            rowData.command = 0;
        } else if (this.currentColumn === 3) {
            rowData.cmdData = 0;
        }

        // Write back to pattern - setRow expects individual parameters, not an object
        pattern.setRow(this.currentRow, rowData.note, rowData.instrument, rowData.command, rowData.cmdData);
        this.renderPattern();
        this.highlightCurrentCell();
    }

    toggleMute(voice) {
        this.mutedVoices[voice] = !this.mutedVoices[voice];

        // Send mute command to worklet
        if (typeof window.sidWorkletNode !== 'undefined' && window.sidWorkletNode) {
            window.sidWorkletNode.port.postMessage({
                type: this.mutedVoices[voice] ? 'muteVoice' : 'unmuteVoice',
                voice: voice
            });
        }

        // If muting, immediately clear the gate bit for this voice to stop sound
        if (this.mutedVoices[voice]) {
            const voiceOffset = voice * 7;  // Each voice has 7 registers
            setGlobalSIDRegister(voiceOffset + 0x04, 0x00);  // Control register - clear gate
        }

        console.log(`Voice ${voice} ${this.mutedVoices[voice] ? 'muted' : 'unmuted'}`);

        // Re-render to update button state
        this.renderPattern();
    }

    isVoiceMuted(voice) {
        return this.mutedVoices[voice];
    }

    updatePlaybackHighlight() {
        // Remove previous playback highlights first
        document.querySelectorAll('.gt2-pattern-row').forEach(el => el.classList.remove('gt2-playing-row'));
        document.querySelectorAll('.gt2-row-number').forEach(el => el.classList.remove('playing'));

        // Update song position display
        const songPosEl = document.getElementById('gt2-song-position');
        if (songPosEl) {
            const pos0 = voiceState[0].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const pos1 = voiceState[1].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const pos2 = voiceState[2].orderPosition.toString(16).toUpperCase().padStart(2, '0');
            const isPlaying = getPlaybackState().isPlaying;
            const playSymbol = isPlaying ? '▶' : '■';
            songPosEl.textContent = `${playSymbol} Pos: ${pos0} ${pos1} ${pos2}`;
        }

        // Track which rows are playing for row number highlighting
        const playingRows = new Set();

        // Update voice headers with current playing patterns and highlight rows
        for (let voice = 0; voice < 3; voice++) {
            const state = voiceState[voice];

            if (state.isPlaying) {
                // Update fixed voice header with playing pattern number
                const header = document.getElementById(`gt2-voice-${voice}-header`);
                if (header) {
                    const patNum = state.patternIndex.toString(10).padStart(2, '0');
                    // Only update the text span, not the entire header (to preserve mute button)
                    const textSpan = header.querySelector('span');
                    if (textSpan) {
                        textSpan.textContent = `Voice ${voice} [${patNum}]`;
                    }
                }

                // Highlight the playing row
                const selector = `.gt2-pattern-row[data-voice="${voice}"][data-row="${state.patternRow}"]`;
                const playingRow = document.querySelector(selector);

                // Debug logging (only log occasionally to avoid spam)
                if (Math.random() < 0.05) {  // Log ~5% of the time
                    console.log(`🎵 Highlight V${voice}: row=${state.patternRow}, pat=${state.patternIndex}, found=${!!playingRow}`);
                    if (!playingRow) {
                        // Check what rows exist
                        const allRowsForVoice = document.querySelectorAll(`.gt2-pattern-row[data-voice="${voice}"]`);
                        console.log(`  Available rows for V${voice}:`, Array.from(allRowsForVoice).map(r => r.dataset.row).join(', '));
                    }
                }

                if (playingRow) {
                    playingRow.classList.add('gt2-playing-row');
                    playingRows.add(state.patternRow);
                }
            }
        }

        // Highlight row numbers - these should match exactly with the pattern rows
        playingRows.forEach(rowNum => {
            const rowNumbers = document.querySelectorAll('.gt2-row-number');
            // Row numbers: index 0 = header, index 1 = row 0, index 2 = row 1, etc.
            // So for row N, we want index N+1
            if (rowNumbers[rowNum + 1]) {
                rowNumbers[rowNum + 1].classList.add('playing');
            }
        });
    }

    clearPlaybackHighlight() {
        document.querySelectorAll('.gt2-pattern-row').forEach(el => el.classList.remove('gt2-playing-row'));
    }

    updateSongInfo(title, author, stats) {
        const titleEl = document.getElementById('gt2-song-title');
        const authorEl = document.getElementById('gt2-song-author');
        const statsEl = document.getElementById('gt2-song-stats');

        if (titleEl) {
            titleEl.textContent = title || 'Untitled';
        }
        if (authorEl) {
            authorEl.textContent = `Author: ${author || 'Unknown'}`;
        }
        if (statsEl) {
            statsEl.textContent = stats || '';
        }
    }

    setSongTitle(title) {
        const titleEl = document.getElementById('gt2-song-title');
        if (titleEl) {
            titleEl.textContent = title || 'Untitled';
        }
    }

    setSongAuthor(author) {
        const authorEl = document.getElementById('gt2-song-author');
        if (authorEl) {
            authorEl.textContent = `Author: ${author || 'Unknown'}`;
        }
    }

    setSongStats(patternCount, speed) {
        const statsEl = document.getElementById('gt2-song-stats');
        if (statsEl) {
            statsEl.textContent = `| Patterns: ${patternCount} | Speed: ${speed}`;
        }
    }

    formatNote(noteNum) {
        if (noteNum === NOTE_EMPTY || noteNum === 0 || noteNum === undefined || noteNum === null) return '...';
        if (noteNum === NOTE_REST) return 'R--';
        if (noteNum === NOTE_KEYOFF) return '===';
        const noteName = gt2PatternManager.noteNumberToName(noteNum);
        // If we get an invalid note name, show as empty
        if (!noteName || noteName === 'undefined' || noteName.includes('NaN')) return '...';
        return noteName;
    }

    formatHex(value, digits) {
        if (!value || value === 0) return '.'.repeat(digits);
        return value.toString(16).toUpperCase().padStart(digits, '0');
    }

    injectCSS() {
        if (document.getElementById('gt2-pattern-editor-styles')) return;

        const style = document.createElement('style');
        style.id = 'gt2-pattern-editor-styles';
        style.textContent = `
            #gt2-pattern-editor {
                padding: 10px;
                background: #1a1a1a;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                font-size: 14px;
            }

            .gt2-song-info {
                padding: 8px 15px;
                background: linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%);
                border: 1px solid #00aa00;
                border-bottom: none;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .gt2-song-info-left {
                display: flex;
                align-items: center;
                gap: 15px;
            }

            .gt2-transport-buttons {
                display: flex;
                gap: 4px;
            }

            .gt2-transport-btn {
                width: 28px;
                height: 28px;
                border: 1px solid #00aa00;
                background: #1a1a1a;
                color: #00ff00;
                cursor: pointer;
                font-size: 12px;
                border-radius: 3px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.1s;
            }

            .gt2-transport-btn:hover {
                background: #003300;
                border-color: #00ff00;
            }

            .gt2-transport-btn.active {
                background: #00aa00;
                color: #000;
                border-color: #00ff00;
                box-shadow: 0 0 8px #00ff00;
            }

            #gt2-play-btn.active {
                background: #00cc00;
            }

            #gt2-pause-btn.active {
                background: #ccaa00;
                color: #000;
                border-color: #ffcc00;
                box-shadow: 0 0 8px #ffcc00;
            }

            #gt2-stop-btn.active {
                background: #333;
            }

            .gt2-song-title {
                font-size: 16px;
                font-weight: bold;
                color: #00ff00;
                text-shadow: 0 0 8px #00ff00;
            }

            .gt2-song-meta {
                font-size: 11px;
                color: #00aa00;
            }

            .gt2-song-meta span {
                margin-left: 12px;
            }

            .gt2-editor-header {
                margin-bottom: 10px;
                padding: 10px;
                background: #2a2a2a;
                border: 1px solid #00ff00;
            }

            .pattern-controls {
                margin-top: 10px;
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            .pattern-controls label {
                display: flex;
                align-items: center;
                gap: 5px;
            }

            .pattern-controls input {
                width: 60px;
                background: #000;
                color: #00ff00;
                border: 1px solid #00ff00;
                padding: 2px 5px;
            }

            .pattern-controls button {
                background: #003300;
                color: #00ff00;
                border: 1px solid #00ff00;
                padding: 5px 10px;
                cursor: pointer;
            }

            .pattern-controls button:hover {
                background: #005500;
            }

            .gt2-pattern-view {
                border: 1px solid #00ff00;
                background: #000;
            }

            .gt2-pattern-headers {
                display: flex;
                gap: 5px;
                background: #2a2a2a;
                padding: 5px;
                border-bottom: 2px solid #00ff00;
            }

            .gt2-row-number-header-fixed {
                font-weight: bold;
                text-align: center;
                padding: 5px;
                background: #2a2a2a;
                min-width: 40px;
                width: 40px;
            }

            .gt2-voice-headers-container {
                display: flex;
                gap: 10px;
                flex: 1;
            }

            .gt2-pattern-grid-container {
                display: flex;
                gap: 5px;
                max-height: 500px;
                overflow-y: auto;
                background: #000;
                padding: 5px;
            }

            .gt2-row-numbers {
                display: flex;
                flex-direction: column;
                background: #1a1a1a;
                padding: 2px;
                min-width: 40px;
                width: 40px;
            }

            .gt2-row-number {
                padding: 3px 5px;
                text-align: right;
                color: #888;
                min-width: 30px;
            }

            .gt2-pattern-grid {
                display: flex;
                gap: 10px;
                flex: 1;
            }

            .gt2-voice-column {
                flex: 1;
                display: flex;
                flex-direction: column;
                min-width: 200px;
            }

            .gt2-voice-header {
                font-weight: bold;
                text-align: center;
                padding: 5px;
                background: #2a2a2a;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex: 1;
                min-width: 200px;
            }

            .gt2-mute-btn {
                background: #003300;
                color: #00ff00;
                border: 1px solid #00ff00;
                padding: 2px 6px;
                font-size: 12px;
                cursor: pointer;
                border-radius: 3px;
                min-width: 30px;
            }

            .gt2-mute-btn:hover {
                background: #005500;
            }

            .gt2-mute-btn.muted {
                background: #550000;
                color: #ff5555;
                border-color: #ff5555;
            }

            .gt2-pattern-number {
                font-size: 11px;
                color: #ffff00;
                font-weight: normal;
                margin-left: 8px;
            }

            .gt2-pattern-row {
                display: flex;
                gap: 5px;
                padding: 2px 5px;
                cursor: pointer;
                border: 1px solid transparent;
            }

            .gt2-pattern-row:hover {
                background: #1a3a1a;
            }

            .gt2-pattern-row.gt2-current-row {
                background: #003300;
                border: 1px solid #00ff00;
            }

            .gt2-current-cell {
                background: #005500 !important;
                outline: 2px solid #00ff00;
                outline-offset: -2px;
            }

            .gt2-pattern-row.gt2-playing-row {
                background: #00aa00 !important;  /* Bright green for playing row */
                border: 2px solid #00ff00;
                color: #ffffff;
                font-weight: bold;
                box-shadow: 0 0 8px #00ff00;  /* Glow effect */
            }

            .gt2-pattern-row.gt2-playing-row.gt2-current-row {
                background: #00dd00 !important;  /* Even brighter if also cursor row */
                border: 3px solid #ffff00;
                box-shadow: 0 0 12px #00ff00;
            }

            .gt2-row-number.playing {
                background: #00aa00;  /* Match row highlighting */
                color: #ffffff;
                font-weight: bold;
                box-shadow: 0 0 4px #00ff00;
            }

            .gt2-note {
                width: 40px;
                color: #ffff00;
            }

            .gt2-instrument {
                width: 30px;
                color: #00ffff;
            }

            .gt2-command {
                width: 30px;
                color: #ff00ff;
            }

            .gt2-cmddata {
                width: 30px;
                color: #ff8800;
            }

            .gt2-editor-help {
                margin-top: 10px;
                padding: 10px;
                background: #2a2a2a;
                border: 1px solid #00ff00;
                font-size: 12px;
            }
        `;
        document.head.appendChild(style);
    }
}

// Initialize GT2 pattern editor
export function initGT2PatternEditor() {
    const container = document.getElementById('gt2-pattern-editor-container');
    if (!container) {
        console.warn('GT2 pattern editor container not found');
        return;
    }

    const editor = new GT2PatternEditor();
    editor.createUI(container);

    // Make it globally available
    if (typeof window !== 'undefined') {
        window.gt2PatternEditor = editor;
    }

    return editor;
}
