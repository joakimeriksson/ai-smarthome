/* Differential probe for the AC791N FPU (`-mcpu=r3`, tools/probe_build.sh fpu): each float
 * expression runs on `volatile` inputs (real `3f e5` / `iff` instructions) and is compared
 * with the same expression folded by LLVM at compile time (IEEE single precision). */
#include "harness/probe.h"

static uint32_t bits(float f) { union { float f; uint32_t u; } x = { f }; return x.u; }
#define F(rt, ct) p_check(bits(rt), bits(ct))
#define I(rt, ct) p_check((uint32_t)(rt), (uint32_t)(ct))

static float vals[] = { 0.0f, -0.0f, 1.0f, -1.0f, 0.5f, 3.25f, -7.75f, 1e-3f, 12345.678f, -98765.43f, 1e30f, -2.5e-20f };
#define NV (sizeof vals / sizeof vals[0])

int main(void)
{
    volatile float a = 3.25f, b = -7.75f, c = 0.1f, big = 1e30f, tiny = 1e-30f, half = 0.5f;
    volatile int32_t si = -123456, sp = 77;
    volatile uint32_t ui = 3000000000u;
    volatile float nan_v = __builtin_nanf("");
    unsigned i, j;

    F(a + b, 3.25f + -7.75f);
    F(a - b, 3.25f - -7.75f);
    F(a * b, 3.25f * -7.75f);
    F(a / b, 3.25f / -7.75f);
    F(c * c, 0.1f * 0.1f);
    F(c / a, 0.1f / 3.25f);
    F(big * big, 1e30f * 1e30f);
    F(tiny * tiny, 1e-30f * 1e-30f);
    F(half - half, 0.5f - 0.5f);
    F(b * a + c, -7.75f * 3.25f + 0.1f);
    F(__builtin_fminf(a, b), -7.75f);
    F(__builtin_fmaxf(a, b), 3.25f);
    F(__builtin_fminf(c, a), 0.1f);
    F(__builtin_fmaxf(c, b), 0.1f);
    I((int32_t)a, 3);
    I((int32_t)b, -7);
    I((int32_t)(b * 1000.0f), -7750);
    I((uint32_t)(big), 0xffffffffu);          /* saturates (LLVM: poison; hardware-defined) */
    I((uint32_t)a, 3u);
    F((float)si, -123456.0f);
    F((float)sp, 77.0f);
    F((float)ui, 3000000000.0f);
    F((float)(si * 3), -370368.0f);
    /* all ops over a value grid, compared with the same ops on the folded constants */
    for (i = 0; i < NV; i++)
        for (j = 0; j < NV; j++) {
            volatile float x = vals[i], y = vals[j];
            float xs = vals[i], ys = vals[j];
            F(x + y, xs + ys);
            F(x - y, xs - ys);
            F(x * y, xs * ys);
            if (ys != 0.0f) F(x / y, xs / ys);
            I(x < y, xs < ys);
            I(x <= y, xs <= ys);
            I(x > y, xs > ys);
            I(x >= y, xs >= ys);
            I(x == y, xs == ys);
            I(x != y, xs != ys);
        }
    /* unordered: every compare with NaN is false except != */
    I(a < nan_v, 0); I(a <= nan_v, 0); I(a > nan_v, 0); I(a >= nan_v, 0); I(a == nan_v, 0); I(a != nan_v, 1);
    I(nan_v < a, 0); I(!(nan_v >= a), 1); I(!(nan_v > a), 1); I(!(nan_v <= a), 1); I(!(nan_v < a), 1);
    I(__builtin_isunordered(a, nan_v), 1); I(__builtin_isunordered(a, b), 0);
    /* compares that branch (goto form) */
    for (i = 0; i < NV; i++) {
        volatile float x = vals[i];
        float xs = vals[i];
        int r = 0, e = 0;
        if (x < a) r |= 1;
        if (x > b) r |= 2;
        if (x <= c) r |= 4;
        if (!(x >= half)) r |= 8;
        if (x == 1.0f) r |= 16;
        if (xs < 3.25f) e |= 1;
        if (xs > -7.75f) e |= 2;
        if (xs <= 0.1f) e |= 4;
        if (!(xs >= 0.5f)) e |= 8;
        if (xs == 1.0f) e |= 16;
        I(r, e);
    }
    p_done();
    for (;;) {}
}
