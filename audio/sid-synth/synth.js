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

// GT2-compatible instrument presets - only authentic GoatTracker2 parameters
// Format: name, waveform, ad (attack/decay), sr (sustain/release), pulseWidth, sync, ringMod, tables
// GT2 table pointers: 0 = no table, 1+ = table position (1-based)
export const instruments = [
    // GT2-compatible instruments with firstWave, gateTimer, vibratoDelay
    // firstWave: waveform|gate|sync|ringmod bits (0x11=tri+gate, 0x21=saw+gate, 0x41=pulse+gate, 0x81=noise+gate)
    // gateTimer: bits 0-5=timer, bit 6=no gate-off, bit 7=no hard restart
    { name: "Lead (Tri)", waveform: WAVE_TRIANGLE, firstWave: 0x11, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xFE, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Bass (Pulse)", waveform: WAVE_PULSE, firstWave: 0x41, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0x8C, pulseWidth: 0x0400, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Pad (Saw)", waveform: WAVE_SAWTOOTH, firstWave: 0x21, gateTimer: 0x02, vibratoDelay: 0, ad: 0x88, sr: 0xAF, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Perc (Noise)", waveform: WAVE_NOISE, firstWave: 0x81, gateTimer: 0x02, vibratoDelay: 0, ad: 0x01, sr: 0x01, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "GT2 Pulse", waveform: WAVE_PULSE, firstWave: 0x41, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "GT2 Tri", waveform: WAVE_TRIANGLE, firstWave: 0x11, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Sync Lead", waveform: WAVE_SAWTOOTH, firstWave: 0x23, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: true, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Ring Mod", waveform: WAVE_TRIANGLE, firstWave: 0x15, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: false, ringMod: true, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "GT2 Saw", waveform: WAVE_SAWTOOTH, firstWave: 0x21, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
    { name: "Custom", waveform: WAVE_TRIANGLE, firstWave: 0x11, gateTimer: 0x02, vibratoDelay: 0, ad: 0x0F, sr: 0xF8, pulseWidth: 0x0800, sync: false, ringMod: false, tables: { wave: 0, pulse: 0, filter: 0, speed: 0 } },
];

export let sidPlayer; // AudioWorklet mode only: placeholder object
export let audioContext; // Web Audio API AudioContext
let sidWorkletNode = null; // AudioWorkletNode
let useWorklet = false;
// Enable: we'll attempt to load the bundled worklet if present, otherwise fall back.
const ENABLE_AUDIO_WORKLET = true;
const workletReadyCallbacks = [];

// Mirror of SID registers for quick reads (peek substitute)
const sidRegs = new Uint8Array(0x20);
// Queue for register writes before worklet is ready
let pendingPokes = [];
// Fallback engine only: per-buffer gate ON scheduling (declared but only used
// when ScriptProcessor fallback is active)
let pendingGateRetriggers = [];

// UI helper: show a non-intrusive warning popup when AudioWorklet is unavailable
function showAudioWorkletWarning(detail) {
    try {
        if (typeof document === 'undefined') return; // not in browser context
        if (sessionStorage.getItem('sidAudioWorkletWarned') === '1') return; // only once per session
        sessionStorage.setItem('sidAudioWorkletWarned', '1');

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.left = '0';
        overlay.style.top = '0';
        overlay.style.right = '0';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.pointerEvents = 'none';

        const box = document.createElement('div');
        box.style.background = '#221';
        box.style.border = '1px solid #a55';
        box.style.color = '#f8d7da';
        box.style.padding = '10px 14px';
        box.style.margin = '10px auto';
        box.style.borderRadius = '6px';
        box.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
        box.style.fontSize = '14px';
        box.style.boxShadow = '0 2px 6px rgba(0,0,0,0.4)';
        box.style.pointerEvents = 'auto';

        const strong = document.createElement('div');
        strong.style.fontWeight = '600';
        strong.style.marginBottom = '4px';
        strong.textContent = 'AudioWorklet unavailable — using fallback audio engine';

        const msg = document.createElement('div');
        msg.textContent = 'Audio will still play, but timing may be less tight. ' + (detail ? `(${detail})` : '');

        const actions = document.createElement('div');
        actions.style.marginTop = '8px';

        const close = document.createElement('button');
        close.textContent = 'Dismiss';
        close.style.padding = '4px 8px';
        close.style.background = '#733';
        close.style.border = '1px solid #a55';
        close.style.color = '#fff';
        close.style.borderRadius = '4px';
        close.style.cursor = 'pointer';
        close.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        actions.appendChild(close);
        box.appendChild(strong);
        box.appendChild(msg);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
    } catch (e) {
        // As a last resort, fall back to alert (rare)
        try { alert('AudioWorklet unavailable — using fallback audio engine. Timing may be less tight.'); } catch (_) { }
    }
}

// Audio timing removed - handled in AudioWorklet
let jsStepTimer = null;
let jsLFOTimer = null;

// Gate retriggering removed - handled in AudioWorklet

// Audio timing callbacks removed - AudioWorklet only

// Audio-driven sequencer removed - AudioWorklet only
export function startAudioDrivenSequencer(bpm) {
    // Legacy function - no longer used with AudioWorklet only
    console.warn('startAudioDrivenSequencer called but AudioWorklet handles sequencing internally');
}

// Audio-driven LFO removed - AudioWorklet only
export function startAudioDrivenLFO() {
    // Legacy function - no longer used with AudioWorklet only
    console.warn('startAudioDrivenLFO called but AudioWorklet handles LFO internally');
}

// Audio-driven timing removed - AudioWorklet only
export function stopAudioDrivenTiming() {
    if (jsStepTimer) { clearInterval(jsStepTimer); jsStepTimer = null; }
    if (jsLFOTimer) { clearInterval(jsLFOTimer); jsLFOTimer = null; }
    console.log("Audio-driven timing stopped");
}

// Export function to get JS timer status
export function getJSTimerStatus() {
    return {
        stepTimer: jsStepTimer !== null,
        lfoTimer: jsLFOTimer !== null
    };
}

// Audio-driven BPM removed - AudioWorklet only
export function updateAudioDrivenBPM(bpm) {
    // Legacy function - no longer used with AudioWorklet only
    console.warn('updateAudioDrivenBPM called but AudioWorklet handles BPM internally');
}

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

    // Check if AudioContext already exists and is working
    if (audioContext && audioContext.state !== 'closed') {
        console.log(`AudioContext already exists (state: ${audioContext.state}), skipping initialization`);
        return;
    }

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    // Make audioContext globally available
    window.audioContext = audioContext;

    console.log(`Audio context sample rate: ${audioContext.sampleRate} Hz`);

    // Prefer AudioWorklet if available, but only create one
    if (ENABLE_AUDIO_WORKLET && audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        // Check if worklet is already being initialized or exists
        if (sidWorkletNode || useWorklet) {
            console.log('AudioWorklet already initialized or in progress, skipping');
            return;
        }

        console.log('Trying AudioWorklet SID path...');
        // Prefer the bundled worklet (no importScripts needed); fall back to source for dev
        const tryUrls = ['sid-processor.bundle.js', 'sid-processor.js'];
        const loadWorklet = (urls) => {
            const url = urls.shift();
            if (!url) return Promise.reject(new Error('No worklet module could be loaded'));
            // Add a cache-buster to ensure changes propagate during dev
            const withVersion = url + (url.indexOf('?') === -1 ? `?v=${Date.now()}` : '');
            return audioContext.audioWorklet.addModule(withVersion).catch((e) => {
                console.warn(`AudioWorklet addModule failed for ${url}:`, e);
                return loadWorklet(urls);
            });
        };
        loadWorklet(tryUrls.slice()).then(() => {
            // Double-check that we haven't created one already during async operation
            if (sidWorkletNode) {
                console.log('AudioWorklet created while async operation was in progress, skipping duplicate');
                return;
            }

            sidWorkletNode = new AudioWorkletNode(audioContext, 'sid-processor');
            sidWorkletNode.port.onmessage = (ev) => {
                const { type, payload } = ev.data || {};
                if (type === 'ready') {
                    useWorklet = true;
                    sidPlayer = { worklet: true }; // placeholder for truthy checks
                    window.sidWorkletNode = sidWorkletNode;
                    console.log(`SID Worklet ready (sr=${payload.sampleRate}, block=${payload.blockSize})`);
                    // Expose info for status pages
                    try { window.sidWorkletInfo = payload; } catch (_) { }
                    // Default master volume
                    setGlobalSIDRegister(0x18, 0x0F);
                    // Flush any pending pokes queued before readiness
                    if (pendingPokes.length) {
                        for (const p of pendingPokes) {
                            sidWorkletNode.port.postMessage({ type: 'poke', payload: p });
                        }
                        pendingPokes.length = 0;
                    }
                    // Notify any listeners waiting for readiness
                    while (workletReadyCallbacks.length) {
                        const cb = workletReadyCallbacks.shift();
                        try { cb && cb(); } catch (e) { console.warn('Worklet ready callback failed:', e); }
                    }
                } else if (type === 'started') {
                    console.log('Worklet sequencer confirmed started');
                } else if (type === 'stopped') {
                    console.log('Worklet sequencer confirmed stopped');
                } else if (type === 'step') {
                    // Update voiceState with position information from worklet
                    if (payload.voicePositions && typeof window !== 'undefined' && window.voiceState) {
                        try {
                            payload.voicePositions.forEach((pos, voice) => {
                                if (window.voiceState[voice] && pos) {
                                    window.voiceState[voice].orderPosition = pos.orderPos;
                                    window.voiceState[voice].patternIndex = pos.patternIndex;
                                    window.voiceState[voice].patternRow = pos.patternRow;
                                    window.voiceState[voice].isPlaying = true;
                                }
                            });
                        } catch (e) {
                            console.warn('Failed to update voiceState:', e);
                        }
                    }

                    if (typeof window !== 'undefined' && typeof window.updateWorkletStep === 'function') {
                        try { window.updateWorkletStep(payload); } catch (_) { }
                    }
                } else if (type === 'telemetry') {
                    // Update Oscilloscopes / Register Visualization
                    if (typeof window !== 'undefined' && typeof window.updateWorkletTelemetry === 'function') {
                        try { window.updateWorkletTelemetry(payload); } catch (_) { }
                    }
                } else if (type === 'triggerTables') {
                    // DISABLED: Worklet now handles all table execution internally
                    // Main thread gt2FrameEngine was causing conflicts/double-updates with worklet
                    // The worklet has sample-accurate timing, so it should be the only executor
                } else if (type === 'executeCommand') {
                    // Worklet wants to execute a pattern command
                    try {
                        const voice = ev.data.voice;
                        const command = ev.data.command;
                        const cmdData = ev.data.cmdData;
                        const tick = ev.data.tick || 0;
                        const frequency = ev.data.frequency || 0;

                        // Import pattern command engine dynamically
                        import('./pattern-commands.js').then(module => {
                            const { patternCommandEngine } = module;
                            patternCommandEngine.executeCommand(voice, command, cmdData, tick, frequency);
                            console.log(`Command executed: V${voice} cmd=${command.toString(16)} data=${cmdData.toString(16)}`);
                        }).catch(e => {
                            console.warn('Failed to execute pattern command:', e);
                        });
                    } catch (e) {
                        console.warn('Failed to execute pattern command:', e);
                    }
                } else if (type === 'error') {
                    console.error('SID Worklet error:', payload);
                    showAudioWorkletWarning('Worklet init error');
                    // Fallback to ScriptProcessor if worklet cannot init
                    try { sidWorkletNode.disconnect(); } catch (e) { }
                    sidWorkletNode = null;
                    useWorklet = false;
                    pendingPokes.length = 0;
                    initScriptProcessorPath();
                }
            };
            sidWorkletNode.connect(audioContext.destination);
            sidWorkletNode.port.postMessage({ type: 'init' });
        }).catch(err => {
            console.error('AudioWorklet failed to load:', err);
            alert('AudioWorklet is required but failed to initialize. Please use a modern browser that supports AudioWorklet.');
            throw new Error('AudioWorklet required but not available');
        });
        return; // Defer rest to async worklet init
    } else {
        // AudioWorklet API missing entirely
        console.error('AudioWorklet API not supported by this browser');
        alert('This application requires AudioWorklet support. Please use a modern browser (Chrome 64+, Firefox 76+, Safari 14+).');
        throw new Error('AudioWorklet API not supported');
    }
}

function initScriptProcessorPath() {
    // Check if ScriptProcessor is already initialized
    if (sidPlayer && scriptProcessor) {
        console.log("ScriptProcessor already initialized, skipping");
        return;
    }

    // Disconnect any existing scriptProcessor to prevent multiple instances
    if (scriptProcessor) {
        try {
            scriptProcessor.disconnect();
            console.log("Disconnected existing ScriptProcessor");
        } catch (e) {
            console.warn("Error disconnecting existing ScriptProcessor:", e);
        }
    }

    sidPlayer = new jsSID.SIDPlayer({
        quality: jsSID.quality.low,
        clock: jsSID.chip.clock.PAL,
        model: jsSID.chip.model.MOS6581,
        sampleRate: audioContext.sampleRate
    });

    console.log("SIDPlayer initialized with:", sidPlayer);

    // Create a ScriptProcessorNode to generate audio samples
    // Use a smaller buffer for lower latency. Events inside the buffer are processed sample-accurately.
    scriptProcessor = audioContext.createScriptProcessor(512, 0, 2);
    // Remember the effective buffer size
    processorBufferSize = scriptProcessor.bufferSize || 512;
    // Expose for debug pages
    if (typeof window !== 'undefined') window.scriptProcessor = scriptProcessor;
    scriptProcessor.onaudioprocess = (event) => {
        const leftChannel = event.outputBuffer.getChannelData(0);
        const rightChannel = event.outputBuffer.getChannelData(1);
        const samples = leftChannel.length;

        const bufferStartSample = sampleCounter;
        const bufferEndSample = bufferStartSample + samples;

        // Collect sample-accurate events within this buffer window
        const events = [];

        // Sequencer steps
        while (
            nextStepSampleTime > 0 &&
            nextStepSampleTime >= bufferStartSample &&
            nextStepSampleTime < bufferEndSample
        ) {
            events.push({ type: 'seq', offset: nextStepSampleTime - bufferStartSample });
            nextStepSampleTime += stepDurationInSamples;
        }

        // LFO updates
        while (
            nextLFOUpdateSampleTime > 0 &&
            nextLFOUpdateSampleTime >= bufferStartSample &&
            nextLFOUpdateSampleTime < bufferEndSample
        ) {
            events.push({ type: 'lfo', offset: nextLFOUpdateSampleTime - bufferStartSample });
            nextLFOUpdateSampleTime += lfoUpdateIntervalSamples;
        }

        // Gate ON retrigger events
        const remainingRetriggers = [];
        for (let i = 0; i < pendingGateRetriggers.length; i++) {
            const ge = pendingGateRetriggers[i];
            if (ge.gateOnSample >= bufferStartSample && ge.gateOnSample < bufferEndSample) {
                events.push({ type: 'gateOn', offset: ge.gateOnSample - bufferStartSample, voice: ge.voice, value: ge.controlValue });
            } else {
                remainingRetriggers.push(ge);
            }
        }
        pendingGateRetriggers = remainingRetriggers;

        // Sort by offset, then by type priority if needed
        events.sort((a, b) => a.offset - b.offset);

        // Generate audio in chunks up to each event offset, apply event, continue
        let writeIndex = 0;
        const temp = (n) => sidPlayer.synth.generate(n);

        const writeChunk = (chunk, start) => {
            for (let i = 0; i < chunk.length; i++) {
                leftChannel[start + i] = chunk[i];
                rightChannel[start + i] = chunk[i]; // Mono copy
            }
        };

        let idx = 0;
        while (idx < events.length) {
            const currentOffset = events[idx].offset | 0;
            const chunkLen = Math.max(0, currentOffset - writeIndex);

            if (chunkLen > 0) {
                const chunk = temp(chunkLen);
                writeChunk(chunk, writeIndex);
                writeIndex += chunkLen;
            }

            // Process all events at this exact offset
            while (idx < events.length && events[idx].offset === currentOffset) {
                const ev = events[idx];
                if (ev.type === 'seq') {
                    if (audioTimingCallbacks.onSequencerStep) audioTimingCallbacks.onSequencerStep(currentOffset);
                } else if (ev.type === 'lfo') {
                    if (audioTimingCallbacks.onLFOUpdate) audioTimingCallbacks.onLFOUpdate(currentOffset);
                } else if (ev.type === 'gateOn') {
                    setSIDRegister(ev.voice, CONTROL, ev.value);
                }
                idx++;
            }
        }

        // Generate any remaining samples after the last event
        const remaining = samples - writeIndex;
        if (remaining > 0) {
            const chunk = temp(remaining);
            writeChunk(chunk, writeIndex);
        }

        // Advance global sample counter
        sampleCounter += samples;
    };

    // Connect the ScriptProcessorNode to the audio context destination
    scriptProcessor.connect(audioContext.destination);

    console.log("AudioContext and ScriptProcessorNode set up.");
    setGlobalSIDRegister(0x18, 0x0F); // Master volume default
}

export function hzToSid(frequencyHz) {
    // SID frequency register formula: freq_reg = (desired_freq * 16777216) / clock_freq
    // 16777216 = 2^24 (24-bit accumulator)
    const clockFreq = getSIDClockFreq();
    const result = Math.round((frequencyHz * 16777216) / clockFreq);
    return Math.max(0, Math.min(65535, result)); // Clamp to 16-bit range
}

export function setSIDRegister(voice, register, value) {
    const regAddress = (voice * VOICE_OFFSET) + register;
    sidRegs[regAddress & 0x1F] = value & 0xFF;

    // Debug GT2 waveform writes
    if (register === 4) {
        console.log(`📤 setSIDRegister: voice=${voice}, reg=${register}, addr=0x${regAddress.toString(16)}, value=0x${value.toString(16)}, useWorklet=${useWorklet}, hasWorkletNode=${!!sidWorkletNode}`);
    }

    if (sidWorkletNode) {
        const payload = { address: regAddress, value: value & 0xFF };
        if (useWorklet) {
            sidWorkletNode.port.postMessage({ type: 'poke', payload });
        } else {
            pendingPokes.push(payload);
        }
    } else if (sidPlayer && sidPlayer.synth) {
        sidPlayer.synth.poke(regAddress, value & 0xFF);
    }
}

export function setGlobalSIDRegister(address, value) {
    sidRegs[address & 0x1F] = value & 0xFF;
    if (sidWorkletNode) {
        const payload = { address: address >>> 0, value: value & 0xFF };
        if (useWorklet) {
            sidWorkletNode.port.postMessage({ type: 'poke', payload });
        } else {
            pendingPokes.push(payload);
        }
    } else if (sidPlayer && sidPlayer.synth) {
        sidPlayer.synth.poke(address >>> 0, value & 0xFF);
    }
}

// Ensure ScriptProcessor fallback is initialized (used when worklet not yet ready)
export function ensureFallbackEngine() {
    if (!scriptProcessor) {
        try {
            // Initialize fallback path if not already
            // Reuse existing audioContext
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                window.audioContext = audioContext;
            }
            // Initialize jsSID + ScriptProcessor
            // Duplicate minimal logic from initScriptProcessorPath
            sidPlayer = new jsSID.SIDPlayer({
                quality: jsSID.quality.low,
                clock: jsSID.chip.clock.PAL,
                model: jsSID.chip.model.MOS6581,
                sampleRate: audioContext.sampleRate
            });
            scriptProcessor = audioContext.createScriptProcessor(512, 0, 2);
            processorBufferSize = scriptProcessor.bufferSize || 512;
            if (typeof window !== 'undefined') window.scriptProcessor = scriptProcessor;
            scriptProcessor.onaudioprocess = (event) => {
                const leftChannel = event.outputBuffer.getChannelData(0);
                const rightChannel = event.outputBuffer.getChannelData(1);
                const samples = leftChannel.length;
                const bufferStartSample = sampleCounter;
                const bufferEndSample = bufferStartSample + samples;
                const events = [];
                while (nextStepSampleTime > 0 && nextStepSampleTime >= bufferStartSample && nextStepSampleTime < bufferEndSample) {
                    events.push({ type: 'seq', offset: nextStepSampleTime - bufferStartSample });
                    nextStepSampleTime += stepDurationInSamples;
                }
                while (nextLFOUpdateSampleTime > 0 && nextLFOUpdateSampleTime >= bufferStartSample && nextLFOUpdateSampleTime < bufferEndSample) {
                    events.push({ type: 'lfo', offset: nextLFOUpdateSampleTime - bufferStartSample });
                    nextLFOUpdateSampleTime += lfoUpdateIntervalSamples;
                }
                const remainingRetriggers = [];
                for (let i = 0; i < pendingGateRetriggers.length; i++) {
                    const ge = pendingGateRetriggers[i];
                    if (ge.gateOnSample >= bufferStartSample && ge.gateOnSample < bufferEndSample) {
                        events.push({ type: 'gateOn', offset: ge.gateOnSample - bufferStartSample, voice: ge.voice, value: ge.controlValue });
                    } else {
                        remainingRetriggers.push(ge);
                    }
                }
                pendingGateRetriggers = remainingRetriggers;
                events.sort((a, b) => a.offset - b.offset);
                let writeIndex = 0;
                const temp = (n) => sidPlayer.synth.generate(n);
                const writeChunk = (chunk, start) => {
                    for (let i = 0; i < chunk.length; i++) {
                        leftChannel[start + i] = chunk[i];
                        rightChannel[start + i] = chunk[i];
                    }
                };
                let idx = 0;
                while (idx < events.length) {
                    const currentOffset = events[idx].offset | 0;
                    const chunkLen = Math.max(0, currentOffset - writeIndex);
                    if (chunkLen > 0) {
                        const chunk = temp(chunkLen);
                        writeChunk(chunk, writeIndex);
                        writeIndex += chunkLen;
                    }
                    while (idx < events.length && events[idx].offset === currentOffset) {
                        const ev = events[idx];
                        if (ev.type === 'seq') { if (audioTimingCallbacks.onSequencerStep) audioTimingCallbacks.onSequencerStep(currentOffset); }
                        else if (ev.type === 'lfo') { if (audioTimingCallbacks.onLFOUpdate) audioTimingCallbacks.onLFOUpdate(currentOffset); }
                        else if (ev.type === 'gateOn') { setSIDRegister(ev.voice, CONTROL, ev.value); }
                        idx++;
                    }
                }
                const remaining = samples - writeIndex;
                if (remaining > 0) {
                    const chunk = temp(remaining);
                    writeChunk(chunk, writeIndex);
                }
                sampleCounter += samples;
            };
            scriptProcessor.connect(audioContext.destination);
        } catch (e) {
            console.warn('Failed to initialize fallback engine:', e);
        }
    }
}

export function isWorkletActive() {
    return !!sidWorkletNode && !!useWorklet;
}

export function onWorkletReady(callback) {
    if (isWorkletActive()) {
        try { callback(); } catch (e) { console.warn('onWorkletReady callback error:', e); }
    } else {
        workletReadyCallbacks.push(callback);
    }
}

export function workletStartSequencer({ allPatterns, orderLists, instruments, tables, bpm }) {
    if (!sidWorkletNode) {
        console.warn('workletStartSequencer: sidWorkletNode is null');
        return;
    }

    console.log(`workletStartSequencer: Starting GT2 song mode with ${allPatterns.length} patterns`);
    console.log(`workletStartSequencer: Order lists:`, orderLists.map((ol, i) => `V${i}:${ol.slice(0, 5).join(',')}`).join(' '));
    if (tables) {
        console.log(`workletStartSequencer: Tables included - WTBL has ${tables.ltable[0].filter(x => x !== 0).length} non-zero entries`);
        // Debug dump first 10 WTBL entries to verify gate bits
        console.log(`📊 WTBL first 10 entries being sent to worklet:`);
        for (let i = 0; i < 10; i++) {
            const L = tables.ltable[0][i] || 0;
            const R = tables.rtable[0][i] || 0;
            const hasGate = (L >= 0x10 && L <= 0xDF) ? ((L & 0x01) ? '+gate' : 'NO-gate') : '';
            console.log(`  [${i}] L=0x${L.toString(16).padStart(2,'0')} R=0x${R.toString(16).padStart(2,'0')} ${hasGate}`);
        }
    }

    sidWorkletNode.port.postMessage({ type: 'loadPattern', payload: { allPatterns, orderLists, instruments, tables } });
    sidWorkletNode.port.postMessage({ type: 'setBPM', payload: { bpm } });
    sidWorkletNode.port.postMessage({ type: 'start' });

    console.log(`workletStartSequencer: Sent loadPattern, setBPM, and start messages to worklet`);
}

export function workletStopSequencer() {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'stop' });
}

export function workletPanic() {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'panic' });
}

export function workletSetBPM(bpm) {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'setBPM', payload: { bpm } });
}

export function workletSetGT2Tempo(speed, tempo) {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'setGT2Tempo', payload: { speed, tempo } });
}

if (typeof window !== 'undefined') {
    window.setGT2Tempo = workletSetGT2Tempo;
}

export function stopVoice(voice) {
    // Prefer synchronized gate control in the AudioWorklet
    if (isWorkletActive && isWorkletActive()) {
        try { workletNoteOff(voice); } catch (_) { }
        console.log(`Voice ${voice} stopped via worklet (GATE cleared)`);
        return;
    }
    // Fallback: write directly
    const controlReg = (voice * VOICE_OFFSET) + CONTROL;
    const currentControl = sidRegs[controlReg & 0x1F] || 0x10; // default waveform TRI
    const newControl = (currentControl & 0xF0) & 0xFE; // preserve waveform, clear GATE
    setGlobalSIDRegister(controlReg, newControl);
    console.log(`Voice ${voice} stopped (fallback) (GATE cleared)`);
}

export function releaseVoice(voice, waveform = 0x10) {
    // Prefer synchronized gate control in the AudioWorklet
    if (isWorkletActive && isWorkletActive()) {
        try { workletNoteOff(voice, waveform); } catch (_) { }
        console.log(`Voice ${voice} released via worklet with waveform 0x${waveform.toString(16)}`);
        return;
    }
    // Fallback: write directly
    const controlReg = (voice * VOICE_OFFSET) + CONTROL;
    setGlobalSIDRegister(controlReg, (waveform & 0xF0) & 0xFE);
    console.log(`Voice ${voice} released (fallback) with waveform 0x${waveform.toString(16)}`);
}

export function stopAllVoices() {
    // Stop all three voices
    for (let voice = 0; voice < 3; voice++) {
        stopVoice(voice);
    }
}

// Track active filter states per voice
let voiceFilterStates = [false, false, false];

// Function to update global filter state based on active voices
function updateGlobalFilterState() {
    if (!(useWorklet || (sidPlayer && sidPlayer.synth))) return;

    // Check if any voice is using the filter
    const anyVoiceFiltered = voiceFilterStates.some(state => state);

    if (!anyVoiceFiltered) {
        // No voices using filter - completely disable it
        setGlobalSIDRegister(23, 0x00); // Clear all voice routing and resonance
        setGlobalSIDRegister(24, 0x0F); // Clear filter type, keep volume at 15
        console.log(`Filter completely disabled - no active filtered voices`);
    }
}

// Function to apply filter settings to a voice
export function applyFilter(voice, filterSettings) {
    if (!filterSettings) return;

    if (filterSettings.enabled) {
        // Mark this voice as using filter
        voiceFilterStates[voice] = true;

        // Set filter frequency (11-bit value split across two 8-bit registers)
        const ffreqlo = filterSettings.frequency & 0x07;
        const ffreqhi = (filterSettings.frequency >> 3) & 0xFF;

        setGlobalSIDRegister(21, ffreqlo); // Low 3 bits of frequency
        setGlobalSIDRegister(22, ffreqhi); // High 8 bits of frequency

        // Set resonance and voice routing - need to preserve other voices' routing
        const currentRouting = sidRegs[23] & 0x07;
        const voiceRouting = currentRouting | (1 << voice); // Add this voice to filter routing
        const resonanceAndRouting = ((filterSettings.resonance & 0xF0)) | voiceRouting;
        setGlobalSIDRegister(23, resonanceAndRouting);

        // Set filter type and volume
        // Bits 4-6: Filter type (LP/BP/HP), Bit 7: Voice 3 off, Bits 0-3: Volume
        const volReg = sidRegs[24];
        const currentVolume = (volReg & 0x0F) || 0x0F;
        const clampedVolume = Math.min(currentVolume, 0x0F); // Ensure volume doesn't exceed 15
        const filterTypeAndVolume = (filterSettings.type & 0x70) | clampedVolume;
        setGlobalSIDRegister(24, filterTypeAndVolume);

        console.log(`Filter applied to voice ${voice}: freq=0x${filterSettings.frequency.toString(16)}, res=${filterSettings.resonance} (0x${filterSettings.resonance.toString(16)}) -> reg23=0x${resonanceAndRouting.toString(16)}, type=0x${filterSettings.type.toString(16)}`);
    } else {
        // Mark this voice as not using filter
        voiceFilterStates[voice] = false;

        // Disable filter for this voice by clearing its routing bit
        const currentRouting2 = sidRegs[23];
        const newRouting = currentRouting2 & ~(1 << voice); // Clear this voice's routing bit
        setGlobalSIDRegister(23, newRouting);
        console.log(`Filter disabled for voice ${voice}`);

        // Check if we should completely disable the filter
        updateGlobalFilterState();
    }
}

// Clean API: Play note with instrument
// instrumentIdOrObject can be:
//   - number: index into instruments array
//   - object: instrument object directly
export function playNoteWithInstrument(voice, frequencyHz, duration, instrumentIdOrObject) {
    let instrument;
    let instrumentIndex = -1;

    // Handle both instrument ID (number) and instrument object
    if (typeof instrumentIdOrObject === 'number') {
        instrumentIndex = instrumentIdOrObject;
        instrument = instruments[instrumentIndex];
        if (!instrument) {
            console.warn(`Invalid instrument ID: ${instrumentIndex}`);
            return;
        }
    } else if (typeof instrumentIdOrObject === 'object' && instrumentIdOrObject !== null) {
        instrument = instrumentIdOrObject;
    } else {
        console.warn(`Invalid instrument parameter:`, instrumentIdOrObject);
        return;
    }

    console.log(`🎵 Playing "${instrument.name}" on voice ${voice}, freq ${frequencyHz.toFixed(2)}Hz`);

    // DISABLED: Main thread table triggering - worklet handles tables now
    // triggerTablesForInstrument(voice, frequencyHz, instrument, instrumentIndex);

    // Send to worklet (all instrument parameters bundled)
    if (sidWorkletNode) {
        const payload = { voice, frequencyHz, instrument, instrumentIndex };
        sidWorkletNode.port.postMessage({ type: 'noteOn', payload });
    } else {
        console.warn(`No worklet available - note not played`);
    }
}

// Alias for cleaner code
export const playNote = playNoteWithInstrument;

// Helper function to trigger GT2 tables
function triggerTablesForInstrument(voice, frequencyHz, instrument, instrumentIndex) {
    if (!instrument?.tables) return;

    console.log(`🔍 Checking tables for instrument ${instrumentIndex}:`, instrument.tables);

    // GT2 uses 1-based pointers: 0 = no table, 1+ = table position
    if (instrument.tables.wave > 0 || instrument.tables.pulse > 0 || instrument.tables.filter > 0 || instrument.tables.speed > 0) {
        // Convert frequency to MIDI note number (approximate)
        const noteNumber = Math.round(12 * Math.log2(frequencyHz / 440) + 69); // A4 = 440Hz = MIDI 69

        console.log(`✨ GT2 Tables triggered for voice ${voice}, freq ${frequencyHz.toFixed(2)}Hz (MIDI ${noteNumber}), instr ${instrumentIndex}`);

        // Import gt2FrameEngine (circular dependency safe since it's a runtime call)
        import('./gt2-frame-engine.js').then(module => {
            module.gt2FrameEngine.triggerNoteTables(voice, noteNumber, instrument);
        });
    } else {
        console.log(`❌ No active tables for instrument ${instrumentIndex}`);
    }
}

// AudioWorklet worklet functions

export function workletNoteOn(voice, frequencyHz, instrument, tables = null) {
    if (!sidWorkletNode) return;
    // If tables provided, send them first so worklet has table data for this note
    if (tables) {
        sidWorkletNode.port.postMessage({ type: 'loadTables', payload: { tables } });
    }
    const payload = { voice, frequencyHz, instrument };
    sidWorkletNode.port.postMessage({ type: 'noteOn', payload });
}

export function workletLoadTables(tables) {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'loadTables', payload: { tables } });
}

export function workletNoteOff(voice, waveform = 0x10) {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'noteOff', payload: { voice, waveform } });
}

export function workletUpdateInstruments(instrumentsArray) {
    if (!sidWorkletNode) return;
    sidWorkletNode.port.postMessage({ type: 'updateInstruments', payload: { instruments: instrumentsArray } });
}

export function workletSetSidModel(model) {
    if (!sidWorkletNode) return;
    // model should be 6581 or 8580
    sidWorkletNode.port.postMessage({ type: 'setSidModel', payload: { model: model } });
    console.log(`Setting SID model to ${model}`);
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
