# SID Tracker

A modern web-based music tracker that emulates the legendary Commodore 64 SID (Sound Interface Device) chip. Create authentic chiptune music with the classic sound of the 6581/8580 SID chip using a familiar tracker interface.

![SID Tracker Interface](screenshot.png)

## 🎵 Features

### Core Functionality
- **3-voice polyphonic SID chip emulation** using [jsSID](https://github.com/hermitsoft/jsSID)
- **Pattern-based sequencing** with support for multiple patterns (A-Z)
- **Real-time instrument editor** with full SID parameter control
- **Live keyboard input** - Play notes in real-time using computer keyboard
- **Recording mode** - Record notes while playing or step-by-step
- **Song arrangement** - Organize patterns into complete songs
- **Project management** - Save/load projects and export/import JSON files

### SID Chip Features
- **Authentic waveforms**: Triangle, Sawtooth, Pulse, Noise
- **ADSR envelope control** with proper Attack, Decay, Sustain, Release
- **Pulse width modulation** (PWM) with LFO support
- **Frequency modulation** (FM) with LFO support
- **Hardware features**: Ring modulation, oscillator sync
- **Built-in arpeggios** with multiple chord patterns

### Advanced Features
- **LFO Engine**: Continuous PWM and FM modulation at 60Hz
- **Arpeggio Engine**: Real-time chord arpeggiation
- **Tempo control**: BPM slider and tap tempo
- **Pattern operations**: Copy, paste, clear patterns
- **Multiple pattern lengths**: 16, 32, or 64 steps
- **Sustain notes**: Control note length with `---` notation

## 🎹 Getting Started

### Quick Start
1. Open `index.html` in a modern web browser
2. Click "Enable Keyboard" to play notes with your computer keyboard
3. Click "Play" to hear the demo pattern
4. Open "Instrument Editor" to customize sounds
5. Click "Help" for detailed usage instructions

### Keyboard Layout
```
Lower octave (C-3 to B-3):
Z S X D C V G B H N J M
C C# D D# E F F# G G# A A# B

Higher octave (C-4 to B-4):  
Q 2 W 3 E R 5 T 6 Y 7 U
C C# D D# E F F# G G# A A# B

Even higher (C-5 to D#5):
I 9 O 0 P
C C# D D# E
```

## 🎛️ Interface Guide

### Transport Controls
- **Play**: Start pattern/song playback
- **Stop**: Stop playback
- **Record**: Enable recording mode for live note entry

### Pattern Management
- **Pattern Select**: Choose pattern A-Z to edit
- **Copy/Paste**: Copy patterns to clipboard
- **Clear**: Clear current pattern
- **Length**: Pattern length display

### Recording Mode
- **Voice Select**: Choose which voice (1-3) to record to
- **Instrument Select**: Choose instrument for recording
- **Auto-advance**: Automatically move to next step after recording

#### Recording Controls
- **Space**: Record rest (silence)
- **Enter**: Record sustain (continue previous note)
- **←→**: Switch between voices
- **↑↓**: Move between steps
- **Escape**: Exit recording mode

### Song Editor
- **Pattern Length**: Set global pattern length
- **Song Sequence**: Arrange patterns in playback order
- **Pattern Grid**: Visual overview of all patterns

## 🔧 Technical Details

### Architecture
The project is built using modern JavaScript modules:

- **`synth.js`**: Core SID chip emulation and sound generation
- **`sequencer.js`**: Pattern playback and timing engine
- **`instrument-editor.js`**: Real-time instrument parameter editing
- **`keyboard-input.js`**: Computer keyboard to musical note mapping
- **`record-mode.js`**: Live recording functionality
- **`lfo-engine.js`**: Low-frequency oscillation for modulation
- **`pattern-manager.js`**: Pattern storage and manipulation
- **`song-editor.js`**: Song arrangement and management

### Dependencies
- **[jsSID](https://github.com/jhohertz/jsSID)**: JavaScript SID chip emulation library (included as git submodule)
- **Web Audio API**: Modern browser audio processing
- **ES6 Modules**: Modern JavaScript module system

### Browser Compatibility
- **Chrome/Chromium**: Full support
- **Firefox**: Full support
- **Safari**: Full support (macOS/iOS)
- **Edge**: Full support

Requires a modern browser with Web Audio API support.

## 📝 Note Entry Format

### Supported Note Formats
- **`C-4`**, **`D#5`**, **`F-3`**: Musical notes (note + octave)
- **`R`**: Rest (silence)
- **`---`**: Sustain (continue previous note)
- **`(empty)`**: Silence

### Examples
```
C-4, ---, ---, E-4    → C-4 plays for 3 steps, then E-4
C-3, R, D-3, ---      → C-3, silence, D-3 for 2 steps
```

## 🎵 Creating Music

### Basic Workflow
1. **Choose an instrument** from the dropdown or create a custom one
2. **Enable keyboard input** and play notes to hear the sound
3. **Enter recording mode** and record notes step-by-step or in real-time
4. **Create patterns** with different melodies, bass lines, and percussion
5. **Arrange patterns** in the song editor for complete compositions
6. **Export your project** to save and share your music

### Tips for Great SID Music
- **Use the authentic waveforms**: Triangle for leads, pulse for bass, noise for drums
- **Experiment with ADSR**: Sharp attack for plucks, long release for pads
- **Try PWM and FM**: Add movement and character to your sounds
- **Use arpeggios**: Create rich chords with limited voices
- **Layer patterns**: Build complex arrangements from simple patterns

## 💾 File Format

Projects are saved as JSON files containing:
```json
{
  "songData": {
    "title": "My SID Song",
    "patterns": [...],
    "sequence": [0, 1, 2, 0]
  },
  "instruments": [
    {
      "name": "Lead",
      "waveform": 16,
      "ad": 15,
      "sr": 248,
      "pulseWidth": 2048,
      "pwmLFO": { "enabled": false, "freq": 0, "depth": 0 },
      "fmLFO": { "enabled": false, "freq": 0, "depth": 0 }
    }
  ],
  "tempo": { "bpm": 120 },
  "metadata": {
    "version": "2.0",
    "created": "2025-01-11"
  }
}
```

## 🚀 Development

### Local Development
```bash
# Clone the repository with submodules
git clone --recursive https://github.com/yourusername/sid-tracker.git
cd sid-tracker

# If already cloned without submodules:
git submodule update --init --recursive

# Serve locally (required for ES6 modules)
python -m http.server 8000
# or
npx serve .

# Open http://localhost:8000 in your browser
```

### Project Structure
```
sid-tracker/
├── index.html              # Main application
├── style.css              # UI styling
├── main.js                # Application initialization
├── synth.js               # SID chip emulation
├── sequencer.js           # Pattern playback
├── instrument-editor.js    # Instrument editing
├── keyboard-input.js      # Keyboard input handling
├── record-mode.js         # Recording functionality
├── lfo-engine.js          # LFO modulation
├── arpeggio-engine.js     # Arpeggio system
├── pattern-manager.js     # Pattern management
├── song-editor.js         # Song arrangement
├── tempo-control.js       # Tempo management
└── jsSID/                 # SID emulation library (git submodule)
```

## 🎯 Roadmap

### Planned Features
- [ ] **SID file export**: Export to authentic .sid format for SIDPlay
- [ ] **More effects**: Vibrato, pitch bend, portamento
- [ ] **Sample import**: Import custom waveforms
- [ ] **MIDI support**: Control with MIDI keyboards
- [ ] **Visualization**: Oscilloscope and spectrum analyzer
- [ ] **Advanced sequencing**: Pattern chains, loops, tempo automation

### Known Issues
- Pattern lengths are global (affects all patterns)
- Limited to 3 simultaneous voices (hardware limitation)
- No real-time effects during playback

## 🤝 Contributing

Contributions are welcome! Areas where help is especially appreciated:

- **SID authenticity**: Improving emulation accuracy
- **UI/UX improvements**: Better workflow and usability
- **Documentation**: Tutorials and examples
- **Browser compatibility**: Testing on different platforms
- **Performance optimization**: Reducing CPU usage

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[jsSID](https://github.com/jhohertz/jsSID)**: James Hohertz's excellent JavaScript SID chip emulation
- **Original SID chip**: Commodore 64's legendary sound chip and its creators
- **SID community**: Documentation, preservation efforts, and the HVSC collection
- **Tracker tradition**: Inspired by ProTracker, GoatTracker, and other classic trackers
- **Web Audio API**: Modern browser audio capabilities

## 📱 Screenshots

![Instrument Editor](screenshot-instruments.png)
*The instrument editor with full ADSR and LFO control*

![Recording Mode](screenshot-recording.png) 
*Recording mode with real-time step highlighting*

![Song Editor](screenshot-song.png)
*Song editor for arranging patterns into complete compositions*

---

**Happy tracking! 🎵**

Create authentic chiptunes with the legendary sound of the Commodore 64 SID chip!