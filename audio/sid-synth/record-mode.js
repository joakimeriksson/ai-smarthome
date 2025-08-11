// record-mode.js - Keyboard recording mode for step entry
import { patternManager } from './pattern-manager.js';
import { keyboardInput } from './keyboard-input.js';
import { currentStep as sequencerCurrentStep, playbackInterval } from './sequencer.js';

class RecordMode {
    constructor() {
        this.isRecording = false;
        this.currentVoice = 0; // Which voice to record to (0, 1, or 2)
        this.currentStep = 0;  // Current step position
        this.currentInstrument = 0; // Current instrument to use
        this.autoAdvance = true; // Automatically advance to next step
        this.recordingCallbacks = [];
        
        this.setupKeyboardRecording();
    }
    
    enable() {
        this.isRecording = true;
        this.currentStep = 0; // Reset to beginning
        
        // Enable keyboard input if not already enabled
        if (!keyboardInput.isEnabled) {
            keyboardInput.enable();
        }
        
        this.updateRecordingStatus();
        console.log(`🔴 Recording enabled - Voice ${this.currentVoice + 1}, Step ${this.currentStep + 1}`);
    }
    
    disable() {
        this.isRecording = false;
        this.updateRecordingStatus();
        console.log('⏹️ Recording disabled');
    }
    
    toggle() {
        if (this.isRecording) {
            this.disable();
        } else {
            this.enable();
        }
    }
    
    setVoice(voice) {
        if (voice >= 0 && voice < 3) {
            this.currentVoice = voice;
            console.log(`Recording voice changed to ${voice + 1}`);
            this.updateRecordingStatus();
        }
    }
    
    setStep(step) {
        const currentPattern = patternManager.getCurrentPattern();
        if (step >= 0 && step < currentPattern.length) {
            this.currentStep = step;
            console.log(`Recording step changed to ${step + 1}`);
            this.updateRecordingStatus();
        }
    }
    
    setInstrument(instrumentIndex) {
        this.currentInstrument = instrumentIndex;
        keyboardInput.setInstrument(instrumentIndex);
        console.log(`Recording instrument changed to ${instrumentIndex}`);
        this.updateRecordingStatus();
    }
    
    setAutoAdvance(enabled) {
        this.autoAdvance = enabled;
        console.log(`Auto-advance ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    setupKeyboardRecording() {
        // Listen for keyboard input when recording is enabled
        keyboardInput.onNotePressed = (note, frequency) => {
            if (this.isRecording) {
                this.recordNote(note);
            }
        };
    }
    
    recordNote(note) {
        const currentPattern = patternManager.getCurrentPattern();
        
        // Use sequencer's current step if playing, otherwise use our own step
        const stepToRecord = playbackInterval !== null ? sequencerCurrentStep : this.currentStep;
        
        // Record the note at the appropriate position
        currentPattern.setStepData(this.currentVoice, stepToRecord, note, this.currentInstrument);
        
        console.log(`🎵 Recorded ${note} at Voice ${this.currentVoice + 1}, Step ${stepToRecord + 1} ${playbackInterval !== null ? '(during playback)' : ''}`);
        
        // Update the UI to show the new note
        this.updateTrackerUI();
        
        // Auto-advance to next step if enabled (only when not playing)
        if (this.autoAdvance && playbackInterval === null) {
            this.advanceStep();
        }
        
        // Notify listeners
        this.notifyRecordingEvent('noteRecorded', {
            voice: this.currentVoice,
            step: stepToRecord,
            note: note,
            instrument: this.currentInstrument
        });
    }
    
    recordRest() {
        const currentPattern = patternManager.getCurrentPattern();
        
        // Use sequencer's current step if playing, otherwise use our own step
        const stepToRecord = playbackInterval !== null ? sequencerCurrentStep : this.currentStep;
        
        currentPattern.setStepData(this.currentVoice, stepToRecord, 'R', this.currentInstrument);
        
        console.log(`🔇 Recorded REST at Voice ${this.currentVoice + 1}, Step ${stepToRecord + 1} ${playbackInterval !== null ? '(during playback)' : ''}`);
        
        this.updateTrackerUI();
        
        if (this.autoAdvance && playbackInterval === null) {
            this.advanceStep();
        }
        
        this.notifyRecordingEvent('restRecorded', {
            voice: this.currentVoice,
            step: stepToRecord
        });
    }
    
    recordSustain() {
        const currentPattern = patternManager.getCurrentPattern();
        
        // Use sequencer's current step if playing, otherwise use our own step
        const stepToRecord = playbackInterval !== null ? sequencerCurrentStep : this.currentStep;
        
        currentPattern.setStepData(this.currentVoice, stepToRecord, '---', this.currentInstrument);
        
        console.log(`🎵 Recorded SUSTAIN at Voice ${this.currentVoice + 1}, Step ${stepToRecord + 1} ${playbackInterval !== null ? '(during playback)' : ''}`);
        
        this.updateTrackerUI();
        
        if (this.autoAdvance && playbackInterval === null) {
            this.advanceStep();
        }
        
        this.notifyRecordingEvent('sustainRecorded', {
            voice: this.currentVoice,
            step: stepToRecord
        });
    }
    
    advanceStep() {
        const currentPattern = patternManager.getCurrentPattern();
        this.currentStep = (this.currentStep + 1) % currentPattern.length;
        
        this.updateRecordingStatus();
        this.highlightCurrentStep();
        
        console.log(`⏭️ Advanced to step ${this.currentStep + 1}`);
    }
    
    previousStep() {
        const currentPattern = patternManager.getCurrentPattern();
        this.currentStep = (this.currentStep - 1 + currentPattern.length) % currentPattern.length;
        
        this.updateRecordingStatus();
        this.highlightCurrentStep();
        
        console.log(`⏮️ Back to step ${this.currentStep + 1}`);
    }
    
    updateTrackerUI() {
        // Update the tracker UI to show the new note
        if (window.refreshTrackerFromPattern) {
            window.refreshTrackerFromPattern();
        }
    }
    
    updateRecordingStatus() {
        // Update UI elements to show recording status
        const recordButton = document.getElementById('recordButton');
        const recordStatus = document.getElementById('recordStatus');
        
        if (recordButton) {
            recordButton.textContent = this.isRecording ? 'Stop Recording' : 'Record';
            recordButton.style.backgroundColor = this.isRecording ? '#A00' : '#050';
        }
        
        if (recordStatus && this.isRecording) {
            const displayStep = playbackInterval !== null ? sequencerCurrentStep : this.currentStep;
            const playingText = playbackInterval !== null ? ' (Playing)' : '';
            recordStatus.textContent = `REC: Voice ${this.currentVoice + 1}, Step ${displayStep + 1}${playingText}`;
            recordStatus.style.display = 'block';
        } else if (recordStatus) {
            recordStatus.style.display = 'none';
        }
        
        // Highlight current step
        if (this.isRecording) {
            this.highlightCurrentStep();
        } else {
            this.clearStepHighlights();
        }
    }
    
    highlightCurrentStep() {
        // Remove previous recording highlights
        this.clearStepHighlights();
        
        // Add recording highlight to current step
        const noteElement = document.getElementById(`note-${this.currentVoice}-${this.currentStep}`);
        const instElement = document.getElementById(`instrument-${this.currentVoice}-${this.currentStep}`);
        
        if (noteElement && instElement) {
            noteElement.classList.add('recording-highlight');
            instElement.classList.add('recording-highlight');
        }
    }
    
    clearStepHighlights() {
        document.querySelectorAll('.recording-highlight').forEach(element => {
            element.classList.remove('recording-highlight');
        });
    }
    
    // Keyboard shortcuts for recording
    setupRecordingShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (!this.isRecording) return;
            
            // Only respond to shortcuts when not typing in text fields
            if (keyboardInput.isTypingInTextField(event.target)) {
                return;
            }
            
            switch (event.code) {
                case 'Space':
                    event.preventDefault();
                    this.recordRest();
                    break;
                    
                case 'Enter':
                    event.preventDefault();
                    this.recordSustain();
                    break;
                    
                case 'ArrowLeft':
                    event.preventDefault();
                    if (this.currentVoice > 0) {
                        this.setVoice(this.currentVoice - 1);
                    }
                    break;
                    
                case 'ArrowRight':
                    event.preventDefault();
                    if (this.currentVoice < 2) {
                        this.setVoice(this.currentVoice + 1);
                    }
                    break;
                    
                case 'ArrowUp':
                    event.preventDefault();
                    this.previousStep();
                    break;
                    
                case 'ArrowDown':
                    event.preventDefault();
                    this.advanceStep();
                    break;
                    
                case 'Escape':
                    event.preventDefault();
                    this.disable();
                    break;
            }
        });
    }
    
    // Event system for recording callbacks
    onRecordingEvent(callback) {
        this.recordingCallbacks.push(callback);
    }
    
    removeRecordingCallback(callback) {
        const index = this.recordingCallbacks.indexOf(callback);
        if (index > -1) {
            this.recordingCallbacks.splice(index, 1);
        }
    }
    
    notifyRecordingEvent(eventType, data) {
        this.recordingCallbacks.forEach(callback => {
            try {
                callback(eventType, data);
            } catch (error) {
                console.error('Error in recording callback:', error);
            }
        });
    }
    
    // Get current recording state
    getRecordingState() {
        return {
            isRecording: this.isRecording,
            currentVoice: this.currentVoice,
            currentStep: this.currentStep,
            currentInstrument: this.currentInstrument,
            autoAdvance: this.autoAdvance
        };
    }
}

// Extend keyboard input to support recording callbacks
const originalKeyboardInput = keyboardInput;

// Override the handleKeyDown method to add recording support
const originalHandleKeyDown = keyboardInput.handleKeyDown;
keyboardInput.handleKeyDown = async function(event) {
    // Call original method
    const result = await originalHandleKeyDown.call(this, event);
    
    // Trigger recording callback if it exists
    if (this.onNotePressed) {
        const note = keyboardInput.constructor.keyboardMap?.[event.code];
        if (note) {
            const frequency = keyboardInput.constructor.noteFrequencies?.[note];
            this.onNotePressed(note, frequency);
        }
    }
    
    return result;
};

// Global record mode instance
export const recordMode = new RecordMode();

// Make it globally available
if (typeof window !== 'undefined') {
    window.recordMode = recordMode;
}