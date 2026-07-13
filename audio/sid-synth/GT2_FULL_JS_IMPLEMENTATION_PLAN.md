> **HISTORICAL (2025):** This plan is outdated — pattern commands, tables and the worklet engine are long since implemented, and GT2 parity is now verified register-by-register via `make verify`. See CLAUDE.md and GT2_PARITY_PLAN.md.

# Full JavaScript GoatTracker2 Implementation Plan

## Executive Summary

This document outlines the roadmap for transforming the current **SID Tracker** into a complete JavaScript version of **GoatTracker 2**. The current implementation already has significant GT2 compatibility, but a full implementation requires adding the complete pattern command system, advanced editing features, file export capabilities, and the classic GoatTracker UI workflow.

---

## Current Implementation Status

### ✅ Already Implemented (Strong Foundation)

#### Core Audio Engine
- **jsSID Integration**: Complete SID chip emulation using TinySID/FastSID
- **AudioWorklet Architecture**: Sample-accurate timing at 50Hz/60Hz (PAL/NTSC)
- **Filter System**: Full SID filter implementation (low-pass, band-pass, high-pass)
- **ADSR Envelopes**: Complete attack/decay/sustain/release control
- **Waveforms**: All SID waveforms (triangle, sawtooth, pulse, noise)
- **Special Features**: Sync, ring modulation support

#### GT2 Table System (COMPLETE)
- **✅ Wavetable (WTBL)**: Waveform and arpeggio control
  - Delay commands (01-0F)
  - Waveform values (10-DF) with gate bit
  - Jump commands (FF xx)
  - Pattern command execution from wavetable
  - Absolute and relative notes

- **✅ Pulsetable (PTBL)**: Pulse width modulation
  - Time-based modulation steps (01-7F)
  - Set pulse width commands (8X-FX)
  - Jump commands (FF xx)

- **✅ Filtertable (FTBL)**: Filter control
  - Set cutoff (00 xx)
  - Modulation steps (01-7F)
  - Set filter params (80-F0)
  - Jump commands (FF xx)

- **✅ Speedtable (STBL)**: Vibrato/portamento/funktempo
  - Vibrato speed/depth
  - Portamento 16-bit speeds
  - Funktempo dual-tempo values
  - Note-independent calculation support ($80 high bit)

#### GT2 Architecture
- **✅ Per-Voice Pattern System**: 208 single-voice patterns (0-207)
- **✅ Independent Order Lists**: 3 separate order lists (one per voice)
- **✅ Pattern Format**: 4 bytes per row (note, instrument, command, cmdData)
- **✅ Song Commands**: LOOPSONG ($FE), ENDSONG ($FF), TRANSPOSE, REPEAT
- **✅ Frame Engine**: 50Hz table execution matching C64 timing
- **✅ GT2 .sng Import**: Complete song/instrument/table import
- **✅ Instrument Table Pointers**: 1-based table pointers in instruments
- **✅ Position Sync**: Worklet-to-UI position tracking for visual highlighting

#### User Interface
- **✅ GT2 Pattern Editor**: Track view with 3 voices side-by-side
- **✅ GT2 Order Editor**: 3 independent order list columns
- **✅ Table Editor**: Visual table editing with hex reference
- **✅ Instrument Editor**: Comprehensive parameter editing with table assignment
- **✅ Playback Highlighting**: Real-time visual feedback of playing position
- **✅ Mute Controls**: Per-voice mute buttons

#### File I/O
- **✅ Import GT2 .sng**: Full song import with patterns, orders, instruments, tables
- **✅ Export JSON**: Project save format
- **✅ Export SID**: Generate playable .SID files (partial)

---

## Missing Features for Full GT2 Implementation

### 🔴 Critical Missing Features

#### 1. Pattern Commands (HIGHEST PRIORITY)
Currently **ZERO pattern commands** are implemented. GoatTracker2 has 16 commands (0XY-FXY):

**Missing Commands:**
- **0XY**: Do nothing (empty command)
- **1XY**: Portamento up (speedtable index)
- **2XY**: Portamento down (speedtable index)
- **3XY**: Toneportamento / Tie-note (speedtable index or 00)
- **4XY**: Vibrato (speedtable index)
- **5XY**: Set attack/decay
- **6XY**: Set sustain/release
- **7XY**: Set waveform
- **8XY**: Set wavetable pointer
- **9XY**: Set pulsetable pointer
- **AXY**: Set filtertable pointer
- **BXY**: Set filter control (resonance + channel bitmask)
- **CXY**: Set filter cutoff
- **DXY**: Set master volume / timing mark
- **EXY**: Funktempo (speedtable index)
- **FXY**: Set tempo (global or per-channel)

**Implementation Requirements:**
- Command parsing in pattern playback
- Speedtable lookups for portamento/vibrato
- Real-time effect execution at 50Hz
- Command state tracking per voice
- One-shot vs continuous command handling
- Realtime optimization (skip commands on tick 0 optionally)

#### 2. Advanced Editing Features
- **Pattern Operations**:
  - Transpose (halfstep up/down, octave up/down)
  - Shrink/Expand pattern (divide/multiply by 2)
  - Join patterns (merge with next in orderlist)
  - Split pattern from cursor position
  - Mark/copy/paste with selection
  - Invert selection
  - Clear commands only

- **Table Operations**:
  - Convert limit-based to time-based modulation (SHIFT+L)
  - Negate speed parameter (SHIFT+N)
  - Transpose speedtable portamento (SHIFT+Q,A,W,S)
  - Convert absolute/relative notes (SHIFT+R)
  - Optimize table (remove unused entries)
  - Smart paste instruments (update pattern references)

- **Keyboard Shortcuts**:
  - Protracker keyboard mode (two-row piano)
  - DMC keyboard mode (one-row piano with octave numbers)
  - Janko keyboard mode
  - Auto-advance modes (GREEN/YELLOW/RED)
  - Jam mode vs Edit mode toggle

#### 3. Song Management Features
- **Orderlist Commands**:
  - TRANSPOSE (+/- in orderlist)
  - REPEAT (R command)
  - Swap channel orderlists (SHIFT+1,2,3)
  - Mark/copy/paste orderlist sections

- **Subtunes**: Multiple song arrangements per file
- **Song Start/End Markers**: Per-channel loop points
- **Pattern Length Control**: Variable pattern lengths (1-128 rows)
- **Highlighting Step Size**: Configurable (SHIFT+M,N)

#### 4. Instrument Advanced Features
- **Vibrato Delay**: Ticks before instrument vibrato starts
- **HR/Gate Timer**: Hard restart and gate-off timing
  - Bit $80 disables hard restart
  - Bit $40 disables gate-off
- **1stFrame Wave**: Special waveform on note init frame
  - $09 = gate + testbit (typical)
  - $00 = leave waveform unchanged
  - $FE = gate off
  - $FF = gate on
- **Smart Paste**: Remap instrument numbers in patterns

#### 5. Playback Features
- **Follow Play Mode**: Auto-scroll to playing position
- **Pattern Play**: Play single pattern in loop (F3)
- **Gatebit Masking**: Proper key-on/key-off command interaction
- **Multispeed**: Speed multiplier (1x, 2x, 4x, 8x)
- **Per-Channel Tempo**: Independent tempo per voice (FXY with $80+)
- **Funktempo**: Alternating tempo values (EXY command)

#### 6. File Export/Import
- **GT2 .sng Export**: Save songs in GoatTracker2 format
- **GT2 .ins Import/Export**: Individual instrument files
- **Pack & Relocate**: Generate optimized PRG/BIN files
- **SID Export**: Complete SID file generation with player code
- **Merge-Load**: Import patterns/instruments into existing song

#### 7. Optimization Features
- **Pattern Optimization**: Remove duplicate patterns
- **Table Optimization**: Deduplicate table segments
- **Optimize Musicdata**: Compress and pack song data
- **Pattern Splitting**: SNGSPLI2-style pattern division

---

## Architecture Comparison

### Current SID Tracker vs Full GT2

| Feature | SID Tracker | GoatTracker2 | Gap |
|---------|-------------|--------------|-----|
| **Pattern System** | ✅ 208 single-voice patterns | ✅ 208 single-voice patterns | None |
| **Table System** | ✅ All 4 tables (WTBL/PTBL/FTBL/STBL) | ✅ All 4 tables | None |
| **Pattern Commands** | ❌ 0 commands | ✅ 16 commands (0XY-FXY) | **CRITICAL** |
| **Editing Features** | ⚠️ Basic | ✅ Advanced (transpose, join, split) | Major |
| **Keyboard Modes** | ⚠️ One mode | ✅ 3 modes (Protracker/DMC/Janko) | Medium |
| **Orderlist Commands** | ⚠️ LOOP/END only | ✅ LOOP/END/TRANSPOSE/REPEAT | Medium |
| **File I/O** | ✅ Import .sng | ✅ Import/Export .sng/.ins | Medium |
| **Optimization** | ❌ None | ✅ Pattern/table/data optimization | Major |
| **Playback Modes** | ⚠️ Basic | ✅ Follow play, pattern play, multispeed | Medium |
| **Instrument Features** | ⚠️ Basic tables | ✅ Vibrato delay, HR/Gate timer | Medium |

---

## Implementation Roadmap

### Phase 1: Pattern Commands (4-6 weeks)
**Priority: CRITICAL - Nothing else matters until this is done**

#### Week 1-2: Realtime Commands (1XY-4XY)
- **1XY**: Portamento up
  - Read speedtable entry (16-bit value)
  - Add to frequency each tick
  - Stop on 0XY or new note

- **2XY**: Portamento down
  - Read speedtable entry (16-bit value)
  - Subtract from frequency each tick

- **3XY**: Toneportamento
  - Calculate frequency difference to target note
  - Approach target using speedtable speed
  - Special case: 3 00 = instant tie-note

- **4XY**: Vibrato
  - Read speedtable (left=speed, right=depth)
  - Triangle wave modulation
  - Track vibrato phase per voice
  - Note-independent mode ($80 high bit)

**Testing**: Verify all realtime commands work with speedtable, interact correctly

#### Week 3: One-Shot Commands (5XY-7XY)
- **5XY**: Set attack/decay register
- **6XY**: Set sustain/release register
- **7XY**: Set waveform register
- Ensure these don't interrupt realtime commands

#### Week 4: Table Pointer Commands (8XY-AXY)
- **8XY**: Set wavetable pointer (00 = stop)
- **9XY**: Set pulsetable pointer (00 = stop)
- **AXY**: Set filtertable pointer (00 = stop)
- Integration with existing table system

#### Week 5: Filter Commands (BXY-CXY)
- **BXY**: Set filter control
  - X = resonance (0-F)
  - Y = channel bitmask (0-7)
  - 00 = disable filter and stop filtertable
- **CXY**: Set filter cutoff

#### Week 6: System Commands (DXY-FXY)
- **DXY**: Master volume / timing mark
- **EXY**: Funktempo (alternating tempo)
- **FXY**: Set tempo (global or per-channel)

**Deliverable**: All 16 pattern commands working correctly

---

### Phase 2: Advanced Editing (3-4 weeks)

#### Week 1: Pattern Editing
- Transpose functions (halfstep, octave)
- Shrink/expand pattern
- Mark/copy/paste with selection
- Invert selection
- Clear commands

#### Week 2: Table Editing
- Limit-to-time conversion (SHIFT+L)
- Negate speed (SHIFT+N)
- Transpose speedtable portamento
- Convert absolute/relative notes
- Table optimization

#### Week 3: Orderlist Editing
- TRANSPOSE command (+/-)
- REPEAT command (R)
- Swap channel orderlists
- Mark/copy/paste orderlist sections

#### Week 4: Pattern Operations
- Join patterns (merge with next)
- Split pattern from cursor
- Rearrange pattern numbers
- Smart paste instruments

**Deliverable**: Full editing capabilities matching GT2

---

### Phase 3: Keyboard and Input (2 weeks)

#### Week 1: Keyboard Modes
- Protracker mode (two-row piano)
- DMC mode (one-row + octave numbers)
- Janko mode (alternative layout)
- Mode switching (/K0, /K1, /K2)

#### Week 2: Auto-advance Modes
- GREEN: Advance on notes & data
- YELLOW: Advance on notes only (DMC)
- RED: No auto-advance
- Jam mode vs Edit mode
- Visual mode indicators

**Deliverable**: All 3 keyboard modes with proper auto-advance

---

### Phase 4: Playback Features (2 weeks)

#### Week 1: Advanced Playback
- Follow play mode (auto-scroll)
- Pattern play mode (F3 - loop single pattern)
- Multispeed support (1x, 2x, 4x, 8x)
- Per-channel tempo (FXY with $80+)

#### Week 2: Playback Optimization
- Realtime optimization (/R0 toggle)
- Pulse optimization (/O0 toggle)
- Gatebit masking (key-on/key-off interaction)
- Hard restart timing

**Deliverable**: Complete playback feature parity

---

### Phase 5: File I/O and Export (2-3 weeks)

#### Week 1: Export Capabilities
- GT2 .sng export (save in native GT2 format)
- GT2 .ins export (individual instruments)
- Proper file format writing

#### Week 2: SID Export
- Complete SID file generation
- Player code embedding
- Packed/relocated format
- PRG/BIN export

#### Week 3: Import Enhancements
- Merge-load functionality
- Import instruments only
- Import patterns only
- Legacy v1.xx support

**Deliverable**: Complete file I/O matching GT2

---

### Phase 6: Optimization and Utilities (2 weeks)

#### Week 1: Data Optimization
- Pattern deduplication
- Table optimization
- Remove unused entries
- Pattern splitting utility

#### Week 2: Additional Tools
- Optimize musicdata function
- Calculate optimal pattern lengths
- Memory usage display
- Rastertime estimation

**Deliverable**: Full optimization toolkit

---

### Phase 7: UI Polish and Completion (2 weeks)

#### Week 1: GT2-Style UI
- Classic GT2 screen layout
- Status bar with mode indicators
- Context-sensitive help (F12)
- Online help system

#### Week 2: Final Polish
- Keyboard command help
- Modal dialogs for operations
- Save/load confirmation
- Error handling and validation

**Deliverable**: Complete GT2-style user interface

---

## Total Implementation Time Estimate

**Minimum**: 17 weeks (4 months)
**Realistic**: 22 weeks (5.5 months)
**With testing & polish**: 26 weeks (6.5 months)

---

## Technical Architecture

### Core Modules to Create/Extend

#### 1. `pattern-commands.js` (NEW)
```javascript
export class PatternCommandEngine {
    constructor() {
        this.voiceStates = []; // Per-voice command state
        this.speedtable = null;
    }

    // Execute command at current tick
    executeCommand(voice, command, data, tick) {
        switch (command) {
            case 0x0: return this.cmd0_doNothing(voice, data);
            case 0x1: return this.cmd1_portamentoUp(voice, data, tick);
            case 0x2: return this.cmd2_portamentoDown(voice, data, tick);
            // ... etc for all 16 commands
        }
    }

    // Realtime commands (1-4)
    cmd1_portamentoUp(voice, speedtableIndex, tick) { ... }
    cmd2_portamentoDown(voice, speedtableIndex, tick) { ... }
    cmd3_toneportamento(voice, speedtableIndex, tick) { ... }
    cmd4_vibrato(voice, speedtableIndex, tick) { ... }

    // One-shot commands (5-7)
    cmd5_setADSR(voice, value) { ... }
    cmd6_setSustainRelease(voice, value) { ... }
    cmd7_setWaveform(voice, value) { ... }

    // Table pointer commands (8-A)
    cmd8_setWavetablePtr(voice, ptr) { ... }
    cmd9_setPulsetablePtr(voice, ptr) { ... }
    cmdA_setFiltertablePtr(voice, ptr) { ... }

    // Filter commands (B-C)
    cmdB_setFilterControl(voice, value) { ... }
    cmdC_setFilterCutoff(voice, value) { ... }

    // System commands (D-F)
    cmdD_setMasterVolume(voice, value) { ... }
    cmdE_funktempo(voice, speedtableIndex) { ... }
    cmdF_setTempo(voice, value) { ... }
}
```

#### 2. `editing-operations.js` (NEW)
```javascript
export class EditingOperations {
    // Pattern operations
    transposePattern(patternIndex, semitones) { ... }
    shrinkPattern(patternIndex) { ... }
    expandPattern(patternIndex) { ... }
    joinPatterns(patternIndex, nextPatternIndex) { ... }
    splitPattern(patternIndex, row) { ... }

    // Table operations
    convertLimitToTime(tableType, position) { ... }
    negateSpeed(tableType, position) { ... }
    transposePortamento(tableType, position, semitones) { ... }

    // Selection operations
    markSelection(startRow, endRow, voice) { ... }
    copySelection() { ... }
    pasteSelection() { ... }
    invertSelection() { ... }
}
```

#### 3. `keyboard-modes.js` (NEW)
```javascript
export class KeyboardModeManager {
    constructor() {
        this.mode = 'protracker'; // protracker, dmc, janko
        this.autoAdvanceMode = 'green'; // green, yellow, red
        this.jamMode = false;
    }

    setMode(mode) { ... }
    setAutoAdvance(mode) { ... }
    handleKeyPress(key, octave) { ... }

    // Mode-specific key mappings
    protrackerKeyMap = { ... };
    dmcKeyMap = { ... };
    jankoKeyMap = { ... };
}
```

#### 4. `file-export.js` (EXTEND)
```javascript
export class GT2FileExporter {
    // Export complete .sng file
    exportSNG(song) { ... }

    // Export individual instrument
    exportINS(instrument) { ... }

    // Pack and relocate
    packAndRelocate(song, options) {
        // Generate optimized PRG/BIN/SID
        this.optimizePatterns(song);
        this.optimizeTables(song);
        this.generatePlayerCode();
        return this.assembleBinary();
    }
}
```

#### 5. `optimization.js` (NEW)
```javascript
export class MusicDataOptimizer {
    optimizePatterns(song) {
        // Remove duplicate patterns
        // Update orderlist references
    }

    optimizeTables(song) {
        // Deduplicate table segments
        // Update instrument pointers
    }

    splitPatterns(song, targetLength) {
        // SNGSPLI2-style pattern division
    }

    calculateMemoryUsage(song) {
        // Estimate packed size
    }
}
```

---

## Testing Strategy

### Unit Tests
- Pattern command execution (each command individually)
- Table operations (convert, negate, transpose)
- Editing operations (transpose, join, split)
- File I/O (import/export round-trip)

### Integration Tests
- Command interaction (realtime + one-shot)
- Pattern + table coordination
- Order list playback with commands
- Multi-voice synchronization

### Compatibility Tests
- Import existing GT2 songs
- Verify identical playback
- Export and re-import
- Compare with C64 output (using SID file export)

### Performance Tests
- 50Hz table execution timing
- Command processing overhead
- Large song loading
- Real-time editing responsiveness

---

## Success Criteria

A **full JS GoatTracker2** implementation must:

1. ✅ **Import ANY GT2 .sng file** and play it identically
2. ✅ **Export .sng files** that load and play correctly in GT2
3. ✅ **Implement ALL 16 pattern commands** (0XY-FXY)
4. ✅ **Support ALL table operations** (WTBL, PTBL, FTBL, STBL)
5. ✅ **Provide ALL editing features** (transpose, join, split, etc.)
6. ✅ **Offer ALL 3 keyboard modes** (Protracker/DMC/Janko)
7. ✅ **Generate working SID files** with player code
8. ✅ **Optimize and pack songs** like GT2RELOC
9. ✅ **Match GT2 UI workflow** (jam mode, follow play, etc.)
10. ✅ **Pass compatibility test suite** (import GT2 songs, verify playback)

---

## Challenges and Considerations

### 1. Pattern Command Complexity
- Commands interact (realtime + one-shot)
- Tick-based execution requires careful timing
- Speedtable lookups must be fast
- State tracking per voice

### 2. Playback Accuracy
- Must match C64 timing exactly (50Hz PAL)
- ADSR bugs and hard restart timing
- Gatebit masking complexity
- Filter behavior differences (6581 vs 8580)

### 3. File Format Precision
- Binary .sng format must be exact
- Table optimization must preserve behavior
- Pattern packing must not break songs
- Version compatibility (GTS3/GTS4/GTS5)

### 4. UI Responsiveness
- Real-time editing during playback
- Follow play auto-scroll
- Keyboard input lag
- Large song handling

### 5. Browser Limitations
- AudioWorklet threading constraints
- File system access (Web File API)
- Memory limits for large songs
- Cross-browser compatibility

---

## Recommended Approach

### Start Here (Most Impact)
1. **Pattern Commands (Phase 1)** - Absolutely critical foundation
2. **Testing with GT2 songs** - Verify command implementation
3. **Advanced editing (Phase 2)** - Makes it usable for composition
4. **File export (Phase 5)** - Enables sharing and compatibility

### Can Wait
- Keyboard modes (Phase 3) - Nice to have, not essential
- Optimization tools (Phase 6) - Useful but not blocking
- UI polish (Phase 7) - Can be incremental

### Priority Order
1. **Commands (1XY-FXY)** ← START HERE
2. **Export .sng files** ← COMPATIBILITY
3. **Advanced editing** ← USABILITY
4. **SID export** ← DISTRIBUTION
5. Everything else

---

## Conclusion

The current **SID Tracker** has an excellent foundation with:
- ✅ Complete table system (WTBL/PTBL/FTBL/STBL)
- ✅ GT2 .sng import
- ✅ Per-voice patterns and order lists
- ✅ Frame-based playback engine

The **critical gap** is the **pattern command system**. Without commands 0XY-FXY, imported GT2 songs play only the notes, missing:
- Portamento effects
- Vibrato
- Filter sweeps
- Tempo changes
- And all dynamic effects

**Implementing the 16 pattern commands is the highest priority** and will take approximately **6 weeks of focused development**. Once commands work, the remaining features (editing, export, optimization) are straightforward enhancements.

**Total realistic timeline: 22-26 weeks (5.5-6.5 months)** for a complete, production-ready JS GoatTracker2 implementation.

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Prioritize phases** based on project goals
3. **Set up testing infrastructure** (GT2 song library for validation)
4. **Begin Phase 1: Pattern Commands** (Week 1-2: Realtime commands)
5. **Establish compatibility benchmarks** (which GT2 songs should work)

---

*Document Version: 1.0*
*Date: 2025-11-02*
*Author: Analysis of SID Tracker codebase vs GoatTracker2 reference implementation*
