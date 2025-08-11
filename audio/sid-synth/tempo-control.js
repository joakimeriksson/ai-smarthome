// tempo-control.js - Tempo and timing control system

class TempoControl {
    constructor() {
        this.bpm = 120; // Default BPM
        this.stepResolution = 16; // 16th notes per step (1/16 note resolution)
        this.swing = 0; // Swing percentage (0-100)
        this.isPlaying = false;
        
        // Timing calculations
        this.stepDurationMs = this.calculateStepDuration();
        this.swingOffset = 0;
        
        // Callbacks for tempo changes
        this.onTempoChangeCallbacks = [];
    }
    
    // Calculate step duration in milliseconds based on BPM and resolution
    calculateStepDuration() {
        // BPM = beats per minute, where 1 beat = 1/4 note
        // Step duration = (60 seconds / BPM) * (1000 ms/second) * (1 beat / 4 quarter notes) * (4 quarter notes / stepResolution)
        // Simplified: (60000 / BPM) * (4 / stepResolution)
        return (60000 / this.bpm) * (4 / this.stepResolution);
    }
    
    // Set BPM and recalculate timings
    setBPM(newBpm) {
        const oldBpm = this.bpm;
        this.bpm = Math.max(30, Math.min(300, newBpm)); // Clamp to reasonable range
        this.stepDurationMs = this.calculateStepDuration();
        
        console.log(`Tempo changed: ${oldBpm} → ${this.bpm} BPM (${this.stepDurationMs.toFixed(1)}ms per step)`);
        
        // Notify listeners
        this.notifyTempoChange();
    }
    
    // Set step resolution (how many subdivisions per quarter note)
    setStepResolution(resolution) {
        const validResolutions = [4, 8, 16, 32]; // Quarter, eighth, sixteenth, thirty-second notes
        if (validResolutions.includes(resolution)) {
            this.stepResolution = resolution;
            this.stepDurationMs = this.calculateStepDuration();
            console.log(`Step resolution changed to 1/${resolution} notes`);
            this.notifyTempoChange();
        }
    }
    
    // Set swing amount (0-100%)
    setSwing(swingPercent) {
        this.swing = Math.max(0, Math.min(100, swingPercent));
        this.swingOffset = (this.stepDurationMs * this.swing) / 200; // Max 50% of step duration
        console.log(`Swing set to ${this.swing}% (${this.swingOffset.toFixed(1)}ms offset)`);
    }
    
    // Get step duration with swing applied
    getStepDuration(stepIndex) {
        // Apply swing to every other step (typical swing pattern)
        if (this.swing > 0 && stepIndex % 2 === 1) {
            return this.stepDurationMs + this.swingOffset;
        }
        return this.stepDurationMs;
    }
    
    // Add callback for tempo changes
    onTempoChange(callback) {
        this.onTempoChangeCallbacks.push(callback);
    }
    
    // Remove tempo change callback
    removeTempoChangeCallback(callback) {
        const index = this.onTempoChangeCallbacks.indexOf(callback);
        if (index > -1) {
            this.onTempoChangeCallbacks.splice(index, 1);
        }
    }
    
    // Notify all listeners of tempo change
    notifyTempoChange() {
        this.onTempoChangeCallbacks.forEach(callback => {
            try {
                callback(this.bpm, this.stepDurationMs, this.stepResolution);
            } catch (error) {
                console.error('Error in tempo change callback:', error);
            }
        });
    }
    
    // Get tempo info as object
    getTempoInfo() {
        return {
            bpm: this.bpm,
            stepDurationMs: this.stepDurationMs,
            stepResolution: this.stepResolution,
            swing: this.swing,
            swingOffset: this.swingOffset
        };
    }
    
    // Convert BPM to various note durations (for reference)
    getNotedurations() {
        const quarterNoteMs = 60000 / this.bpm;
        return {
            whole: quarterNoteMs * 4,
            half: quarterNoteMs * 2,
            quarter: quarterNoteMs,
            eighth: quarterNoteMs / 2,
            sixteenth: quarterNoteMs / 4,
            thirtysecond: quarterNoteMs / 8
        };
    }
    
    // Tap tempo function (call this multiple times to detect BPM)
    tapTempo() {
        const now = performance.now();
        
        if (!this.lastTapTime) {
            this.tapTimes = [now];
            this.lastTapTime = now;
            return;
        }
        
        this.tapTimes.push(now);
        
        // Keep only recent taps (within 3 seconds)
        this.tapTimes = this.tapTimes.filter(time => now - time < 3000);
        
        // Need at least 2 taps to calculate BPM
        if (this.tapTimes.length >= 2) {
            // Calculate average interval between taps
            const intervals = [];
            for (let i = 1; i < this.tapTimes.length; i++) {
                intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
            }
            
            const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
            const detectedBpm = Math.round(60000 / avgInterval);
            
            // Only update if BPM is reasonable
            if (detectedBpm >= 60 && detectedBpm <= 200) {
                this.setBPM(detectedBpm);
                console.log(`Tap tempo detected: ${detectedBpm} BPM`);
            }
        }
        
        this.lastTapTime = now;
    }
    
    // Reset tap tempo
    resetTapTempo() {
        this.tapTimes = [];
        this.lastTapTime = null;
    }
    
    // Sync to external clock (for future MIDI sync)
    syncToExternalClock(clockSignal) {
        // Placeholder for MIDI clock sync
        // 24 MIDI clock pulses per quarter note
        const pulsesPerStep = 24 / (this.stepResolution / 4);
        // Implementation would depend on MIDI clock source
    }
}

// Global tempo control instance
export const tempoControl = new TempoControl();

// Make it globally available
if (typeof window !== 'undefined') {
    window.tempoControl = tempoControl;
}