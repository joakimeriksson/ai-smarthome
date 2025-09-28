// sid-exporter.js - Export SID Tracker projects to .sid format
import { Assembler } from './jsSID/js/6502asm.js';
import { instruments } from './synth.js';
import { patternManager } from './pattern-manager.js';
import { tempoControl } from './tempo-control.js';
import { downloadGoatTrackerASM } from './exporters/gt2/exporter-gt2.js';

class SIDExporter {
    constructor() {
        this.loadAddress = 0x1000;
        this.initAddress = 0x1000;
        this.playAddress = 0x1003;
    }
    
    /**
     * Export only data for GoatTracker replayer (assembly include)
     */
    exportGoatTrackerData(songTitle = "sid_tracker_song") {
        console.log("🎛️ Exporting GoatTracker data-only ASM...");
        downloadGoatTrackerASM(songTitle);
    }
    
    /**
     * Export current project as SID file
     */
    exportSID(songTitle = "SID Tracker Export", author = "SID Tracker User") {
        console.log("🎵 Starting SID export...");
        
        try {
            // Collect project data
            const songData = this.collectSongData();
            const musicData = this.convertToSIDFormat(songData);
            const playerCode = this.generatePlayerCode(musicData);
            const binary = this.assembleBinary(playerCode, musicData);
            const sidFile = this.createSIDFile(binary, songTitle, author);
            
            console.log("✅ SID export successful!");
            return sidFile;
            
        } catch (error) {
            console.error("❌ SID export failed:", error);
            throw error;
        }
    }
    
    /**
     * Collect current project data
     */
    collectSongData() {
        const currentPattern = patternManager.getCurrentPattern();
        const patternData = [];
        
        console.log(`📊 Collecting pattern data (length: ${currentPattern.length}):`);
        
        // Extract pattern data
        for (let step = 0; step < currentPattern.length; step++) {
            for (let voice = 0; voice < 3; voice++) {
                const stepData = currentPattern.getStepData(voice, step);
                if (stepData.note && stepData.note !== '') {
                    patternData.push({
                        step,
                        voice,
                        note: stepData.note,
                        instrument: stepData.instrument || 0
                    });
                    console.log(`  Step ${step}, Voice ${voice}: ${stepData.note} (Inst ${stepData.instrument || 0})`);
                }
            }
        }
        
        console.log(`📊 Found ${patternData.length} notes in pattern`);
        
        return {
            patterns: [patternData], // Currently export single pattern
            instruments: JSON.parse(JSON.stringify(instruments)),
            tempo: tempoControl.bpm,
            patternLength: currentPattern.length
        };
    }
    
    /**
     * Convert tracker data to SID-friendly format
     */
    convertToSIDFormat(songData) {
        const steps = new Array(songData.patternLength);
        
        // Initialize all steps
        for (let i = 0; i < songData.patternLength; i++) {
            steps[i] = {
                voices: [
                    { note: 0, freq: 0, waveform: 0, ad: 0, sr: 0, pw: 0 },
                    { note: 0, freq: 0, waveform: 0, ad: 0, sr: 0, pw: 0 },
                    { note: 0, freq: 0, waveform: 0, ad: 0, sr: 0, pw: 0 }
                ]
            };
        }
        
        // Fill in pattern data
        songData.patterns[0].forEach(entry => {
            if (entry.step < songData.patternLength) {
                const voice = steps[entry.step].voices[entry.voice];
                const instrument = songData.instruments[entry.instrument];
                
                if (entry.note === 'R') {
                    // Rest - gate off
                    voice.note = 0;
                    voice.freq = 0;
                    voice.waveform = 0;
                } else if (entry.note === '---') {
                    // Sustain - keep previous
                    // (handled by not overwriting)
                } else {
                    // Regular note
                    const freq = this.noteToSIDFreq(entry.note);
                    voice.note = 1;
                    voice.freq = freq;
                    voice.waveform = instrument.waveform | 0x01; // Add GATE bit
                    voice.ad = instrument.ad;
                    voice.sr = instrument.sr;
                    voice.pw = instrument.pulseWidth;
                }
            }
        });
        
        return {
            steps,
            patternLength: songData.patternLength,
            tempo: songData.tempo
        };
    }
    
    /**
     * Convert note string to SID frequency value
     */
    noteToSIDFreq(noteStr) {
        const noteMap = {
            'C-': 0, 'C#': 1, 'D-': 2, 'D#': 3, 'E-': 4, 'F-': 5,
            'F#': 6, 'G-': 7, 'G#': 8, 'A-': 9, 'A#': 10, 'B-': 11
        };
        
        if (noteStr.length < 3) return 0;
        
        const noteName = noteStr.substring(0, 2);
        const octave = parseInt(noteStr.charAt(2));
        
        if (!(noteName in noteMap) || isNaN(octave)) return 0;
        
        const noteNum = noteMap[noteName];
        const midiNote = (octave + 1) * 12 + noteNum;
        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        // Convert to SID frequency value
        const clockFreq = 985248; // PAL
        return Math.round((freq * 16777216) / clockFreq) & 0xFFFF;
    }
    
    /**
     * Generate 6502 player code
     */
    generatePlayerCode(musicData) {
        const code = [];
        
        code.push("PATTERN_LENGTH = " + musicData.patternLength);
        code.push("SID_BASE = $D400");
        
        // Init routine at $1000
        code.push("*= $1000");
        code.push("init:");
        code.push("    ldx #$00");
        code.push("    stx $D418");
        code.push("    ldx #$00");
        code.push("clear_sid:");
        code.push("    lda #$00");
        code.push("    sta $D400,x");
        code.push("    inx");
        code.push("    cpx #$19");
        code.push("    bne clear_sid");
        code.push("    lda #$0F");
        code.push("    sta $D418");
        code.push("    lda #$00");
        code.push("    sta step_counter");
        code.push("    rts");
        
        // Play routine at $1003
        code.push("*= $1003");
        code.push("play:");
        code.push("    lda step_counter");
        code.push("    cmp #PATTERN_LENGTH");
        code.push("    bne play_step");
        code.push("    lda #$00");
        code.push("    sta step_counter");
        code.push("play_step:");
        code.push("    ldx step_counter");
        code.push("    lda freq_table_lo,x");
        code.push("    sta $D400");
        code.push("    lda freq_table_hi,x");
        code.push("    sta $D401");
        code.push("    lda ad_table_0,x");
        code.push("    sta $D405");
        code.push("    lda sr_table_0,x");
        code.push("    sta $D406");
        code.push("    lda pw_lo_table_0,x");
        code.push("    sta $D402");
        code.push("    lda pw_hi_table_0,x");
        code.push("    sta $D403");
        code.push("    lda wave_table_0,x");
        code.push("    sta $D404");
        code.push("    lda freq_table_lo + " + musicData.patternLength + ",x");
        code.push("    sta $D407");
        code.push("    lda freq_table_hi + " + musicData.patternLength + ",x");
        code.push("    sta $D408");
        code.push("    lda ad_table_1,x");
        code.push("    sta $D40C");
        code.push("    lda sr_table_1,x");
        code.push("    sta $D40D");
        code.push("    lda pw_lo_table_1,x");
        code.push("    sta $D409");
        code.push("    lda pw_hi_table_1,x");
        code.push("    sta $D40A");
        code.push("    lda wave_table_1,x");
        code.push("    sta $D40B");
        code.push("    lda freq_table_lo + " + (musicData.patternLength * 2) + ",x");
        code.push("    sta $D40E");
        code.push("    lda freq_table_hi + " + (musicData.patternLength * 2) + ",x");
        code.push("    sta $D40F");
        code.push("    lda ad_table_2,x");
        code.push("    sta $D413");
        code.push("    lda sr_table_2,x");
        code.push("    sta $D414");
        code.push("    lda pw_lo_table_2,x");
        code.push("    sta $D410");
        code.push("    lda pw_hi_table_2,x");
        code.push("    sta $D411");
        code.push("    lda wave_table_2,x");
        code.push("    sta $D412");
        code.push("    inc step_counter");
        code.push("    rts");
        
        code.push("step_counter: .byte $00");
        
        // Generate frequency tables
        const freqLo = [], freqHi = [];
        for (let voice = 0; voice < 3; voice++) {
            for (let step = 0; step < musicData.patternLength; step++) {
                const freq = musicData.steps[step].voices[voice].freq;
                freqLo.push("$" + (freq & 0xFF).toString(16).padStart(2, '0').toUpperCase());
                freqHi.push("$" + ((freq >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase());
            }
        }
        
        code.push("freq_table_lo:");
        code.push("    .byte " + freqLo.join(", "));
        code.push("freq_table_hi:");
        code.push("    .byte " + freqHi.join(", "));
        code.push("");
        
        // Generate waveform tables
        for (let voice = 0; voice < 3; voice++) {
            const waveData = [];
            for (let step = 0; step < musicData.patternLength; step++) {
                const wave = musicData.steps[step].voices[voice].waveform;
                waveData.push("$" + wave.toString(16).padStart(2, '0').toUpperCase());
            }
            code.push(`wave_table_${voice}:`);
            code.push("    .byte " + waveData.join(", "));
        }

        // Generate instrument tables
        for (let voice = 0; voice < 3; voice++) {
            const adData = [], srData = [], pwLoData = [], pwHiData = [];
            for (let step = 0; step < musicData.patternLength; step++) {
                const ad = musicData.steps[step].voices[voice].ad;
                const sr = musicData.steps[step].voices[voice].sr;
                const pw = musicData.steps[step].voices[voice].pw;
                adData.push("$" + ad.toString(16).padStart(2, '0').toUpperCase());
                srData.push("$" + sr.toString(16).padStart(2, '0').toUpperCase());
                pwLoData.push("$" + (pw & 0xFF).toString(16).padStart(2, '0').toUpperCase());
                pwHiData.push("$" + ((pw >> 8) & 0xFF).toString(16).padStart(2, '0').toUpperCase());
            }
            code.push(`ad_table_${voice}:`);
            code.push("    .byte " + adData.join(", "));
            code.push(`sr_table_${voice}:`);
            code.push("    .byte " + srData.join(", "));
            code.push(`pw_lo_table_${voice}:`);
            code.push("    .byte " + pwLoData.join(", "));
            code.push(`pw_hi_table_${voice}:`);
            code.push("    .byte " + pwHiData.join(", "));
        }
        
        return code.join("\n");
    }
    
    /**
     * Assemble code to binary
     */
    assembleBinary(code, musicData) {
        try {
            const asm = new Assembler();
            const result = asm.assemble(code);
            const objectCode = new Uint8Array(result.objectCode);
            console.log("✅ Assembled binary successfully!");
            return objectCode;
        } catch (error) {
            console.error("❌ Assembler error:", error);
            throw error;
        }
    }
    
    /**
     * Create complete SID file with header
     */
    createSIDFile(binary, title, author) {
        const header = new Uint8Array(126); // Standard PSID header size
        let pos = 0;
        
        // Magic "PSID"
        header[pos++] = 0x50; // P
        header[pos++] = 0x53; // S
        header[pos++] = 0x49; // I
        header[pos++] = 0x44; // D
        
        // Version (2 bytes, big-endian)
        header[pos++] = 0x00;
        header[pos++] = 0x02;
        
        // Data offset (2 bytes, big-endian) - header is 126 bytes
        header[pos++] = 0x00;
        header[pos++] = 0x7E;
        
        // Load address (2 bytes, big-endian)
        header[pos++] = (this.loadAddress >> 8) & 0xFF;
        header[pos++] = this.loadAddress & 0xFF;
        
        // Init address (2 bytes, big-endian)
        header[pos++] = (this.initAddress >> 8) & 0xFF;
        header[pos++] = this.initAddress & 0xFF;
        
        // Play address (2 bytes, big-endian)
        header[pos++] = (this.playAddress >> 8) & 0xFF;
        header[pos++] = this.playAddress & 0xFF;
        
        // Number of songs (2 bytes, big-endian)
        header[pos++] = 0x00;
        header[pos++] = 0x01;
        
        // Start song (2 bytes, big-endian)
        header[pos++] = 0x00;
        header[pos++] = 0x01;
        
        // Speed (4 bytes, big-endian) - use CIA timer
        header[pos++] = 0x00;
        header[pos++] = 0x00;
        header[pos++] = 0x00;
        header[pos++] = 0x00;
        
        // Name (32 bytes, null-terminated)
        const nameBytes = new TextEncoder().encode(title.substring(0, 31));
        for (let i = 0; i < 32; i++) {
            header[pos++] = i < nameBytes.length ? nameBytes[i] : 0;
        }
        
        // Author (32 bytes, null-terminated)
        const authorBytes = new TextEncoder().encode(author.substring(0, 31));
        for (let i = 0; i < 32; i++) {
            header[pos++] = i < authorBytes.length ? authorBytes[i] : 0;
        }
        
        // Released (32 bytes, null-terminated)
        const year = new Date().getFullYear().toString();
        const yearBytes = new TextEncoder().encode(year);
        for (let i = 0; i < 32; i++) {
            header[pos++] = i < yearBytes.length ? yearBytes[i] : 0;
        }
        
        // Flags (2 bytes) - basic PSID
        header[pos++] = 0x00;
        header[pos++] = 0x00;
        
        // Reserved fields
        while (pos < 126) {
            header[pos++] = 0x00;
        }
        
        // SID files need the load address as the first 2 bytes of the binary data
        const binaryWithLoadAddr = new Uint8Array(binary.length + 2);
        binaryWithLoadAddr[0] = this.loadAddress & 0xFF;        // Low byte
        binaryWithLoadAddr[1] = (this.loadAddress >> 8) & 0xFF; // High byte
        binaryWithLoadAddr.set(binary, 2); // Copy binary data after load address
        
        // Combine header and binary data (with load address)
        const sidFile = new Uint8Array(header.length + binaryWithLoadAddr.length);
        sidFile.set(header, 0);
        sidFile.set(binaryWithLoadAddr, header.length);
        
        console.log(`📁 SID file created: ${sidFile.length} bytes total`);
        console.log(`📁 Load address in file: $${binaryWithLoadAddr[1].toString(16).padStart(2,'0')}${binaryWithLoadAddr[0].toString(16).padStart(2,'0')}`);
        
        return sidFile;
    }
    
    /**
     * Download SID file
     */
    downloadSID(songTitle = "sid-tracker-export") {
        try {
            const sidData = this.exportSID(songTitle, "SID Tracker User");
            const blob = new Blob([sidData], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${songTitle.replace(/[^a-zA-Z0-9-_]/g, '_')}.sid`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            console.log(`✅ SID file downloaded: ${a.download}`);
            
        } catch (error) {
            console.error("❌ Failed to download SID file:", error);
            alert("Failed to export SID file. Check console for details.");
        }
    }
}

// Create global instance
export const sidExporter = new SIDExporter();

// Make it globally available
if (typeof window !== 'undefined') {
    window.sidExporter = sidExporter;
}
