// table-generators.js - parameterised generators for the GT2 tables.
//
// PURE and DOM-FREE (Node-safe), exactly like gt2-sng-parser.js /
// gt2-sng-writer.js: the browser table editor and tools/make-default-song.js
// both drive these, so there is ONE implementation of the byte layout.
//
// These exist because GT2's tables are genuinely hostile to hand-authoring -
// every trap below produced a silent, error-free wrong result at some point:
//
//   * A DELAY entry lasts value+1 frames. WAVEEXEC compares BEFORE
//     incrementing (`if (wavetime != wave) { wavetime++; skip }`), so left=0
//     holds one frame and left=1 holds two. Encoding a measured N-frame gap as
//     left=N runs every arpeggio at half speed.
//   * A jump's right byte is an ABSOLUTE 1-BASED pointer, not an offset - and
//     right=0 means STOP, not "position 0". Every generator here therefore
//     takes startPos (the 0-based array index it will be written to) and emits
//     absolute targets.
//   * A wavetable right byte is a RELATIVE semitone offset (0x00-0x5F up,
//     0x60-0x7F down), 0x80 = "no note change", 0x81-0xFF = ABSOLUTE note.
//     Drums must use absolute notes or they detune under order-list transposes.
//   * PTBL left=0x00 is not "no-op" - it sets pulsetime=0, the modulate block
//     never runs and the pointer never advances, so the table stalls forever.
//
// Every generator returns { entries: [{left, right, description}], description,
// jumpTarget? } - entries are written sequentially from startPos.

export const WAVEFORMS = {
    triangle: 0x11,
    sawtooth: 0x21,
    pulse:    0x41,
    noise:    0x81,
};

// Interval sets, semitones from the root
export const CHORDS = {
    'octave':   [0, 12],
    'fifth':    [0, 7],
    'major':    [0, 4, 7],
    'minor':    [0, 3, 7],
    'dim':      [0, 3, 6],
    'aug':      [0, 4, 8],
    'sus4':     [0, 5, 7],
    'major7':   [0, 4, 7, 11],
    'minor7':   [0, 3, 7, 10],
    'dom7':     [0, 4, 7, 10],
    'major-inv':[0, 4, 9],      // first inversion - the classic C64 arp shape
    'minor-oct':[0, 3, 7, 12],
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/** GT2 relative-note byte: 0x00-0x5F = +0..+95, 0x60-0x7F = -32..-1 */
function relNote(semitones) {
    if (semitones >= 0) return Math.min(0x5F, semitones);
    return Math.max(0x60, 0x80 + semitones);
}

/** GT2 absolute-note byte (right >= 0x81); keeps drums fixed under transpose */
const absNote = (n) => 0x80 | clamp(n, 1, 0x7F);

/** Signed byte for a modulate speed */
const sbyte = (v) => clamp(v, -127, 127) & 0xFF;

/**
 * Arpeggio / trill wavetable.
 *
 * One waveform entry per chord tone sets waveform AND note for exactly one
 * frame; holding a tone longer needs a following delay entry. To cover N
 * frames total: 1 waveform frame + a delay of N-2 (which lasts N-1 frames).
 *
 * stepFrames 1 gives the Hubbard shimmer (Monty's voice 2 changes pitch every
 * single frame); 6 gives a slow broken chord.
 */
export function generateArpeggio({
    chord = 'minor', waveform = WAVEFORMS.pulse, stepFrames = 1, startPos = 0,
} = {}) {
    const intervals = Array.isArray(chord) ? chord : (CHORDS[chord] || CHORDS.minor);
    const step = clamp(stepFrames, 1, 17);
    const entries = [];
    for (const iv of intervals) {
        entries.push({
            left: waveform & 0xFF,
            right: relNote(iv),
            description: `${iv >= 0 ? '+' : ''}${iv} semitones`,
        });
        if (step > 1) {
            entries.push({ left: step - 2, right: 0x80, description: `hold ${step}f total` });
        }
    }
    entries.push({ left: 0xFF, right: startPos + 1, description: 'loop to start' });
    return {
        entries,
        description: `${Array.isArray(chord) ? intervals.join(',') : chord} arp, ` +
                     `${step} frame${step === 1 ? '' : 's'}/step`,
    };
}

/**
 * Pulse-width sweep (PWM). Triangle up/down so it is seamless and bounded.
 * The loop deliberately returns to the FIRST MODULATE, not the leading set:
 * GT2 keeps the pulse VALUE across the jump, so re-running the set would snap
 * the sweep back and make it stutter.
 */
export function generatePWM({
    center = 0x800, depth = 0x400, rate = 32, startPos = 0,
} = {}) {
    const ticks = clamp(rate, 1, 127);
    const step = clamp(Math.abs(depth) / ticks, 1, 127);
    const travel = step * ticks;
    const start = clamp(center - travel / 2, 0, 0xFFF);
    const entries = [
        { left: 0x80 | ((start >> 8) & 0x0F), right: start & 0xFF,
          description: `set PW $${start.toString(16)}` },
        { left: ticks, right: sbyte(step),  description: `${ticks}f rising +${step}` },
        { left: ticks, right: sbyte(-step), description: `${ticks}f falling -${step}` },
        // startPos+2 = the first modulate entry (1-based pointer)
        { left: 0xFF, right: startPos + 2, description: 'loop (keeps PW value)' },
    ];
    return {
        entries,
        description: `PWM around $${center.toString(16)}, depth $${travel.toString(16)}, ` +
                     `${ticks * 2}f cycle`,
    };
}

/**
 * Global filter sweep.
 *
 * gplay.c 269-270 reads `filtertype = LEFT & 0x70` and `filterctrl = RIGHT`,
 * so RESONANCE **and ROUTING** both live in the right byte. Putting routing in
 * the left byte (where & 0x70 discards it) leaves routing 0 - the filter is
 * then completely inaudible because no voice passes through it.
 *
 * routing is a 3-bit voice mask: bit0 = voice 1, bit1 = voice 2, bit2 = voice 3.
 */
export const FILTER_MODES = { lowpass: 0x10, bandpass: 0x20, highpass: 0x40 };

export function generateFilterSweep({
    mode = 'lowpass', resonance = 10, routing = 0b001,
    low = 0x20, high = 0xC0, rate = 48, startPos = 0,
} = {}) {
    const modeBits = (typeof mode === 'number' ? mode : (FILTER_MODES[mode] ?? 0x10)) & 0x70;
    const lo = clamp(low, 0, 0xFF), hi = clamp(high, 0, 0xFF);
    const ticks = clamp(rate, 1, 127);
    const step = clamp(Math.abs(hi - lo) / ticks, 1, 127);
    const entries = [
        { left: 0x80 | modeBits,
          right: ((clamp(resonance, 0, 15) & 0x0F) << 4) | (routing & 0x07),
          description: `set ${typeof mode === 'string' ? mode : 'filter'}, res ${resonance}, route ${routing.toString(2).padStart(3, '0')}` },
        { left: 0x00, right: lo, description: `cutoff $${lo.toString(16)}` },
        { left: ticks, right: sbyte(step),  description: `${ticks}f opening +${step}` },
        { left: ticks, right: sbyte(-step), description: `${ticks}f closing -${step}` },
        // startPos+3 = the first modulate: keep the params, replay the sweep
        { left: 0xFF, right: startPos + 3, description: 'loop (keeps filter params)' },
    ];
    return {
        entries,
        description: `${mode} sweep $${lo.toString(16)}-$${hi.toString(16)}, ` +
                     `res ${resonance}, ${ticks * 2}f cycle`,
    };
}

/**
 * Vibrato parameters for STBL.
 *
 * CMD_VIBRATO reads `cmpvalue = LEFT`, `speed = RIGHT`, then per frame:
 *   if (vibtime < 0x80 && vibtime > cmpvalue) vibtime ^= 0xff;
 *   vibtime += 2;  freq += (vibtime & 1) ? -speed : +speed;
 * vibtime advances by 2, so the compare value is ~one full period in frames and
 * the peak deviation is speed * period/2 SID frequency units.
 *
 * STBL is indexed directly by the command parameter - it is a parameter slot,
 * NOT a program - so this emits exactly one entry and no jump.
 * cmpvalue must stay under 0x80; bit 7 selects GT2's hifi (pitch-relative) mode.
 */
export function generateVibrato({ periodFrames = 12, depth = 0x30 } = {}) {
    const cmp = clamp(periodFrames, 1, 0x7F);
    const speed = clamp((2 * Math.abs(depth)) / cmp, 1, 0xFF);
    return {
        entries: [{ left: cmp, right: speed,
                    description: `vibrato ~${cmp}f period, +-${Math.round(speed * cmp / 2)} units` }],
        description: `vibrato: ${cmp}f period, speed ${speed}`,
    };
}

/**
 * Drum-kit onset wavetable (one-shot: terminated with a jump to 0 = STOP).
 *
 * Notes are ABSOLUTE so the kit keeps its pitch regardless of the pattern row's
 * note and survives order-list transposes - a relative kit detunes with the key
 * change and stops sounding like a kit.
 */
export const DRUM_KINDS = ['kick', 'snare', 'hat', 'tom'];

export function generateDrum({ kind = 'kick' } = {}) {
    const N = WAVEFORMS.noise, T = WAVEFORMS.triangle;
    // [waveform, absolute note] per frame - noise transient into a tonal body
    const shapes = {
        // pitch drops fast: the classic C64 kick
        kick:  { steps: [[N, 40], [T, 31], [T, 26], [T, 22]], ad: 0x00, sr: 0x88 },
        snare: { steps: [[N, 62], [N, 58], [N, 54], [N, 50]], ad: 0x00, sr: 0x9A },
        hat:   { steps: [[N, 84], [N, 80]],                   ad: 0x00, sr: 0x56 },
        tom:   { steps: [[N, 50], [T, 45], [T, 41], [T, 38]], ad: 0x00, sr: 0x9A },
    };
    const shape = shapes[kind] || shapes.kick;
    const entries = shape.steps.map(([w, n]) => ({
        left: w, right: absNote(n), description: `${w === N ? 'noise' : 'tri'} note ${n} (absolute)`,
    }));
    entries.push({ left: 0xFF, right: 0x00, description: 'STOP (one-shot)' });
    return {
        entries,
        instrument: { ad: shape.ad, sr: shape.sr, firstWave: shape.steps[0][0] },
        description: `${kind}: ${shape.steps.length}-frame one-shot, absolute notes`,
    };
}

/** Which generators apply to which table type (0=WTBL 1=PTBL 2=FTBL 3=STBL) */
export const GENERATORS_BY_TABLE = {
    0: ['arpeggio', 'drum'],
    1: ['pwm'],
    2: ['filter'],
    3: ['vibrato'],
};

export function generate(name, params = {}) {
    switch (name) {
        case 'arpeggio': return generateArpeggio(params);
        case 'pwm':      return generatePWM(params);
        case 'filter':   return generateFilterSweep(params);
        case 'vibrato':  return generateVibrato(params);
        case 'drum':     return generateDrum(params);
        default: throw new Error(`unknown generator: ${name}`);
    }
}
