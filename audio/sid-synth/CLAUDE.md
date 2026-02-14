# SID Tracker

Web-based SID (C64) tracker with full **GoatTracker2 compatibility**. AudioWorklet-only architecture, GT2 per-voice patterns, table-based modulation, .sng import, .SID export.

## Architecture Overview

**GT2 per-voice pattern system** (not the old unified 16-pattern system):
- **208 single-voice patterns** (0-207), 4 bytes/row: note, instrument, command, cmdData
- **3 independent order lists** (one per voice) with repeat/transpose/LOOPSONG commands
- **GT2-only instruments**: waveform, firstWave, ADSR, pulseWidth, gateTimer, vibParam, vibratoDelay, sync, ringMod, table pointers
- **No LFO/arpeggio engines** -- use GT2 tables and pattern commands instead

### Worklet-Centric Design

**ALL audio processing runs in the AudioWorklet** (`sid-processor.body.js`):
- Sequencing (pattern/order list traversal)
- Note triggering with sample-accurate timing
- Table execution (WTBL/PTBL/FTBL/STBL) at 50Hz tick rate
- Realtime commands (portamento, vibrato) at 50Hz
- One-shot commands (ADSR, waveform, filter, tempo)
- reSID emulation (cycle-accurate SID chip)

**Main thread** only handles:
- UI updates (pattern editor highlighting via `window.voiceState`)
- Keyboard note input (sends `noteOn`/`noteOff` messages to worklet)
- Transport controls (sends `start`/`stop`/`loadPattern` to worklet)
- Register pokes from UI (sends `poke` messages to worklet)

## GT2 Note Encoding

| Value | Meaning |
|-------|---------|
| `0x00` | Empty (sustain, no change) |
| `0x60-0xBC` | Notes C-0 to G#7 (93 semitones) |
| `0xBD` (189) | REST - sustain previous note, no gate change |
| `0xBE` (190) | KEYOFF - clear gate bit, trigger ADSR release |
| `0xBF` (191) | KEYON - set gate bit (retrigger without new note) |
| `0xFF` | Pattern end marker |

Internal note index: `noteInput - 0x60` gives 0-95 range for frequency table lookup.

## GT2 Order List Commands

| Value | Meaning |
|-------|---------|
| `0x00-0xCF` | Pattern number (single byte) |
| `0xD0-0xDF` | REPEAT: play next pattern (entry - 0xD0) extra times (single byte) |
| `0xE0-0xFD` | TRANSPOSE: entry - 0xF0 gives signed semitones (-16 to +13), followed by pattern |
| `0xFE` | LOOPSONG: next byte = restart position |
| `0xFF` | ENDSONG: loops to position 0 |

## File Map

### Core Audio
| File | Purpose |
|------|---------|
| `synth.js` | AudioWorklet init, worklet message routing, `setSIDRegister`/`setGlobalSIDRegister`, keyboard noteOn/Off |
| `worklet/sid-processor.body.js` | **THE engine**: sequencing, GT2 table execution, realtime commands, reSID audio generation |
| `sid-processor.bundle.js` | Built bundle (jsSID + processor). **Rebuild**: `tools/build-worklet.sh` then Shift+Reload |
| `table-manager-gt2.js` | WTBL/PTBL/FTBL/STBL storage (255 entries each, dual-byte ltable/rtable). Used by UI and import; worklet gets a copy via `loadPattern` message |
| `gt2-frame-engine.js` | **DISABLED** for sequencer playback. Legacy main-thread table engine. `triggerNoteTables()` no longer called. |
| `pattern-commands.js` | Main-thread command engine. **Only used for keyboard-triggered notes** (worklet handles sequencer commands internally) |

### Pattern & Sequencing
| File | Purpose |
|------|---------|
| `pattern-manager-gt2.js` | 208 single-voice patterns, GT2 note format (0x60-0xBC=notes, 0xBD=REST, 0xBE=KEYOFF) |
| `sequencer-gt2.js` | Sends patterns/orderLists/instruments/tables to worklet via `workletStartSequencer()`. Main-thread `playStep()` is legacy dead code. |

### UI
| File | Purpose |
|------|---------|
| `main.js` | App controller, transport, project management, Export .SID button |
| `gt2-pattern-editor.js` | Track view: 3 voices side-by-side, playback highlighting, fixed headers |
| `gt2-order-editor.js` | Per-voice order list editor |
| `instrument-editor.js` | GT2-only instrument editor with table pointer assignment |
| `keyboard-input.js` | Piano keyboard input (Z-M lower octave, Q-U upper octave) |
| `record-mode.js` | Live recording with auto-advance |
| `tempo-control.js` | BPM (60-200), swing, tap tempo |

### Import/Export
| File | Purpose |
|------|---------|
| `gt2-importer.js` | GoatTracker2 .sng import (GTS3/GTS4/GTS5), replaces ALL instruments (no default at index 0) |
| `exporters/gt2/sid-exporter-gt2.js` | .SID file generation with pre-assembled GT2 6502 player binary |
| `exporters/gt2/driver/gt2-driver-data.js` | Pre-assembled 4553-byte GT2 player as base64 + metadata |

### External
| File | Purpose |
|------|---------|
| `jsSID/` | reSID emulation library (submodule) |

## Key Data Structures

### Instrument (GT2-only)
```javascript
{
    name: "Name",
    waveform: 0x10,       // Triangle=0x10, Saw=0x20, Pulse=0x40, Noise=0x80
    firstWave: 0x11,      // Waveform+gate+sync/ring for first frame (0x11=tri+gate)
    gateTimer: 0x02,      // Bits 0-5=timer, bit 6=no gate-off, bit 7=no hard restart
    vibratoDelay: 0,      // Frames to delay vibrato start
    vibParam: 0,          // Vibrato parameter (index into STBL)
    ad: 0x0F,             // Attack/Decay (4 bits each)
    sr: 0xF0,             // Sustain/Release (4 bits each)
    pulseWidth: 0x0800,   // 12-bit (0x000-0xFFF)
    sync: false,
    ringMod: false,
    tables: { wave: 0, pulse: 0, filter: 0, speed: 0 }  // 0 = no table, 1+ = 1-based position
}
```

### GT2 Tables (per type: WTBL, PTBL, FTBL, STBL)
- 255 entries, dual-byte: `ltable[type][pos]` + `rtable[type][pos]`
- **1-based pointers**: 0 = no table, 1 = array index 0, 2 = array index 1, etc.
- `0xFF` left byte = jump (right byte = destination, 0x00 = stop)
- Waveform values stored WITH gate bit (0x21 = saw+gate, 0x41 = pulse+gate)

### Worklet Voice State (per voice, inside sid-processor.body.js)
```javascript
{
    active: bool,           // Voice is producing sound
    instrument: object,     // Current instrument
    baseNote: 0-95,         // GT2 note index (noteInput - 0x60)
    baseSidFreq: uint16,    // SID frequency from GT2 freq table
    currentFrequency: uint16, // Current SID freq (modified by portamento/vibrato)
    targetFrequency: uint16,  // Target for toneportamento (cmd 3)
    wave: uint8,            // Current waveform byte (from firstWave or wavetable)
    gate: 0xFF/0xFE,        // Gate mask (0xFF=on, 0xFE=off/release)
    activeCommand: 0-4,     // Current realtime command (0=none)
    commandData: uint8,     // Realtime command parameter
    transpose: int,         // Current transpose from order list
    // Table state:
    ptr: [wave, pulse, filter, speed],  // 1-based pointers (0=inactive)
    waveActive/pulseActive/speedActive: bool,
    wavetime: uint8,        // Wavetable delay counter
    tablePulse: uint12,     // Current pulse width from table
    skipWaveOnce: bool,     // GT2 TICK0 behavior: skip first WAVEEXEC on new note
    // Vibrato:
    vibtime: uint8,         // GT2 vibrato phase counter
    vibratoPhase: uint8,    // Reset on new note
}
```

## Audio Pipeline (Actual)

1. `sequencer-gt2.js` sends `loadPattern` message with allPatterns, orderLists, instruments, tables to worklet
2. `synth.js` sends `start` message to worklet
3. **Worklet `process()`**: generates audio in chunks, scheduling `seq` events (pattern steps) and `tick` events (50Hz table/command execution)
4. **On `seq` event**: `handleSequencerStep()` reads pattern data, processes notes/commands, advances order list
5. **On `tick` event**: `executeRealtimeCommands()` runs global filter table, then per-voice: wavetable, frequency effects, pulsetable
6. Worklet sends `step` messages with `voicePositions` back to main thread
7. `synth.js` receives `step`, updates `window.voiceState` for UI highlighting
8. `gt2-pattern-editor.js` polls `window.voiceState` at 50ms for playback highlighting

### Timing Model
- **Base tick**: `Math.floor(sampleRate / 50)` samples = 50Hz PAL rate
- **Step duration**: `globalTempo * tickIntervalSamples` (default tempo = 6 = 6 ticks per step)
- **Funktempo**: alternates between two tempo values per step (swing)
- **Per-channel tempo**: overrides global for individual voices

## GT2 Table Execution Order (per tick, in worklet)

1. `executeGlobalFiltertable()` - filter is GLOBAL, runs once before voice loop
2. Per voice (0, 1, 2):
   a. Hard restart timer check
   b. `executeWavetable()` - updates `vs.wave`, writes reg $04 (waveform+gate)
   c. Frequency update from wavetable note result (GT2 freq table lookup)
   d. Realtime effects (cmd 1-4: portamento/vibrato) - only if wavetable didn't set a note
   e. `executePulsetable()` - updates pulse width, writes regs $02/$03
3. Filter registers ALWAYS written ($15-$18), even when no filter table active

### Wavetable Left Byte Encoding
| Range | Meaning |
|-------|---------|
| `0x00-0x0F` | Delay N frames |
| `0x10-0xDF` | Waveform value (written to SID reg $04 with gate mask) |
| `0xE0-0xEF` | Silent waveform (wave = left & 0x0F, gate cleared) |
| `0xF0-0xFE` | Embedded pattern command (cmd = left & 0x0F, param = right byte) |
| `0xFF` | Jump to position in right byte (0x00 = stop) |

### Wavetable Right Byte (Note)
| Value | Meaning |
|-------|---------|
| `0x80` | No note change (keep current frequency) |
| `0x00-0x7F` | Relative: `(right + baseNote) & 0x7F` |
| `0x81-0xFF` | Absolute: `right & 0x7F` |

## Pattern Commands

| Cmd | Type | Description |
|-----|------|-------------|
| 0 | - | Clear realtime command (DONOTHING) |
| 1XY | Realtime | Portamento up (XY = STBL index, 16-bit speed) |
| 2XY | Realtime | Portamento down (XY = STBL index) |
| 3XY | Realtime | Toneportamento to note (XY = STBL index) |
| 4XY | Realtime | Vibrato (STBL left=speed, right=depth; hifi if speed>=0x80) |
| 5XY | One-shot | Set Attack/Decay |
| 6XY | One-shot | Set Sustain/Release |
| 7XY | One-shot | Set Waveform (vs.wave = XY) |
| 8XY | One-shot | Set wavetable pointer (0=disable) |
| 9XY | One-shot | Set pulsetable pointer (0=disable) |
| AXY | One-shot | Set filtertable pointer (GLOBAL, 0=disable) |
| BXY | One-shot | Filter control (resonance+routing, 0=disable filter) |
| CXY | One-shot | Filter cutoff |
| DXY | One-shot | Master volume (0-F) |
| EXY | One-shot | Funktempo (XY=STBL index, 0=disable) |
| FXY | One-shot | Set tempo ($03-$7F=global, $83-$FF=per-channel) |

**GT2 behavior**: Command 0 clears realtime state. Commands 1-4 set realtime state (runs every tick). One-shot commands (5-F) do NOT clear running realtime commands. New note clears realtime command UNLESS command is toneportamento (3).

## SID Filter Registers

| Reg | Bits | Function |
|-----|------|----------|
| $15 (21) | 0-2 | Filter frequency low 3 bits (GT2 always writes 0) |
| $16 (22) | 0-7 | Filter frequency high 8 bits (GT2 cutoff) |
| $17 (23) | 4-7 / 0-2 | Resonance / Voice routing |
| $18 (24) | 4-6 / 0-3 | Filter type (LP=0x10, BP=0x20, HP=0x40) / Volume |

Filter is shared across voices; each voice independently routed via bits 0-2 of reg $17.

## GT2 Effects via Tables (not LFOs)

- **PWM**: PTBL with set (0x80-0xFE) and modulate (0x01-0x7F) commands
- **Vibrato**: Command 4XY + STBL (left=speed, right=depth; hifi mode if speed bit 7 set)
- **Arpeggios**: WTBL with relative notes (0x00-0x5F=up, 0x60-0x7F=down via overflow)
- **Filter sweeps**: FTBL with set-params (0x80+), set-cutoff (0x00), modulate (0x01-0x7F)
- **Dynamic ADSR**: Commands 5XY/6XY or wavetable embedded commands (0xF5/0xF6)

## Instrument Indexing

- **GT2 1-based**: Pattern data uses instrument 1+ (0 = "no change, keep current")
- **JS array 0-based**: Instrument 1 reads `instruments[1]`, instrument 0 is unused/"no change"
- **Import**: `gt2-importer.js` replaces ALL instruments (no default at index 0)
- **Export**: `sid-exporter-gt2.js` packs instruments starting at index 1

## Building the Worklet Bundle

```sh
chmod +x tools/build-worklet.sh
tools/build-worklet.sh
```
Bundles `jsSID/js/jssid.core.js` + `jsSID/js/jssid.tinysid.js` + `worklet/sid-processor.body.js` into `sid-processor.bundle.js`. No npm required. Hard-reload browser after rebuild.

## Play/Stop Behavior

- **Start**: `sequencer-gt2.js` sends all data to worklet, worklet starts sequencing from step 0
- **Stop**: Soft stop + hard panic (clears gates, frequencies, mutes volume via worklet `panic` message)

## Keyboard Shortcuts

- **Spacebar**: Play/Stop
- **R**: Enter record mode
- **Ctrl+S/O/E**: Save/Load/Export
- **Recording**: Space=Rest, Enter=Sustain, Arrows=navigate, Escape=exit, 1-9=instrument

## GT2 C Source Reference

The original GoatTracker2 C source is in `gt2-src/`. Key files:

| File | Purpose |
|------|---------|
| `gt2-src/gplay.c` | **THE reference**: playroutine (sequencer + table execution + commands) |
| `gt2-src/gplay.h` | CHN struct definition (per-voice state) |
| `gt2-src/gcommon.h` | Constants (FIRSTNOTE=0x60, LASTNOTE=0xBC, CMD_*, table types, INSTR struct) |
| `gt2-src/greloc.c` | .SID export/relocator |
| `gt2-src/gfile.c` | .sng file load/save |
| `gt2-src/player.s` | 6502 assembly player (for actual C64 playback) |

### GT2 INSTR struct (gcommon.h)
```c
typedef struct {
  unsigned char ad;
  unsigned char sr;
  unsigned char ptr[MAX_TABLES];  // ptr[WTBL], ptr[PTBL], ptr[FTBL], ptr[STBL]
  unsigned char vibdelay;
  unsigned char gatetimer;
  unsigned char firstwave;
  char name[MAX_INSTRNAMELEN];
} INSTR;
```
Note: No explicit `vibparam` field. Instrument vibrato uses `iptr->ptr[STBL]` as the vibrato parameter (speedtable pointer).

### GT2 CHN struct (gplay.h)
```c
typedef struct {
  unsigned char trans, instr, note, lastnote, newnote;
  unsigned pattptr;
  unsigned char pattnum, songptr, repeat;
  unsigned short freq;
  unsigned char gate, wave;
  unsigned short pulse;
  unsigned char ptr[2];         // ONLY WTBL and PTBL! (filter is global, speed is via cmddata)
  unsigned char pulsetime, wavetime, vibtime, vibdelay;
  unsigned char command, cmddata, newcommand, newcmddata;
  unsigned char tick, tempo, mute, advance, gatetimer;
} CHN;
```
Key: CHN only stores 2 table pointers (WTBL, PTBL). Filter pointer (`filterptr`) is global. Speed/vibrato uses `cmddata` (= instrument's STBL pointer).

### GT2 playroutine() Execution Order (gplay.c)

Each frame, for each channel:
1. **Filter execution** (GLOBAL, before voice loop) - lines 255-304
2. **Tick decrement** (`cptr->tick--`) - line 320
3. **If tick == 0 → TICK0**: sequencer advance, new note init, tick0 commands - lines 342-516
4. **If tick overflows (>= 0x80)**: reload from tempo or funktable - lines 325-338
5. **WAVEEXEC**: wavetable execution - lines 518-726
6. **TICKNEFFECTS**: realtime commands (portamento/vibrato) - lines 729-844
7. **PULSEEXEC**: pulsetable execution - lines 847-900
8. **GETNEWNOTES** (when `tick == gatetimer`): read pattern data, start HR - lines 904-937
9. **NEXTCHN**: write ALL SID registers (freq, pulse, wave&gate) - lines 938-948

## Differences from GT2 C Source (Bugs / Missing Features)

### 1. Hard Restart Timing (MAJOR)
**GT2**: Pattern data is read at `tick == gatetimer` (GETNEWNOTES, lines 901-937). This triggers gate-off `gatetimer` frames BEFORE TICK0. On TICK0, the new note is processed (firstWave applied, tables reset). The HR gap gives the SID's ADSR time to decay, preventing clicks.
**Our worklet**: Reads pattern data and processes the new note in the same step (`handleSequencerStep`). Uses a tiny `synth.generate(8)` gap (~0.17ms) instead of proper gatetimer-based frame delay. The instrument's `gatetimer` field is not used for timing.
**Impact**: Note retriggering may click. Songs relying on HR timing will sound different.

### 2. Instrument Vibrato with Delay (MODERATE)
**GT2** (gplay.c lines 768-801): When command is DONOTHING (0), if `cmddata` (= instrument STBL ptr) is non-zero AND `vibdelay > 0`, it counts down vibdelay then FALLS THROUGH to CMD_VIBRATO. This enables automatic vibrato from instrument settings.
```c
case CMD_DONOTHING:
  if ((!cptr->cmddata) || (!cptr->vibdelay)) break;
  if (cptr->vibdelay > 1) { cptr->vibdelay--; break; }
case CMD_VIBRATO:  // falls through!
```
**Our worklet**: Only activates vibrato from explicit pattern command 4XY. Instrument `vibParam`/`vibratoDelay` are imported but never used during playback.
**Impact**: Instruments with built-in vibrato (common in GT2 songs) won't vibrate.

### 3. Per-Channel Tick Counters (MODERATE)
**GT2**: Each channel has its own `tick` counter that decrements independently every frame. With per-channel tempo, channels advance at different rates.
**Our worklet**: Uses a single global step timer (`nextStepSample`). All 3 voices advance together. `channelTempo` exists but doesn't drive independent tick counters.
**Impact**: Per-channel tempo (FXY with high bit set) won't work correctly. Songs with different speeds per voice will be wrong.

### 4. Filter Cutoff Wrapping (MINOR)
**GT2**: `filtercutoff += rtable[...]` uses unsigned 8-bit wrapping (0xFF + 1 = 0x00).
**Our worklet**: `gf.cutoff = Math.max(0, Math.min(0xFF, gf.cutoff + gf.modSpeed))` clamps to 0-255.
**Impact**: Filter sweeps that intentionally wrap past boundaries will sound different.

### 5. Pulse Width Low Bit (MINOR)
**GT2** (line 945): `sidreg[0x2+7*c] = cptr->pulse & 0xfe` — clears bit 0 of pulse low register.
**Our worklet**: `this.setVoiceReg(voice, 0x02, pulseVal & 0xFF)` — keeps all bits.
**Impact**: Negligible (SID hardware ignores bit 0 of pulse low on 6581).

### 6. Frequency Tables
**Worklet** (`sid-processor.body.js`): Tables match GT2 `gplay.c` exactly. Correct.
**Frame engine** (`gt2-frame-engine.js`): Tables differ from `gplay.c` — wrong values from octave 2 onwards. But frame engine is DISABLED, so no impact on playback.

## Known Issues / Legacy Code

- **`gt2-frame-engine.js`**: Main-thread table engine is DISABLED (`start()` commented out in sequencer-gt2.js). Worklet handles all table execution. Frequency tables are WRONG (differ from gplay.c). File kept for potential future use.
- **`pattern-commands.js`**: Full command engine on main thread, but worklet implements commands internally. Main thread version only active for keyboard-triggered commands via `executeCommand` message. Could cause double-execution if both paths run.
- **`table-manager-gt2.js` `GT2TablePlaybackState`**: Table execution state class not used by worklet (worklet has inline execution). Only used by disabled `gt2-frame-engine.js`.
- **Keyboard noteOn frequency path**: Goes through Hz->SID conversion (`hzToSid()`) which is slightly less accurate than GT2 table lookup. Sequencer playback uses correct GT2 tables.

## Troubleshooting

- Hard reload (Shift+Reload) after code changes to refresh AudioWorklet
- Silent voice: check instrument waveform, firstWave, and `$D418` volume
- Wrong instrument sounds after import: verify instruments[0] is first GT2 instrument (not default "Lead (Tri)")
- Debug tables in worklet: check console for `WTBL`, `PTBL`, `FTBL` log messages
- Debug filter: look for `FILTER REGS` and `GLOBAL FTBL` console messages
- Compare against GT2 C source: `gt2-src/gplay.c` is the authoritative reference
