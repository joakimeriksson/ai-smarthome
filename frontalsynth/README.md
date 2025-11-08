# FrontalSynth

A professional-grade analog modeling synthesizer built with Web Audio API and JavaScript.

## Features

### Core Synthesis
- **3-Voice Polyphony**: Play up to 3 notes simultaneously with intelligent voice stealing
- **Analog-Style Oscillators**: Sawtooth, Square, Triangle, and Sine waveforms
- **Pulse Width Modulation**: Adjustable pulse width for square waves
- **Detune Control**: Fine-tune oscillator pitch for thicker sounds

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

### LFO (Low Frequency Oscillator)
- **Multiple Waveforms**: Sine, Triangle, Square, Sawtooth
- **Rate Control**: 0.1 to 20 Hz
- **Adjustable Depth**: 0-100%

### Modulation Matrix
Route modulation sources to multiple destinations:
- **LFO → Pitch**: Vibrato effects
- **LFO → Filter**: Wah-wah and sweep effects
- **LFO → PWM**: Pulse width modulation
- **Envelope → Filter**: Classic filter envelope control

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

#### Basic Bass Sound
1. Waveform: Sawtooth
2. Filter Cutoff: 500 Hz
3. Filter Resonance: 5-10
4. Envelope: Attack 10ms, Decay 200ms, Sustain 0%, Release 100ms
5. Filter Env Amount: 2000

#### Pad Sound
1. Waveform: Square or Triangle
2. Filter Cutoff: 2000 Hz
3. Envelope: Attack 800ms, Decay 500ms, Sustain 70%, Release 1000ms
4. Add LFO to Filter (slow rate, low depth)

#### Lead Sound
1. Waveform: Sawtooth
2. Filter Cutoff: 4000 Hz
3. Filter Resonance: 3-5
4. Add LFO to Pitch for vibrato
5. Envelope: Fast attack, medium release

#### Arpeggio Sequences
1. Enable Arpeggiator
2. Choose pattern (Up/Down works great)
3. Set BPM to desired tempo
4. Hold multiple keys to create sequences

## Technical Details

### Architecture
- **Web Audio API**: Low-latency audio processing
- **Modular Design**: Separate voice management, LFO, and arpeggiator classes
- **Real-time Parameter Updates**: All controls respond instantly

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
