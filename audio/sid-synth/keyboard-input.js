// keyboard-input.js
import { initSynth, playNote, playNoteWithInstrument, stopVoice, stopAllVoices, releaseVoice, setGlobalSIDRegister, setSIDRegister, isWorkletActive, workletNoteOff } from './synth.js';
import { instruments } from './synth.js';
import { lfoEngine } from './lfo-engine.js';
import { arpeggioEngine } from './arpeggio-engine.js';

// Piano keyboard mapping - computer keyboard to musical notes
const keyboardMap = {
    // Lower octave (C-3 to B-3)
    'KeyZ': 'C-3',    // Z
    'KeyS': 'C#3',    // S
    'KeyX': 'D-3',    // X
    'KeyD': 'D#3',    // D
    'KeyC': 'E-3',    // C
    'KeyV': 'F-3',    // V
    'KeyG': 'F#3',    // G
    'KeyB': 'G-3',    // B
    'KeyH': 'G#3',    // H
    'KeyN': 'A-3',    // N
    'KeyJ': 'A#3',    // J
    'KeyM': 'B-3',    // M
    
    // Higher octave (C-4 to B-4)
    'KeyQ': 'C-4',    // Q
    'Digit2': 'C#4',  // 2
    'KeyW': 'D-4',    // W
    'Digit3': 'D#4',  // 3
    'KeyE': 'E-4',    // E
    'KeyR': 'F-4',    // R
    'Digit5': 'F#4',  // 5
    'KeyT': 'G-4',    // T
    'Digit6': 'G#4',  // 6
    'KeyY': 'A-4',    // Y
    'Digit7': 'A#4',  // 7
    'KeyU': 'B-4',    // U
    
    // Even higher octave (C-5 to B-5)
    'KeyI': 'C-5',    // I
    'Digit9': 'C#5',  // 9
    'KeyO': 'D-5',    // O
    'Digit0': 'D#5',  // 0
    'KeyP': 'E-5'     // P
};

// Note frequencies (expanded from sequencer.js)
const noteFrequencies = {
    'C-3': 130.81,
    'C#3': 138.59,
    'D-3': 146.83,
    'D#3': 155.56,
    'E-3': 164.81,
    'F-3': 174.61,
    'F#3': 185.00,
    'G-3': 196.00,
    'G#3': 207.65,
    'A-3': 220.00,
    'A#3': 233.08,
    'B-3': 246.94,
    'C-4': 261.63,
    'C#4': 277.18,
    'D-4': 293.66,
    'D#4': 311.13,
    'E-4': 329.63,
    'F-4': 349.23,
    'F#4': 369.99,
    'G-4': 392.00,
    'G#4': 415.30,
    'A-4': 440.00,
    'A#4': 466.16,
    'B-4': 493.88,
    'C-5': 523.25,
    'C#5': 554.37,
    'D-5': 587.33,
    'D#5': 622.25,
    'E-5': 659.25
};

class KeyboardInput {
    constructor() {
        this.pressedKeys = new Set();
        this.activeVoices = new Map(); // Track which voice is playing which key
        this.currentInstrument = 0;
        this.isEnabled = false;
        this.keyboardVoice = 2; // Use voice 2 for keyboard input by default
        this.onNotePressed = null; // Callback for recording mode
        
        this.setupKeyboardListeners();
    }
    
    enable() {
        this.isEnabled = true;
        console.log('🎹 Keyboard input enabled - Use computer keyboard to play notes!');
        console.log('💡 Tip: Click outside input fields to play, click in input fields to type');
        this.showKeyboardHelp();
        this.updateKeyboardStatus();
    }
    
    disable() {
        this.isEnabled = false;
        this.stopAllNotes();
        console.log('Keyboard input disabled');
        this.updateKeyboardStatus();
    }
    
    updateKeyboardStatus() {
        // Add visual feedback about keyboard state
        const body = document.body;
        if (this.isEnabled) {
            body.classList.add('keyboard-input-active');
        } else {
            body.classList.remove('keyboard-input-active');
        }
    }
    
    setInstrument(instrumentIndex) {
        this.currentInstrument = Math.max(0, Math.min(instruments.length - 1, instrumentIndex));
    }
    
    setupKeyboardListeners() {
        document.addEventListener('keydown', (event) => {
            if (!this.isEnabled) return;
            
            // Don't interfere with text input fields
            if (this.isTypingInTextField(event.target)) {
                return;
            }
            
            // Don't trigger if user is holding modifier keys
            if (event.ctrlKey || event.altKey || event.metaKey) {
                return;
            }
            
            // Prevent default browser behavior only for piano keys
            if (keyboardMap[event.code]) {
                event.preventDefault();
            }
            
            this.handleKeyDown(event);
        });
        
        document.addEventListener('keyup', (event) => {
            if (!this.isEnabled) return;
            
            // Don't interfere with text input fields
            if (this.isTypingInTextField(event.target)) {
                return;
            }
            
            if (keyboardMap[event.code]) {
                event.preventDefault();
            }
            
            this.handleKeyUp(event);
        });
        
        // Handle window blur to stop all notes
        window.addEventListener('blur', () => {
            this.stopAllNotes();
        });
        
        // Add focus/blur listeners to input fields for better UX
        this.setupInputFieldListeners();
    }
    
    setupInputFieldListeners() {
        // Listen for focus on input fields to provide visual feedback
        document.addEventListener('focusin', (event) => {
            if (this.isEnabled && this.isTypingInTextField(event.target)) {
                event.target.classList.add('text-input-focused');
                // Temporarily stop all playing notes when focusing on input
                this.stopAllNotes();
            }
        });
        
        document.addEventListener('focusout', (event) => {
            if (event.target.classList.contains('text-input-focused')) {
                event.target.classList.remove('text-input-focused');
            }
        });
    }
    
    isTypingInTextField(element) {
        // Check if the user is typing in an input field, textarea, or contenteditable element
        if (!element) return false;
        
        const tagName = element.tagName.toLowerCase();
        
        // Only treat actual text inputs and textareas as typing fields
        if (tagName === 'textarea') {
            return true;
        }
        
        if (tagName === 'input') {
            // Only text-based input types should block keyboard piano
            const textInputTypes = ['text', 'search', 'email', 'password', 'tel', 'url', 'number'];
            if (textInputTypes.includes(element.type) || !element.type) {
                return true;
            }
            // Range sliders, checkboxes, etc. should NOT block keyboard piano
            return false;
        }
        
        // Select dropdowns should not block keyboard piano (they use arrow keys, not letters)
        if (tagName === 'select') {
            return false;
        }
        
        // Check for contenteditable elements
        if (element.contentEditable === 'true') {
            return true;
        }
        
        return false;
    }
    
    async handleKeyDown(event) {
        // Ignore if key is already pressed or if it's a repeat event
        if (this.pressedKeys.has(event.code) || event.repeat) {
            return;
        }
        
        const note = keyboardMap[event.code];
        if (!note) return;
        
        // Initialize audio if needed (worklet or fallback)
        if (!window.audioContext) {
            initSynth();
        }
        
        // Ensure audio context is running
        if (window.audioContext && window.audioContext.state === 'suspended') {
            await window.audioContext.resume();
        }
        
        this.pressedKeys.add(event.code);
        
        const frequency = noteFrequencies[note];
        if (!frequency) return;
        
        const instrument = instruments[this.currentInstrument];
        if (!instrument) {
            console.error(`No instrument found at index ${this.currentInstrument}`);
            return;
        }
        
        console.log(`Playing with instrument: ${instrument.name} (index ${this.currentInstrument})`);
        console.log(`Instrument details:`, instrument);
        
        // Find an available voice or use the keyboard voice
        let voice = this.keyboardVoice;
        
        // If worklet engine is active, let it handle LFO/Arp
        if (!(isWorkletActive && isWorkletActive())) {
            // Set up LFO engine
            lfoEngine.start();
            lfoEngine.setVoice(voice, instrument, frequency, instrument.pulseWidth);
            
            // Set up arpeggio engine if enabled
            if (instrument.arpeggio?.enabled) {
                arpeggioEngine.start();
                arpeggioEngine.setVoice(voice, true, frequency, instrument.arpeggio.notes, instrument.arpeggio.speed);
            }
        }
        
        // Set master volume
        setGlobalSIDRegister(0x18, 0x0F);
        
        // Play the note with instrument (worklet-aware)
        playNoteWithInstrument(voice, frequency, 0, this.currentInstrument);
        
        // Track the active voice
        this.activeVoices.set(event.code, voice);
        
        console.log(`Playing ${note} (${frequency.toFixed(2)} Hz) on voice ${voice}`);
        
        // Trigger recording callback if it exists
        if (this.onNotePressed) {
            this.onNotePressed(note, frequency);
        }
    }
    
    handleKeyUp(event) {
        if (!this.pressedKeys.has(event.code)) return;
        
        const note = keyboardMap[event.code];
        if (!note) return;
        
        this.pressedKeys.delete(event.code);
        
        const voice = this.activeVoices.get(event.code);
        if (voice !== undefined) {
            // Get the current instrument to preserve waveform during release
            const instrument = instruments[this.currentInstrument];
            
            // Clear GATE bit to trigger release phase
            const controlReg = (voice * 7) + 0x04; // Voice control register
            const waveform = instrument ? instrument.waveform : 0x10;
            if (isWorkletActive && isWorkletActive()) {
                workletNoteOff(voice, waveform);
            } else {
                setGlobalSIDRegister(controlReg, waveform);
            }
            console.log(`Voice ${voice} GATE cleared for release, waveform: 0x${waveform.toString(16)}`);
            
            // Clear arpeggio when not using worklet engine
            if (!(isWorkletActive && isWorkletActive())) {
                arpeggioEngine.clearVoice(voice);
            }
            
            this.activeVoices.delete(event.code);
        }
        
        console.log(`Released ${note}`);
    }
    
    stopAllNotes() {
        // Clear all pressed keys
        this.pressedKeys.clear();
        
        // Stop all active voices properly
        for (const [code, voice] of this.activeVoices.entries()) {
            stopVoice(voice);
        }
        
        this.activeVoices.clear();
        
        // Also stop all voices to be sure
        stopAllVoices();
        
        console.log("All keyboard notes stopped");
    }
    
    
    showKeyboardHelp() {
        console.log(`
🎹 KEYBOARD INPUT ENABLED 🎹

Piano Layout:
Lower octave (C-3 to B-3):
Z S X D C V G B H N J M
C C# D D# E F F# G G# A A# B

Higher octave (C-4 to B-4):  
Q 2 W 3 E R 5 T 6 Y 7 U
C C# D D# E F F# G G# A A# B

Even higher (C-5 to D#5):
I 9 O 0 P
C C# D D# E

Current instrument: ${instruments[this.currentInstrument].name}
        `);
    }
}

// Create global keyboard input instance
export const keyboardInput = new KeyboardInput();

// Make it globally available
if (typeof window !== 'undefined') {
    window.keyboardInput = keyboardInput;
}
