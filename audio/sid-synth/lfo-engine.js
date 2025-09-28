// lfo-engine.js
import { setSIDRegister, calculateTriangleLFO, hzToSid, setGlobalSIDRegister } from './synth.js';

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
        
        // Global filter LFO state (shared across all voices)
        this.filterLFO = {
            activeInstrument: null,
            baseFrequency: 0,
            phase: 0,
            lastUpdate: 0
        };
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        console.log("LFO Engine started (audio-driven timing)");
        // Note: Updates are now driven by audio-driven timing from sequencer.js
        // No more setInterval needed - updates come via handleAudioDrivenLFOUpdate()
    }
    
    stop() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        console.log("LFO Engine stopped");
        // No setInterval to clear with audio-driven timing
        
        // Reset all voices
        this.voices.forEach(voice => {
            voice.isActive = false;
            voice.instrument = null;
        });
        
        // Reset filter LFO
        this.filterLFO.activeInstrument = null;
        this.filterLFO.phase = 0;
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
        
        // Update filter LFO if this instrument has filter LFO enabled
        if (instrument.filter?.enabled && instrument.filterLFO?.enabled) {
            this.filterLFO.activeInstrument = instrument;
            this.filterLFO.baseFrequency = instrument.filter.frequency;
            this.filterLFO.lastUpdate = performance.now();
            
            // Only reset phase if not continuous mode
            if (!instrument.filterLFO.continuous) {
                this.filterLFO.phase = 0;
            }
            
            const modeText = instrument.filterLFO.continuous ? "continuous" : "reset";
            console.log(`Filter LFO activated: ${instrument.name} (${modeText})`);
        }
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
                const modulatedPulseWidth = voice.basePulseWidth + (lfoValue * 2048); // wider range for audibility
                const clampedPulseWidth = Math.max(0, Math.min(0x0FFF, modulatedPulseWidth));
                
                // Update SID pulse width registers
                setSIDRegister(voiceIndex, 0x02, clampedPulseWidth & 0xFF); // PULSE_LO
                // TinySID accepts full 8-bit high register
                setSIDRegister(voiceIndex, 0x03, (clampedPulseWidth >> 8) & 0xFF); // PULSE_HI
                
                updateRequired = true;
            }
            
            // Update FM LFO
            if (instrument.fmLFO.enabled && instrument.fmLFO.freq > 0) {
                voice.fmPhase = (voice.fmPhase + (instrument.fmLFO.freq * deltaTime)) % 1;
                
                const lfoValue = calculateTriangleLFO(voice.fmPhase, instrument.fmLFO.depth);
                const modulatedFreq = voice.baseFrequency * (1 + lfoValue * 0.2); // 20% max for audibility
                const sidFreq = hzToSid(modulatedFreq);
                
                // Update SID frequency registers
                setSIDRegister(voiceIndex, 0x00, sidFreq & 0xFF); // FREQ_LO
                setSIDRegister(voiceIndex, 0x01, (sidFreq >> 8) & 0xFF); // FREQ_HI
                
                updateRequired = true;
            }
        });
        
        // Update global filter LFO (shared across all voices)
        if (this.filterLFO.activeInstrument && this.filterLFO.activeInstrument.filterLFO?.enabled && this.filterLFO.activeInstrument.filterLFO.freq > 0) {
            const deltaTime = (currentTime - this.filterLFO.lastUpdate) / 1000;
            this.filterLFO.lastUpdate = currentTime;
            
            this.filterLFO.phase = (this.filterLFO.phase + (this.filterLFO.activeInstrument.filterLFO.freq * deltaTime)) % 1;
            
            const lfoValue = calculateTriangleLFO(this.filterLFO.phase, this.filterLFO.activeInstrument.filterLFO.depth);
            const modulatedFilterFreq = this.filterLFO.baseFrequency + (lfoValue * 1024); // +/- 1024 range
            const clampedFilterFreq = Math.max(0, Math.min(0x7FF, modulatedFilterFreq)); // Clamp to 11-bit range
            
            // Update SID filter frequency registers (same as applyFilter function)
            const ffreqlo = clampedFilterFreq & 0x07;
            const ffreqhi = (clampedFilterFreq >> 3) & 0xFF;
            setGlobalSIDRegister(21, ffreqlo);
            setGlobalSIDRegister(22, ffreqhi);
            // Filter LFO is running smoothly
        }
    }
}

// Create global LFO engine instance
export const lfoEngine = new LFOEngine();

// Auto-start LFO engine when imported
if (typeof window !== 'undefined') {
    window.lfoEngine = lfoEngine;
}
