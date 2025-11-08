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
- **Oscillator Sync**: TRUE hard sync with phase reset - oscillator 1 resets oscillator 2's phase for authentic analog sync sounds (AudioWorklet processor with full integration: PWM, ring mod, and all LFO modulation work seamlessly with sync enabled)

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

### Modulation Matrix (Per-Oscillator Control)
Route modulation sources to specific oscillators with adjustable amounts:

**LFO1 Modulation:**
- **LFO1 → OSC1 Pitch**: Independent vibrato/pitch modulation for oscillator 1 (0-100%)
- **LFO1 → OSC2 Pitch**: Independent vibrato/pitch modulation for oscillator 2 (0-100%)
- **LFO1 → Filter**: Wah-wah and filter sweep effects, global (0-100%)

**LFO2 Modulation:**
- **LFO2 → OSC1 PWM**: Pulse width sweep for oscillator 1 only (0-100%)
- **LFO2 → OSC2 PWM**: Pulse width sweep for oscillator 2 only (0-100%)

**Envelope Modulation:**
- **ENV → Filter**: Classic analog filter envelope control, global (0-100%)

**Per-Oscillator Benefits:**
- Apply vibrato to only one oscillator while the other stays steady
- Different PWM sweep depths create complex, moving timbres
- OSC1 vibrato at 30% + OSC2 vibrato at 0% = subtle detuning effect
- OSC1 PWM at 80% + OSC2 PWM at 20% = asymmetric pulse width movement

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

#### Sync Lead Sound (with PWM and Ring Mod)
1. OSC1: Sawtooth, Detune 0, Level 40%
2. OSC2: Square, Detune 0, Offset +7 (fifth), Level 50%
3. Enable OSC SYNC, Ring Mod: 20%
4. Pulse Width: 40%, LFO2 → OSC2 PWM: 60%, LFO2 Rate: 0.8 Hz
5. Filter Cutoff: 5000 Hz, Resonance: 4
6. LFO1 → OSC2 Pitch: 30% for vibrato, LFO1 Rate: 5 Hz
7. Envelope: Attack 5ms, Release 200ms
8. Result: Classic sync with PWM sweep and subtle ring modulation - all features working together

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

#### PWM String Pad (Per-Oscillator Modulation)
1. OSC1: Square, Level 60%
2. OSC2: Square, Detune -3, Offset +12 (octave up), Level 40%
3. Pulse Width: 30-70% (experiment!)
4. LFO2 → OSC1 PWM: 80%, LFO2 → OSC2 PWM: 40%, LFO2 Rate: 0.3 Hz, Waveform: Triangle
5. Filter Cutoff: 3000 Hz, Resonance: 2
6. Envelope: Attack 800ms, Decay 600ms, Sustain 70%, Release 1200ms
7. Different PWM depths create complex, evolving chorusing effect
8. Optional: Add LFO1 → OSC1 Pitch: 15%, LFO1 → OSC2 Pitch: 5%, LFO1 Rate: 5 Hz for subtle vibrato variation

#### Detuned Lead with Vibrato
1. OSC1: Sawtooth, Detune 0, Level 50%
2. OSC2: Sawtooth, Detune 7, Level 50%
3. LFO1 → OSC1 Pitch: 40%, LFO1 → OSC2 Pitch: 0%, LFO1 Rate: 6 Hz
4. Filter Cutoff: 4000 Hz, Resonance: 3
5. Envelope: Attack 5ms, Release 150ms
6. Result: OSC1 has vibrato while OSC2 stays steady, creating a unique detuning effect

## Technical Details

### Architecture
- **Web Audio API**: Low-latency audio processing
- **AudioWorklet**: Custom oscillator processing for true hard sync with phase reset
- **Modular Design**: Separate voice management, dual LFO system, and arpeggiator classes
- **Real-time Parameter Updates**: All controls respond instantly
- **Dual LFO Design**: Independent LFO1 (pitch/filter) and LFO2 (PWM) for complex modulation
- **Graceful Fallback**: FM-based sync if AudioWorklet is unavailable

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
├── sync-processor.js   # AudioWorklet processor for true hard sync
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
