// arpeggio-engine.js - C64-style arpeggio engine
import { hzToSid, setSIDRegister } from './synth.js';

const FREQ_LO = 0x00;
const FREQ_HI = 0x01;
const VOICE_OFFSET = 0x07;

class ArpeggioEngine {
    constructor() {
        this.voices = Array(3).fill(null).map(() => ({
            enabled: false,
            baseFreq: 0,
            notes: [0, 4, 7], // Major chord semitones
            speed: 4, // Steps per arpeggio note
            currentNote: 0,
            stepCounter: 0
        }));
        
        this.isRunning = false;
        this.updateInterval = null;
    }
    
    start() {
        if (!this.isRunning) {
            this.isRunning = true;
            // Update arpeggios at 60Hz for smooth transitions
            this.updateInterval = setInterval(() => this.update(), 1000 / 60);
            console.log("Arpeggio engine started");
        }
    }
    
    stop() {
        if (this.isRunning) {
            this.isRunning = false;
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
            console.log("Arpeggio engine stopped");
        }
    }
    
    setVoice(voice, enabled, baseFreq, notes, speed) {
        if (voice >= 0 && voice < 3) {
            const v = this.voices[voice];
            v.enabled = enabled;
            v.baseFreq = baseFreq;
            v.notes = notes.slice(); // Copy the array
            v.speed = Math.max(1, speed); // Minimum speed of 1
            v.currentNote = 0;
            v.stepCounter = 0;
            
            console.log(`Arpeggio voice ${voice}: ${enabled ? 'enabled' : 'disabled'}, base: ${baseFreq}Hz, notes: [${notes.join(', ')}], speed: ${speed}`);
        }
    }
    
    clearVoice(voice) {
        if (voice >= 0 && voice < 3) {
            this.voices[voice].enabled = false;
            console.log(`Arpeggio voice ${voice}: cleared`);
        }
    }
    
    update() {
        if (!this.isRunning) return;
        
        for (let voice = 0; voice < 3; voice++) {
            const v = this.voices[voice];
            
            if (v.enabled && v.baseFreq > 0 && v.notes.length > 0) {
                v.stepCounter++;
                
                // Change arpeggio note when step counter reaches speed
                if (v.stepCounter >= v.speed) {
                    v.stepCounter = 0;
                    v.currentNote = (v.currentNote + 1) % v.notes.length;
                    
                    // Calculate new frequency
                    const semitoneOffset = v.notes[v.currentNote];
                    const newFreq = v.baseFreq * Math.pow(2, semitoneOffset / 12);
                    const sidFreq = hzToSid(newFreq);
                    
                    // Update SID frequency registers only
                    setSIDRegister(voice, FREQ_LO, sidFreq & 0xFF);
                    setSIDRegister(voice, FREQ_HI, (sidFreq >> 8) & 0xFF);
                    
                    // Log every 4th update to avoid spam
                    if (v.currentNote === 0) {
                        console.log(`Arp voice ${voice}: ${newFreq.toFixed(2)}Hz (${semitoneOffset > 0 ? '+' : ''}${semitoneOffset} semitones)`);
                    }
                }
            }
        }
    }
    
    // Helper function to convert note names to semitone offsets
    // e.g., ["C", "E", "G"] with base note C would become [0, 4, 7]
    static notesToSemitones(baseNote, noteNames) {
        const noteValues = {
            'C': 0, 'C#': 1, 'DB': 1, 'D': 2, 'D#': 3, 'EB': 3,
            'E': 4, 'F': 5, 'F#': 6, 'GB': 6, 'G': 7, 'G#': 8,
            'AB': 8, 'A': 9, 'A#': 10, 'BB': 10, 'B': 11
        };
        
        const baseValue = noteValues[baseNote] || 0;
        return noteNames.map(note => {
            const noteValue = noteValues[note] || 0;
            return (noteValue - baseValue + 12) % 12;
        });
    }
    
    // Predefined chord patterns
    static getChordPattern(chordType) {
        const patterns = {
            'major': [0, 4, 7],
            'minor': [0, 3, 7],
            'dim': [0, 3, 6],
            'aug': [0, 4, 8],
            'sus2': [0, 2, 7],
            'sus4': [0, 5, 7],
            '7th': [0, 4, 7, 10],
            'maj7': [0, 4, 7, 11],
            'min7': [0, 3, 7, 10],
            'octave': [0, 12],
            'fifth': [0, 7],
            'fourth': [0, 5]
        };
        
        return patterns[chordType] || patterns['major'];
    }
}

// Create global arpeggio engine instance
export const arpeggioEngine = new ArpeggioEngine();

// Make it globally available
if (typeof window !== 'undefined') {
    window.arpeggioEngine = arpeggioEngine;
}