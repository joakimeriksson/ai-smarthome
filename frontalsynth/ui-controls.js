// FrontalSynth UI Controls
// Handles all user interface interactions and keyboard input

class UIController {
    constructor(synthEngine) {
        this.synth = synthEngine;
        this.keyboardMap = new Map();
        this.pressedKeys = new Set();
        this.midiAccess = null;

        this.init();
    }

    init() {
        this.setupControlListeners();
        this.generateKeyboard();
        this.setupKeyboardInput();
        this.setupMIDI();
        this.updateAllDisplays();
    }

    setupControlListeners() {
        // Oscillator controls
        this.addListener('osc-waveform', (value) => {
            this.synth.setParameter('waveform', value);
        });

        this.addListener('osc-detune', (value) => {
            this.synth.setParameter('detune', value);
            this.updateDisplay('osc-detune-val', value);
        });

        this.addListener('osc-pwm', (value) => {
            this.synth.setParameter('pulseWidth', value);
            this.updateDisplay('osc-pwm-val', value + '%');
        });

        // Filter controls
        this.addListener('filter-cutoff', (value) => {
            this.synth.setParameter('filterCutoff', value);
            this.updateDisplay('filter-cutoff-val', Math.round(value) + ' Hz');
        });

        this.addListener('filter-resonance', (value) => {
            this.synth.setParameter('filterResonance', value);
            this.updateDisplay('filter-resonance-val', parseFloat(value).toFixed(1));
        });

        this.addListener('filter-type', (value) => {
            this.synth.setParameter('filterType', value);
        });

        this.addListener('filter-env', (value) => {
            this.synth.setParameter('filterEnvAmount', value);
            this.updateDisplay('filter-env-val', value);
        });

        // Envelope controls
        this.addListener('env-attack', (value) => {
            this.synth.setParameter('attack', value);
            this.updateDisplay('env-attack-val', value + ' ms');
        });

        this.addListener('env-decay', (value) => {
            this.synth.setParameter('decay', value);
            this.updateDisplay('env-decay-val', value + ' ms');
        });

        this.addListener('env-sustain', (value) => {
            this.synth.setParameter('sustain', value);
            this.updateDisplay('env-sustain-val', value + '%');
        });

        this.addListener('env-release', (value) => {
            this.synth.setParameter('release', value);
            this.updateDisplay('env-release-val', value + ' ms');
        });

        // LFO controls
        this.addListener('lfo-rate', (value) => {
            this.synth.setParameter('lfoRate', value);
            this.updateDisplay('lfo-rate-val', parseFloat(value).toFixed(1) + ' Hz');
        });

        this.addListener('lfo-waveform', (value) => {
            this.synth.setParameter('lfoWaveform', value);
        });

        this.addListener('lfo-depth', (value) => {
            this.synth.setParameter('lfoDepth', value);
            this.updateDisplay('lfo-depth-val', value + '%');
        });

        // Modulation matrix
        this.addListener('mod-lfo-pitch', (value) => {
            this.synth.setParameter('modLfoPitch', value);
            this.updateDisplay('mod-lfo-pitch-val', value + '%');
        });

        this.addListener('mod-lfo-filter', (value) => {
            this.synth.setParameter('modLfoFilter', value);
            this.updateDisplay('mod-lfo-filter-val', value + '%');
        });

        this.addListener('mod-lfo-pwm', (value) => {
            this.synth.setParameter('modLfoPWM', value);
            this.updateDisplay('mod-lfo-pwm-val', value + '%');
        });

        this.addListener('mod-env-filter', (value) => {
            this.synth.setParameter('modEnvFilter', value);
            this.updateDisplay('mod-env-filter-val', value + '%');
        });

        // Arpeggiator controls
        document.getElementById('arp-enabled').addEventListener('change', (e) => {
            this.synth.arpeggiator.setEnabled(e.target.checked);
        });

        this.addListener('arp-pattern', (value) => {
            this.synth.arpeggiator.setPattern(value);
        });

        this.addListener('arp-rate', (value) => {
            this.synth.arpeggiator.setRate(parseInt(value));
        });

        this.addListener('arp-bpm', (value) => {
            this.synth.arpeggiator.setBPM(parseInt(value));
            this.updateDisplay('arp-bpm-val', value);
        });

        // Master controls
        this.addListener('master-volume', (value) => {
            this.synth.setParameter('masterVolume', value / 100);
            this.updateDisplay('master-volume-val', value + '%');
        });
    }

    addListener(elementId, callback) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener('input', (e) => callback(e.target.value));
            element.addEventListener('change', (e) => callback(e.target.value));
        }
    }

    updateDisplay(elementId, value) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = value;
        }
    }

    updateAllDisplays() {
        // Initialize all display values
        const displays = [
            ['osc-detune-val', '0'],
            ['osc-pwm-val', '50%'],
            ['filter-cutoff-val', '2000 Hz'],
            ['filter-resonance-val', '1.0'],
            ['filter-env-val', '4000'],
            ['env-attack-val', '10 ms'],
            ['env-decay-val', '300 ms'],
            ['env-sustain-val', '70%'],
            ['env-release-val', '500 ms'],
            ['lfo-rate-val', '4.0 Hz'],
            ['lfo-depth-val', '0%'],
            ['mod-lfo-pitch-val', '0%'],
            ['mod-lfo-filter-val', '0%'],
            ['mod-lfo-pwm-val', '0%'],
            ['mod-env-filter-val', '50%'],
            ['arp-bpm-val', '120'],
            ['master-volume-val', '50%']
        ];

        displays.forEach(([id, value]) => {
            this.updateDisplay(id, value);
        });
    }

    generateKeyboard() {
        const keyboard = document.getElementById('keyboard');
        const octaves = 2;
        const startNote = 48; // C3

        const whiteKeyPattern = [0, 2, 4, 5, 7, 9, 11]; // C, D, E, F, G, A, B
        const blackKeyPattern = [1, 3, null, 6, 8, 10, null]; // C#, D#, F#, G#, A#

        for (let octave = 0; octave < octaves; octave++) {
            const octaveDiv = document.createElement('div');
            octaveDiv.className = 'octave';

            // White keys
            whiteKeyPattern.forEach((semitone, index) => {
                const note = startNote + (octave * 12) + semitone;
                const key = this.createKey(note, 'white');
                octaveDiv.appendChild(key);
            });

            // Black keys (overlaid)
            blackKeyPattern.forEach((semitone, index) => {
                if (semitone !== null) {
                    const note = startNote + (octave * 12) + semitone;
                    const key = this.createKey(note, 'black');
                    key.style.left = `${(index * 14.28) + 10}%`;
                    octaveDiv.appendChild(key);
                }
            });

            keyboard.appendChild(octaveDiv);
        }
    }

    createKey(note, type) {
        const key = document.createElement('div');
        key.className = `key ${type}`;
        key.dataset.note = note;

        key.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.handleNoteOn(note);
            key.classList.add('active');
        });

        key.addEventListener('mouseup', (e) => {
            e.preventDefault();
            this.handleNoteOff(note);
            key.classList.remove('active');
        });

        key.addEventListener('mouseleave', (e) => {
            if (key.classList.contains('active')) {
                this.handleNoteOff(note);
                key.classList.remove('active');
            }
        });

        // Touch support
        key.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleNoteOn(note);
            key.classList.add('active');
        });

        key.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleNoteOff(note);
            key.classList.remove('active');
        });

        return key;
    }

    setupKeyboardInput() {
        // Map computer keyboard to MIDI notes
        // A-L for white keys, W-U for black keys
        const keyMap = {
            // White keys (C, D, E, F, G, A, B, C)
            'a': 48, 's': 50, 'd': 52, 'f': 53, 'g': 55, 'h': 57, 'j': 59, 'k': 60,
            'l': 62,
            // Black keys (C#, D#, F#, G#, A#)
            'w': 49, 'e': 51, 't': 54, 'y': 56, 'u': 58, 'i': 61
        };

        document.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();

            // Panic button (Escape)
            if (key === 'escape') {
                this.synth.panic();
                this.pressedKeys.clear();
                document.querySelectorAll('.key.active').forEach(k => k.classList.remove('active'));
                return;
            }

            if (keyMap[key] && !this.pressedKeys.has(key)) {
                this.pressedKeys.add(key);
                const note = keyMap[key];
                this.handleNoteOn(note);

                // Highlight visual key
                const keyElement = document.querySelector(`.key[data-note="${note}"]`);
                if (keyElement) {
                    keyElement.classList.add('active');
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();

            if (keyMap[key] && this.pressedKeys.has(key)) {
                this.pressedKeys.delete(key);
                const note = keyMap[key];
                this.handleNoteOff(note);

                // Remove highlight from visual key
                const keyElement = document.querySelector(`.key[data-note="${note}"]`);
                if (keyElement) {
                    keyElement.classList.remove('active');
                }
            }
        });
    }

    setupMIDI() {
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess()
                .then((midiAccess) => {
                    this.midiAccess = midiAccess;
                    console.log('MIDI enabled');

                    for (let input of midiAccess.inputs.values()) {
                        input.onmidimessage = this.handleMIDIMessage.bind(this);
                        console.log('MIDI input:', input.name);
                    }
                })
                .catch((err) => {
                    console.log('MIDI not available:', err);
                });
        }
    }

    handleMIDIMessage(message) {
        const [status, note, velocity] = message.data;
        const command = status >> 4;

        if (command === 9 && velocity > 0) { // Note on
            this.handleNoteOn(note, velocity / 127);
            const keyElement = document.querySelector(`.key[data-note="${note}"]`);
            if (keyElement) {
                keyElement.classList.add('active');
            }
        } else if (command === 8 || (command === 9 && velocity === 0)) { // Note off
            this.handleNoteOff(note);
            const keyElement = document.querySelector(`.key[data-note="${note}"]`);
            if (keyElement) {
                keyElement.classList.remove('active');
            }
        }
    }

    handleNoteOn(note, velocity = 1.0) {
        this.synth.noteOn(note, velocity);
    }

    handleNoteOff(note) {
        this.synth.noteOff(note);
    }
}

// Initialize UI when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.uiController = new UIController(window.synth);
    console.log('FrontalSynth UI initialized');

    // Animate power indicator
    const powerIndicator = document.querySelector('.power-indicator');
    if (powerIndicator) {
        setInterval(() => {
            powerIndicator.style.opacity = powerIndicator.style.opacity === '1' ? '0.3' : '1';
        }, 1000);
    }
});
