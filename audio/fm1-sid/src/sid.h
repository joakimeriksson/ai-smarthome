/* sid.h - a register-level model of the MOS 6581 / 8580 SID, written for the M-VAVE FM-1
 * (JieLi pi32v2, 240 MHz) and for the host.
 *
 * Integer only: the same samples come out on the host and on the FM-1 (no float, no 64-bit
 * arithmetic, no divisions per sample). The chip is clocked in batches: every output sample
 * advances it by the number of SID cycles that fit in it (~22.3 at 985 kHz / 44.1 kHz), and
 * the parts that need cycle precision get it analytically:
 *
 *   - oscillators: 24-bit phase accumulators; hard sync resets the synced phase to where it
 *     would be after the source's MSB rose inside the batch; noise is the 23-bit LFSR, clocked
 *     once per rising edge of accumulator bit 19 (several times per sample at high pitches)
 *   - envelope: the 15-bit rate counter, the rate period table and the exponential decay
 *     divider of the real chip, including the "ADSR bug" (lowering a rate below the counter
 *     makes the counter wrap through 0x7FFF first)
 *   - combined waveforms: AND of the components with a neighbour-bit pull-down model (tables
 *     built at init; an approximation, see README)
 *   - filter: a 12 dB/oct state variable filter (TPT form: stable up to the top of the
 *     range), the cutoff curve of the 6581 (S-shaped, approximate) or the 8580 (linear)
 *   - 6581 DC offsets, so that writes to the volume register make sound ("digis")
 *
 * Clean-room: written from public descriptions of the chip, no code from reSID / reSIDfp.
 * SPDX-License-Identifier: BSD-2-Clause */
#ifndef SID_H
#define SID_H
#include <stdint.h>

typedef enum { SID_6581 = 0, SID_8580 = 1 } sid_model_t;

#define SID_CLOCK_PAL  985248u
#define SID_CLOCK_NTSC 1022727u

/* control register bits (D404 / D40B / D412) */
#define SID_GATE  0x01u
#define SID_SYNC  0x02u
#define SID_RING  0x04u
#define SID_TEST  0x08u
#define SID_TRI   0x10u
#define SID_SAW   0x20u
#define SID_PULSE 0x40u
#define SID_NOISE 0x80u

/* register numbers (offsets from D400) */
enum {
    SID_FREQ_LO = 0, SID_FREQ_HI, SID_PW_LO, SID_PW_HI, SID_CTRL, SID_AD, SID_SR,   /* + 7 * voice */
    SID_FC_LO = 0x15, SID_FC_HI, SID_RES_FILT, SID_MODE_VOL,
    SID_POTX, SID_POTY, SID_OSC3, SID_ENV3
};

/* D418 mode bits */
#define SID_LP   0x10u
#define SID_BP   0x20u
#define SID_HP   0x40u
#define SID_3OFF 0x80u

typedef struct {
    uint32_t acc;                /* 24-bit phase accumulator */
    uint32_t freq;               /* 16-bit frequency register */
    uint32_t pw;                 /* 12-bit pulse width */
    uint32_t lfsr;               /* 23-bit noise shift register */
    uint32_t noise;              /* the noise output (12 bits, 8 significant) */
    uint32_t out;                /* last waveform output (12 bits): kept when no wave is selected */
    uint8_t ctrl;
    uint8_t msb_rose;            /* the MSB went 0 -> 1 in the last sample (sync source) */
    /* envelope */
    uint8_t env;                 /* 8-bit envelope counter */
    uint8_t state;               /* ENV_ATTACK / ENV_DECAY / ENV_RELEASE */
    uint8_t ad, sr;
    uint8_t hold_zero;           /* reached 0 in decay/release: frozen until the next gate */
    uint8_t exp_cnt;
    uint16_t rate_cnt;           /* 15-bit rate counter */
    uint16_t rate_period;        /* the current state's period (cycles) */
} sid_voice_t;

typedef struct {
    sid_voice_t v[3];
    uint8_t reg[32];             /* last value written (reads of write-only registers) */
    uint8_t model;
    uint8_t res_filt, mode_vol;
    uint16_t fc;                 /* 11-bit cutoff */
    uint32_t fs;                 /* output sample rate */
    uint32_t cyc_q16;            /* SID cycles per output sample, Q16 */
    uint32_t cyc_frac;
    /* filter: TPT SVF, coefficients Q12, states in the voice-sum scale */
    int32_t ic1, ic2;
    int32_t a1, a2, a3, k;
    int32_t voice_zero;          /* waveform DAC zero level (12-bit): 0x380 6581, 0x800 8580 */
    int32_t mixer_dc;            /* 6581: the DC that the volume register scales */
    /* output DC blocker */
    int32_t hp_x1, hp_y1;
} sid_t;

void sid_init(sid_t *s, sid_model_t model, uint32_t clock_hz, uint32_t fs);
void sid_reset(sid_t *s);
void sid_write(sid_t *s, uint32_t reg, uint32_t val);
uint32_t sid_read(sid_t *s, uint32_t reg);
/* n samples, mono, ~Q15 (three full voices at volume 15 peak near -3 dBFS; resonance and the
 * output's AC coupling can go past 16 bits: clamp when converting) */
void sid_render(sid_t *s, int32_t *out, uint32_t n);
/* like sid_render, but adds into out (several chips into one buffer) */
void sid_render_add(sid_t *s, int32_t *out, uint32_t n);

#ifdef SID_LOG
/* host builds only: see every write and every render, to record the register stream
 * (host/record.c) and play it on other SID engines (host/replay.cc) */
extern void (*sid_log_init)(const sid_t *s);
extern void (*sid_log_write)(const sid_t *s, uint32_t reg, uint32_t val);
extern void (*sid_log_render)(const sid_t *s, uint32_t n);
#endif

#endif
