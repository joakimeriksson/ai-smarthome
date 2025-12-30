# SID Tracker

A modern web-based music tracker that emulates the legendary Commodore 64 SID (Sound Interface Device) chip with **full GoatTracker2 compatibility**. Create authentic chiptune music with the classic sound of the 6581/8580 SID chip using a familiar tracker interface.

## Features

### GoatTracker2 Compatibility
- **Import GT2 .sng files** directly and edit them
- **208 single-voice patterns** (vs 16 in old system)
- **3 independent order lists** - each voice can play different patterns
- **GT2 table system** - Wavetable, Pulsetable, Filtertable, Speedtable
- **All 16 pattern commands** (0XY-FXY) implemented
- **Polyrhythmic capability** - voices can loop independently

### SID Chip Emulation
- **reSID-based emulation** for authentic filter sound
- **6581/8580 model selection** - switch between chip revisions
- **3-voice polyphonic** with proper voice routing
- **Authentic waveforms** - Triangle, Sawtooth, Pulse, Noise
- **Full filter support** - Low-pass, Band-pass, High-pass with resonance
- **Hardware features** - Ring modulation, oscillator sync

### Audio Engine
- **AudioWorklet-based** for sample-accurate timing and low latency
- **50Hz PAL timing** matching C64 frame rate
- **GT2 table execution** at authentic tick rates
- **Real-time playback highlighting** in track view

### User Interface
- **GT2 Track View** - Shows 3 voices side-by-side with current patterns
- **GT2 Order Editor** - Independent order lists per voice
- **Instrument Editor** - GT2-compatible parameters with table pointers
- **Live keyboard input** - Play notes using computer keyboard
- **Transport controls** - Play, Stop, Pause with song position navigation
- **10x slow motion debug** - Hear table switches clearly for debugging

## Getting Started

### Quick Start
1. Open `index.html` in a modern web browser
2. Click anywhere to initialize audio (browser requirement)
3. Click "Play" to hear the demo pattern
4. Import a GoatTracker2 .sng file to load existing songs
5. Use the GT2 Pattern Editor to edit patterns

### Keyboard Layout
```
Lower octave (C-3 to B-3):
Z S X D C V G B H N J M

Higher octave (C-4 to B-4):
Q 2 W 3 E R 5 T 6 Y 7 U

Even higher (C-5+):
I 9 O 0 P
```

## GoatTracker2 Table System

SID Tracker uses authentic GT2 table-based modulation instead of simple LFOs:

### Wavetable (WTBL)
- Frame-by-frame waveform and arpeggio control
- Relative notes (00-5F up, 60-7F down)
- Waveform changes with gate control

### Pulsetable (PTBL)
- Precise pulse width modulation curves
- Time-based modulation steps
- More control than simple LFO

### Filtertable (FTBL)
- Complex filter sweeps and envelopes
- Filter type, resonance, and routing control
- Multi-stage filter modulation

### Speedtable (STBL)
- Vibrato speed and depth control
- Portamento speed values
- Funktempo (swing) settings

## Pattern Commands

All 16 GoatTracker2 commands are implemented:

| Cmd | Name | Description |
|-----|------|-------------|
| 0XY | Do Nothing | Clear realtime effects |
| 1XY | Portamento Up | Smooth pitch slide up |
| 2XY | Portamento Down | Smooth pitch slide down |
| 3XY | Toneportamento | Slide to target note |
| 4XY | Vibrato | Pitch modulation via speedtable |
| 5XY | Attack/Decay | Set ADSR attack and decay |
| 6XY | Sustain/Release | Set ADSR sustain and release |
| 7XY | Waveform | Change waveform |
| 8XY | Wavetable Ptr | Set wavetable position |
| 9XY | Pulsetable Ptr | Set pulsetable position |
| AXY | Filtertable Ptr | Set filtertable position |
| BXY | Filter Control | Filter type, resonance, routing |
| CXY | Filter Cutoff | Set filter frequency |
| DXY | Master Volume | Control overall volume |
| EXY | Funktempo | Alternating tempo (swing) |
| FXY | Set Tempo | Change playback speed |

## Technical Architecture

### Core Modules
- **`synth.js`** - SID register control and audio engine interface
- **`worklet/sid-processor.body.js`** - AudioWorklet with GT2 sequencer
- **`pattern-manager-gt2.js`** - GT2 per-voice pattern system
- **`sequencer-gt2.js`** - Per-voice playback with order lists
- **`table-manager-gt2.js`** - GT2 table storage and access
- **`gt2-importer.js`** - GoatTracker2 .sng file parser

### UI Modules
- **`gt2-pattern-editor.js`** - Track view with playback highlighting
- **`gt2-order-editor.js`** - Per-voice order list editor
- **`instrument-editor.js`** - GT2-compatible instrument editor
- **`keyboard-input.js`** - Computer keyboard to note mapping

### Build
The AudioWorklet is bundled from source files:
```bash
./tools/build-worklet.sh
```
This creates `sid-processor.bundle.js` from jsSID and the processor code.

## Browser Compatibility

Requires a modern browser with:
- **Web Audio API** with AudioWorklet support
- **ES6 Modules**

Tested on Chrome, Firefox, Safari, and Edge.

## Development

### Local Development
```bash
# Serve locally (required for ES6 modules)
python -m http.server 8000
# or
npx serve .

# Open http://localhost:8000
```

### Rebuild AudioWorklet
After modifying `worklet/sid-processor.body.js`:
```bash
./tools/build-worklet.sh
```
Then hard-reload the browser (Shift+Reload).

## Acknowledgments

- **[jsSID](https://github.com/jhohertz/jsSID)** - JavaScript SID chip emulation
- **[reSID](http://www.zimmers.net/anonftp/pub/cbm/crossplatform/emulators/resid/)** - Accurate SID emulation
- **[GoatTracker2](https://sourceforge.net/projects/goattracker2/)** - Reference implementation for GT2 compatibility
- **Commodore 64** - The legendary machine and its SID chip
- **HVSC** - High Voltage SID Collection

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Happy tracking!**

Create authentic chiptunes with the legendary sound of the Commodore 64 SID chip!
