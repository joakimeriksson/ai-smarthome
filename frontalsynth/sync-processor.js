// Complete AudioWorklet Processor with True Hard Sync
// Implements oscillator sync, PWM, ring modulation, and LFO modulation

class SyncProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            // LFO1 pitch modulation (connected from external LFO1)
            { name: 'lfo1Input', defaultValue: 0, minValue: -1, maxValue: 1 },
            // LFO2 PWM modulation (connected from external LFO2)
            { name: 'lfo2Input', defaultValue: 0, minValue: -1, maxValue: 1 },
            // Oscillator levels
            { name: 'osc1Level', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            { name: 'osc2Level', defaultValue: 0.5, minValue: 0, maxValue: 1 },
            // Ring modulation amount
            { name: 'ringModAmount', defaultValue: 0, minValue: 0, maxValue: 1 },
            // Pulse width (0-1, where 0.5 = square wave)
            { name: 'pulseWidth', defaultValue: 0.5, minValue: 0, maxValue: 1 }
        ];
    }

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

        // Get parameter arrays (can be single value or per-sample array)
        const lfo1Input = parameters.lfo1Input;
        const lfo2Input = parameters.lfo2Input;
        const osc1Level = parameters.osc1Level;
        const osc2Level = parameters.osc2Level;
        const ringModAmount = parameters.ringModAmount;
        const pulseWidthParam = parameters.pulseWidth;

        for (let i = 0; i < channel.length; i++) {
            // Get current parameter values (handle both constant and array)
            const lfo1 = lfo1Input.length > 1 ? lfo1Input[i] : lfo1Input[0];
            const lfo2 = lfo2Input.length > 1 ? lfo2Input[i] : lfo2Input[0];
            const osc1Lvl = osc1Level.length > 1 ? osc1Level[i] : osc1Level[0];
            const osc2Lvl = osc2Level.length > 1 ? osc2Level[i] : osc2Level[0];
            const ringMod = ringModAmount.length > 1 ? ringModAmount[i] : ringModAmount[0];
            const basePulseWidth = pulseWidthParam.length > 1 ? pulseWidthParam[i] : pulseWidthParam[0];

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
                Math.max(0, Math.min(1, basePulseWidth + (lfo2 * this.lfo2Osc1PWMAmount / 100 * 0.4))) :
                basePulseWidth;

            const osc2PWM = this.slaveWaveform === 1 ?
                Math.max(0, Math.min(1, basePulseWidth + (lfo2 * this.lfo2Osc2PWMAmount / 100 * 0.4))) :
                basePulseWidth;

            // Generate waveforms with PWM
            const masterSample = this.getWaveformSample(this.masterPhase, this.masterWaveform, osc1PWM);
            const slaveSample = this.getWaveformSample(this.slavePhase, this.slaveWaveform, osc2PWM);

            // Mix oscillators with levels
            let mixedSample = (masterSample * osc1Lvl) + (slaveSample * osc2Lvl);

            // Add ring modulation (multiply the two oscillators)
            if (ringMod > 0) {
                const ringModSample = masterSample * slaveSample;
                mixedSample += ringModSample * ringMod;
            }

            // Output mixed signal
            channel[i] = mixedSample * 0.5; // Scale down to prevent clipping
        }

        return true;
    }
}

registerProcessor('sync-processor', SyncProcessor);
