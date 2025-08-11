// lfo-engine.js
import { setSIDRegister, calculateTriangleLFO, hzToSid } from './synth.js';

// LFO Engine for continuous modulation
class LFOEngine {
    constructor() {
        this.voices = Array(3).fill(null).map(() => ({
            instrument: null,
            baseFrequency: 0,
            basePulseWidth: 0,
            isActive: false,
            pwmPhase: 0,
            fmPhase: 0,
            lastUpdate: 0
        }));
        
        this.isRunning = false;
        this.updateInterval = null;
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        // Update LFOs at ~60 Hz for smooth modulation
        this.updateInterval = setInterval(() => this.update(), 16);
    }
    
    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        
        // Reset all voices
        this.voices.forEach(voice => {
            voice.isActive = false;
            voice.instrument = null;
        });
    }
    
    setVoice(voiceIndex, instrument, frequency, pulseWidth = 0x0800) {
        if (voiceIndex < 0 || voiceIndex >= 3) return;
        
        const voice = this.voices[voiceIndex];
        voice.instrument = instrument;
        voice.baseFrequency = frequency;
        voice.basePulseWidth = pulseWidth;
        voice.isActive = true;
        voice.pwmPhase = 0; // Reset phases for new note
        voice.fmPhase = 0;
        voice.lastUpdate = performance.now();
    }
    
    clearVoice(voiceIndex) {
        if (voiceIndex < 0 || voiceIndex >= 3) return;
        
        this.voices[voiceIndex].isActive = false;
        this.voices[voiceIndex].instrument = null;
    }
    
    update() {
        if (!this.isRunning) return;
        
        const currentTime = performance.now();
        
        this.voices.forEach((voice, voiceIndex) => {
            if (!voice.isActive || !voice.instrument) return;
            
            const deltaTime = (currentTime - voice.lastUpdate) / 1000; // Convert to seconds
            voice.lastUpdate = currentTime;
            
            const instrument = voice.instrument;
            let updateRequired = false;
            
            // Update PWM LFO
            if (instrument.pwmLFO.enabled && instrument.pwmLFO.freq > 0) {
                voice.pwmPhase = (voice.pwmPhase + (instrument.pwmLFO.freq * deltaTime)) % 1;
                
                const lfoValue = calculateTriangleLFO(voice.pwmPhase, instrument.pwmLFO.depth);
                const modulatedPulseWidth = voice.basePulseWidth + (lfoValue * 1024); // +/- 1024 range
                const clampedPulseWidth = Math.max(0, Math.min(0x0FFF, modulatedPulseWidth));
                
                // Update SID pulse width registers
                setSIDRegister(voiceIndex, 0x02, clampedPulseWidth & 0xFF); // PULSE_LO
                setSIDRegister(voiceIndex, 0x03, (clampedPulseWidth >> 8) & 0x0F); // PULSE_HI
                
                updateRequired = true;
            }
            
            // Update FM LFO
            if (instrument.fmLFO.enabled && instrument.fmLFO.freq > 0) {
                voice.fmPhase = (voice.fmPhase + (instrument.fmLFO.freq * deltaTime)) % 1;
                
                const lfoValue = calculateTriangleLFO(voice.fmPhase, instrument.fmLFO.depth);
                const modulatedFreq = voice.baseFrequency * (1 + lfoValue * 0.1); // 10% max modulation
                const sidFreq = hzToSid(modulatedFreq);
                
                // Update SID frequency registers
                setSIDRegister(voiceIndex, 0x00, sidFreq & 0xFF); // FREQ_LO
                setSIDRegister(voiceIndex, 0x01, (sidFreq >> 8) & 0xFF); // FREQ_HI
                
                updateRequired = true;
            }
        });
    }
}

// Create global LFO engine instance
export const lfoEngine = new LFOEngine();

// Auto-start LFO engine when imported
if (typeof window !== 'undefined') {
    window.lfoEngine = lfoEngine;
}