# FrontalSynth

A professional-grade analog modeling synthesizer built with Web Audio API and JavaScript.

## Features

### Core Synthesis
- **3-Voice Polyphony**: Play up to 3 notes simultaneously with intelligent voice stealing
- **Dual Oscillators per Voice**: Two independent oscillators with individual waveform, detune, offset, and level controls
- **Analog-Style Oscillators**: Sawtooth, Square, Triangle, and Sine waveforms for each oscillator
- **Detune Control**: Independent detune for each oscillator creates rich chorus and unison effects (±50 cents)
- **Note Offset**: Per-oscillator semitone offset (-24 to +24) for intervals, octaves, and fifths
- **Pulse Width Modulation (PWM)**: Variable pulse width for square waves (0-100%), LFO-modulatable for classic analog string sounds
- **Ring Modulation**: Multiply oscillator 1 and 2 signals for metallic, bell-like tones
- **Oscillator Sync**: Hard sync where oscillator 1 drives oscillator 2 frequency for classic analog sync sounds

### Filter
- **Multi-Mode Filter**: Lowpass, Highpass, and Bandpass filter types
- **Cutoff Frequency**: 20 Hz to 20 kHz range
- **Resonance Control**: Self-oscillation capable for classic analog sounds
- **Envelope Modulation**: Adjustable filter envelope amount

### Envelope Generator (ADSR)
- **Attack**: 0-2000ms
- **Decay**: 0-2000ms
- **Sustain**: 0-100%
- **Release**: 0-3000ms

### Dual LFOs (Low Frequency Oscillators)
- **LFO1**: Controls pitch and filter modulation
  - Multiple Waveforms: Sine, Triangle, Square, Sawtooth
  - Rate Control: 0.1 to 20 Hz
  - Always Running: Ready to modulate
- **LFO2**: Independent PWM modulation
  - Multiple Waveforms: Sine, Triangle, Square, Sawtooth
  - Rate Control: 0.1 to 20 Hz
  - Independent rate allows complex timbral movement

### Modulation Matrix
Route modulation sources to multiple destinations with adjustable amounts:
- **LFO1 → Pitch**: Vibrato and pitch modulation effects (0-100%)
- **LFO1 → Filter**: Wah-wah and filter sweep effects (0-100%)
- **LFO2 → PWM**: Pulse width modulation sweep for classic analog string/pad textures (0-100%)
- **Envelope → Filter**: Classic analog filter envelope control (0-100%)

The dual LFO architecture allows independent modulation rates - for example, slow pitch vibrato (LFO1 at 5Hz) combined with fast PWM sweep (LFO2 at 0.3Hz) for evolving, complex timbres.

### Arpeggiator
- **Multiple Patterns**: Up, Down, Up/Down, Random
- **Adjustable Rate**: 1/16, 1/8, 1/4 note divisions
- **BPM Control**: 60-200 BPM
- **Real-time Control**: Hold notes and enable arpeggiator on the fly

## Usage

### Opening the Synthesizer
Simply open `index.html` in a modern web browser (Chrome, Firefox, Safari, Edge).

### Playing the Synthesizer

#### Computer Keyboard
- **White Keys**: A, S, D, F, G, H, J, K, L
- **Black Keys**: W, E, T, Y, U, I
- **Panic**: Press ESC to stop all notes

#### On-Screen Keyboard
Click or tap the visual keyboard keys to play notes.

#### MIDI Keyboard
Connect a MIDI keyboard - FrontalSynth will automatically detect and use it.

### Creating Sounds

#### Detuned Supersaw Bass
1. OSC1: Sawtooth, Detune 0, Level 50%
2. OSC2: Sawtooth, Detune 7-12, Level 50%
3. Filter Cutoff: 800 Hz, Resonance: 8
4. Envelope: Attack 10ms, Decay 300ms, Sustain 0%, Release 150ms
5. Filter Env → 80%, ENV Amount: 3000

#### Warm Analog Pad
1. OSC1: Triangle, Detune -5, Level 50%
2. OSC2: Triangle, Detune 5, Level 50%
3. Filter Cutoff: 1500 Hz
4. Envelope: Attack 1000ms, Decay 800ms, Sustain 60%, Release 1500ms
5. LFO1 → Filter: 30%, LFO1 Rate: 0.5 Hz, Waveform: Sine

#### Sync Lead Sound
1. OSC1: Sawtooth, Detune 0, Level 40%
2. OSC2: Square, Detune 12, Level 60%
3. Enable OSC SYNC
4. Filter Cutoff: 5000 Hz, Resonance: 4
5. LFO1 → Pitch: 20% for vibrato, LFO1 Rate: 5 Hz
6. Envelope: Attack 5ms, Release 200ms

#### Bell/Metallic Tones
1. OSC1: Sine, Level 40%
2. OSC2: Sine, Detune 7, Level 40%
3. Ring Mod: 60-80%
4. Filter Cutoff: 8000 Hz
5. Envelope: Attack 1ms, Decay 400ms, Sustain 0%, Release 600ms

#### Wobble Bass (Dubstep style)
1. OSC1: Sawtooth, Level 50%
2. OSC2: Square, Detune 5, Level 50%
3. Filter Cutoff: 2000 Hz, Resonance: 15
4. LFO1 → Filter: 80%, LFO1 Rate: 4-8 Hz, Waveform: Square
5. Envelope: Fast attack, short decay, low sustain

#### PWM String Pad
1. OSC1: Square, Level 60%
2. OSC2: Square, Detune -3, Offset +12 (octave up), Level 40%
3. Pulse Width: 30-70% (experiment!)
4. LFO2 → PWM: 60%, LFO2 Rate: 0.3 Hz, Waveform: Triangle
5. Filter Cutoff: 3000 Hz, Resonance: 2
6. Envelope: Attack 800ms, Decay 600ms, Sustain 70%, Release 1200ms
7. Chorus/detune effect from sweeping PWM creates lush analog texture
8. Optional: Add LFO1 → Pitch: 10%, LFO1 Rate: 5 Hz for vibrato on top of PWM sweep

## Technical Details

### Architecture
- **Web Audio API**: Low-latency audio processing
- **Modular Design**: Separate voice management, dual LFO system, and arpeggiator classes
- **Real-time Parameter Updates**: All controls respond instantly
- **Dual LFO Design**: Independent LFO1 (pitch/filter) and LFO2 (PWM) for complex modulation

### Browser Compatibility
- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (may require user interaction to start audio)

### Performance
- Lightweight: No external dependencies
- Optimized voice management
- Efficient parameter modulation
- Low CPU usage even with all 3 voices active

## File Structure

```
frontalsynth/
├── index.html          # Main HTML interface
├── synth-engine.js     # Core synthesis engine
├── ui-controls.js      # UI and input handling
├── style.css           # Analog-style CSS styling
└── README.md          # This file
```

## Development

### Core Classes

**SynthEngine**: Main synthesizer engine managing voices and parameters
**SynthVoice**: Individual voice with oscillator, filter, and envelope
**LFO**: Low-frequency oscillator for modulation
**Arpeggiator**: Pattern-based note sequencer
**UIController**: Handles all user interface interactions

### Adding Features

The modular architecture makes it easy to add new features:
- Add new modulation destinations in the modulation matrix
- Implement additional filter types or effects
- Expand arpeggiator patterns
- Add preset management

## Tips & Tricks

1. **Thick Sounds**: Use pulse width modulation with the LFO
2. **Movement**: Route LFO to filter cutoff for evolving textures
3. **Classic Analog**: High resonance + envelope modulation = classic synth sounds
4. **Rhythmic Patterns**: Experiment with different arpeggiator patterns and rates
5. **Voice Layering**: Play chords to use all 3 voices for rich sounds

## License

MIT License - Feel free to use and modify as needed.

## Credits

Built with Web Audio API
Designed for lightweight performance and professional sound quality
