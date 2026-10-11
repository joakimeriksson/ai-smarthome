/* fm1/workload.h - the bench workload, the same code on the host (host/demo.c hash) and on
 * the emulated FM-1 (fm1/bench.c): WL_CHIPS SID chips (6581), a held chord on every voice
 * with the SAW LEAD patch (filter, vibrato), a chord change halfway. The hash of the
 * samples must agree bit for bit.
 * SPDX-License-Identifier: BSD-2-Clause */
#ifndef WORKLOAD_H
#define WORKLOAD_H
#include "../src/sidsynth.h"

#ifndef WL_CHIPS
#define WL_CHIPS 1
#endif
#ifndef WL_SAMPLES
#define WL_SAMPLES 11025u        /* 0.25 s */
#endif

static sidsyn_t wl_syn;

static void wl_init(void)
{
    sidsyn_init(&wl_syn, WL_CHIPS, SID_6581, 44100u);
    sidsyn_set_patch(&wl_syn, &SID_PATCHES[0]);
}

static void wl_notes(uint32_t base)
{
    uint32_t i;
    sidsyn_all_off(&wl_syn);
    for (i = 0; i < WL_CHIPS * 3u; i++)
        sidsyn_note_on(&wl_syn, base + i * 4u);
}

/* render in 128-sample blocks (Felucca's I2S half buffer) */
static void wl_render(int32_t *out, uint32_t n)
{
    uint32_t i;
    for (i = 0; i < n; i += 128u) {
        if (i == 0)
            wl_notes(48);
        if (i == (n / 2u & ~127u))
            wl_notes(53);
        sidsyn_render(&wl_syn, out + i, n - i < 128u ? n - i : 128u);
    }
}

static void wl_run(int32_t *out, uint32_t n)
{
    wl_init();
    wl_render(out, n);
}

static uint32_t wl_hash(const int32_t *x, uint32_t n)
{
    uint32_t h = 2166136261u, i;
    for (i = 0; i < n; i++)
        h = (h ^ (uint32_t)x[i]) * 16777619u;
    return h;
}
#endif
