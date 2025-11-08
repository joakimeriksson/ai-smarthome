// FrontalSynth - Analog Modeling Synthesizer Engine
// Web Audio API based synthesis engine with modulation matrix

class SynthVoice {
    constructor(audioContext) {
        this.context = audioContext;
        this.note = null;
        this.active = false;

        // Dual Oscillators
        this.osc1 = null;
        this.osc2 = null;
        this.osc1Gain = this.context.createGain();
        this.osc2Gain = this.context.createGain();
        this.osc1Gain.gain.value = 0.5;
        this.osc2Gain.gain.value = 0.5;

        // PWM components (using waveshaper comparator method)
        this.pwm1Offset = this.context.createGain(); // DC offset for PWM
        this.pwm1Shaper = this.context.createWaveShaper();
        this.pwm1Output = this.context.createGain();
        this.pwm2Offset = this.context.createGain();
        this.pwm2Shaper = this.context.createWaveShaper();
        this.pwm2Output = this.context.createGain();

        // Create comparator waveshaper curve (hard clipping to create square/pulse wave)
        const shaperCurve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            shaperCurve[i] = (i < 128) ? -1 : 1; // If input < 0, output -1, else output 1
        }
        this.pwm1Shaper.curve = shaperCurve;
        this.pwm2Shaper.curve = shaperCurve;

        // Ring modulator (uses waveshaper to multiply signals)
        this.ringMod = this.context.createWaveShaper();
        this.ringModGain = this.context.createGain();
        this.ringModGain.gain.value = 0;

        // Oscillator mixer
        this.oscMixer = this.context.createGain();
        this.oscMixer.gain.value = 1.0;

        // LFO modulation nodes
        this.lfoToPitchGain = this.context.createGain();
        this.lfoToPitchGain.gain.value = 0;
        this.lfoToFilterGain = this.context.createGain();
        this.lfoToFilterGain.gain.value = 0;
        this.lfoToPWMGain = this.context.createGain();
        this.lfoToPWMGain.gain.value = 0;

        // Filter
        this.filter = this.context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 2000;
        this.filter.Q.value = 1;

        // VCA (Voltage Controlled Amplifier)
        this.vca = this.context.createGain();
        this.vca.gain.value = 0;

        // Connect: Mixer -> Filter -> VCA
        this.oscMixer.connect(this.filter);
        this.filter.connect(this.vca);
    }

    start(frequency, params, lfoNode, lfo2Node) {
        if (this.active) {
            this.stop();
        }

        const now = this.context.currentTime;
        this.active = true;

        // Create oscillator 1
        this.osc1 = this.context.createOscillator();
        this.osc1.type = params.osc1Waveform;
        // Apply semitone offset: frequency * 2^(offset/12)
        const osc1Freq = frequency * Math.pow(2, params.osc1Offset / 12);
        this.osc1.frequency.value = osc1Freq;
        this.osc1.detune.value = params.osc1Detune;

        // Create oscillator 2
        this.osc2 = this.context.createOscillator();
        this.osc2.type = params.osc2Waveform;
        // Apply semitone offset: frequency * 2^(offset/12)
        const osc2Freq = frequency * Math.pow(2, params.osc2Offset / 12);
        this.osc2.frequency.value = osc2Freq;
        this.osc2.detune.value = params.osc2Detune;

        // Update oscillator levels
        this.osc1Gain.gain.value = params.osc1Level;
        this.osc2Gain.gain.value = params.osc2Level;

        // Connect oscillators to their gain nodes
        this.osc1.connect(this.osc1Gain);
        this.osc2.connect(this.osc2Gain);

        // Setup ring modulation if enabled
        if (params.ringMod > 0) {
            this.setupRingMod(params.ringMod);
        }

        // Setup oscillator sync if enabled
        if (params.oscSync) {
            this.setupOscSync();
        }

        // Connect oscillator gains to mixer
        this.osc1Gain.connect(this.oscMixer);
        this.osc2Gain.connect(this.oscMixer);

        // Connect ring mod output to mixer
        this.ringModGain.connect(this.oscMixer);

        // Setup LFO modulation routing
        if (lfoNode) {
            this.setupLFORouting(lfoNode, params.modMatrix);
        }

        // Start oscillators
        this.osc1.start(now);
        this.osc2.start(now);

        // Setup PWM after oscillators are started - always set up for square waves or when LFO2 PWM is active
        // Use LFO2 for PWM modulation (independent from LFO1)
        if (params.osc1Waveform === 'square' || params.osc2Waveform === 'square' ||
            params.modMatrix.lfo2Osc1PWM > 0 || params.modMatrix.lfo2Osc2PWM > 0) {
            this.setupPWM(frequency, params.pulseWidth, lfo2Node, params.modMatrix, params);
        }

        // Apply envelope
        this.applyEnvelope(params.envelope, params.filterEnvAmount, params.modMatrix);
    }

    setupRingMod(amount) {
        // Ring modulation: multiply osc1 and osc2
        // Create a simple multiplier using waveshaper
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = (i - 128) / 128;
            curve[i] = x * x; // Simple multiplication approximation
        }
        this.ringMod.curve = curve;

        this.ringModGain.gain.value = amount;

        // Connect both oscillators to ring mod
        this.osc1.connect(this.ringMod);
        this.osc2.connect(this.ringMod);
        this.ringMod.connect(this.ringModGain);
    }

    setupOscSync() {
        // Hard sync: osc1 frequency controls osc2 frequency
        // Use osc1 to modulate osc2's frequency
        const syncDepth = this.context.createGain();
        syncDepth.gain.value = this.osc2.frequency.value;
        this.osc1.connect(syncDepth);
        syncDepth.connect(this.osc2.frequency);
    }

    setupPWM(frequency, pulseWidth, lfoNode, modMatrix, params) {
        // PWM using waveshaper comparator method
        // Sawtooth wave -> DC offset -> Comparator (waveshaper) -> Pulse wave
        // Pulse width from 0-100, where 50 is a square wave
        // LFO2 modulates the DC offset for classic analog PWM sweep

        // Calculate DC offset from pulse width (0-100 maps to -1 to +1 offset)
        // offset = 2*(pulseWidth/100) - 1
        // PW=50 -> offset=0 (square), PW=100 -> offset=1 (wide), PW=0 -> offset=-1 (narrow)
        const dcOffset = 2 * (pulseWidth / 100) - 1;

        // PWM for Oscillator 1 if it's set to square
        if (this.osc1 && this.osc1.type === 'square') {
            // Replace square wave with PWM-capable sawtooth
            this.osc1.type = 'sawtooth';

            // Disconnect from direct connection and route through PWM chain
            this.osc1.disconnect();

            // Set up PWM chain: osc1 -> offset -> comparator -> output -> osc1Gain
            this.pwm1Offset.gain.value = 1; // Pass-through gain
            this.pwm1Output.gain.value = 1;

            // Create constant source for DC offset
            const dcSource1 = this.context.createConstantSource();
            dcSource1.offset.value = dcOffset;

            // Connect the PWM chain
            this.osc1.connect(this.pwm1Offset);
            dcSource1.connect(this.pwm1Offset);
            this.pwm1Offset.connect(this.pwm1Shaper);
            this.pwm1Shaper.connect(this.pwm1Output);
            this.pwm1Output.connect(this.osc1Gain);

            dcSource1.start();
            this.dcSource1 = dcSource1; // Store for cleanup

            // LFO2 modulation of OSC1 PWM - modulates the DC offset (per-oscillator amount)
            if (lfoNode && modMatrix.lfo2Osc1PWM > 0) {
                // Scale LFO to appropriate range for PWM modulation
                const lfoScale = (modMatrix.lfo2Osc1PWM / 100) * 0.8; // Max ±0.8 offset modulation
                const lfo2Osc1PWMGain = this.context.createGain();
                lfo2Osc1PWMGain.gain.value = lfoScale;
                lfoNode.connect(lfo2Osc1PWMGain);
                lfo2Osc1PWMGain.connect(dcSource1.offset);
                this.lfo2Osc1PWMGain = lfo2Osc1PWMGain; // Store for cleanup
            }
        }

        // PWM for Oscillator 2 if it's set to square
        if (this.osc2 && this.osc2.type === 'square') {
            // Replace square wave with PWM-capable sawtooth
            this.osc2.type = 'sawtooth';

            this.osc2.disconnect();

            this.pwm2Offset.gain.value = 1;
            this.pwm2Output.gain.value = 1;

            const dcSource2 = this.context.createConstantSource();
            dcSource2.offset.value = dcOffset;

            this.osc2.connect(this.pwm2Offset);
            dcSource2.connect(this.pwm2Offset);
            this.pwm2Offset.connect(this.pwm2Shaper);
            this.pwm2Shaper.connect(this.pwm2Output);
            this.pwm2Output.connect(this.osc2Gain);

            dcSource2.start();
            this.dcSource2 = dcSource2;

            // LFO2 modulation of OSC2 PWM (per-oscillator amount)
            if (lfoNode && modMatrix.lfo2Osc2PWM > 0) {
                const lfoScale = (modMatrix.lfo2Osc2PWM / 100) * 0.8;
                const lfo2Osc2PWMGain = this.context.createGain();
                lfo2Osc2PWMGain.gain.value = lfoScale;
                lfoNode.connect(lfo2Osc2PWMGain);
                lfo2Osc2PWMGain.connect(dcSource2.offset);
                this.lfo2Osc2PWMGain = lfo2Osc2PWMGain; // Store for cleanup
            }
        }
    }

    setupLFORouting(lfoNode, modMatrix) {
        // LFO1 to OSC1 Pitch modulation
        if (modMatrix.lfo1Osc1Pitch > 0) {
            const lfo1Osc1PitchGain = this.context.createGain();
            lfo1Osc1PitchGain.gain.value = modMatrix.lfo1Osc1Pitch * 10; // Scale for cents
            lfoNode.connect(lfo1Osc1PitchGain);
            lfo1Osc1PitchGain.connect(this.osc1.detune);
            this.lfo1Osc1PitchGain = lfo1Osc1PitchGain; // Store for cleanup
        }

        // LFO1 to OSC2 Pitch modulation
        if (modMatrix.lfo1Osc2Pitch > 0) {
            const lfo1Osc2PitchGain = this.context.createGain();
            lfo1Osc2PitchGain.gain.value = modMatrix.lfo1Osc2Pitch * 10; // Scale for cents
            lfoNode.connect(lfo1Osc2PitchGain);
            lfo1Osc2PitchGain.connect(this.osc2.detune);
            this.lfo1Osc2PitchGain = lfo1Osc2PitchGain; // Store for cleanup
        }

        // LFO1 to Filter modulation (global)
        if (modMatrix.lfo1Filter > 0) {
            this.lfoToFilterGain.gain.value = modMatrix.lfo1Filter * 50; // Scale for filter frequency
            lfoNode.connect(this.lfoToFilterGain);
            this.lfoToFilterGain.connect(this.filter.frequency);
        }
    }

    applyEnvelope(envelope, filterEnvAmount, modMatrix) {
        const now = this.context.currentTime;
        const attackTime = envelope.attack / 1000;
        const decayTime = envelope.decay / 1000;
        const sustainLevel = envelope.sustain / 100;

        // Amplitude envelope
        this.vca.gain.cancelScheduledValues(now);
        this.vca.gain.setValueAtTime(0, now);
        this.vca.gain.linearRampToValueAtTime(1, now + attackTime);
        this.vca.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime);

        // Filter envelope
        const envFilterMod = modMatrix.envFilter / 100;
        const filterEnvAmt = filterEnvAmount * envFilterMod;

        this.filter.frequency.cancelScheduledValues(now);
        const baseFreq = this.filter.frequency.value;
        this.filter.frequency.setValueAtTime(baseFreq, now);
        this.filter.frequency.linearRampToValueAtTime(Math.min(20000, baseFreq + filterEnvAmt), now + attackTime);
        this.filter.frequency.linearRampToValueAtTime(Math.min(20000, baseFreq + (filterEnvAmt * sustainLevel)), now + attackTime + decayTime);
    }

    stop(releaseTime = 0.5) {
        if (!this.active) return;

        const now = this.context.currentTime;

        // Release envelope
        this.vca.gain.cancelScheduledValues(now);
        this.vca.gain.setValueAtTime(this.vca.gain.value, now);
        this.vca.gain.linearRampToValueAtTime(0, now + releaseTime);

        // Filter release
        const currentFilterFreq = this.filter.frequency.value;
        this.filter.frequency.cancelScheduledValues(now);
        this.filter.frequency.setValueAtTime(currentFilterFreq, now);
        this.filter.frequency.linearRampToValueAtTime(this.filter.frequency.defaultValue || 2000, now + releaseTime);

        // Clean up oscillators
        setTimeout(() => {
            if (this.osc1) {
                this.osc1.stop();
                this.osc1.disconnect();
                this.osc1 = null;
            }
            if (this.osc2) {
                this.osc2.stop();
                this.osc2.disconnect();
                this.osc2 = null;
            }
            // Clean up PWM DC sources
            if (this.dcSource1) {
                this.dcSource1.stop();
                this.dcSource1.disconnect();
                this.dcSource1 = null;
            }
            if (this.dcSource2) {
                this.dcSource2.stop();
                this.dcSource2.disconnect();
                this.dcSource2 = null;
            }
            // Disconnect LFO and PWM connections
            try {
                this.lfoToPitchGain.disconnect();
                this.lfoToFilterGain.disconnect();
                this.lfoToPWMGain.disconnect();
                if (this.lfo1Osc1PitchGain) this.lfo1Osc1PitchGain.disconnect();
                if (this.lfo1Osc2PitchGain) this.lfo1Osc2PitchGain.disconnect();
                if (this.lfo2Osc1PWMGain) this.lfo2Osc1PWMGain.disconnect();
                if (this.lfo2Osc2PWMGain) this.lfo2Osc2PWMGain.disconnect();
                this.pwm1Offset.disconnect();
                this.pwm1Shaper.disconnect();
                this.pwm1Output.disconnect();
                this.pwm2Offset.disconnect();
                this.pwm2Shaper.disconnect();
                this.pwm2Output.disconnect();
            } catch(e) {}

            this.active = false;
        }, releaseTime * 1000 + 100);
    }

    setFilterParams(cutoff, resonance, type) {
        this.filter.frequency.value = cutoff;
        this.filter.Q.value = resonance;
        this.filter.type = type;
    }

    connect(destination) {
        this.vca.connect(destination);
    }
}

class LFO {
    constructor(audioContext) {
        this.context = audioContext;
        this.osc = null;
        this.gain = this.context.createGain();
        this.gain.gain.value = 1.0;
        this.running = false;
    }

    start(rate, waveform) {
        if (this.running) {
            this.stop();
        }

        this.osc = this.context.createOscillator();
        this.osc.type = waveform;
        this.osc.frequency.value = rate;

        this.osc.connect(this.gain);
        this.osc.start();
        this.running = true;
    }

    stop() {
        if (this.osc) {
            try {
                this.osc.stop();
                this.osc.disconnect();
            } catch(e) {}
            this.osc = null;
        }
        this.running = false;
    }

    setRate(rate) {
        if (this.osc) {
            this.osc.frequency.value = rate;
        }
    }

    getOutput() {
        return this.gain;
    }
}

class Arpeggiator {
    constructor(synthEngine) {
        this.synth = synthEngine;
        this.enabled = false;
        this.pattern = 'up';
        this.rate = 8; // Note division
        this.bpm = 120;
        this.heldNotes = [];
        this.currentIndex = 0;
        this.intervalId = null;
        this.direction = 1; // For up/down pattern
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        if (enabled && this.heldNotes.length > 0) {
            this.start();
        } else {
            this.stop();
        }
    }

    setPattern(pattern) {
        this.pattern = pattern;
        this.currentIndex = 0;
        this.direction = 1;
    }

    setRate(rate) {
        this.rate = rate;
        if (this.enabled && this.intervalId) {
            this.stop();
            this.start();
        }
    }

    setBPM(bpm) {
        this.bpm = bpm;
        if (this.enabled && this.intervalId) {
            this.stop();
            this.start();
        }
    }

    addNote(note) {
        if (!this.heldNotes.includes(note)) {
            this.heldNotes.push(note);
            this.heldNotes.sort((a, b) => a - b);

            if (this.enabled && !this.intervalId) {
                this.start();
            }
        }
    }

    removeNote(note) {
        const index = this.heldNotes.indexOf(note);
        if (index > -1) {
            this.heldNotes.splice(index, 1);

            if (this.heldNotes.length === 0) {
                this.stop();
            }
        }
    }

    start() {
        if (this.intervalId) return;

        const intervalMs = (60000 / this.bpm) / (this.rate / 4);

        this.intervalId = setInterval(() => {
            this.playNextNote();
        }, intervalMs);

        // Play first note immediately
        this.playNextNote();
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.currentIndex = 0;
        this.direction = 1;
    }

    playNextNote() {
        if (this.heldNotes.length === 0) return;

        let noteIndex;

        switch (this.pattern) {
            case 'up':
                noteIndex = this.currentIndex % this.heldNotes.length;
                this.currentIndex++;
                break;

            case 'down':
                noteIndex = (this.heldNotes.length - 1) - (this.currentIndex % this.heldNotes.length);
                this.currentIndex++;
                break;

            case 'updown':
                noteIndex = this.currentIndex;
                this.currentIndex += this.direction;

                if (this.currentIndex >= this.heldNotes.length - 1) {
                    this.direction = -1;
                } else if (this.currentIndex <= 0) {
                    this.direction = 1;
                }
                break;

            case 'random':
                noteIndex = Math.floor(Math.random() * this.heldNotes.length);
                break;
        }

        const note = this.heldNotes[noteIndex];
        const frequency = this.midiToFreq(note);

        // Play short note
        this.synth.playNote(frequency, 0.15);
    }

    midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    clear() {
        this.heldNotes = [];
        this.stop();
    }
}

class SynthEngine {
    constructor() {
        this.context = null;
        this.voices = [];
        this.lfo = null;
        this.lfo2 = null; // Second LFO for PWM modulation
        this.masterGain = null;
        this.arpeggiator = null;
        this.activeNotes = new Map(); // Map note to voice

        // Synth parameters
        this.params = {
            osc1Waveform: 'sawtooth',
            osc1Detune: 0,
            osc1Offset: 0,  // Semitone offset (-24 to +24)
            osc1Level: 0.5,
            osc2Waveform: 'sawtooth',
            osc2Detune: 5,  // Slight detune by default
            osc2Offset: 0,  // Semitone offset (-24 to +24)
            osc2Level: 0.5,
            pulseWidth: 50,  // 50 = square wave, < 50 = narrow pulse, > 50 = wide pulse
            ringMod: 0,
            oscSync: false,
            filterCutoff: 2000,
            filterResonance: 1,
            filterType: 'lowpass',
            filterEnvAmount: 4000,
            envelope: {
                attack: 10,
                decay: 300,
                sustain: 70,
                release: 500
            },
            lfo: {
                rate: 4,
                waveform: 'sine'
            },
            lfo2: {
                rate: 2,
                waveform: 'triangle'
            },
            modMatrix: {
                lfo1Osc1Pitch: 0,   // LFO1 modulation of OSC1 pitch
                lfo1Osc2Pitch: 0,   // LFO1 modulation of OSC2 pitch
                lfo1Filter: 0,       // LFO1 modulation of filter (global)
                lfo2Osc1PWM: 0,      // LFO2 modulation of OSC1 PWM
                lfo2Osc2PWM: 0,      // LFO2 modulation of OSC2 PWM
                envFilter: 50        // Envelope modulation of filter
            },
            masterVolume: 0.5
        };

        this.init();
    }

    init() {
        // Create audio context
        this.context = new (window.AudioContext || window.webkitAudioContext)();

        // Create master gain
        this.masterGain = this.context.createGain();
        this.masterGain.gain.value = this.params.masterVolume;
        this.masterGain.connect(this.context.destination);

        // Create 3 voices
        for (let i = 0; i < 3; i++) {
            const voice = new SynthVoice(this.context);
            voice.connect(this.masterGain);
            this.voices.push(voice);
        }

        // Create LFO1 - start it immediately
        this.lfo = new LFO(this.context);
        this.lfo.start(this.params.lfo.rate, this.params.lfo.waveform);

        // Create LFO2 for PWM modulation - start it immediately
        this.lfo2 = new LFO(this.context);
        this.lfo2.start(this.params.lfo2.rate, this.params.lfo2.waveform);

        // Create arpeggiator
        this.arpeggiator = new Arpeggiator(this);

        console.log('FrontalSynth initialized with', this.voices.length, 'voices');
    }

    noteOn(note, velocity = 1.0) {
        // Resume audio context if suspended (browser autoplay policy)
        if (this.context.state === 'suspended') {
            this.context.resume();
        }

        const frequency = this.midiToFreq(note);

        // If arpeggiator is enabled, just track the note
        if (this.arpeggiator.enabled) {
            this.arpeggiator.addNote(note);
            return;
        }

        // Find available voice
        let voice = this.voices.find(v => !v.active);

        // If no available voice, steal the oldest one
        if (!voice) {
            voice = this.voices[0];
            // Find the note using this voice and remove it
            for (let [noteNum, v] of this.activeNotes.entries()) {
                if (v === voice) {
                    this.activeNotes.delete(noteNum);
                    break;
                }
            }
        }

        // Store which voice is playing this note
        this.activeNotes.set(note, voice);
        voice.note = note;

        // Update filter parameters
        voice.setFilterParams(
            this.params.filterCutoff,
            this.params.filterResonance,
            this.params.filterType
        );

        // Start the voice with LFO1 and LFO2
        voice.start(frequency, {
            osc1Waveform: this.params.osc1Waveform,
            osc1Detune: this.params.osc1Detune,
            osc1Offset: this.params.osc1Offset,
            osc1Level: this.params.osc1Level,
            osc2Waveform: this.params.osc2Waveform,
            osc2Detune: this.params.osc2Detune,
            osc2Offset: this.params.osc2Offset,
            osc2Level: this.params.osc2Level,
            pulseWidth: this.params.pulseWidth,
            ringMod: this.params.ringMod,
            oscSync: this.params.oscSync,
            envelope: this.params.envelope,
            filterEnvAmount: this.params.filterEnvAmount,
            modMatrix: this.params.modMatrix
        }, this.lfo.getOutput(), this.lfo2.getOutput());

        this.updateVoiceIndicators();
    }

    noteOff(note) {
        // If arpeggiator is enabled, remove from held notes
        if (this.arpeggiator.enabled) {
            this.arpeggiator.removeNote(note);
            return;
        }

        const voice = this.activeNotes.get(note);
        if (voice) {
            voice.stop(this.params.envelope.release / 1000);
            this.activeNotes.delete(note);
            this.updateVoiceIndicators();
        }
    }

    playNote(frequency, duration = 0.2) {
        // For arpeggiator - play a note directly with frequency
        let voice = this.voices.find(v => !v.active);
        if (!voice) {
            voice = this.voices[0];
        }

        voice.setFilterParams(
            this.params.filterCutoff,
            this.params.filterResonance,
            this.params.filterType
        );

        voice.start(frequency, {
            osc1Waveform: this.params.osc1Waveform,
            osc1Detune: this.params.osc1Detune,
            osc1Offset: this.params.osc1Offset,
            osc1Level: this.params.osc1Level,
            osc2Waveform: this.params.osc2Waveform,
            osc2Detune: this.params.osc2Detune,
            osc2Offset: this.params.osc2Offset,
            osc2Level: this.params.osc2Level,
            pulseWidth: this.params.pulseWidth,
            ringMod: this.params.ringMod,
            oscSync: this.params.oscSync,
            envelope: this.params.envelope,
            filterEnvAmount: this.params.filterEnvAmount,
            modMatrix: this.params.modMatrix
        }, this.lfo.getOutput(), this.lfo2.getOutput());

        setTimeout(() => {
            voice.stop(this.params.envelope.release / 1000);
        }, duration * 1000);
    }

    midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    setParameter(param, value) {
        switch(param) {
            // Oscillator 1
            case 'osc1Waveform':
                this.params.osc1Waveform = value;
                break;
            case 'osc1Detune':
                this.params.osc1Detune = parseFloat(value);
                break;
            case 'osc1Offset':
                this.params.osc1Offset = parseFloat(value);
                break;
            case 'osc1Level':
                this.params.osc1Level = parseFloat(value);
                break;

            // Oscillator 2
            case 'osc2Waveform':
                this.params.osc2Waveform = value;
                break;
            case 'osc2Detune':
                this.params.osc2Detune = parseFloat(value);
                break;
            case 'osc2Offset':
                this.params.osc2Offset = parseFloat(value);
                break;
            case 'osc2Level':
                this.params.osc2Level = parseFloat(value);
                break;

            // PWM
            case 'pulseWidth':
                this.params.pulseWidth = parseFloat(value);
                break;

            // Ring mod and sync
            case 'ringMod':
                this.params.ringMod = parseFloat(value);
                break;
            case 'oscSync':
                this.params.oscSync = value;
                break;

            // Filter
            case 'filterCutoff':
                this.params.filterCutoff = parseFloat(value);
                this.voices.forEach(v => {
                    if (v.filter) v.filter.frequency.value = this.params.filterCutoff;
                });
                break;
            case 'filterResonance':
                this.params.filterResonance = parseFloat(value);
                this.voices.forEach(v => {
                    if (v.filter) v.filter.Q.value = this.params.filterResonance;
                });
                break;
            case 'filterType':
                this.params.filterType = value;
                this.voices.forEach(v => {
                    if (v.filter) v.filter.type = this.params.filterType;
                });
                break;
            case 'filterEnvAmount':
                this.params.filterEnvAmount = parseFloat(value);
                break;

            // Envelope
            case 'attack':
                this.params.envelope.attack = parseFloat(value);
                break;
            case 'decay':
                this.params.envelope.decay = parseFloat(value);
                break;
            case 'sustain':
                this.params.envelope.sustain = parseFloat(value);
                break;
            case 'release':
                this.params.envelope.release = parseFloat(value);
                break;

            // LFO1
            case 'lfoRate':
                this.params.lfo.rate = parseFloat(value);
                if (this.lfo.running) {
                    this.lfo.setRate(this.params.lfo.rate);
                }
                break;
            case 'lfoWaveform':
                this.params.lfo.waveform = value;
                if (this.lfo.running) {
                    this.lfo.stop();
                    this.lfo.start(this.params.lfo.rate, this.params.lfo.waveform);
                }
                break;

            // LFO2 (PWM modulation)
            case 'lfo2Rate':
                this.params.lfo2.rate = parseFloat(value);
                if (this.lfo2.running) {
                    this.lfo2.setRate(this.params.lfo2.rate);
                }
                break;
            case 'lfo2Waveform':
                this.params.lfo2.waveform = value;
                if (this.lfo2.running) {
                    this.lfo2.stop();
                    this.lfo2.start(this.params.lfo2.rate, this.params.lfo2.waveform);
                }
                break;

            // Modulation Matrix - Per-Oscillator Controls
            case 'modLfo1Osc1Pitch':
                this.params.modMatrix.lfo1Osc1Pitch = parseFloat(value);
                break;
            case 'modLfo1Osc2Pitch':
                this.params.modMatrix.lfo1Osc2Pitch = parseFloat(value);
                break;
            case 'modLfo1Filter':
                this.params.modMatrix.lfo1Filter = parseFloat(value);
                break;
            case 'modLfo2Osc1PWM':
                this.params.modMatrix.lfo2Osc1PWM = parseFloat(value);
                break;
            case 'modLfo2Osc2PWM':
                this.params.modMatrix.lfo2Osc2PWM = parseFloat(value);
                break;
            case 'modEnvFilter':
                this.params.modMatrix.envFilter = parseFloat(value);
                break;

            // Master
            case 'masterVolume':
                this.params.masterVolume = parseFloat(value);
                this.masterGain.gain.value = this.params.masterVolume;
                break;
        }
    }

    updateVoiceIndicators() {
        // This will be called from UI
        for (let i = 0; i < this.voices.length; i++) {
            const indicator = document.getElementById(`voice-${i + 1}`);
            if (indicator) {
                indicator.classList.toggle('active', this.voices[i].active);
            }
        }
    }

    panic() {
        // Stop all voices immediately
        this.voices.forEach(voice => voice.stop(0));
        this.activeNotes.clear();
        this.arpeggiator.clear();
        this.updateVoiceIndicators();
    }
}

// Create global synth instance
window.synth = new SynthEngine();
