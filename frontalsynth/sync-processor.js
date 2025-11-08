// Complete AudioWorklet Processor with True Hard Sync
// Implements oscillator sync, PWM, ring modulation, and LFO modulation
// Safari-compatible version using message port for all parameters

class SyncProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Master oscillator (OSC1) - drives sync
        this.masterPhase = 0;
        this.masterFrequency = 440;
        this.masterWaveform = 0; // 0=saw, 1=square, 2=tri, 3=sine
        this.masterDetune = 0;
        this.masterOffset = 0;

        // Slave oscillator (OSC2) - gets reset by master
        this.slavePhase = 0;
        this.slaveFrequency = 440;
        this.slaveWaveform = 0;
        this.slaveDetune = 0;
        this.slaveOffset = 0;

        // Oscillator levels and effects
        this.osc1Level = 0.5;
        this.osc2Level = 0.5;
        this.ringModAmount = 0;
        this.pulseWidth = 0.5;

        // Modulation amounts (how much LFO affects each param)
        this.lfo1Osc1PitchAmount = 0;
        this.lfo1Osc2PitchAmount = 0;
        this.lfo2Osc1PWMAmount = 0;
        this.lfo2Osc2PWMAmount = 0;

        this.sampleRate = sampleRate;

        // Listen for parameter updates via message port
        this.port.onmessage = (event) => {
            const { type, ...params } = event.data;
            if (type === 'update') {
                if (params.masterFrequency !== undefined) this.masterFrequency = params.masterFrequency;
                if (params.slaveFrequency !== undefined) this.slaveFrequency = params.slaveFrequency;
                if (params.masterWaveform !== undefined) this.masterWaveform = params.masterWaveform;
                if (params.slaveWaveform !== undefined) this.slaveWaveform = params.slaveWaveform;
                if (params.masterDetune !== undefined) this.masterDetune = params.masterDetune;
                if (params.slaveDetune !== undefined) this.slaveDetune = params.slaveDetune;
                if (params.masterOffset !== undefined) this.masterOffset = params.masterOffset;
                if (params.slaveOffset !== undefined) this.slaveOffset = params.slaveOffset;

                // Oscillator levels and effects
                if (params.osc1Level !== undefined) this.osc1Level = params.osc1Level;
                if (params.osc2Level !== undefined) this.osc2Level = params.osc2Level;
                if (params.ringModAmount !== undefined) this.ringModAmount = params.ringModAmount;
                if (params.pulseWidth !== undefined) this.pulseWidth = params.pulseWidth;

                // Modulation amounts (0-100 scale from UI)
                if (params.lfo1Osc1PitchAmount !== undefined) this.lfo1Osc1PitchAmount = params.lfo1Osc1PitchAmount;
                if (params.lfo1Osc2PitchAmount !== undefined) this.lfo1Osc2PitchAmount = params.lfo1Osc2PitchAmount;
                if (params.lfo2Osc1PWMAmount !== undefined) this.lfo2Osc1PWMAmount = params.lfo2Osc1PWMAmount;
                if (params.lfo2Osc2PWMAmount !== undefined) this.lfo2Osc2PWMAmount = params.lfo2Osc2PWMAmount;
            }
        };
    }

    // Generate waveform sample from phase (0 to 1)
    // For square waves, support PWM via pulse width parameter
    getWaveformSample(phase, waveform, pulseWidth = 0.5) {
        switch(waveform) {
            case 0: // Sawtooth
                return 2 * phase - 1;

            case 1: // Square with PWM
                return phase < pulseWidth ? 1 : -1;

            case 2: // Triangle
                return phase < 0.5 ? (4 * phase - 1) : (3 - 4 * phase);

            case 3: // Sine
                return Math.sin(2 * Math.PI * phase);

            default:
                return 2 * phase - 1;
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];

        if (!channel) return true;

        // Get LFO inputs from input channels
        // inputs[0][0] = LFO1, inputs[0][1] = LFO2
        const lfo1Input = inputs[0] && inputs[0][0] ? inputs[0][0] : null;
        const lfo2Input = inputs[0] && inputs[0][1] ? inputs[0][1] : null;

        for (let i = 0; i < channel.length; i++) {
            // Get LFO values (default to 0 if not connected)
            const lfo1 = lfo1Input ? lfo1Input[i] || 0 : 0;
            const lfo2 = lfo2Input ? lfo2Input[i] || 0 : 0;

            // Apply LFO1 pitch modulation (in cents)
            // lfo1 ranges -1 to +1, modAmount is 0-100 from UI
            const osc1PitchMod = (this.lfo1Osc1PitchAmount * lfo1 * 10) / 1200; // Convert to octaves
            const osc2PitchMod = (this.lfo1Osc2PitchAmount * lfo1 * 10) / 1200;

            // Calculate detuned and modulated frequencies
            const masterFreq = this.masterFrequency *
                Math.pow(2, this.masterDetune / 1200) *
                Math.pow(2, osc1PitchMod);

            const slaveFreq = this.slaveFrequency *
                Math.pow(2, this.slaveDetune / 1200) *
                Math.pow(2, osc2PitchMod);

            // Advance master oscillator phase
            this.masterPhase += masterFreq / this.sampleRate;

            // Detect master phase wrap (cycle complete)
            if (this.masterPhase >= 1.0) {
                this.masterPhase -= 1.0;

                // HARD SYNC: Reset slave oscillator phase
                this.slavePhase = 0;
            }

            // Advance slave oscillator phase
            this.slavePhase += slaveFreq / this.sampleRate;
            if (this.slavePhase >= 1.0) {
                this.slavePhase -= 1.0;
            }

            // Calculate pulse widths with LFO2 modulation
            // lfo2 ranges -1 to +1, modAmount is 0-100 from UI
            const osc1PWM = this.masterWaveform === 1 ?
                Math.max(0, Math.min(1, this.pulseWidth + (lfo2 * this.lfo2Osc1PWMAmount / 100 * 0.4))) :
                this.pulseWidth;

            const osc2PWM = this.slaveWaveform === 1 ?
                Math.max(0, Math.min(1, this.pulseWidth + (lfo2 * this.lfo2Osc2PWMAmount / 100 * 0.4))) :
                this.pulseWidth;

            // Generate waveforms with PWM
            const masterSample = this.getWaveformSample(this.masterPhase, this.masterWaveform, osc1PWM);
            const slaveSample = this.getWaveformSample(this.slavePhase, this.slaveWaveform, osc2PWM);

            // Mix oscillators with levels
            let mixedSample = (masterSample * this.osc1Level) + (slaveSample * this.osc2Level);

            // Add ring modulation (multiply the two oscillators)
            if (this.ringModAmount > 0) {
                const ringModSample = masterSample * slaveSample;
                mixedSample += ringModSample * this.ringModAmount;
            }

            // Output mixed signal
            channel[i] = mixedSample * 0.5; // Scale down to prevent clipping
        }

        return true;
    }
}

registerProcessor('sync-processor', SyncProcessor);
