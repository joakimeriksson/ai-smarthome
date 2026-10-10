/* Differential probe: X0X's 909 bass drum (reference/fm1-x0x, GPL-3.0) rendered on the emulated
 * FM-1 (hard float, X0X's flags) and natively; the outputs must agree bit for bit (or nearly:
 * libm vs the device's own math). Results: OUT[0] = magic, OUT[1..] = float bits. */
#include <stdint.h>
#ifdef NATIVE
#include <stdio.h>
#include <string.h>
static uint32_t OUT[4096];
#else
#define OUT ((volatile uint32_t *)0x01C40000u)
void *memset(void *d, int c, unsigned n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, unsigned n) { unsigned char *p = d; const unsigned char *q = s; while (n--) *p++ = *q++; return d; }
#endif
#include "drum909.c"

static drum909_t D;
static float L[256], R[256], RV[256], DL[256];
static uint32_t bits(float f) { union { float f; uint32_t u; } x = { f }; return x.u; }

int main(void)
{
    int i;
#ifndef NATIVE
    extern uint32_t __data_start[], __data_end[], __data_load[];
    for (i = 0; &__data_start[i] < __data_end; i++)
        __data_start[i] = __data_load[i];
#endif
    drum909_init(&D);
    {   /* the BD voice's state after init (OUT[1024..]) and after the trigger (OUT[2048..]) */
        const uint32_t *w = (const uint32_t *)&D.bt[0];
        for (i = 0; i < (int)(sizeof D.bt[0] / 4); i++) OUT[1024 + i] = w[i];
        drum909_trigger(&D, 0, 1.0f);
        for (i = 0; i < (int)(sizeof D.bt[0] / 4); i++) OUT[2048 + i] = w[i];
        OUT[1023] = sizeof D.bt[0] / 4;
    }
    for (i = 0; i < 256; i++) L[i] = R[i] = RV[i] = DL[i] = 0.0f;
    drum909_render_st(&D, L, R, RV, DL, 64);
    drum909_render_st(&D, L + 64, R + 64, RV + 64, DL + 64, 64);
    drum909_render_st(&D, L + 128, R + 128, RV + 128, DL + 128, 128);
    for (i = 0; i < 256; i++) {
        OUT[1 + i] = bits(L[i]);
        OUT[257 + i] = bits(R[i]);
    }
    OUT[0] = 0x50524F42u;
#ifdef NATIVE
    for (i = 0; i < 3072; i++) printf("%08x\n", OUT[i]);
#else
    for (;;) {}
#endif
    return 0;
}
