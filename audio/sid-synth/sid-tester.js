// sid-tester.js - Test exported SID files using jsSID
import { sidExporter } from './sid-exporter.js';

class SIDTester {
    constructor() {
        this.testPlayer = null;
        this.currentSIDFile = null;
        this.isTestPlaying = false;
    }
    
    /**
     * Initialize test player
     */
    initTestPlayer() {
        if (this.testPlayer) {
            this.stopTest();
        }
        
        console.log("🧪 Initializing SID test player...");
        console.log("jsSID available:", typeof jsSID !== 'undefined');
        console.log("pico available:", typeof pico !== 'undefined');
        
        if (typeof jsSID === 'undefined') {
            throw new Error("jsSID library not loaded");
        }
        
        if (typeof pico === 'undefined') {
            throw new Error("pico.js audio library not available");
        }
        
        console.log("pico environment:", pico.env);
        console.log("pico sample rate:", pico.samplerate);
        
        // Create SID player - it will use pico.js internally
        this.testPlayer = new jsSID.SIDPlayer({ 
            quality: jsSID.quality.low, 
            clock: jsSID.chip.clock.PAL,
            model: jsSID.chip.model.MOS6581
        });
        
        console.log("✅ SID test player initialized");
        console.log("Player object:", this.testPlayer);
    }
    
    /**
     * Test current project by exporting and playing as SID
     */
    async testCurrentProject() {
        try {
            console.log("🧪 Testing current project as SID file...");
            
            // Export current project as SID data
            const sidData = sidExporter.exportSID("Test Export", "SID Tracker Test");
            
            // Load the SID data into test player
            await this.loadAndPlaySID(sidData);
            
        } catch (error) {
            console.error("❌ Failed to test SID export:", error);
            alert("Failed to test SID export. Check console for details.");
        }
    }
    
    /**
     * Load and play SID data
     */
    async loadAndPlaySID(sidData) {
        if (!this.testPlayer) {
            this.initTestPlayer();
        }
        
        console.log("📀 Loading SID data for testing...");
        
        // Convert Uint8Array to string format expected by jsSID
        let sidString = '';
        for (let i = 0; i < sidData.length; i++) {
            sidString += String.fromCharCode(sidData[i]);
        }
        
        console.log(`SID data converted to string: ${sidString.length} bytes`);
        
        // Load SID file into test player using the proper jsSID method
        // This automatically creates the SIDFile object and initializes everything
        this.testPlayer.loadFileFromData(sidString);
        
        // Get the loaded SID file for debugging
        this.currentSIDFile = this.testPlayer.getSidFile();
        
        if (!this.currentSIDFile) {
            throw new Error("Failed to load SID file - no SIDFile created");
        }
        
        console.log("📀 SID file loaded:");
        console.log(`  Title: ${this.currentSIDFile.name}`);
        console.log(`  Author: ${this.currentSIDFile.author}`);
        console.log(`  Published: ${this.currentSIDFile.published}`);
        console.log(`  Load Address: $${this.currentSIDFile.load_addr.toString(16).toUpperCase()}`);
        console.log(`  Init Address: $${this.currentSIDFile.init_addr.toString(16).toUpperCase()}`);
        console.log(`  Play Address: $${this.currentSIDFile.play_addr.toString(16).toUpperCase()}`);
        console.log(`  Data Offset: $${this.currentSIDFile.data_offset.toString(16).toUpperCase()}`);
        console.log(`  Speed: ${this.currentSIDFile.speed} (0=50Hz, 1=100Hz)`);
        console.log(`  Subsongs: ${this.currentSIDFile.subsongs + 1}`);
        console.log(`  Current song: ${this.currentSIDFile.currentsong}`);
        
        // Debug the 6502 memory to see if our code was loaded correctly
        console.log("🔍 Debugging 6502 memory at init address:");
        const cpu = this.testPlayer.cpu;
        if (cpu && cpu.mem) {
            const initAddr = this.currentSIDFile.init_addr;
            console.log(`  Memory at $${initAddr.toString(16)}: $${cpu.mem[initAddr].toString(16).padStart(2, '0')}`);
            console.log(`  Memory at $${(initAddr+1).toString(16)}: $${cpu.mem[initAddr+1].toString(16).padStart(2, '0')}`);
            console.log(`  Memory at $${(initAddr+2).toString(16)}: $${cpu.mem[initAddr+2].toString(16).padStart(2, '0')}`);
            console.log(`  Memory at $${(initAddr+3).toString(16)}: $${cpu.mem[initAddr+3].toString(16).padStart(2, '0')}`);
            
            console.log("🔍 SID registers after init:");
            console.log(`  $D400 (freq lo): $${cpu.mem[0xD400].toString(16).padStart(2, '0')}`);
            console.log(`  $D401 (freq hi): $${cpu.mem[0xD401].toString(16).padStart(2, '0')}`);
            console.log(`  $D404 (control): $${cpu.mem[0xD404].toString(16).padStart(2, '0')}`);
            console.log(`  $D405 (att/dec): $${cpu.mem[0xD405].toString(16).padStart(2, '0')}`);
            console.log(`  $D406 (sus/rel): $${cpu.mem[0xD406].toString(16).padStart(2, '0')}`);
            console.log(`  $D418 (volume):  $${cpu.mem[0xD418].toString(16).padStart(2, '0')}`);
        }
        
        // Check if there's actual data in memory
        let hasData = false;
        for (let i = this.currentSIDFile.load_addr; i < this.currentSIDFile.load_addr + 100; i++) {
            if (this.currentSIDFile.mem[i] !== 0) {
                hasData = true;
                break;
            }
        }
        console.log(`  Has non-zero data in memory: ${hasData}`);
        
        // Check if player is ready (should be false after loadFileFromData)
        console.log(`Player ready state after load: ${this.testPlayer.ready}`);
        console.log(`Player finished state after load: ${this.testPlayer.finished}`);
        
        // Start playback (this will set ready=true and start audio generation)
        this.startTest();
        
        console.log("▶️ SID test playback started");
    }
    
    /**
     * Start SID test playback
     */
    async startTest() {
        if (!this.testPlayer) {
            console.error("No SID test player available");
            return;
        }
        
        console.log("Starting SID test (user interaction context)...");
        
        this.isTestPlaying = true;
        
        console.log("▶️ Starting SID playback...");
        console.log("Player ready before play:", this.testPlayer.ready);
        console.log("Player finished before play:", this.testPlayer.finished);
        console.log("pico.isPlaying before:", pico.isPlaying);
        console.log("pico.env:", pico.env);
        
        // Start playback using jsSID's built-in play method
        // This sets ready=true and calls pico.play(this)
        this.testPlayer.play();
        
        console.log("Player ready after play:", this.testPlayer.ready);
        console.log("Player finished after play:", this.testPlayer.finished);
        console.log("pico.isPlaying after:", pico.isPlaying);
        
        // Test if audio is actually being generated
        setTimeout(() => {
            console.log("Testing audio generation after 500ms...");
            const testBuffer = new Array(1024);
            const generated = this.testPlayer.generateIntoBuffer(1024, testBuffer, 0);
            
            let hasAudio = false;
            let maxSample = 0;
            for (let i = 0; i < testBuffer.length; i++) {
                if (testBuffer[i] !== 0) {
                    hasAudio = true;
                    maxSample = Math.max(maxSample, Math.abs(testBuffer[i]));
                }
            }
            
            console.log(`Audio generation test - Generated: ${generated}, Has audio: ${hasAudio}, Max: ${maxSample}`);
            console.log("pico.isPlaying (after 500ms):", pico.isPlaying);
        }, 500);
        
        // Update UI
        this.updateTestUI();
    }
    
    /**
     * Stop SID test playback
     */
    stopTest() {
        this.isTestPlaying = false;
        
        if (this.testPlayer) {
            this.testPlayer.stop();
        }
        
        console.log("⏹️ SID test stopped");
        console.log("pico.isPlaying after stop:", pico ? pico.isPlaying : 'pico not available');
        
        // Update UI
        this.updateTestUI();
    }
    
    /**
     * Update test UI elements
     */
    updateTestUI() {
        const testButton = document.getElementById('testSIDButton');
        if (testButton) {
            testButton.textContent = this.isTestPlaying ? 'Stop SID Test' : 'Test SID Export';
            testButton.style.backgroundColor = this.isTestPlaying ? '#A00' : '#050';
        }
        
        const testStatus = document.getElementById('testSIDStatus');
        if (testStatus) {
            if (this.isTestPlaying && this.currentSIDFile) {
                testStatus.textContent = `Testing: ${this.currentSIDFile.name}`;
                testStatus.style.display = 'block';
            } else {
                testStatus.style.display = 'none';
            }
        }
    }
    
    /**
     * Test an external SID file
     */
    async testSIDFile(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const sidData = new Uint8Array(arrayBuffer);
            
            await this.loadAndPlaySID(sidData);
            
        } catch (error) {
            console.error("❌ Failed to test SID file:", error);
            alert("Failed to test SID file. Check console for details.");
        }
    }
    
    /**
     * Test with a known good SID file first
     */
    async testKnownSID() {
        try {
            console.log("🧪 Testing with known good SID file...");
            
            // Try to load a known good SID file from jsSID's collection
            const response = await fetch('jsSID/sid/real/Monty_on_the_Run.sid');
            if (!response.ok) {
                throw new Error('Could not load test SID file');
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const sidData = new Uint8Array(arrayBuffer);
            
            console.log(`Loaded ${sidData.length} bytes from Monty_on_the_Run.sid`);
            
            await this.loadAndPlaySID(sidData);
            
        } catch (error) {
            console.error("❌ Failed to test known SID file:", error);
            // Fall back to testing current project
            this.testCurrentProject();
        }
    }
    
    /**
     * Toggle test playback
     */
    toggleTest() {
        if (this.isTestPlaying) {
            this.stopTest();
        } else {
            // Test the current project export
            this.testCurrentProject();
        }
    }
    
    /**
     * Get test status info
     */
    getTestInfo() {
        if (!this.currentSIDFile) {
            return "No SID file loaded";
        }
        
        return {
            name: this.currentSIDFile.name,
            author: this.currentSIDFile.author,
            published: this.currentSIDFile.published,
            loadAddr: this.currentSIDFile.load_addr,
            initAddr: this.currentSIDFile.init_addr,
            playAddr: this.currentSIDFile.play_addr,
            subsongs: this.currentSIDFile.subsongs,
            isPlaying: this.isTestPlaying
        };
    }
    
    /**
     * Cleanup resources
     */
    dispose() {
        this.stopTest();
        this.testPlayer = null;
        this.currentSIDFile = null;
    }
}

// Create global instance
export const sidTester = new SIDTester();

// Make it globally available
if (typeof window !== 'undefined') {
    window.sidTester = sidTester;
}