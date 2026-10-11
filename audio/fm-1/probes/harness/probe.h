/* Shared probe conventions. Results block at RESULTS (RAM):
 *   [0] = magic 0x50524F42 ("PROB") written last, [1] = number of tests,
 *   [2] = number of failures, then per failure: index, got, expected.
 * The runner prints it with `--dump 0x01C10000 64`. */
#ifndef PROBE_H
#define PROBE_H
#include <stdint.h>

#define RESULTS ((volatile uint32_t *)0x01C10000u)
#define MAX_FAIL 16

static uint32_t p_n, p_fail;

static void p_check(uint32_t got, uint32_t exp)
{
    if (got != exp && p_fail < MAX_FAIL) {
        RESULTS[3 + p_fail * 3] = p_n;
        RESULTS[4 + p_fail * 3] = got;
        RESULTS[5 + p_fail * 3] = exp;
    }
    if (got != exp)
        p_fail++;
    p_n++;
}

static void p_done(void)
{
    RESULTS[1] = p_n;
    RESULTS[2] = p_fail;
    RESULTS[0] = 0x50524F42u;
}
#endif
