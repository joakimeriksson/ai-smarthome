"""Convert decoded Synthex program records (40 raw parameter values each, as the
firmware unpacks them into zero page $38..$5F) into TypeScript source for
packages/engine/src/presets/factory.ts.

Parameter index -> meaning (from R. Grieb's CC map, confirmed against the
firmware disassembly):

  0  OSC2 detune (8b, centre 128, +-quarter tone)
  1  LFO depth A (8b)        2  LFO depth B (8b)
  3  LFO freq (8b, pot reads inverted)   4  LFO delay (8b, inverted)
  5  VCF cutoff (8b)   6  VCF key track (8b)   7  VCF env amount (8b)
  8  VCF env sustain (8b)   9  VCA env sustain (7b<<1)
  10 VCF resonance (7b<<1)  11 OSC1 PW (7b<<1)  12 OSC2 PW (7b<<1)
  13 glide/porta speed (7b<<1)  14 glide amount ((v>>2)-32 st)
  15 OSC1 transpose (7b<<1 -> 0..12 st via threshold table)
  16 OSC2 transpose
  17 OSC1 mix vol (4b<<4)  18 OSC2 mix vol  19 noise vol
  20 VCF attack (4b<<4)  21 VCA attack  22 VCF decay  23 VCA decay
  24 VCF release  25 VCA release
  26 LFO routing bits: 0 osc1 pitch, 1 osc2 pitch, 2 osc1 PW, 3 amp, 4 filter, 5 osc2 PW
  27 OSC1 footage 0..4 = 16' 8' 4' 2' 1'   28 OSC2 footage
  29 OSC1 wave 0 tri 1 saw 2 square 3 pulse 4 pulse PWM'd by other osc
  30 OSC2 wave
  31 LFO wave 0 tri 1 falling ramp 2 rising ramp 3 square
  32 VCF mode 0 LP24 1 BP6 2 BP12 3 HP12
  33 chorus 0 off 1 2 3
  34 .6 glide  .7 portamento
  35 .6 VCF env invert  .7 OSC2 sync
  36 .6 glide->OSC2  .7 glide->OSC1   (firmware routing; panel labels are swapped)
  37 .7 OSC1 ring mod  .6 OSC2 ring mod
  38 .7 release switch on  .6 hold switch on
  39 .6 white noise  .7 pink noise
"""
import json, math, sys

ROM_NAMES = [
    'Chunky Synth', 'Wah brass', 'Fat Sound', 'Metallic', 'Pan flutes',
    'Tremolo piano', 'Chorale', 'Brass I', 'Brass II', 'Brass III',
    'Double basses', 'Ceilos', 'Violins', 'Church organ', 'Reed organ',
    'Electronic organ', 'High pass sweep', 'Filtered brass', 'Filtered chorus', 'Filtered strings',
    'Metallic piano', 'Pianet', 'Funky Clav.', 'Clavichord I', 'Clavichord II',
    'Clavinet', 'Electric piano I', 'Electric piano II', 'Chimes', 'Vibes',
    'Sweep 1', 'Sweep 2', 'Take-off', 'Landing', 'Wash of sound',
    'Fast decay', 'Ring mod.', 'Phased sweep', 'Bass pluck', 'Whistle',
]
MEM_NAMES = [
    'Cathedral choir', 'Sync. Harmonic Sweep', 'Filtered Choir', 'Harsh Clavinet', 'Echo',
    'Double Bass — Nylon Guitar', 'Sync. 1', 'Sync. 2', 'De-tuned pipe organ', 'Normal Clavinet',
    'Harsh lead', 'Solo Violin', 'Bass Guitar', 'Sync. 3', 'Glide Strings',
    'Hammond 1 (John Lord)', 'Phased Choir', 'Brash Brass', 'Brushed Cymbals', 'Hammond 2 (Emerson)',
    'Plink', 'Wah Ring Mod.', 'Metallic Clavinet', 'Bass Drum – tom-toms', 'Hammond 3 (Brooker T)',
    'Plucked brass', 'Snare Drum', 'Distant Strings', 'Watery Grave', 'High Portamento',
    'Electric Piano', 'Oriental Fourths', 'Wood Blocks (use with sequencer)', 'Marimba', 'Harp',
    'Filtered brass', 'Deep. Sync.', 'Mini Moog Bass', 'Mini Moog Lead', 'Steel Drums',
]

# Firmware table at $E99F: transpose pot value -> semitones (largest index whose
# threshold is <= value).
TRANSPOSE_THRESH = [0x00, 0x05, 0x15, 0x2d, 0x47, 0x60, 0x78, 0x92, 0xab, 0xc3, 0xd9, 0xeb, 0xfa]

def semis(v):
    s = 0
    for i, t in enumerate(TRANSPOSE_THRESH):
        if v >= t: s = i
    return s

# Envelope stage times per 4-bit step, from the voice card's RC network as
# modelled in pecostm32's Synthex emulator (synthexhardware.js, CPU cycle
# counts at 1 MHz for the attack stage; the same network sets decay and
# release). 3 ms .. 13.2 s, roughly x2 every step pair.
ENV_TABLE_MS = [3.102, 6.204, 14.52, 29.04, 36.96, 73.92, 99.0, 198.0,
                257.4, 514.8, 660.0, 1320.0, 1782.0, 3564.0, 6600.0, 13200.0]

def env_time(v):
    """4-bit envelope knob (stored <<4) -> seconds (the table value)."""
    return ENV_TABLE_MS[v >> 4] / 1000

# Stage times on the hardware, measured on Per Kristian's run-through:
#  - attack reaches the peak in about half the table time (Double basses,
#    Violins, High pass sweep: 0.12-0.135 s for table 0.257 s; Whistle and
#    Pan flutes: ~50 ms for table 99 ms);
#  - decay is linear in CV and takes the table time (Phased sweep's cutoff
#    falls linearly from peak to sustain in 6.6 s, table 6.6 s);
#  - release is exponential, 20 dB per table time (Vibes, Pianet, Metallic
#    piano, Funky Clav., Clavinet, Clavichord II, Sweep 2, Brass II, Church
#    organ: slopes within +-25 % of 20/T dB/s). The engine's release
#    parameter is defined that way (time to fall 20 dB).
ATTACK_SCALE = 0.5
def attack_time(v): return env_time(v) * ATTACK_SCALE

def lfo_rate(v):
    """Pot reads inverted (vibrato presets sit at low raw values).
    Fitted to six hardware measurements (Wash of sound 39 -> 11.0 Hz, Clavinet
    53 -> 8.05, Whistle 58 -> 7.1, Tremolo piano 89 -> 3.39, Electric piano
    II 98 -> 2.8, Ring mod. 134 -> 1.1): exponential, x400 across the pot,
    all six within 5 %. 27.7 Hz at 0, 0.07 Hz at 255."""
    return 27.7 * 400 ** (-v / 255)

def lfo_delay(v):
    """Inverted like the rate pot. 1 ms .. 30 s; near the stop = no delay."""
    inv = 255 - v
    if inv < 12: return 0.0
    return 0.001 * 30000 ** (inv / 255)

def glide_time(v):
    """Speed pot: 0 = slowest. Calibrated so Ring mod. (8) ~ 0.9 s."""
    return 0.005 * 200 ** (1 - v / 254)

def r(x, nd=3):
    s = f'{x:.{nd}f}'.rstrip('0').rstrip('.')
    return s if s not in ('', '-0') else '0'

WAVES = ['triangle', 'sawtooth', 'square', 'square', 'square']
FILTERS = ['lp24', 'bp6', 'bp12', 'hp12']
LFO_SHAPES = ['tri', 'ramp-down', 'ramp', 'square']

# Engine scaling for the LFO routings (modMatrix x depth):
PITCH_MOD = 0.11     # engine: 12 st * matrix * depth -> +-1.3 st at full depth
                     # (measured: Whistle +-0.72 st at depth 0.71, Wash of sound
                     # +-0.35 st at depth 0.73 after the same analysis of an
                     # engine render; both say the old +-2 st was ~2x too deep)
PWM_MOD = 1.0        # engine: 0.45 * matrix * depth
CUTOFF_MOD = 0.5     # engine: 60 st * matrix * depth  -> +-30 st at full depth
AMP_MOD = 0.37       # engine: amp * (1 + matrix * lfo * depth); measured tremolo
                     # 4.7 dB p-p at depth 0.69 (Tremolo piano) and 4.2 dB at
                     # 0.68 (Electric piano II) -> modulation index 0.26
XMOD_DEPTH = 0.175   # pulse-width cross-mod depth, from the Elka-X Laser Harp fit
# VCF cutoff mapping. The cutoff pot reads INVERTED like the two LFO pots
# (raw 255 = knob at minimum): with that, Bass pluck and Fast decay sit at
# knob ~0 plus a full envelope, Ceilos and the organs are open, and the
# hardware readings agree (below). Weights from the voice-card schematic
# (410CST5800: the cutoff summing amp weighs FREQ:KEY:ENV as 47/30 : 47/43 :
# 47/24 = 1 : 0.698 : 1.25), the firmware's key value ((key - 36) * 2, zero
# at the bottom key C2), and two anchors on Per Kristian's recording (Chunky
# Synth at C2, filter at sustain: note 108; Phased sweep at its sustain,
# key 46: note 72):
#   fc_note = CUT_OFFSET + CUT_SLOPE * ((255-raw) + 0.698*kt*2*(key-36) + 1.25*env*level)
# Independent checks on the same recording (not used in the fit): Filtered
# brass 94/101 vs measured 97/98 (keys 36/48), Church organ 95 vs 96 (key
# 48), Electronic organ 74/83/93 vs 76/88/100 (keys 48/60/72), Pan flutes
# 82 vs ~76. The engine computes 24 + 96*cutoff + 60*envAmount*level +
# keyTrack*(midi-60), so the three engine fields are the hardware terms
# re-expressed in it; the engine clamps the result at note 132.
CUT_SLOPE = 0.58        # semitones per DAC unit (148 st across the knob)
CUT_OFFSET = -1.0       # cutoff note with every CV at zero
KEY_W, ENV_W = 0.698, 1.25
MIX_SCALE = 0.7      # panel volume 10 -> 0.7 in the engine (keeps resonant presets out of the limiter)

def convert(p, name):
    oct1, oct2 = p[27] - 2, p[28] - 2
    w1, w2 = p[29], p[30]
    pw1 = min(0.95, max(0.05, p[11] / 254)) if w1 == 3 or w1 == 4 else 0.5
    pw2 = min(0.95, max(0.05, p[12] / 254)) if w2 == 3 or w2 == 4 else 0.5
    detune_cents = (p[0] - 128) / 128 * 50
    transpose1 = semis(p[15])
    transpose2 = semis(p[16])
    osc2_detune = transpose2 * 100 + detune_cents
    noise_on = bool(p[39] & 0xC0)
    noise_color = 'pink' if p[39] & 0x80 else 'white'
    routing = p[26]
    invert = bool(p[35] & 0x40)
    sync = bool(p[35] & 0x80)
    ring = bool(p[37] & 0xC0)
    release_on = bool(p[38] & 0x80)
    glide_mode = 'portamento' if p[34] & 0x80 else ('glide' if p[34] & 0x40 else 'off')
    g_osc2 = bool(p[36] & 0x40)
    g_osc1 = bool(p[36] & 0x80)
    glide_amount = (p[14] >> 2) - 32
    rel = lambda v: env_time(v) if release_on else 0.01

    lines = []
    def L(s): lines.append('    ' + s)
    o1 = f"osc1: {{ wave: '{WAVES[w1]}', octave: {oct1}, pwm: {r(pw1)} }},"
    if transpose1:
        o1 += f"  // OSC1 transpose +{transpose1} st not representable; folded into OSC2 detune"
        osc2_detune -= transpose1 * 100
    L(o1)
    L(f"osc2: {{ wave: '{WAVES[w2]}', octave: {oct2}, detune: {r(osc2_detune, 1)}, pwm: {r(pw2)}, sync: {str(sync).lower()} }},")
    mix = [f"osc1: {r(p[17] / 240 * MIX_SCALE)}", f"osc2: {r(p[18] / 240 * MIX_SCALE)}",
           f"noise: {r(p[19] / 240 * MIX_SCALE if noise_on else 0)}", f"noiseColor: '{noise_color}'",
           f"ringMod: {str(ring).lower()}"]
    if w2 == 4: mix.append(f"crossMod: {XMOD_DEPTH}")
    if w1 == 4: mix.append(f"crossMod2: {XMOD_DEPTH}")
    L('mix:  { ' + ', '.join(mix) + ' },')
    env_amt = p[7] / 255 * (-1 if invert else 1)
    # Key tracking: the firmware feeds the DAC with (key - 36) * 2, i.e. zero at
    # the bottom key C2 ($F3B3: SBC #$24, $F64A: ASL before STA $14E0), using
    # the KEY TRACK knob through the DAC reference input; the engine centres
    # its tracking on C4, so the 24-key difference moves into the base cutoff.
    # See CUT_SLOPE above.
    kt = p[6] / 255
    key_track = CUT_SLOPE * KEY_W * 2 * kt                       # st per key
    env_engine = CUT_SLOPE * ENV_W * 255 / 60 * abs(env_amt)     # engine envAmount (x60 st)
    base = CUT_OFFSET + CUT_SLOPE * (255 - p[5]) + key_track * (60 - 36)   # pot inverted
    cutoff = (base - 24) / 96
    L(f"filter: {{ mode: '{FILTERS[p[32]]}', cutoff: {r(cutoff)}, resonance: {r(p[10] / 254)}, envAmount: {r(env_engine * (-1 if invert else 1))}, keyTrack: {r(key_track)} }},")
    L(f"envFilter: ADSR({r(attack_time(p[20]))}, {r(env_time(p[22]))}, {r(p[8] / 255)}, {r(rel(p[24]))}),")
    L(f"envAmp:    ADSR({r(attack_time(p[21]))}, {r(env_time(p[23]))}, {r(p[9] / 254)}, {r(rel(p[25]))}),")
    L(f"lfo1: {{ shape: '{LFO_SHAPES[p[31]]}', rate: {r(lfo_rate(p[3]), 2)}, delay: {r(lfo_delay(p[4]), 2)}, depthA: {r(p[1] / 255)}, depthB: {r(p[2] / 255)} }},")
    # defaults() carries env1ToCutoff: 1 for the hand-made memories; the real
    # filter-envelope depth is filter.envAmount, so switch that extra path off.
    mm = ['env1ToCutoff: 0']
    if routing & 0x01: mm.append(f"lfo1ToOsc1Pitch: {PITCH_MOD}")
    if routing & 0x02: mm.append(f"lfo1ToOsc2Pitch: {PITCH_MOD}")
    if routing & 0x04: mm.append(f"lfo1ToOsc1Pwm: {PWM_MOD}")
    if routing & 0x20: mm.append(f"lfo1ToOsc2Pwm: {PWM_MOD}")
    if routing & 0x10: mm.append(f"lfo1ToCutoff: {CUTOFF_MOD}")
    if routing & 0x08: mm.append(f"lfo1ToAmp: {AMP_MOD}")
    L('modMatrix: { ' + ', '.join(mm) + ' },')
    if glide_mode != 'off':
        L(f"glide: {{ mode: '{glide_mode}', amount: {glide_amount}, time: {r(glide_time(p[13]))}, osc1: {str(g_osc1).lower()}, osc2: {str(g_osc2).lower()} }},")
    notes = []
    if not release_on: notes.append('RELEASE switch off')
    if p[38] & 0x40: notes.append('HOLD switch on (not modelled)')
    if transpose1: notes.append(f'OSC1 transpose {transpose1} st')
    chorus = p[33]
    fx = f", {{ chorus: {{ enabled: true, mode: {chorus} }} }}" if chorus else ", { chorus: { enabled: false } }"
    comment = f"  // {name}" + (f" — {'; '.join(notes)}" if notes else '')
    body = '\n'.join(lines)
    return comment, body, fx

def bank_blocks(records, names, kind):
    out = []
    for b in range(4):
        var = f"{'PRESETS' if kind == 'rom' else 'MEM'}_B{b + 1}"
        typ = 'Patch' if kind == 'rom' else 'MemoryEntry'
        out.append(f"// --- Bank {b + 1} ----------------------------------------------------------------\n")
        out.append(f"const {var}: Record<number, {typ}> = {{")
        for prog in range(10):
            i = b * 10 + prog
            name = names[i]
            comment, body, fx = convert(records[i], f"{(b + 1) * 10 + prog} {name}")
            esc = name.replace("'", "\\'")
            if kind == 'rom':
                out.append(f"{comment}\n  {prog}: single('{esc}', L({{\n{body}\n  }}){fx}),")
            else:
                out.append(f"{comment}\n  {prog}: {{ name: '{esc}', patch: single('{esc}', L({{\n{body}\n  }}){fx}) }},")
        out.append('}\n')
    return '\n'.join(out)

if __name__ == '__main__':
    rom = json.load(open(sys.argv[1]))
    mem = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else None
    s = []
    s.append("// ===========================================================================")
    s.append("// SYNTHEX PRESETS — 40 ROM patches (Paul Wiffen, 1982)")
    s.append("// Decoded from the Synthex firmware EPROMs (T41/EM3/FM3): the 40 x 25-byte")
    s.append("// packed records at $D000, unpacked by running the firmware's own recall")
    s.append("// routine in a 6502 emulator (tools/synthex-rom/). Values are the panel")
    s.append("// settings as the hardware stored them; see tools/synthex-rom/README.md")
    s.append("// for the raw-to-engine scaling conventions and which ones are assumptions.")
    s.append("// ===========================================================================\n")
    s.append(bank_blocks(rom, ROM_NAMES, 'rom'))
    if mem:
        s.append("// ===========================================================================")
        s.append("// SYNTHEX MEMORIES — 40 RAM patches shipped on the factory cassette")
        s.append("// Decoded from the original cassette audio (virtual-music.at) with the")
        s.append("// FSK decoder in tools/synthex-rom/. Same record format as the ROM presets.")
        s.append("// ===========================================================================\n")
        s.append("type MemoryEntry = { name: string; patch?: Patch }\n")
        s.append(bank_blocks(mem, MEM_NAMES, 'mem'))
    print('\n'.join(s))
