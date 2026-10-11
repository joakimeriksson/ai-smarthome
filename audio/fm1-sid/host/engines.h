/* host/engines.h - one C interface over the SID engines that host/replay.cc compares.
 * Each lives in its own translation unit (reSID 0.16 and 1.0 share header names).
 * model: 0 = 6581, 1 = 8580; method: engine-specific sampling mode (see replay.cc) */
#ifndef ENGINES_H
#define ENGINES_H
#ifdef __cplusplus
extern "C" {
#endif
#define ENGINE_API(p) \
    void *p##_new(int model, double clock, double fs, int method); \
    void p##_write(void *e, int reg, int val); \
    int p##_clock(void *e, int cycles, short *buf, int max); \
    void p##_free(void *e);
ENGINE_API(r016)
ENGINE_API(r10)
ENGINE_API(rfp)
#ifdef __cplusplus
}
#endif
#endif
