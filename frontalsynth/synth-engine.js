// FrontalSynth - Analog Modeling Synthesizer Engine
// Web Audio API based synthesis engine with modulation matrix

class SynthVoice {
    constructor(audioContext) {
        this.context = audioContext;
        this.note = null;
        this.active = false;

        // Oscillators
        this.osc = null;
        this.pwmOsc = null; // For pulse width modulation
        this.pwmGain = null;

        // Filter
        this.filter = this.context.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 2000;
        this.filter.Q.value = 1;

        // VCA (Voltage Controlled Amplifier)
        this.vca = this.context.createGain();
        this.vca.gain.value = 0;

        // Filter envelope gain
        this.filterEnvGain = this.context.createGain();
        this.filterEnvGain.gain.value = 0;

        // Connect: Filter -> VCA
        this.filter.connect(this.vca);
    }

    start(frequency, waveform, params) {
        if (this.active) {
            this.stop();
        }

        const now = this.context.currentTime;
        this.active = true;

        // Create main oscillator
        this.osc = this.context.createOscillator();
        this.osc.type = waveform;
        this.osc.frequency.value = frequency;

        // Apply detune
        if (params.detune) {
            this.osc.detune.value = params.detune;
        }

        // For square wave, implement PWM using two sawtooth waves
        if (waveform === 'square' && params.pulseWidth !== 50) {
            this.setupPWM(frequency, params.pulseWidth);
        }

        // Connect oscillator to filter
        this.osc.connect(this.filter);

        // Start oscillator
        this.osc.start(now);

        // Apply envelope
        this.applyEnvelope(params.envelope, params.filterEnvAmount, params.modMatrix);
    }

    setupPWM(frequency, pulseWidth) {
        // PWM using two sawtooth oscillators with phase offset
        const pwmAmount = (pulseWidth - 50) / 50; // -1 to 1

        if (Math.abs(pwmAmount) > 0.01) {
            this.osc.type = 'sawtooth';

            this.pwmOsc = this.context.createOscillator();
            this.pwmOsc.type = 'sawtooth';
            this.pwmOsc.frequency.value = frequency;
            this.pwmOsc.detune.value = 0;

            this.pwmGain = this.context.createGain();
            this.pwmGain.gain.value = -1; // Invert second oscillator

            this.pwmOsc.connect(this.pwmGain);
            this.pwmGain.connect(this.filter);
            this.pwmOsc.start(this.context.currentTime);
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
        this.filter.frequency.linearRampToValueAtTime(baseFreq + filterEnvAmt, now + attackTime);
        this.filter.frequency.linearRampToValueAtTime(baseFreq + (filterEnvAmt * sustainLevel), now + attackTime + decayTime);
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
            if (this.osc) {
                this.osc.stop();
                this.osc.disconnect();
                this.osc = null;
            }
            if (this.pwmOsc) {
                this.pwmOsc.stop();
                this.pwmOsc.disconnect();
                this.pwmOsc = null;
            }
            if (this.pwmGain) {
                this.pwmGain.disconnect();
                this.pwmGain = null;
            }
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
        this.gain.gain.value = 0;
        this.running = false;
    }

    start(rate, waveform, depth) {
        if (this.running) {
            this.stop();
        }

        this.osc = this.context.createOscillator();
        this.osc.type = waveform;
        this.osc.frequency.value = rate;

        this.gain.gain.value = depth / 100;

        this.osc.connect(this.gain);
        this.osc.start();
        this.running = true;
    }

    stop() {
        if (this.osc) {
            this.osc.stop();
            this.osc.disconnect();
            this.osc = null;
        }
        this.running = false;
    }

    setRate(rate) {
        if (this.osc) {
            this.osc.frequency.value = rate;
        }
    }

    setDepth(depth) {
        this.gain.gain.value = depth / 100;
    }

    connect(destination) {
        return this.gain.connect(destination);
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
        this.masterGain = null;
        this.arpeggiator = null;
        this.activeNotes = new Map(); // Map note to voice

        // Synth parameters
        this.params = {
            waveform: 'sawtooth',
            detune: 0,
            pulseWidth: 50,
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
                waveform: 'sine',
                depth: 0
            },
            modMatrix: {
                lfoPitch: 0,
                lfoFilter: 0,
                lfoPWM: 0,
                envFilter: 50
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

        // Create LFO
        this.lfo = new LFO(this.context);

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

        // Start the voice
        voice.start(frequency, this.params.waveform, {
            detune: this.params.detune,
            pulseWidth: this.params.pulseWidth,
            envelope: this.params.envelope,
            filterEnvAmount: this.params.filterEnvAmount,
            modMatrix: this.params.modMatrix
        });

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

        voice.start(frequency, this.params.waveform, {
            detune: this.params.detune,
            pulseWidth: this.params.pulseWidth,
            envelope: this.params.envelope,
            filterEnvAmount: this.params.filterEnvAmount,
            modMatrix: this.params.modMatrix
        });

        setTimeout(() => {
            voice.stop(this.params.envelope.release / 1000);
        }, duration * 1000);
    }

    midiToFreq(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    setParameter(param, value) {
        switch(param) {
            case 'waveform':
                this.params.waveform = value;
                break;
            case 'detune':
                this.params.detune = parseFloat(value);
                break;
            case 'pulseWidth':
                this.params.pulseWidth = parseFloat(value);
                break;
            case 'filterCutoff':
                this.params.filterCutoff = parseFloat(value);
                this.voices.forEach(v => v.filter.frequency.value = this.params.filterCutoff);
                break;
            case 'filterResonance':
                this.params.filterResonance = parseFloat(value);
                this.voices.forEach(v => v.filter.Q.value = this.params.filterResonance);
                break;
            case 'filterType':
                this.params.filterType = value;
                this.voices.forEach(v => v.filter.type = this.params.filterType);
                break;
            case 'filterEnvAmount':
                this.params.filterEnvAmount = parseFloat(value);
                break;
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
                    this.lfo.start(this.params.lfo.rate, this.params.lfo.waveform, this.params.lfo.depth);
                }
                break;
            case 'lfoDepth':
                this.params.lfo.depth = parseFloat(value);
                if (this.params.lfo.depth > 0 && !this.lfo.running) {
                    this.lfo.start(this.params.lfo.rate, this.params.lfo.waveform, this.params.lfo.depth);
                } else if (this.params.lfo.depth === 0 && this.lfo.running) {
                    this.lfo.stop();
                } else if (this.lfo.running) {
                    this.lfo.setDepth(this.params.lfo.depth);
                }
                break;
            case 'masterVolume':
                this.params.masterVolume = parseFloat(value);
                this.masterGain.gain.value = this.params.masterVolume;
                break;
            case 'modLfoPitch':
                this.params.modMatrix.lfoPitch = parseFloat(value);
                break;
            case 'modLfoFilter':
                this.params.modMatrix.lfoFilter = parseFloat(value);
                break;
            case 'modLfoPWM':
                this.params.modMatrix.lfoPWM = parseFloat(value);
                break;
            case 'modEnvFilter':
                this.params.modMatrix.envFilter = parseFloat(value);
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
