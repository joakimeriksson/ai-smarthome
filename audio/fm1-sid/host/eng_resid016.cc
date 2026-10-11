// reSID 0.16 (Dag Lem, GPL-2.0-or-later) behind host/engines.h
#include "sid.h"
#include "engines.h"

extern "C" void *r016_new(int model, double clock, double fs, int method)
{
    SID *s = new SID();
    s->set_chip_model(model ? MOS8580 : MOS6581);
    s->enable_filter(true);
    s->enable_external_filter(true);
    s->set_sampling_parameters(clock, (sampling_method)method, fs);
    return s;
}
extern "C" void r016_write(void *e, int reg, int val) { ((SID *)e)->write(reg, val); }
extern "C" int r016_clock(void *e, int cycles, short *buf, int max)
{
    cycle_count dt = cycles;
    int n = 0;
    while (dt > 0 && n < max)
        n += ((SID *)e)->clock(dt, buf + n, max - n);
    return n;
}
extern "C" void r016_free(void *e) { delete (SID *)e; }
