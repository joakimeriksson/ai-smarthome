/* sidsynth.h - a playable synth around one or more SID chips (sid.h), the way C64 music
 * drivers use the chip: register writes once per frame (50 Hz PAL, or 2x / 4x "multispeed"),
 * driven by per-instrument tables:
 *
 *   wavetable  per frame: waveform bits + a note offset, with a loop point. Drums (a noise
 *              frame, then a falling pulse), the C64 "chord" arpeggio (0, 4, 7 looped),
 *              attack transients all come from here
 *   pulse      pulse width sweep, ping-pong between two limits
 *   filter     mode, resonance, cutoff start and per-frame sweep (one filter per chip: the
 *              notes that share a chip share it, as on the real thing)
 *   vibrato    delay, speed, depth
 *   mod        sync / ring: the note then takes two of a chip's voices (voice 1 sounds, voice
 *              3 runs silent as the sync / ring source at its own interval and sweep)
 *   hard restart  a frame of ADSR 0 / gate off before a retrigger, so attacks stay sharp
 *
 * Polyphony: 3 notes per chip (1 per chip with sync / ring patches); 1 to SYN_MAXCHIPS chips.
 * SPDX-License-Identifier: BSD-2-Clause */
#ifndef SIDSYNTH_H
#define SIDSYNTH_H
#include "sid.h"

#define SYN_MAXCHIPS 4
#define SYN_WT 16

typedef struct {
    const char *name;
    uint8_t ad, sr;
    uint8_t wt_len, wt_loop;     /* wt_loop >= wt_len: stay on the last row */
    uint8_t wt_ctrl[SYN_WT];     /* SID_TRI / SAW / PULSE / NOISE (+ SID_TEST); the gate is the synth's */
    int8_t wt_note[SYN_WT];      /* semitones from the played note */
    uint16_t pw;                 /* 12-bit start width */
    int16_t pw_speed;            /* per frame */
    uint16_t pw_lo, pw_hi;
    uint8_t filter;              /* 0: off, else SID_LP | SID_BP | SID_HP */
    uint8_t res;                 /* 0..15 */
    uint16_t cutoff;             /* 11-bit start */
    int16_t cut_speed;           /* per frame, clamped to cut_lo..cut_hi */
    uint16_t cut_lo, cut_hi;
    uint8_t vib_delay, vib_speed, vib_depth;   /* frames; LFO step per frame (1024 = a cycle); Q8 semitones */
    uint8_t mod;                 /* 0, SID_SYNC, SID_RING or both */
    int8_t mod_note;             /* the source's interval from the played note */
    int16_t mod_sweep;           /* per frame, Q8 semitones, added to the sounding voice (sync sweeps) */
    uint8_t hr;                  /* hard restart frames (0: none) */
} sid_patch_t;

typedef struct {
    uint8_t chip, idx;           /* SID voice */
    uint8_t note, held, busy;
    uint8_t pos, hr_left;
    uint8_t ctrl;                /* last control byte written */
    uint32_t age;
    uint32_t frame;
    int32_t sweep;               /* Q8 semitones */
    int32_t pw, pw_dir;
    int32_t vib;                 /* LFO phase, Q8 */
} syn_voice_t;

typedef struct {
    sid_t chip[SYN_MAXCHIPS];
    syn_voice_t v[SYN_MAXCHIPS * 3];
    sid_patch_t p;               /* the playing patch: a copy, edited by the knobs */
    uint32_t nchips, nslots;
    uint32_t fs, rate;           /* output rate; frames per second (50 = PAL) */
    uint32_t tick_left, tick_err;
    uint32_t clock_age;
    int32_t cut[SYN_MAXCHIPS];   /* each chip's sweeping cutoff */
    int32_t cut_ofs;             /* knob offset to the cutoff */
    int32_t transpose;           /* semitones */
    uint8_t vol;
} sidsyn_t;

void sidsyn_init(sidsyn_t *y, uint32_t nchips, sid_model_t model, uint32_t fs);
void sidsyn_set_patch(sidsyn_t *y, const sid_patch_t *p);
void sidsyn_note_on(sidsyn_t *y, uint32_t note);
void sidsyn_note_off(sidsyn_t *y, uint32_t note);
void sidsyn_all_off(sidsyn_t *y);
/* n mono samples, ~Q15 (the chips mixed and scaled down for headroom) */
void sidsyn_render(sidsyn_t *y, int32_t *out, uint32_t n);

extern const sid_patch_t SID_PATCHES[];
extern const uint32_t SID_NPATCHES;

#endif
