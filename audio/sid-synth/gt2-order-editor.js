// gt2-order-editor.js - GoatTracker2-style order list editor
// Shows 3 independent order lists (one per voice)

import { gt2PatternManager, LOOPSONG, ENDSONG, MAX_PATTERNS } from './pattern-manager-gt2.js';
import { voiceState, getPlaybackState } from './sequencer-gt2.js';

export class GT2OrderEditor {
    constructor() {
        this.currentVoice = 0;
        this.currentPosition = 0;
        this.playbackInterval = null;
        this.startPlaybackTracking();
    }

    startPlaybackTracking() {
        // Update playback position every 50ms
        this.playbackInterval = setInterval(() => {
            if (getPlaybackState().isPlaying) {
                this.updatePlaybackHighlight();
            } else {
                this.clearPlaybackHighlight();
            }
        }, 50);
    }

    createUI(containerElement) {
        const editorDiv = document.createElement('div');
        editorDiv.id = 'gt2-order-editor';
        editorDiv.innerHTML = `
            <div class="gt2-order-header">
                <h3>Order Lists (Song Sequence)</h3>
                <div class="order-controls">
                    <button id="gt2-add-order">Add Pattern</button>
                    <button id="gt2-insert-order">Insert</button>
                    <button id="gt2-delete-order">Delete</button>
                    <button id="gt2-add-loop">Add Loop</button>
                    <button id="gt2-add-end">Add End</button>
                </div>
            </div>
            <div class="gt2-order-grid">
                <div class="gt2-order-column">
                    <div class="gt2-order-column-header">Voice 0</div>
                    <div class="gt2-order-list" id="gt2-order-voice-0"></div>
                </div>
                <div class="gt2-order-column">
                    <div class="gt2-order-column-header">Voice 1</div>
                    <div class="gt2-order-list" id="gt2-order-voice-1"></div>
                </div>
                <div class="gt2-order-column">
                    <div class="gt2-order-column-header">Voice 2</div>
                    <div class="gt2-order-list" id="gt2-order-voice-2"></div>
                </div>
            </div>
            <div class="gt2-order-help">
                <strong>Order List Commands:</strong>
                00-CF: Pattern number (0-${MAX_PATTERNS-1}) |
                R1-R16: Repeat pattern 1-16 times |
                +0 to +14: Transpose up (halftones) |
                -1 to -15: Transpose down (halftones) |
                LOOP→XX: Loop to position |
                END: End of song
            </div>
        `;

        containerElement.appendChild(editorDiv);

        this.setupEventHandlers();
        this.renderOrderLists();
        this.injectCSS();
    }

    setupEventHandlers() {
        document.getElementById('gt2-add-order').addEventListener('click', () => {
            const pattern = prompt('Enter pattern number (0-' + (MAX_PATTERNS-1) + '):');
            if (pattern !== null) {
                const patNum = parseInt(pattern);
                if (patNum >= 0 && patNum < MAX_PATTERNS) {
                    gt2PatternManager.song.addToOrder(this.currentVoice, patNum);
                    this.renderOrderLists();
                }
            }
        });

        document.getElementById('gt2-add-loop').addEventListener('click', () => {
            const pos = prompt('Loop to position:');
            if (pos !== null) {
                const loopPos = parseInt(pos);
                const orderList = gt2PatternManager.song.orderLists[this.currentVoice];
                const insertPos = orderList.indexOf(ENDSONG);
                if (insertPos >= 0) {
                    orderList.splice(insertPos, 0, LOOPSONG, loopPos);
                } else {
                    orderList.push(LOOPSONG, loopPos);
                }
                this.renderOrderLists();
            }
        });

        document.getElementById('gt2-add-end').addEventListener('click', () => {
            const orderList = gt2PatternManager.song.orderLists[this.currentVoice];
            if (!orderList.includes(ENDSONG)) {
                orderList.push(ENDSONG);
                this.renderOrderLists();
            }
        });

        document.getElementById('gt2-delete-order').addEventListener('click', () => {
            const orderList = gt2PatternManager.song.orderLists[this.currentVoice];
            if (this.currentPosition >= 0 && this.currentPosition < orderList.length) {
                orderList.splice(this.currentPosition, 1);
                this.renderOrderLists();
            }
        });
    }

    renderOrderLists() {
        for (let voice = 0; voice < 3; voice++) {
            const listDiv = document.getElementById(`gt2-order-voice-${voice}`);
            listDiv.innerHTML = '';

            const orderList = gt2PatternManager.song.orderLists[voice];

            // Skip rendering parameter bytes for LOOPSONG and special commands
            let skipNext = false;

            orderList.forEach((entry, index) => {
                // Skip this entry if it's a parameter for previous command
                if (skipNext) {
                    skipNext = false;
                    return;
                }

                const entryDiv = document.createElement('div');
                entryDiv.className = 'gt2-order-entry';
                entryDiv.dataset.voice = voice;
                entryDiv.dataset.position = index;

                const posSpan = document.createElement('span');
                posSpan.className = 'gt2-order-pos';
                posSpan.textContent = index.toString(16).toUpperCase().padStart(2, '0');

                const valueSpan = document.createElement('span');
                valueSpan.className = 'gt2-order-value';
                valueSpan.textContent = this.formatOrderEntry(entry, orderList, index);

                entryDiv.appendChild(posSpan);
                entryDiv.appendChild(valueSpan);

                entryDiv.addEventListener('click', () => {
                    this.currentVoice = voice;
                    this.currentPosition = index;
                    this.highlightCurrent();
                });

                listDiv.appendChild(entryDiv);

                // Mark to skip next entry if this was a command with parameter
                // LOOPSONG (0xFE) and REPEAT (0xD0-0xDF) take a parameter byte
                // TRANSPOSE commands (0xE0-0xFD) don't use a parameter in GT2
                if (entry === LOOPSONG || (entry >= 0xD0 && entry <= 0xDF)) {
                    skipNext = true;
                }
            });
        }

        this.highlightCurrent();
    }

    formatOrderEntry(entry, orderList, index) {
        if (entry === ENDSONG) {
            return 'END';
        } else if (entry === LOOPSONG) {
            const loopPos = orderList[index + 1] || 0;
            return `LOOP→${loopPos.toString(16).toUpperCase().padStart(2, '0')}`;
        } else if (entry >= 0xD0 && entry <= 0xDF) {
            // REPEAT commands (0xD0-0xDF): R1-R16 (R0 = repeat 16 times)
            const param = orderList[index + 1] || 0;
            const repeatCount = param === 0 ? 16 : param;
            return `R${repeatCount}`;
        } else if (entry >= 0xE0 && entry <= 0xEE) {
            // Transpose UP (0xE0-0xEE): +0 to +14 halftones
            const transposeAmount = entry - 0xE0;
            return `+${transposeAmount}`;
        } else if (entry >= 0xEF && entry <= 0xFD) {
            // Transpose DOWN (0xEF-0xFD): -1 to -15 halftones
            const transposeAmount = entry - 0xEE;
            return `-${transposeAmount}`;
        } else if (entry < MAX_PATTERNS) {
            return entry.toString(16).toUpperCase().padStart(2, '0');
        } else {
            console.warn(`Invalid order entry at index ${index}: ${entry} (0x${entry.toString(16)}) - MAX_PATTERNS=${MAX_PATTERNS}`);
            return `??[${entry.toString(16).toUpperCase()}]`;
        }
    }

    highlightCurrent() {
        document.querySelectorAll('.gt2-order-entry').forEach(el => {
            el.classList.remove('gt2-current-order');
        });

        const selector = `.gt2-order-entry[data-voice="${this.currentVoice}"][data-position="${this.currentPosition}"]`;
        const current = document.querySelector(selector);
        if (current) {
            current.classList.add('gt2-current-order');
            current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    updatePlaybackHighlight() {
        // Remove previous playback highlights
        document.querySelectorAll('.gt2-order-entry').forEach(el => el.classList.remove('gt2-playing-order'));

        // Highlight currently playing order positions for each voice
        for (let voice = 0; voice < 3; voice++) {
            const state = voiceState[voice];
            if (state.isPlaying) {
                const selector = `.gt2-order-entry[data-voice="${voice}"][data-position="${state.orderPosition}"]`;
                const playingEntry = document.querySelector(selector);
                if (playingEntry) {
                    playingEntry.classList.add('gt2-playing-order');
                }
            }
        }
    }

    clearPlaybackHighlight() {
        document.querySelectorAll('.gt2-order-entry').forEach(el => el.classList.remove('gt2-playing-order'));
    }

    injectCSS() {
        if (document.getElementById('gt2-order-editor-styles')) return;

        const style = document.createElement('style');
        style.id = 'gt2-order-editor-styles';
        style.textContent = `
            #gt2-order-editor {
                padding: 10px;
                background: #1a1a1a;
                color: #00ff00;
                font-family: 'Courier New', monospace;
                font-size: 14px;
            }

            .gt2-order-header {
                margin-bottom: 10px;
                padding: 10px;
                background: #2a2a2a;
                border: 1px solid #00ff00;
            }

            .order-controls {
                margin-top: 10px;
                display: flex;
                gap: 10px;
                flex-wrap: wrap;
            }

            .order-controls button {
                background: #003300;
                color: #00ff00;
                border: 1px solid #00ff00;
                padding: 5px 10px;
                cursor: pointer;
            }

            .order-controls button:hover {
                background: #005500;
            }

            .gt2-order-grid {
                display: flex;
                gap: 10px;
                border: 1px solid #00ff00;
                background: #000;
                padding: 10px;
            }

            .gt2-order-column {
                flex: 1;
                display: flex;
                flex-direction: column;
            }

            .gt2-order-column-header {
                font-weight: bold;
                text-align: center;
                padding: 5px;
                background: #2a2a2a;
                border-bottom: 2px solid #00ff00;
                margin-bottom: 5px;
            }

            .gt2-order-list {
                display: flex;
                flex-direction: column;
                gap: 2px;
                max-height: 300px;
                overflow-y: auto;
            }

            .gt2-order-entry {
                display: flex;
                gap: 10px;
                padding: 5px;
                cursor: pointer;
                border: 1px solid transparent;
                background: #0a0a0a;
            }

            .gt2-order-entry:hover {
                background: #1a3a1a;
            }

            .gt2-order-entry.gt2-current-order {
                background: #003300;
                border: 1px solid #00ff00;
            }

            .gt2-order-entry.gt2-playing-order {
                background: #1a1a3a;
                border: 1px solid #00aaff;
            }

            .gt2-order-entry.gt2-playing-order.gt2-current-order {
                background: #1a331a;
                border: 1px solid #00ffff;
            }

            .gt2-order-pos {
                color: #888;
                min-width: 30px;
            }

            .gt2-order-value {
                color: #ffff00;
                font-weight: bold;
            }

            .gt2-order-help {
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

export function initGT2OrderEditor() {
    const container = document.getElementById('gt2-order-editor-container');
    if (!container) {
        console.warn('GT2 order editor container not found');
        return;
    }

    const editor = new GT2OrderEditor();
    editor.createUI(container);

    if (typeof window !== 'undefined') {
        window.gt2OrderEditor = editor;
    }

    return editor;
}
