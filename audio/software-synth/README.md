# Software Synth - Keyboard Playable

A JavaScript/WASM software synthesizer that you can play like a real instrument using your computer keyboard. Features both anti-aliased synthesis and authentic SID chip emulation.

## Features

### 1. Keyboard Playable Synth
- Play melodies using your computer keyboard (A-K keys)
- Two synth engines: Anti-Aliased or SID Emulation
- Full ADSR envelope control for sound shaping
- 8-voice polyphony for rich chords
- Visual keyboard with active note highlighting

### 2. Dual Synth Engines

**Anti-Aliased Software Synth:**
- High-quality band-limited oscillators
- Multiple waveform types: sine, sawtooth, square, triangle
- 4x oversampling for reduced aliasing
- Band-limited waveform generation using harmonic series
- Clean, modern sound quality

**SID Chip Emulation:**
- Authentic C64 SID chip sound
- Triangle, sawtooth, pulse, and noise waveforms
- Classic 8-bit character with natural aliasing
- Uses the existing tinyrsid WASM backend

## Files

- `index.html` - Main interface with both SID player and anti-aliased synth
- `synth.js` - SID file player implementation
- `anti-aliased-synth.js` - Anti-aliased software synth implementation
- `backend_tinyrsid.js` - Tinyrsid WASM backend (Emscripten compiled)
- `tinyrsid.wasm` - WASM binary for SID emulation
- `test.html` - Simple backend test
- `test-synth.html` - Comprehensive synth testing

## Technical Details

### Anti-Aliasing Techniques

1. **Band-Limited Waveform Generation**:
   - Uses harmonic series with Nyquist frequency filtering
   - Generates waveforms by summing appropriate harmonics
   - Different normalization factors for each waveform type

2. **Oversampling**:
   - 4x oversampling to reduce aliasing artifacts
   - Simple averaging filter for downsampling
   - Linear interpolation for smooth waveform playback

3. **Waveform Characteristics**:
   - **Sawtooth**: 1/n harmonic amplitude, all harmonics
   - **Square**: 1/n harmonic amplitude, odd harmonics only
   - **Triangle**: 1/n² harmonic amplitude, odd harmonics with alternating signs
   - **Sine**: Pure sine wave (naturally band-limited)

### SID Player Implementation

- Uses Web Audio API ScriptProcessor for audio processing
- Loads SID files via Fetch API
- Interfaces with tinyrsid WASM backend for SID emulation
- Provides playback controls and visualization

## Usage

### Important: Use the Launch Script

**Do NOT open index.html directly from Finder.** Due to browser security restrictions, you must run the synth through a local web server:

```bash
cd software-synth
./launch-synth.sh
```

This will:
1. Start a local web server on port 8000
2. Open the synth in your default browser
3. Allow WASM files to load properly
4. Enable all Web Audio API features

### Using the Synth

1. **Select Synth Type**: Choose between "Anti-Aliased" or "SID Emulation"
2. **Choose Waveform**: Sawtooth, Square, Triangle, or Sine
3. **Adjust ADSR Envelope**: Shape your sound with attack, decay, sustain, release
4. **Click "Start Synth"**: Initializes the audio engine
5. **Play Notes**: Press A-K keys on your keyboard:
   ```
   A W S E D F T G Y H U J K
   C C# D D# E F F# G G# A A# B C
   ```

### Keyboard Controls

- **A-K keys**: Play musical notes (C4 to C5 octave)
- **Waveform selector**: Change oscillator type
- **ADSR sliders**: Adjust envelope parameters in real-time
- **Volume slider**: Control overall output volume
- **Start/Stop buttons**: Initialize or stop the audio engine

### Troubleshooting

**SID Emulation Fallback:**
The synth has a dual-mode SID emulation system:
- **Primary**: Uses WASM-based tinyrsid backend for authentic sound (requires web server)
- **Fallback**: Pure JavaScript SID emulation that works without WASM

If you see "SID emulator using JS fallback mode", the synth will still work but with a JavaScript-based SID emulation instead of the WASM version.

**If you have issues:**
- Use the launch script: `./launch-synth.sh`
- Check browser console for detailed error messages
- Wait for status messages to confirm backend loading
- Try refreshing the page if it gets stuck
- The JS fallback should always work, even without WASM

**Browser compatibility:**
- Chrome, Firefox, Safari, and Edge all support Web Audio API and WASM
- Mobile browsers may have limited functionality
- Use latest browser version for best results

## Browser Compatibility

- Requires Web Audio API support
- Requires WASM support for SID playback
- Tested on Chrome, Firefox, Safari, and Edge

## Performance Considerations

- The anti-aliased synth uses oversampling which increases CPU usage
- Band-limited waveform generation is computationally intensive during initialization
- SID emulation via WASM provides authentic sound but has higher CPU requirements

## Future Enhancements

- Add more waveform types (pulse, noise)
- Implement proper low-pass filters for better anti-aliasing
- Add envelope generators (ADSR)
- Implement polyphony
- Add effects (reverb, delay, distortion)
- MIDI support for external control