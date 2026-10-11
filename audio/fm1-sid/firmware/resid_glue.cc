// firmware/resid_glue.cc - reSID 0.16 (Dag Lem, GPL-2.0-or-later, ext/resid-0.16) for the SID
// player firmware: one chip in static storage, a bump allocator for its sample ring, C entry
// points for firmware/main.c.
// SPDX-License-Identifier: GPL-3.0-only
#include "sid.h"

static unsigned char heap[40 * 1024] __attribute__((aligned(8)));
static unsigned heap_top;
void *operator new(__SIZE_TYPE__ n)
{
    void *p = heap + heap_top;
    heap_top += (unsigned)((n + 7u) & ~7u);
    return heap_top <= sizeof heap ? p : 0;
}
void *operator new[](__SIZE_TYPE__ n) { return operator new(n); }
void operator delete(void *) {}
void operator delete[](void *) {}
inline void *operator new(__SIZE_TYPE__, void *p) { return p; }
extern "C" void __cxa_pure_virtual() { for (;;) {} }

static SID *chip;
static unsigned char store[sizeof(SID)] __attribute__((aligned(8)));

extern "C" void rs_init(int model, double clock, double fs)
{
    heap_top = 0;                         // the previous chip's ring goes with it
    chip = new (store) SID();
    chip->set_chip_model(model ? MOS8580 : MOS6581);
    chip->enable_filter(true);
    chip->enable_external_filter(true);
    chip->set_sampling_parameters(clock, SAMPLE_FAST, fs);
}

extern "C" void rs_write(int reg, int val) { chip->write(reg, val); }

// clock up to *cycles, producing at most n samples; *cycles is what is left
extern "C" int rs_clock(int *cycles, short *buf, int n)
{
    cycle_count dt = *cycles;
    int got = chip->clock(dt, buf, n);
    *cycles = dt;
    return got;
}

// the voices' envelope levels (0..255), for the display
extern "C" void rs_env(unsigned char env[3])
{
    SID::State st = chip->read_state();
    env[0] = st.envelope_counter[0];
    env[1] = st.envelope_counter[1];
    env[2] = st.envelope_counter[2];
}
