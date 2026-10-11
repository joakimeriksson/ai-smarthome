/* player/psid.h - run a PSID tune's 6502 code and report its SID writes, cycle-exact.
 *
 * The 6502 is floooh's chips m6502.h (zlib licence, fetched into ext/chips by
 * tools/fetch_ext.sh): cycle-stepped, decimal mode, the undocumented opcodes. Around it the
 * PSID environment: 64 KB RAM with the $01 banking of the I/O area, CIA 1 timer A as the
 * speed source of CIA-timed tunes, the SID registers ($D400-$D7FF, every 32 bytes); no ROMs,
 * no VIC beyond the raster counter, no NMI. Enough for PSID tunes (init + a play routine per
 * frame); RSID tunes need a whole C64 (host/sidlogger.cpp, libsidplayfp).
 *
 * Portable C: the host (player/psidlog.c, checked against libsidplayfp's register stream)
 * and the FM-1 firmware (firmware/) run the same code.
 * SPDX-License-Identifier: BSD-2-Clause */
#ifndef PSID_H
#define PSID_H
#include <stdint.h>

#define PSID_PAL_CLOCK 985248u
#define PSID_PAL_FRAME 19656u            /* 312 lines x 63 cycles */

/* a SID write: cycle = cycles since the start of this init / play call */
typedef void (*psid_write_fn)(void *user, uint32_t cycle, uint32_t reg, uint32_t val);

typedef struct psid psid_t;

/* the tune's header fields (strings NUL-terminated, Latin-1) */
typedef struct {
    char name[33], author[33], released[33];
    uint16_t load, init, play;
    uint16_t songs, start;
    uint32_t speed;                       /* bit n set: song n+1 is CIA-timed */
    uint8_t model;                        /* 0 6581, 1 8580 (header flags; unknown -> 6581) */
} psid_info_t;

/* the player state is large (64 KB RAM): static storage on the FM-1 */
uint32_t psid_size(void);
int psid_load(psid_t *p, const uint8_t *data, uint32_t len, psid_write_fn wr, void *user);   /* 0: ok */
const psid_info_t *psid_info(const psid_t *p);
/* run the init routine for song (1-based); returns the cycles it took */
uint32_t psid_init(psid_t *p, uint32_t song);
/* cycles from one play call to the next (a PAL frame, or the CIA timer A latch) */
uint32_t psid_period(const psid_t *p);
/* run one play call (or the tune's own interrupt handler); returns the cycles it took */
uint32_t psid_play(psid_t *p);

#endif
