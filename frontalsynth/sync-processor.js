// Hard Sync AudioWorklet Processor
// Implements true oscillator sync with phase reset

class SyncProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        // Master oscillator (OSC1) - drives sync
        this.masterPhase = 0;
        this.masterFrequency = 440;
        this.masterWaveform = 0; // 0=saw, 1=square, 2=tri, 3=sine

        // Slave oscillator (OSC2) - gets reset by master
        this.slavePhase = 0;
        this.slaveFrequency = 440;
        this.slaveWaveform = 0;

        // Detune values
        this.masterDetune = 0;
        this.slaveDetune = 0;

        this.sampleRate = sampleRate;

        // Listen for parameter updates
        this.port.onmessage = (event) => {
            const { type, ...params } = event.data;
            if (type === 'update') {
                if (params.masterFrequency !== undefined) this.masterFrequency = params.masterFrequency;
                if (params.slaveFrequency !== undefined) this.slaveFrequency = params.slaveFrequency;
                if (params.masterWaveform !== undefined) this.masterWaveform = params.masterWaveform;
                if (params.slaveWaveform !== undefined) this.slaveWaveform = params.slaveWaveform;
                if (params.masterDetune !== undefined) this.masterDetune = params.masterDetune;
                if (params.slaveDetune !== undefined) this.slaveDetune = params.slaveDetune;
            }
        };
    }

    // Generate waveform sample from phase (0 to 1)
    getWaveformSample(phase, waveform) {
        switch(waveform) {
            case 0: // Sawtooth
                return 2 * phase - 1;

            case 1: // Square
                return phase < 0.5 ? 1 : -1;

            case 2: // Triangle
                return phase < 0.5 ? (4 * phase - 1) : (3 - 4 * phase);

            case 3: // Sine
                return Math.sin(2 * Math.PI * phase);

            default:
                return 2 * phase - 1; // Default to sawtooth
        }
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const channel = output[0];

        if (!channel) return true;

        for (let i = 0; i < channel.length; i++) {
            // Calculate detuned frequencies
            const masterFreq = this.masterFrequency * Math.pow(2, this.masterDetune / 1200);
            const slaveFreq = this.slaveFrequency * Math.pow(2, this.slaveDetune / 1200);

            // Store previous master phase to detect wrapping
            const prevMasterPhase = this.masterPhase;

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

            // Generate waveforms
            const masterSample = this.getWaveformSample(this.masterPhase, this.masterWaveform);
            const slaveSample = this.getWaveformSample(this.slavePhase, this.slaveWaveform);

            // Mix both oscillators (equal mix for now)
            channel[i] = (masterSample + slaveSample) * 0.5;
        }

        return true;
    }
}

registerProcessor('sync-processor', SyncProcessor);
