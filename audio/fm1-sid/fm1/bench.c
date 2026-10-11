/* fm1/bench.c - the SID workload (workload.h) as a bare-metal pi32v2 program for the FM-1
 * emulator (../../fm-1): no RTOS, no HAL, just the CPU. bench_mark() brackets the timed
 * render (break on it with --break-pc: the step counts give instructions per sample); the
 * results land in RAM for --dump:
 *   RES[0] magic "SIDB", RES[1] hash, RES[2] samples, RES[3] chips, then the samples (int16 pairs)
 * SPDX-License-Identifier: BSD-2-Clause */
#include <stdint.h>
#include "workload.h"

#define RES ((volatile uint32_t *)0x01C80000u)

void *memset(void *d, int c, unsigned n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, unsigned n) { unsigned char *p = d; const unsigned char *q = s; while (n--) *p++ = *q++; return d; }

static int32_t buf[WL_SAMPLES];

__attribute__((noinline)) void bench_mark(uint32_t what) { RES[15] = what; }

int main(void)
{
    extern uint32_t __data_start[], __data_end[], __data_load[], __bss_start[], __bss_end[];
    uint32_t i;
    for (i = 0; &__data_start[i] < __data_end; i++)
        __data_start[i] = __data_load[i];
    for (i = 0; &__bss_start[i] < __bss_end; i++)
        __bss_start[i] = 0;
    bench_mark(1);               /* init: builds the combined-waveform tables */
    wl_init();
    bench_mark(2);               /* the timed render */
    wl_render(buf, WL_SAMPLES);
    bench_mark(3);
    RES[1] = wl_hash(buf, WL_SAMPLES);
    RES[2] = WL_SAMPLES;
    RES[3] = WL_CHIPS;
    for (i = 0; i < WL_SAMPLES; i += 2) {
        int32_t a = buf[i], b = i + 1 < WL_SAMPLES ? buf[i + 1] : 0;
        a = a > 32767 ? 32767 : a < -32768 ? -32768 : a;
        b = b > 32767 ? 32767 : b < -32768 ? -32768 : b;
        RES[16 + i / 2] = (uint32_t)(uint16_t)a | (uint32_t)(uint16_t)b << 16;
    }
    RES[0] = 0x53494442u;        /* "SIDB" */
    for (;;) {}
    return 0;
}
