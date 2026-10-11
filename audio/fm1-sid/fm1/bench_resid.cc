// fm1/bench_resid.cc - reSID 0.16 (GPL-2.0-or-later, fetched into ext/, not in this repo) on the
// emulated FM-1: replays the bench workload's register log (fm1/sidlog2h.py) with the sampling
// method METHOD (0 fast, 1 interpolate, 2 resample-interpolate), bracketed by bench_mark like
// fm1/bench.c. Results at RES as in bench.c, plus RES[4] = the heap high-water mark (bytes).
#include "sid.h"
#include "wl_log.h"
#include <stdint.h>

#ifdef NATIVE
#include <stdio.h>
static uint32_t RES[16 + 6000 + 3200];
#else
#define RES ((volatile uint32_t *)0x01C80000u)
#endif
#ifndef METHOD
#define METHOD 0
#endif

static char arena[200 * 1024] __attribute__((aligned(8)));
static uint32_t arena_top;
#ifndef NATIVE
void *operator new(__SIZE_TYPE__ n) { void *p = arena + arena_top; arena_top += (n + 7u) & ~7u; return p; }
void *operator new[](__SIZE_TYPE__ n) { return operator new(n); }
void operator delete(void *) {}
void operator delete[](void *) {}
extern "C" void __cxa_pure_virtual() { for (;;) {} }
extern "C" void *memset(void *d, int c, __SIZE_TYPE__ n) { unsigned char *p = (unsigned char *)d; while (n--) *p++ = (unsigned char)c; return d; }
extern "C" void *memcpy(void *d, const void *s, __SIZE_TYPE__ n) { unsigned char *p = (unsigned char *)d; const unsigned char *q = (const unsigned char *)s; while (n--) *p++ = *q++; return d; }
#endif

static short buf[LOG_SAMPLES + 64];
static SID *sid;
static uint32_t nout;
static uint32_t done;

extern "C" __attribute__((noinline)) void bench_mark(uint32_t what) { RES[15] = what; }

static void clock_to(uint32_t target)
{
    while (done < target) {
        cycle_count dt = (cycle_count)(target - done);
        while (dt > 0 && nout < LOG_SAMPLES + 64)
            nout += sid->clock(dt, buf + nout, LOG_SAMPLES + 64 - nout);
        done = target;
    }
}
static uint32_t cyc(uint32_t pos) { return (uint32_t)((uint64_t)pos * LOG_CLOCK / LOG_FS); }

extern "C" int main(void)
{
    uint32_t i, h = 2166136261u;
#ifndef NATIVE
    extern uint32_t __data_start[], __data_end[], __data_load[], __bss_start[], __bss_end[];
    typedef void (*ctor_t)(void);
    extern ctor_t __init_array_start[], __init_array_end[];
    for (i = 0; &__data_start[i] < __data_end; i++)
        __data_start[i] = __data_load[i];
    for (i = 0; &__bss_start[i] < __bss_end; i++)
        __bss_start[i] = 0;
    for (ctor_t *c = __init_array_start; c < __init_array_end; c++)
        (*c)();
#endif
    bench_mark(1);              /* init: the object, the FIR table for resampling */
    sid = new SID();
    sid->set_chip_model(LOG_MODEL ? MOS8580 : MOS6581);
    sid->set_sampling_parameters(LOG_CLOCK, (sampling_method)METHOD, LOG_FS);
    bench_mark(2);              /* the timed replay */
    for (i = 0; i < LOG_NEV; i++) {
        clock_to(cyc(LOG_EV[i].pos));
        sid->write(LOG_EV[i].reg, LOG_EV[i].val);
#ifdef STATEDUMP
        {   /* debug: reSID's state after some writes, at RES[16 + 32 k] */
            static const uint32_t AT[6] = {5, 20, 40, 60, 100, 200};
            for (uint32_t k = 0; k < 6; k++)
                if (i == AT[k]) {
                    SID::State st = sid->read_state();
                    volatile uint32_t *o = &RES[6000 + 32 * k];
                    for (uint32_t v = 0; v < 3; v++) {
                        o[v] = st.accumulator[v];
                        o[3 + v] = st.shift_register[v];
                        o[6 + v] = st.rate_counter[v];
                        o[9 + v] = st.rate_counter_period[v];
                        o[12 + v] = st.exponential_counter[v];
                        o[15 + v] = st.envelope_counter[v];
                        o[18 + v] = st.envelope_state[v];
                        o[21 + v] = st.hold_zero[v];
                    }
                    o[24] = done;
                    o[25] = nout;
                }
        }
#endif
    }
    clock_to(cyc(LOG_SAMPLES) + 64);
    bench_mark(3);
    for (i = 0; i < LOG_SAMPLES; i++)
        h = (h ^ (uint32_t)(int32_t)(i < nout ? buf[i] : 0)) * 16777619u;
    RES[1] = h;
    RES[2] = LOG_SAMPLES;
    RES[3] = 1;
    RES[4] = arena_top;
    for (i = 0; i < LOG_SAMPLES; i += 2)
        RES[16 + i / 2] = (uint32_t)(uint16_t)buf[i] | (uint32_t)(uint16_t)buf[i + 1] << 16;
    RES[0] = 0x53494442u;
#ifdef NATIVE
    printf("hash %08x heap %u\n", RES[1], RES[4]);
#ifdef STATEDUMP
    for (i = 0; i < 6 * 32; i++)
        printf("%08x%c", RES[6000 + i], i % 8 == 7 ? '\n' : ' ');
#endif
    return 0;
#endif
    for (;;) {}
    return 0;
}
