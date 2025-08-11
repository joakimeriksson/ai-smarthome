// synth.js

// SID Register Offsets
const FREQ_LO = 0x00;
const FREQ_HI = 0x01;
const PULSE_LO = 0x02;
const PULSE_HI = 0x03;
const CONTROL = 0x04;
const ATTACK_DECAY = 0x05;
const SUSTAIN_RELEASE = 0x06;

// Voice 0 registers start at 0x00, Voice 1 at 0x07, Voice 2 at 0x0E
const VOICE_OFFSET = 0x07;

// SID Clock Frequency - use the value from the initialized SIDPlayer
const getSIDClockFreq = () => {
    if (sidPlayer && sidPlayer.clock) {
        return sidPlayer.clock;
    }
    return jsSID?.chip?.clock?.PAL || 985248; // Fallback to PAL frequency
};

// Waveform Constants (from SID documentation)
const WAVE_TRIANGLE = 0x10;
const WAVE_SAWTOOTH = 0x20;
const WAVE_PULSE = 0x40;
const WAVE_NOISE = 0x80;

// Control register bit flags
const CTRL_GATE = 0x01;        // Gate bit
const CTRL_SYNC = 0x02;        // Sync bit
const CTRL_RING_MOD = 0x04;    // Ring modulation bit
const CTRL_TEST = 0x08;        // Test bit (usually not used)

// Instrument Presets
export const instruments = [
    { name: "Lead (Tri)", waveform: WAVE_TRIANGLE, ad: 0x0F, sr: 0xFE, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Bass (Pulse)", waveform: WAVE_PULSE, ad: 0x0F, sr: 0x8C, pulseWidth: 0x0400, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Pad (Saw)", waveform: WAVE_SAWTOOTH, ad: 0x88, sr: 0xAF, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Perc (Noise)", waveform: WAVE_NOISE, ad: 0x01, sr: 0x01, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "PWM Test", waveform: WAVE_PULSE, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: true, freq: 5, depth: 0.5 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "FM Test", waveform: WAVE_TRIANGLE, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: true, freq: 3, depth: 0.1 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Sync Lead", waveform: WAVE_SAWTOOTH, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: true, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Ring Mod", waveform: WAVE_TRIANGLE, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: true, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
    { name: "Arp Major", waveform: WAVE_TRIANGLE, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: true, notes: [0, 4, 7], speed: 8 } },
    { name: "Custom", waveform: WAVE_TRIANGLE, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, pwmLFO: { enabled: false, freq: 0, depth: 0 }, fmLFO: { enabled: false, freq: 0, depth: 0 }, sync: false, ringMod: false, arpeggio: { enabled: false, notes: [0, 4, 7], speed: 4 } },
];

export let sidPlayer; // Declare sidPlayer globally
export let audioContext; // Web Audio API AudioContext
export let scriptProcessor; // ScriptProcessorNode

// LFO phase tracking for each voice (PWM and FM)
export const lfoPhase = Array(3).fill(null).map(() => ({ pwm: 0, fm: 0 }));

// Track LFO update timing
let lastLFOUpdate = 0;

// Explicitly define jsSID.synth and register tinysid
jsSID.synth = {};
jsSID.synth.tinysid = {
    desc: "TinySID",
    class: "TinySID",
    opts: {}
};

export function initSynth() {
    console.log("Attempting to initialize jsSID.SIDPlayer and AudioContext...");
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Make audioContext globally available
    window.audioContext = audioContext;
    
    console.log(`Audio context sample rate: ${audioContext.sampleRate} Hz`);
    
    sidPlayer = new jsSID.SIDPlayer({ 
        quality: jsSID.quality.low, 
        clock: jsSID.chip.clock.PAL,
        model: jsSID.chip.model.MOS6581,
        sampleRate: audioContext.sampleRate 
    });
    
    console.log("SIDPlayer initialized with:", sidPlayer);
    
    // Create a ScriptProcessorNode to generate audio samples
    // Buffer size: 2048, 2 input channels, 2 output channels
    scriptProcessor = audioContext.createScriptProcessor(2048, 0, 2);
    scriptProcessor.onaudioprocess = (event) => {
        const leftChannel = event.outputBuffer.getChannelData(0);
        const rightChannel = event.outputBuffer.getChannelData(1);
        const samples = leftChannel.length;

        // Generate samples using jsSID.TinySID
        const generatedSamples = sidPlayer.synth.generate(samples);

        for (let i = 0; i < samples; i++) {
            leftChannel[i] = generatedSamples[i];
            rightChannel[i] = generatedSamples[i]; // Mono output for now
        }
    };

    // Connect the ScriptProcessorNode to the audio context destination
    scriptProcessor.connect(audioContext.destination);

    console.log("AudioContext and ScriptProcessorNode set up.");
    sidPlayer.synth.poke(0x18, 0x0F); // Set master volume to max (15)
    console.log("Master volume set to 15.");
}

export function hzToSid(frequencyHz) {
    // SID frequency register formula: freq_reg = (desired_freq * 16777216) / clock_freq
    // 16777216 = 2^24 (24-bit accumulator)
    const clockFreq = getSIDClockFreq();
    const result = Math.round((frequencyHz * 16777216) / clockFreq);
    return Math.max(0, Math.min(65535, result)); // Clamp to 16-bit range
}

export function setSIDRegister(voice, register, value) {
    if (sidPlayer && sidPlayer.synth) {
        const regAddress = (voice * VOICE_OFFSET) + register;
        sidPlayer.synth.poke(regAddress, value);
    }
}

export function stopVoice(voice) {
    // Stop a specific voice by clearing its GATE bit
    if (sidPlayer && sidPlayer.synth) {
        const controlReg = (voice * VOICE_OFFSET) + CONTROL;
        // Read current control register and clear GATE bit (bit 0)
        const currentControl = sidPlayer.synth.peek ? sidPlayer.synth.peek(controlReg) : 0;
        const newControl = currentControl & 0xFE; // Clear bit 0 (GATE)
        sidPlayer.synth.poke(controlReg, newControl);
        console.log(`Voice ${voice} stopped (GATE cleared)`);
    }
}

export function releaseVoice(voice, waveform = 0x10) {
    // Release a voice (clear GATE bit to trigger release phase of ADSR)
    if (sidPlayer && sidPlayer.synth) {
        const controlReg = (voice * VOICE_OFFSET) + CONTROL;
        // Set control register with waveform but without GATE bit
        // This should trigger the Release phase of the ADSR envelope
        sidPlayer.synth.poke(controlReg, waveform & 0xFE); // Ensure GATE bit (bit 0) is off
        console.log(`Voice ${voice} released (entering Release phase) with waveform 0x${waveform.toString(16)}`);
    }
}

export function stopAllVoices() {
    // Stop all three voices
    for (let voice = 0; voice < 3; voice++) {
        stopVoice(voice);
    }
}

export function playNote(voice, frequencyHz, duration, waveform, attackDecay, sustainRelease, pulseWidth = 0x0800, sync = false, ringMod = false) {
    const sidFrequency = hzToSid(frequencyHz);
    const clockFreq = getSIDClockFreq();
    
    console.log(`Playing voice ${voice}: ${frequencyHz.toFixed(2)} Hz -> SID freq: ${sidFrequency} (0x${sidFrequency.toString(16)}) using clock: ${clockFreq}`);

    // Set frequency
    setSIDRegister(voice, FREQ_LO, sidFrequency & 0xFF);
    setSIDRegister(voice, FREQ_HI, (sidFrequency >> 8) & 0xFF);

    // Set pulse width (for pulse waveform)
    setSIDRegister(voice, PULSE_LO, pulseWidth & 0xFF);
    setSIDRegister(voice, PULSE_HI, (pulseWidth >> 8) & 0x0F); // Only 4 bits for high byte

    // Set attack/decay
    setSIDRegister(voice, ATTACK_DECAY, attackDecay);

    // Set sustain/release
    setSIDRegister(voice, SUSTAIN_RELEASE, sustainRelease);

    // Build control register value
    let controlValue = waveform | CTRL_GATE; // Start with waveform and GATE
    
    if (sync) {
        controlValue |= CTRL_SYNC;
        console.log(`Voice ${voice}: Sync enabled`);
    }
    
    if (ringMod) {
        controlValue |= CTRL_RING_MOD;
        console.log(`Voice ${voice}: Ring modulation enabled`);
    }

    // Set control register
    setSIDRegister(voice, CONTROL, controlValue);

    // Note: The duration here is for how long the GATE is on. The actual step duration is handled by setInterval.
}

export function calculateTriangleLFO(phase, depth) {
    // Triangle wave: -1 to 1 to -1
    // Phase is 0-1
    let value;
    if (phase < 0.5) {
        // Rising edge: -1 to 1
        value = (phase * 4) - 1;
    } else {
        // Falling edge: 1 to -1
        value = 3 - (phase * 4);
    }
    return value * depth;
}

