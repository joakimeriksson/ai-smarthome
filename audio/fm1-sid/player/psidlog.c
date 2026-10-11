/* player/psidlog.c - player/psid.c on the host: a PSID tune's register stream as sidlog v2,
 * to check the player (the FM-1 firmware runs the same code) against libsidplayfp's stream
 * (build/sidlogger) and its audio.
 *   build/psidlog TUNE.sid OUT.sidlog [song] [seconds]
 * SPDX-License-Identifier: BSD-2-Clause */
#include <stdio.h>
#include <stdlib.h>
#include "psid.h"

typedef struct { uint32_t cyc; uint8_t chip, reg, val, pad; } ev_t;
static ev_t *ev;
static uint32_t nev, cap, base;

static void wr(void *user, uint32_t cycle, uint32_t reg, uint32_t val)
{
    (void)user;
    if (nev == cap)
        ev = realloc(ev, (cap = cap ? 2 * cap : 65536) * sizeof *ev);
    ev[nev].cyc = base + cycle;
    ev[nev].chip = 0;
    ev[nev].reg = (uint8_t)reg;
    ev[nev].val = (uint8_t)val;
    ev[nev++].pad = 0;
}

int main(int argc, char **argv)
{
    static uint8_t buf[65536 + 128];
    psid_t *p = malloc(psid_size());
    FILE *f;
    size_t n;
    uint32_t song, secs, total, t, keep = 0, i;
    if (argc < 3) {
        fprintf(stderr, "usage: %s TUNE.sid OUT.sidlog [song] [seconds]\n", argv[0]);
        return 2;
    }
    f = fopen(argv[1], "rb");
    if (!f) { perror(argv[1]); return 1; }
    n = fread(buf, 1, sizeof buf, f);
    fclose(f);
    if (psid_load(p, buf, (uint32_t)n, wr, 0)) {
        fprintf(stderr, "%s: not a PSID tune\n", argv[1]);
        return 1;
    }
    song = argc > 3 ? (uint32_t)atoi(argv[3]) : 0;
    secs = argc > 4 ? (uint32_t)atoi(argv[4]) : 30;
    total = secs * PSID_PAL_CLOCK;
    base = 0;
    t = psid_init(p, song);
    t = (t / PSID_PAL_FRAME + 1) * PSID_PAL_FRAME;
    while (t < total) {
        base = t;
        psid_play(p);
        t += psid_period(p);
    }
    for (i = 0; i < nev; i++)
        if (ev[i].cyc < total)
            ev[keep++] = ev[i];
    {
        uint32_t h[7] = {psid_info(p)->model, 44100, PSID_PAL_CLOCK, 1, secs * 44100u, keep, 256};
        f = fopen(argv[2], "wb");
        fwrite("SIDLOG2", 1, 8, f);
        fwrite(h, 4, 7, f);
        fwrite(ev, 8, keep, f);
        fclose(f);
    }
    fprintf(stderr, "%s / %s: %u writes\n", psid_info(p)->name, psid_info(p)->author, keep);
    return 0;
}
