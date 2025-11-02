# SID Tracker - Complete Music Production System

## Overview
This is a web-based SID (Sound Interface Device) tracker that emulates the Commodore 64's sound chip capabilities with full **GoatTracker2 compatibility**. The system provides a complete music production environment with authentic SID sound synthesis, multi-pattern song arrangement, real-time recording, comprehensive export capabilities, and GoatTracker2 table-based automation.

## GoatTracker2 Architecture Migration

**SID Tracker has migrated to GoatTracker2's per-voice pattern architecture for complete compatibility.**

### Key Architecture Differences

#### Old System (Unified Patterns)
- **16 patterns** (A-P), each containing all 3 voices together
- Single song sequence controlling all voices simultaneously
- Pattern format: 3-voice interleaved data
- All voices always play the same pattern at the same time

#### New System (GT2 Per-Voice Patterns)
- **208 single-voice patterns** (0-207)
- 3 independent order lists (one per voice)
- Pattern format: 4 bytes per row (note, instrument, command, cmdData)
- Each voice can play different patterns and loop independently
- **Polyrhythmic capability**: Voice 0 can loop pattern A while Voice 1 plays pattern B

### Migration Strategy

1. **GT2 Native Core** (`pattern-manager-gt2.js`, `sequencer-gt2.js`)
   - Complete rewrite using GT2 architecture
   - 100% compatible with GoatTracker2 .sng files
   - Supports all GT2 features (LOOPSONG, ENDSONG, per-voice patterns)

2. **Compatibility Layer** (`pattern-manager-compat.js`)
   - Provides unified API for remaining compatibility code
   - Maps old pattern slots to GT2 patterns (e.g., Pattern A → patterns 0,1,2)
   - Used by record-mode.js and other legacy systems

3. **GT2 Editing UI** (`gt2-pattern-editor.js`, `gt2-order-editor.js`) - **ACTIVE**
   - GoatTracker2-style editors replace old tracker UI
   - Pattern editor shows 3 voices side-by-side
   - Order editor shows 3 independent columns
   - Old unified tracker UI has been removed

### Benefits of GT2 Architecture

- **Import GoatTracker2 songs directly** - Load .sng files and edit them
- **Polyrhythmic patterns** - Each voice can have different loop points
- **Independent voice control** - Voice 0 can end while Voice 1 continues
- **More patterns** - 208 patterns vs 16 in old system
- **Authentic GT2 workflow** - Familiar to GoatTracker2 users

### GT2 Playback State Synchronization

The system uses a dual-track approach to handle playback state with precise position tracking:

1. **AudioWorklet Playback**
   - Notes are played by the AudioWorklet for sample-accurate timing
   - Worklet maintains per-voice position tracking:
     - `this.orderPositions[voice]` - Current position in order list
     - `this.patternRows[voice]` - Current row in pattern
     - `this.patternIndex` - Pattern being played from order list
   - Worklet sends detailed 'step' messages to main thread with per-voice positions

2. **Main Thread State Updates via Worklet Messages**
   - Worklet captures positions BEFORE advancing rows
   - Sends `voicePositions` array with current playing positions for each voice
   - Message format: `{ type: 'step', payload: { step, voicePositions: [{orderPos, patternIndex, patternRow}, ...] }}`
   - synth.js receives messages and updates `window.voiceState` directly
   - Each voice state updated with: `orderPosition`, `patternIndex`, `patternRow`, `isPlaying`
   - **Critical**: Position sent is the row BEING PLAYED, not the next row

3. **Visual Highlighting in Track View**
   - GT2 Pattern Editor runs 50ms polling interval
   - Reads `voiceState[voice].patternRow` for each voice
   - Highlights currently playing row with CSS class `gt2-playing-row`
   - **Bright green highlighting** (#00aa00) with glow effect for maximum visibility
   - **Auto-updates track view** when playing patterns change during playback
   - Fixed headers stay visible while scrolling using separate header container
   - Row numbers (displayed in decimal) also highlighted on left side with green glow
   - Pattern indices displayed in decimal (00-207) matching GoatTracker convention
   - Song position display shows order positions for all 3 voices

**Key Files:**
- `worklet/sid-processor.body.js` - Captures positions before advancing, sends to main thread
- `synth.js` - Receives 'step' messages and updates `window.voiceState`
- `sequencer-gt2.js` - Exports and exposes `voiceState` array on window
- `gt2-pattern-editor.js` - Polls voiceState and applies visual highlighting with fixed headers

### GT2-Only Instrument Architecture

**SID Tracker uses exclusively GoatTracker2-compatible instruments with table-based modulation.**

#### Instrument Structure
Each instrument contains only authentic GT2 parameters:
```javascript
{
    name: "Instrument Name",
    waveform: 0x10,        // Triangle (0x10), Sawtooth (0x20), Pulse (0x40), Noise (0x80)
    ad: 0x0F,              // Attack/Decay (4 bits each, combined)
    sr: 0xF0,              // Sustain/Release (4 bits each, combined)
    pulseWidth: 0x0800,    // 12-bit pulse width (0x000-0xFFF)
    sync: false,           // Oscillator sync enable
    ringMod: false,        // Ring modulation enable
    tables: {              // GT2 table pointers (-1 = no table)
        wave: -1,          // Wavetable pointer (0-255)
        pulse: -1,         // Pulsetable pointer (0-255)
        filter: -1,        // Filtertable pointer (0-255)
        speed: -1          // Speedtable pointer (0-255)
    }
}
```

#### Removed Non-GT2 Features
The following features have been **removed** for GT2 purity:
- ❌ **PWM LFO** - Use PTBL (Pulsetable) instead
- ❌ **FM LFO** - Use command 4XY + STBL (Speedtable) instead
- ❌ **Arpeggio Engine** - Use WTBL (Wavetable) with relative notes instead
- ❌ **Per-instrument Filter** - Use FTBL (Filtertable) + commands BXY/CXY instead
- ❌ **Filter LFO** - Use FTBL (Filtertable) for filter modulation instead

#### How to Achieve Effects in GT2 Mode
- **Pulse Width Modulation**: Create a pulsetable with custom PWM curves
- **Vibrato**: Use pattern command 4XY with speedtable defining speed/depth
- **Arpeggios**: Create a wavetable with relative note commands (00-5F = up, 60-7F = down)
- **Filter Sweeps**: Create a filtertable with modulation steps + use commands BXY/CXY
- **Dynamic ADSR**: Use pattern commands 5XY/6XY to change ADSR during playback

## System Architecture

### Core Audio Engine

1. **synth.js** - Core synthesis engine
   - SID chip emulation using jsSID library  
   - Instrument definitions with comprehensive synthesis parameters
   - Note playback with frequency conversion
   - **Filter implementation** for authentic SID filtering
   - Voice management and register control
   - AudioWorklet-only architecture (ScriptProcessor removed)

2. **pattern-commands.js** - GoatTracker2 pattern command engine
   - All 16 GT2 commands (0XY-FXY) implemented
   - Tick-based execution at 50Hz for smooth portamento/vibrato
   - One-shot commands (5XY-FXY) for ADSR, waveform, filter, tempo
   - Realtime commands (1XY-4XY) for portamento and vibrato effects
   - Speedtable integration for precise modulation control

### GoatTracker2 Table System (GT2)

4. **table-manager-gt2.js** - GoatTracker2-compatible table system
   - Four table types: WTBL (waveform/arpeggio), PTBL (pulse), FTBL (filter), STBL (speed)
   - Dual-byte format (left=command, right=parameter)
   - Table execution with delays, jumps, and loops
   - Waveform values stored WITH gate bit (0x21=sawtooth+gate)
   - Tables are part of instrument definitions (ptr[WTBL/PTBL/FTBL/STBL])

5. **gt2-frame-engine.js** - Frame-based table execution engine
   - Runs at 50Hz (PAL) or 60Hz (NTSC) matching C64 timing
   - Per-voice table playback states
   - Executes wavetable (waveform+note), pulsetable (PWM), filtertable, speedtable
   - Writes SID registers every frame like GoatTracker (sidreg[0x4] = wave & gate)
   - Coordinates with AudioWorklet (disables worklet LFO when tables active)
   - **Worklet Integration**: Triggered via `triggerTables` messages from worklet
   - Exposed globally as `window.gt2FrameEngine` for worklet communication

#### GT2 Table Integration with AudioWorklet

When a note is played in the AudioWorklet, the system checks if the instrument has active tables and triggers the frame engine:

1. **Worklet Detection** (worklet/sid-processor.body.js:359-370)
   ```javascript
   if (inst.tables && (inst.tables.wave > 0 || inst.tables.pulse > 0 || ...)) {
     this.port.postMessage({
       type: 'triggerTables',
       voice: voice,
       baseNote: midiNote - 12,  // GT2 note number
       instrument: inst
     });
   }
   ```

2. **Main Thread Handler** (synth.js:297-312)
   - Receives `triggerTables` message from worklet
   - Calls `window.gt2FrameEngine.triggerNoteTables(voice, baseNote, instrument)`
   - Frame engine starts executing tables at 50Hz

3. **Table Execution**
   - Wave table changes waveform dynamically (e.g., triangle → sawtooth for bass)
   - Pulse table modulates pulse width
   - Filter table modifies filter cutoff
   - Speed table controls execution timing

This integration allows imported GoatTracker2 songs to sound authentic by executing their wave/pulse/filter tables exactly as GT2 does.

6. **gt2-importer.js** - GoatTracker2 .sng file importer
   - **Complete song import** - patterns, orders, instruments, and tables
   - Parses GTS3/GTS4/GTS5 binary format
   - Pattern format: 4 bytes per row (single voice, not interleaved)
   - Order lists: 3 independent sequences with LOOP/END commands
   - Converts GT2 instruments to SID Tracker format
   - Loads all 4 table types with full data
   - Preserves instrument names, ADSR, waveforms, and table pointers
   - **1:1 pattern mapping** - GT2 pattern N → SID Tracker pattern N

### Pattern and Song Management (GT2 Architecture)

**IMPORTANT: SID Tracker now uses GoatTracker2's per-voice pattern architecture for 100% compatibility.**

7. **pattern-manager-gt2.js** - GoatTracker2-native pattern system
   - **208 single-voice patterns** (vs old 16 multi-voice patterns)
   - Each pattern contains ONE voice of data
   - Pattern format: 4 bytes per row (note, instrument, command, cmdData)
   - Pattern lengths: 1-128 rows (configurable per pattern)
   - GT2 note format: 1-95 = notes (C-0 to B-7), 254 = REST, 255 = KEYOFF, 0 = EMPTY
   - Special commands: LOOPSONG (0xFE), ENDSONG (0xFF), REPEAT, TRANSPOSE

8. **pattern-manager-compat.js** - Compatibility layer for legacy UI
   - Provides unified pattern API for existing tracker UI
   - Converts between GT2 patterns and old unified view
   - Allows gradual migration from old system
   - Maps pattern slots: Pattern A → GT2 patterns 0,1,2 (one per voice)

9. **sequencer-gt2.js** - Per-voice pattern playback engine
   - 3 independent order lists (one per voice)
   - Each voice can play different patterns
   - Polyrhythmic capability: each voice can loop independently
   - Per-voice state tracking (orderPosition, patternIndex, patternRow, transpose)
   - Song commands: LOOPSONG (jump to position), ENDSONG (stop voice)
   - Pattern mode vs Song mode playback

10. **gt2-pattern-editor.js** - GoatTracker2-style Track View
    - **Track View**: Shows current song position with 3 different patterns (one per voice)
    - Each voice displays its own pattern from the order list
    - **Fixed headers**: Voice headers and row number labels stay visible while scrolling
    - Real-time playback highlighting (bright blue for currently playing rows)
    - Song position display showing play state and order positions for all 3 voices
    - Color-coded fields (note=yellow, instrument=cyan, command=magenta, cmdData=orange)
    - **Decimal display**: Pattern numbers (00-207) and row numbers (00-127) in decimal, matching GoatTracker
    - Mute buttons per voice for isolating individual voices during playback
    - Click to edit cells with keyboard navigation (arrow keys, delete, enter)
    - Click rows to select for editing (not yet implemented)
    - Copy/paste functionality

11. **gt2-order-editor.js** - GoatTracker2-style order list editor
    - Shows 3 independent order lists in columns
    - Pattern numbers, LOOP commands, END markers
    - Voice-independent editing
    - Add/insert/delete functionality

12. **song-editor.js** - Song arrangement interface (Legacy)
    - Visual pattern sequencing
    - Song metadata (title, author)
    - Loop point configuration
    - Pattern preview and management

### User Interface and Input

7. **instrument-editor.js** - GoatTracker2-compatible instrument editor
   - GT2-only parameters: waveform, ADSR, pulse width, sync, ring modulation
   - GT2 table pointer assignment (WTBL, PTBL, FTBL, STBL)
   - Real-time parameter adjustment
   - Instrument testing with GT2 tables
   - **No LFO/arpeggio engines** - use GT2 tables and commands instead

8. **keyboard-input.js** - Piano-style keyboard input
   - Two-octave piano mapping (C-3 to D#5)
   - Real-time note triggering
   - Instrument selection integration

9. **record-mode.js** - Real-time recording system
   - Live note recording from keyboard
   - Voice and step navigation
   - Auto-advance functionality
   - Recording shortcuts (Space=Rest, Enter=Sustain)

10. **main.js** - Application controller
    - UI initialization and event handling
    - Transport controls (Play/Stop/Record)
    - Project management (Save/Load/Export/Import)
    - Modal window management

### Tempo and Timing

11. **tempo-control.js** - Advanced timing system
    - BPM control (60-200 BPM)
    - Tap tempo functionality
    - Swing timing support
    - Per-step duration calculation

### Export and Testing

12. **sid-exporter.js** - SID file generation
    - Export songs as playable .SID files
    - C64-compatible format
    - Metadata embedding

13. **sid-tester.js** - SID playback testing
    - Test generated SID files
    - Playback validation

## Audio Engine Architecture

### AudioWorklet Engine (Only)
- AudioWorklet-only architecture for sample‑accurate timing and low jitter
- Bundled worklet file: `sid-processor.bundle.js` (TinySID + processor)
- No fallback engines - requires modern browser with AudioWorklet support
- **GT2 table integration** via message passing between worklet and GT2 Frame Engine

#### Rebuild the Worklet Bundle
Use the local bundler (no network, no npm required):
```
chmod +x tools/build-worklet.sh
tools/build-worklet.sh
```
This regenerates `sid-processor.bundle.js` from:
- `jsSID/js/jssid.core.js`
- `jsSID/js/jssid.tinysid.js`
- `worklet/sid-processor.body.js`

Hard‑reload the browser (Shift+Reload) to load the new worklet.

### Recent Architecture Changes
- **Removed ScriptProcessor fallback** for simplified codebase
- **Removed LFO/arpeggio engines** - replaced with GoatTracker2 table system
- **Fixed critical filter volume bug** that caused silent instruments
- **Streamlined initialization** with single AudioWorklet path
- **Fixed playback position NaN bug** in worklet currentStep calculation

## Play/Stop Semantics

### Start
- Triggers the first step immediately (no initial delay) in AudioWorklet
- Sends GT2 table trigger messages to main thread when instruments have tables
- Sets up sample-accurate sequencer timing

### Stop
- Sends a soft stop and a hard panic to the worklet:
  - Clears scheduled steps and pending gate events
  - Clears Gate+Frequency on all voices
  - Temporarily mutes master volume (D418 low nibble)
- Stops all GT2 table execution in main thread
- Worklet-only architecture ensures clean stop behavior

## Multi-Pattern Workflow

### Pattern Management System
The tracker supports 16 individual patterns (A through P), each with configurable lengths:

#### Pattern Structure
- **Pattern Length**: 16, 32, or 64 steps per pattern
- **Voice Count**: 3 voices per pattern (matching SID chip capabilities)
- **Data Storage**: Each step contains note and instrument data
- **Pattern Operations**: Copy, paste, clear, and duplicate patterns

#### Song Arrangement
Songs are created by arranging patterns in sequence:
- **Song Sequence**: Ordered list of pattern indices
- **Loop Points**: Define start and end points for song looping
- **Song Metadata**: Title, author, creation date
- **Real-time Switching**: Change patterns during playback (Song mode)

### Recording Workflow

#### Live Recording System
Real-time note input with comprehensive recording features:

**Recording Modes:**
- **Pattern Mode**: Record into current pattern only
- **Song Mode**: Record across pattern sequence
- **Auto-advance**: Automatically move to next step after recording

**Recording Controls:**
- **Voice Selection**: Choose which voice to record (1-3)
- **Instrument Selection**: Set instrument for recorded notes
- **Step Navigation**: Move between steps using arrow keys
- **Special Commands**: Space (Rest), Enter (Sustain), Escape (Stop)

#### Keyboard Input System
Piano-style keyboard mapping for musical input:

**Keyboard Layout:**
```
Lower Octave (C-3 to B-3):  Z S X D C V G B H N J M
Higher Octave (C-4 to B-4): Q 2 W 3 E R 5 T 6 Y 7 U  
Highest Notes (C-5+):       I 9 O 0 P
```

**Input Behavior:**
- **Focus-aware**: Works when not in text input fields
- **Real-time**: Immediate audio feedback
- **Recording Integration**: Notes recorded when in record mode

## GoatTracker2 Pattern Commands and Table-Based Modulation

**SID Tracker uses authentic GoatTracker2 methods for all modulation and effects.**

### Pattern Commands (All 16 Implemented)

#### Realtime Commands (Tick-Based Execution at 50Hz)
- **1XY**: Portamento Up - Smooth upward pitch slide
- **2XY**: Portamento Down - Smooth downward pitch slide
- **3XY**: Toneportamento - Slide to target note frequency
- **4XY**: Vibrato - Pitch modulation using speedtable

#### One-Shot Commands (Execute Once Per Row)
- **5XY**: Set Attack/Decay - ADSR envelope control
- **6XY**: Set Sustain/Release - ADSR envelope control
- **7XY**: Set Waveform - Change waveform (triangle, sawtooth, pulse, noise)
- **8XY**: Wave Table Pointer - Trigger wavetable execution
- **9XY**: Pulse Table Pointer - Trigger pulsetable execution
- **AXY**: Filter Table Pointer - Trigger filtertable execution
- **BXY**: Filter Control - Set filter type, resonance, channel routing
- **CXY**: Filter Cutoff - Set filter frequency (11-bit value)
- **DXY**: Master Volume - Control overall volume
- **EXY**: Funktempo - Alternating tempo per row
- **FXY**: Set Tempo - Change playback speed

### Achieving Effects with GT2 Tables

**Pulse Width Modulation** - Use **PTBL (Pulsetable)**:
- Create custom PWM curves with frame-by-frame control
- Time-based modulation steps for smooth PWM
- More precise than simple LFO

**Vibrato/FM** - Use **Command 4XY + STBL (Speedtable)**:
- Speedtable defines vibrato depth and speed
- Can create complex modulation patterns
- Note-independent calculation available

**Arpeggios** - Use **WTBL (Wavetable) with relative notes**:
- Frame-by-frame note changes
- Support for complex arpeggio patterns
- Can combine waveform changes with note arpeggios

**Filter Sweeps** - Use **FTBL (Filtertable) + Commands BXY/CXY**:
- Multi-stage filter envelopes
- Dynamic filter type changes
- Resonance and channel routing control

## SID Filter Architecture

The SID chip contains a 12dB/octave multimode analog filter that was a defining characteristic of the C64's sound. This implementation provides full access to the filter's capabilities:

### Filter Registers
- **0x15 (21)**: Filter frequency low 3 bits
- **0x16 (22)**: Filter frequency high 8 bits  
- **0x17 (23)**: Resonance (4-7) + Voice routing (0-2)
- **0x18 (24)**: Filter type (4-6) + Voice 3 off (7) + Volume (0-3)

### Filter Types
- **Low-pass (0x10)**: Allows frequencies below cutoff
- **Band-pass (0x20)**: Allows frequencies around cutoff  
- **High-pass (0x40)**: Allows frequencies above cutoff
- **Combinations**: Multiple filter types can be combined

### Implementation Details

#### Instrument Filter Parameters
Each instrument now includes filter settings:
```javascript
filter: {
    enabled: boolean,      // Enable/disable filter for this voice
    frequency: 0x000-0x7FF, // 11-bit cutoff frequency
    resonance: 0x00-0xF0,   // Resonance amount (4 bits << 4) 
    type: 0x10|0x20|0x40    // Filter type flags
}
```

#### Filter Application Process
1. **Voice Routing**: Each voice can be individually routed through the filter
2. **Frequency Setting**: 11-bit frequency value split across two registers
3. **Resonance Control**: 4-bit resonance value emphasizes cutoff frequency
4. **Type Selection**: Low-pass, band-pass, high-pass or combinations

#### Code Integration Points

**synth.js - applyFilter() function:**
```javascript
export function applyFilter(voice, filterSettings) {
    if (filterSettings.enabled) {
        // Set filter frequency (11-bit split across registers)
        sidPlayer.synth.poke(21, filterSettings.frequency & 0x07);
        sidPlayer.synth.poke(22, (filterSettings.frequency >> 3) & 0xFF);
        
        // Set resonance and voice routing
        const voiceRouting = 1 << voice;
        const resonanceAndRouting = (filterSettings.resonance & 0xF0) | voiceRouting;
        sidPlayer.synth.poke(23, resonanceAndRouting);
        
        // Set filter type and preserve volume
        const currentVolume = sidPlayer.synth.peek(24) & 0x0F;
        const filterTypeAndVolume = (filterSettings.type & 0x70) | currentVolume;
        sidPlayer.synth.poke(24, filterTypeAndVolume);
    }
}
```

**playNote() function refactored:**
- **NEW**: `playNoteWithInstrument(voice, frequencyHz, duration, instrumentIdOrObject)` - Clean API taking instrument ID or object
- **Legacy**: `playNote(voice, frequencyHz, duration, waveform, ...)` - Maintained for backward compatibility
- All core systems now use the simplified `playNoteWithInstrument()` function
- Automatically applies all instrument parameters including filter, ADSR, waveform, etc.

**Instrument Definitions Enhanced:**
- All instruments now include filter parameters
- Some presets showcase filter capabilities:
  - Bass: Low-pass filter with moderate resonance
  - Pad: Low-pass filter with gentle resonance  
  - Percussion: Band-pass filter with high resonance
  - Sync Lead: Band-pass filter showcasing sync + filter
  - Ring Mod: High+Band-pass combination filter

## User Interface Integration

### Instrument Editor Filter Controls
New filter section added to instrument editor modal:
- **Enable checkbox**: Toggle filter on/off per instrument
- **Cutoff slider**: 0-2047 range for frequency control
- **Resonance slider**: 0-240 range (16-step increments) 
- **Type dropdown**: All filter type combinations available

### Real-time Updates
- Parameter changes update instrument definition immediately
- Test button plays note with current filter settings
- Changes apply to all instances of instrument in patterns

## Technical Considerations

### Filter Frequency Calculation
The SID filter frequency is not linear - it follows an exponential curve. The current implementation uses raw register values, providing full control but requiring user experimentation to find desired frequencies.

### Voice Routing Limitations  
The SID filter is shared between voices - while each voice can be routed through the filter independently, they all share the same filter parameters. This is authentic to the original hardware.

### Filter Bypass
When filter is disabled for a voice, it bypasses the filter entirely and outputs directly. This preserves the dry signal character important for certain sounds.

## Project Management System

### Export and Import Capabilities

#### JSON Project Files
Complete project export including:
- **All Patterns**: Full pattern data for all 16 patterns
- **Song Sequence**: Pattern arrangement and loop points
- **Instruments**: All custom instruments with parameters
- **Tempo Settings**: BPM, swing, and timing configuration
- **Metadata**: Project title, author, creation date

#### SID File Export
Generate authentic C64-compatible SID files:
- **Format**: Standard .SID format
- **Compatibility**: Playable on C64 emulators and hardware
- **Metadata**: Song title and author embedded
- **Testing**: Built-in SID player for validation

#### Legacy Support
- **Backwards Compatibility**: Load older project formats
- **Format Migration**: Automatic upgrade to current format
- **Browser Storage**: Local storage for quick save/load

### User Interface System

#### Modal-Based Editors
Professional editing interfaces for detailed parameter control:

**Instrument Editor Features (GT2-Only):**
- **Visual Parameter Control**: Sliders and dropdowns for GT2 parameters
- **Real-time Testing**: Instant audio feedback with GT2 table execution
- **Preset Management**: Create, duplicate, and delete instruments
- **Parameter Categories**: Organized sections for ADSR, Waveform, Pulse Width, SID Features, GT2 Tables
- **Live Updates**: Changes apply immediately to playing patterns
- **GT2 Table Pointers**: Assign instruments to wavetable, pulsetable, filtertable, speedtable positions

**Song Editor Features:**
- **Visual Sequencing**: Drag-and-drop pattern arrangement
- **Pattern Preview**: Visual representation of pattern contents
- **Metadata Editing**: Song title and information
- **Loop Configuration**: Visual loop point setting

#### Transport and Recording Interface
Professional DAW-style controls:
- **Transport Buttons**: Play, Stop, Record with visual feedback
- **Recording Status**: Real-time display of recording position
- **Pattern Display**: Current pattern and position indication
- **Tempo Control**: BPM slider with tap tempo functionality

## Usage Examples and Workflows

### Creating a Complete Song with GT2 Tables

#### Step 1: Pattern Creation (GT2 Mode)
1. **Create Bass Pattern**:
   - Voice 1: Use Bass instrument with wavetable for waveform morphing
   - Program root notes on beat 1 and 3
   - Use command 3XY for portamento slides between notes
   - Add FTBL (filtertable) pointer for filter sweeps

2. **Create Melody Pattern**:
   - Voice 0: Use Lead instrument with vibrato (command 4XY + speedtable)
   - Program melodic sequence with rests for breathing
   - Use WTBL (wavetable) for dynamic waveform changes
   - Add PTBL (pulsetable) for pulse width modulation

3. **Create Percussion Pattern**:
   - Voice 2: Use Perc instrument with noise waveform
   - Program kick on beats 1,3 and snare on beats 2,4
   - Use command BXY to set filter type per step
   - Add hi-hat patterns with ADSR commands (5XY/6XY)

#### Step 2: Song Arrangement
1. Open GT2 Order Editor
2. Arrange patterns independently per voice
3. Set loop points using LOOPSONG commands
4. Add ENDSONG markers where needed

#### Step 3: Sound Design (GT2 Table-Based)
1. **Filter Sweeps**: Create FTBL with modulation steps, use command AXY to trigger
2. **PWM Effects**: Create PTBL with custom modulation curves, assign to instrument
3. **Arpeggios**: Create WTBL with relative note commands (00-5F)
4. **Vibrato**: Use command 4XY with speedtable defining speed/depth

#### Step 4: Final Production
1. Adjust tempo with command FXY or global BPM
2. Test playback in Song mode with per-voice muting
3. Import/export GoatTracker2 .sng files
4. Save project as JSON for future editing

### Advanced GT2 Table Techniques

#### Creating Dynamic Bass with Wavetable
1. Select Bass instrument in editor
2. Create wavetable with waveform progression (triangle → sawtooth)
3. Set instrument wave pointer to wavetable position
4. Add relative note commands for sub-bass octaves
5. Use delays (01-0F) for timing control
6. Test and adjust waveform transitions

#### Sweeping Lead with Filtertable
1. Use sawtooth or pulse waveform
2. Create filtertable with cutoff modulation steps (01-7F)
3. Set filter parameters command (80-F0) for resonance
4. Assign filtertable pointer to instrument
5. Use command AXY in pattern to trigger table at specific rows
6. Combine with vibrato (4XY) for expressive leads

#### Pulse Modulation with Pulsetable
1. Create instrument with pulse waveform (0x40)
2. Design pulsetable with time-based modulation steps
3. Set initial pulse width in instrument (0x0800 = 50%)
4. Pulsetable will modulate around this center point
5. Use jump commands (FF) to loop pulse patterns
6. Assign pulsetable pointer to instrument

## Technical Implementation Notes

### Audio Processing Chain (GT2 Mode)
1. **Note Input** → GT2 Pattern Manager stores note data per voice
2. **Playback** → AudioWorklet reads all patterns and order lists
3. **Per-Voice Sequencing** → Worklet maintains independent positions for each voice
4. **Note Trigger** → Worklet sets basic instrument parameters (waveform, ADSR, frequency)
5. **Table Detection** → If instrument has tables, worklet sends `triggerTables` message
6. **Frame Engine** → Main thread GT2 frame engine executes tables at 50Hz
7. **Dynamic Modulation** → Tables modify waveform, pulse width, filter in real-time
8. **Position Sync** → Worklet sends per-voice positions to main thread for UI highlighting
9. **Output** → Web Audio API renders final audio stream

**Key Difference from Old System**: GT2 mode uses table-based automation instead of LFO engines, matching GoatTracker2's authentic behavior.

### Performance Considerations
- **50Hz Frame Engine**: GT2 tables update at authentic PAL timing (50Hz)
- **Minimal Register Writes**: Only update SID registers when values change
- **Pattern Caching**: Pattern data cached for fast playback switching
- **Real-time Rendering**: Audio generated in real-time without pre-computation
- **Message Passing**: Efficient worklet-to-main-thread communication for table triggers

### Browser Compatibility
- **Web Audio API**: Required for audio output
- **ES6 Modules**: Modern JavaScript module system
- **Local Storage**: For project save/load functionality
- **File API**: For import/export of project files

## Keyboard Shortcuts and Controls

### Global Shortcuts
- **Spacebar**: Play/Stop playback (when not in input field)
- **Ctrl+S**: Save project to browser storage
- **Ctrl+O**: Load project from browser storage
- **Ctrl+E**: Export project as JSON
- **F1**: Show help modal

### Recording Mode Shortcuts
- **Enter Recording Mode**: Click Record button or press R
- **Space**: Record Rest note
- **Enter**: Record Sustain (---)
- **Arrow Keys**: Navigate voices (←→) and steps (↑↓)
- **Escape**: Exit recording mode
- **Number Keys 1-9**: Select instrument (when recording)

### Pattern Management
- **Ctrl+C**: Copy current pattern
- **Ctrl+V**: Paste pattern to current slot
- **Ctrl+X**: Clear current pattern
- **A-P Keys**: Select pattern (when not in input field)

## Advanced Configuration

### Tempo and Timing
- **BPM Range**: 60-200 beats per minute
- **Step Resolution**: 16th notes (4 steps = 1 beat)
- **Swing**: Subtle timing variations for human feel
- **Pattern Lengths**: 16 (1 bar), 32 (2 bars), 64 (4 bars) steps

### Instrument Parameters
Each instrument contains comprehensive synthesis parameters:

#### Waveform Selection
- **Triangle** (0x10): Smooth, sine-like waveform
- **Sawtooth** (0x20): Bright, harmonically rich
- **Pulse** (0x40): Square/rectangular waves, variable width
- **Noise** (0x80): White noise for percussion

#### ADSR Envelope (4-bit values, 0-15)
- **Attack**: Time to reach maximum volume
- **Decay**: Time to fall to sustain level
- **Sustain**: Held volume level during note
- **Release**: Time to fade to silence after note off

#### Advanced Features
- **Sync**: Oscillator synchronization for complex timbres
- **Ring Modulation**: Amplitude modulation between voices
- **Pulse Width**: 12-bit value controlling pulse wave shape

### Filter System Details
The SID filter implementation matches original hardware behavior:

#### Register Mapping
- **$15 (21)**: Filter frequency bits 0-2
- **$16 (22)**: Filter frequency bits 3-10  
- **$17 (23)**: Resonance (bits 4-7) + Voice routing (bits 0-2)
- **$18 (24)**: Filter type (bits 4-6) + Volume (bits 0-3)

#### Voice Routing
Each of the 3 voices can be independently routed through the filter:
- **Bit 0**: Voice 0 through filter
- **Bit 1**: Voice 1 through filter
- **Bit 2**: Voice 2 through filter

## Future Enhancement Possibilities

### Advanced Sequencing
- **Per-step Effects**: Parameter changes per step
- **Probability**: Randomized note triggering
- **Pattern Chaining**: Automatic pattern progression
- **Polyrhythmic Patterns**: Different lengths per voice

### Enhanced Modulation
- **Envelope Followers**: Dynamic response to audio levels
- **Advanced LFO Shapes**: Sine, square, random waveforms
- **Cross-modulation**: Voice-to-voice parameter modulation
- **Macro Controls**: Single controls affecting multiple parameters

### Collaboration Features
- **Pattern Sharing**: Import/export individual patterns
- **Online Library**: Community pattern/instrument database
- **Real-time Collaboration**: Multiple users editing simultaneously
- **Version Control**: Track changes and history

### Audio Enhancement
- **Multiple Filter Banks**: Per-voice filtering
- **Delay/Reverb**: Spatial effects processing
- **Multi-timbral**: Multiple instruments per voice
- **Audio Recording**: Capture performances as audio files

## Development and Architecture Notes

### Code Organization
The codebase follows a modular ES6 architecture with clear separation of concerns:

#### Core Audio Modules
- **synth.js**: Low-level SID register control and audio generation
- **pattern-commands.js**: GoatTracker2 pattern command engine (16 commands)
- **table-manager-gt2.js**: GT2 table system (WTBL, PTBL, FTBL, STBL)
- **gt2-frame-engine.js**: 50Hz table execution engine
- **worklet/sid-processor.body.js**: AudioWorklet processor with GT2 integration

#### Pattern and Sequence Management
- **pattern-manager-gt2.js**: GT2 per-voice pattern system (208 patterns)
- **pattern-manager-compat.js**: Compatibility layer for legacy code
- **sequencer-gt2.js**: Per-voice playback with independent order lists
- **song-editor.js**: Song arrangement and metadata

#### User Interface and Input
- **main.js**: Application initialization and event coordination
- **instrument-editor.js**: GT2-compatible instrument editor
- **gt2-pattern-editor.js**: GoatTracker2-style track view with playback highlighting
- **gt2-order-editor.js**: Per-voice order list editor
- **keyboard-input.js**: Piano keyboard input system
- **record-mode.js**: Live recording functionality

#### Import/Export and Utility
- **gt2-importer.js**: GoatTracker2 .sng file importer
- **sid-exporter.js**: SID file format generation
- **sid-tester.js**: SID playback validation
- **tempo-control.js**: BPM and timing management

### Filter Register Management
The filter implementation carefully manages register state to avoid conflicts:
- **State Tracking**: Voice-specific filter routing maintained
- **Register Preservation**: peek() function preserves existing values
- **Atomic Updates**: Multiple register changes applied together
- **Voice Isolation**: Per-voice filter enable/disable without affecting others

### Testing and Validation
- **Real-time Testing**: Instrument editor provides immediate audio feedback with GT2 table execution
- **SID Validation**: Generated SID files tested with built-in player
- **Cross-browser**: Tested on modern browsers with Web Audio API support
- **Performance**: 50Hz GT2 table updates without audio dropouts
- **GT2 Compatibility**: Import and playback of GoatTracker2 .sng files

### Backward Compatibility Strategy
- **Graceful Migration**: Old save files automatically upgraded
- **Default Values**: New parameters default to disabled state
- **Non-destructive**: Existing data preserved during upgrades
- **Version Detection**: Save format versioning for compatibility

### Memory and Performance
- **Efficient Pattern Storage**: Sparse array representation
- **Real-time Updates**: Minimal CPU usage for modulation
- **Audio Thread Safety**: Separate audio processing from UI updates
- **Browser Storage**: Local storage used for project persistence

---

## Recent Updates and Bug Fixes

### Engine Reliability & Timing (2025‑09)
- Immediate step‑0 trigger on start
- Reschedule next step on BPM change to avoid drift/bunching
- Same‑buffer gate‑on handling to prevent lost retriggers; longer retrigger gap for ADSR reliability

### Voice Audibility & Volume (2025‑09)
- Worklet ensures `$D418` has non‑zero volume and bit7 cleared (voice‑3 enabled) on start and noteOn
- Expanded note map to C‑0..C‑8 so bass and rhythm notes play at correct frequencies

### GT2-Only Architecture Migration (2025-11)
- **Removed all non-GT2 features** from instrument editor for authentic workflow
- **Removed PWM/FM LFO engines** - replaced with PTBL and command 4XY + STBL
- **Removed Arpeggio engine** - replaced with WTBL relative note commands
- **Removed per-instrument Filter/Filter LFO** - replaced with FTBL + commands BXY/CXY
- **Simplified instrument structure** to GT2-only parameters (waveform, ADSR, pulseWidth, sync, ringMod, tables)
- **Enhanced playback highlighting** with bright green (#00aa00) glow effect
- **Fixed NaN bug** in worklet currentStep calculation (removed undefined patternLength modulo)
- **Auto-update track view** when playing patterns change during playback

### Defaults & UI (2025‑09)
- App title: "SID Tracker"
- Pattern A: 16‑step 8‑bit loop (lead triangle, pulse bass, noise rhythm)
- GT2 Pattern Editor with fixed headers and per-voice mute buttons
- GT2 Order Editor with independent order lists per voice

### Troubleshooting
- After code updates, hard reload (Shift+Reload) to refresh the AudioWorklet module
- If a voice seems silent, verify the instrument waveform and that `$D418` volume > 0 (handled automatically by the worklet)
- If playback highlighting stops working, check console for NaN errors in position tracking
- GT2 tables execute at 50Hz in main thread; check `window.gt2FrameEngine` for debugging

## GoatTracker2 Table System Integration Plan

### Overview
GoatTracker2 is a legendary C64 music tracker with a sophisticated table-based modulation system. This section documents the plan to port its table features to enhance the SID Tracker with more powerful sound design capabilities.

### GoatTracker2 Table Architecture

#### Four Table Types
GoatTracker2 uses four specialized tables for comprehensive sound control:

1. **Wavetable** (Wave/Arpeggio)
   - Controls waveform changes and note arpeggios
   - Left side: Delay (01-0F), Waveform values (10-DF), Inaudible waveforms (E0-EF), Commands (F0-FE), Jump (FF)
   - Right side: Relative notes (00-5F), Negative relative notes (60-7F), Keep frequency (80), Absolute notes (81-DF)
   - Can execute pattern commands from wavetable (except 0XY, 8XY, EXY)
   - Supports delays and frame-by-frame waveform/pitch control

2. **Pulsetable** (Pulse Modulation)
   - Controls pulse width modulation with high precision
   - Left side: Time-based modulation steps (01-7F) or Set pulse width (8X-FX), Jump (FF)
   - Right side: Speed (signed 8-bit) for modulation, or low 8 bits for pulse width
   - Limit-based steps can be converted to time-based with SHIFT+L
   - More precise than simple LFO - allows custom modulation curves

3. **Filtertable** (Filter Modulation)
   - Controls filter cutoff and parameters over time
   - Left side: Set cutoff (00), Modulation step (01-7F), Set filter params (80-F0), Jump (FF)
   - Right side: Cutoff value or speed for modulation, or resonance/channel bitmask
   - Can change filter type, resonance, and channel routing per step
   - Supports complex filter sweeps and multi-stage envelopes

4. **Speedtable** (Shared Parameter Table)
   - Shared by vibrato, portamento, and funktempo
   - For vibrato: Left=speed (direction change rate), Right=depth (pitch change amount)
   - For portamento: 16-bit speed value (Left=MSB, Right=LSB)
   - For funktempo: Two tempo values that alternate per pattern row
   - High bit ($80) enables note-independent calculation with divisor

#### Table Features
- **Jump Commands**: Tables can loop with FF jump command (right side = position, $00 = stop)
- **Table Pointers**: Instruments point to specific table positions
- **Pattern Commands**: Can set/change table pointers mid-pattern (8XY, 9XY, AXY commands)
- **Optimization**: Duplicate table segments automatically removed when packing
- **Maximum Length**: 255 entries per table
- **Shared Data**: Multiple instruments can reference same table positions

### Integration Architecture

#### New Modules to Create

**table-manager.js** - Core table system
- Four table arrays: wavetable, pulsetable, filtertable, speedtable
- Table execution logic separate from LFO engines
- Table pointer management for instruments
- Jump command handling
- Table optimization and deduplication

**table-editor.js** - Table editing interface
- Visual table editor with left/right columns
- Table type selection (wave/pulse/filter/speed)
- Hex value entry for table data
- Jump command visualization
- Table length management
- Copy/paste table segments

**gt2-compatibility.js** - GoatTracker2 compatibility layer
- Import/export GT2 .SNG format
- Import/export GT2 .INS format
- Table data conversion between formats
- Preserve GT2 table semantics

#### Modified Modules

**instrument-editor.js** enhancements:
- Add table pointer parameters (wave/pulse/filter/speed positions)
- Visual indicators of table assignments
- Quick jump to table editor from pointers
- Table preview in instrument view

**synth.js** enhancements:
- Replace simple LFO with table-driven modulation
- Add wavetable execution for note/waveform changes
- Add pulsetable execution for pulse modulation
- Add filtertable execution for filter sweeps
- Integrate with existing SID register control

**sequencer.js** enhancements:
- Add pattern commands 8XY (set wavetable ptr), 9XY (set pulsetable ptr), AXY (set filtertable ptr)
- Table pointer management per voice
- Table execution timing synchronized with pattern playback

**pattern-manager.js** enhancements:
- Support new table-related pattern commands
- Store table pointer commands in pattern data

#### Data Structure Changes

**Instrument definition** additions:
```javascript
{
  // Existing parameters...
  waveTablePos: 0x00-0xFF,    // Wavetable start position
  pulseTablePos: 0x00-0xFF,   // Pulsetable start position
  filterTablePos: 0x00-0xFF,  // Filtertable start position
  speedTablePos: 0x00-0xFF,   // Speedtable/vibrato parameter
  vibratoDelay: 0x00-0xFF,    // Ticks before vibrato starts
}
```

**Table data structures**:
```javascript
const tables = {
  wave: {
    left: new Uint8Array(256),   // Waveform/delay/command
    right: new Uint8Array(256),  // Note/parameter
  },
  pulse: {
    left: new Uint8Array(256),   // Time/pulse high
    right: new Uint8Array(256),  // Speed/pulse low
  },
  filter: {
    left: new Uint8Array(256),   // Command/time
    right: new Uint8Array(256),  // Cutoff/speed/params
  },
  speed: {
    left: new Uint8Array(256),   // Speed MSB or vibrato speed
    right: new Uint8Array(256),  // Speed LSB or vibrato depth
  }
};
```

### Implementation Phases

#### Phase 1: Core Table Engine (Foundation)
- Implement table-manager.js with basic table storage
- Add table execution logic to AudioWorklet processor
- Create simple table editor UI
- Test basic wavetable execution

#### Phase 2: Wavetable System (Sound Generation)
- Full wavetable implementation with delays, jumps
- Relative/absolute note handling
- Waveform changes per step
- Pattern command execution from wavetable
- Integration with existing note system

#### Phase 3: Pulsetable System (Pulse Modulation)
- Replace PWM LFO with pulsetable execution
- Time-based modulation steps
- Pulse width setting commands
- Limit-to-time conversion utility

#### Phase 4: Filtertable System (Filter Modulation)
- Replace filter LFO with filtertable execution
- Filter cutoff modulation
- Filter parameter changes (type, resonance, routing)
- Multi-stage filter envelopes

#### Phase 5: Speedtable System (Shared Parameters)
- Speedtable for vibrato control
- Speedtable for portamento
- Funktempo implementation
- Note-independent calculation option

#### Phase 6: GT2 Compatibility (Import/Export)
- GT2 .SNG file import
- GT2 .INS file import/export
- Table data conversion
- Pattern command mapping
- Validation and testing

#### Phase 7: Advanced Features (Power User Tools)
- Table optimization (remove duplicates)
- Smart paste for instruments with tables
- Table visualization and debugging
- Hifi portamento/vibrato calculation
- Table scrolling lock/unlock

### Migration Strategy

**Backwards Compatibility**:
- Existing LFO parameters can auto-generate simple tables
- Simple table programs created for basic LFO-like behavior
- Existing songs continue to work with compatibility layer

**Progressive Enhancement**:
- Basic functionality works with simple table programs
- Advanced users can hand-craft complex table sequences
- Import GT2 songs to learn from existing table techniques

**User Interface Evolution**:
- Keep existing LFO controls for beginners
- Add "Advanced" mode that reveals table editor
- Provide presets showing table capabilities
- Tutorial patterns demonstrating table features

### Benefits of Table System

**Creative Advantages**:
- **Precise Control**: Frame-by-frame parameter automation
- **Complex Modulation**: Multi-stage envelopes and modulation curves
- **Memory Efficiency**: Shared table data between instruments
- **Authentic Sound**: Matches classic C64 tracker workflow
- **Advanced Techniques**: Drum synthesis, complex arpeggios, filter sweeps

**Technical Advantages**:
- **Deterministic**: Exact reproduction of modulation
- **Compact**: Table-based more efficient than continuous modulation
- **Flexible**: Tables can be any length, loop anywhere
- **Powerful**: Execute commands within tables for meta-control

### Reference Implementation

The GoatTracker2 codebase (located at `../../../goattracker2`) provides reference implementation:

**Key Source Files**:
- `src/gtable.c` - Table execution and management
- `src/gtable.h` - Table function declarations
- `src/ginstr.c` - Instrument with table parameters
- `src/gplay.c` - Table execution during playback
- `src/greloc.c` - Table optimization and packing

**Documentation**:
- `readme.txt` - Complete table format specification (section 3.4)
- `goat_tracker_commands.pdf` - Visual command reference

### Using the GoatTracker2 Importer

The GT2 importer allows you to load instruments and tables from existing GoatTracker2 songs:

#### Import Process:
1. Click the **"Import GT2"** button in the Project controls (next to the Import button)
2. Select a GoatTracker2 `.sng` file (GTS3/GTS4/GTS5 format)
3. Choose whether to **REPLACE** existing instruments (except Lead Tri) or **ADD** to existing instruments
4. The importer will:
   - Load all 4 table types (WTBL, PTBL, FTBL, STBL) into the GT2 table manager
   - Convert GT2 instruments to SID Tracker format with 1-based table pointers
   - Add/replace instruments in the instruments array
   - Preserve instrument names, ADSR envelopes, waveforms, and table pointers
   - Automatically refresh the instrument selector

#### What Gets Imported:
- **Instruments**: All instruments with names, ADSR, waveforms, table pointers (1-based, 0 = no table)
- **Tables**: Complete wavetable, pulsetable, filtertable, and speedtable data (255 entries each)
- **Metadata**: Song name, author, copyright information displayed in confirmation dialog
- **Table Architecture**: Uses GT2's ltable[type][pos] and rtable[type][pos] format

#### Using Imported Instruments:
- Imported instruments appear in the instrument selector immediately after import
- They retain their GT2 table assignments (1-based pointers: 0 = no table, 1+ = table position)
- Tables execute at 50Hz (PAL) matching C64 timing via the GT2 Frame Engine
- Waveforms stored WITH gate bit (0x21, 0x41, etc.) and written every frame
- Arpeggios, pulse modulation, filter sweeps work exactly like GoatTracker2

#### UI Integration:
The GT2 import functionality is integrated with the Project controls:
- Located next to the standard "Import" button for easy access
- Dedicated file input accepts only `.sng` files
- Confirmation dialog shows song info and allows replace/append choice
- Success message shows number of instruments and tables imported
- Instrument selector automatically refreshes to show new instruments

#### Example Workflow:
```javascript
// Import a GT2 song via UI or programmatically
const importer = new GT2Importer();
const data = await importer.importSongFile(file);

// Apply tables to the table manager (replaces existing tables)
importer.applyTables(data.tables);

// Add instruments (replace=true keeps first instrument, replace=false appends)
importer.addInstruments(data, replace = false);

// Use imported instruments in patterns
// They will automatically use their assigned GT2 tables
// Example: Instrument with wave:1 starts executing wavetable at position 1
```

#### GT2 Table System Architecture:
The importer uses a 100% GoatTracker2-compatible table system:
- **ONE array per table type** (not multiple table instances)
- **255 entries per table**: ltable[type][pos] and rtable[type][pos]
- **1-based table pointers**: 0 = no table, 1-255 = position in table array
- **Dual-byte format**: Left byte = command/waveform, Right byte = parameter/note
- **Frame-based execution**: GT2 Frame Engine runs at 50Hz (PAL) or 60Hz (NTSC)
- **Every-frame writes**: Waveform register written every frame like GT2

---

## Summary

The SID Tracker represents a complete digital audio workstation specialized for Commodore 64 sound synthesis. It combines authentic SID chip emulation with modern music production workflows, providing both nostalgic sound generation and contemporary usability.

**Key Capabilities:**
- **Authentic SID Synthesis**: Accurate emulation of all SID chip features
- **Professional Workflow**: Multi-pattern songs, real-time recording, comprehensive editing
- **GT2 Table-Based Modulation**: Wavetable, pulsetable, filtertable, speedtable for precise control
- **16 Pattern Commands**: Complete GoatTracker2 command set for real-time effects
- **Export Compatibility**: Generate playable SID files for C64 hardware/emulators
- **Modern Interface**: Modal editors, keyboard shortcuts, project management
- **GoatTracker2 Compatibility**: Full table system implementation with .sng import

**GoatTracker2 Table System (IMPLEMENTED):**
- **Wavetable (WTBL)**: Frame-by-frame waveform and arpeggio control
- **Pulsetable (PTBL)**: Precise pulse width modulation curves
- **Filtertable (FTBL)**: Complex filter sweeps and multi-stage envelopes
- **Speedtable (STBL)**: Advanced vibrato, portamento, and funktempo
- **GT2 .sng Import**: Load instruments and tables from GoatTracker2 songs

The system maintains the characteristic analog-style filtering and distinctive sound that made the Commodore 64 legendary in computer music history, while providing the editing capabilities expected in modern music production software. The planned table system integration will bring the power and precision of GoatTracker2's legendary workflow to the browser-based environment.

This implementation serves as both a creative tool for chiptune music production and a technical demonstration of browser-based audio synthesis, showcasing how classic computer music hardware can be accurately emulated and enhanced with contemporary web technologies.
