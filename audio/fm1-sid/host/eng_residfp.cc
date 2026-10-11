// reSIDfp (libresidfp: Dag Lem, Antti Lankila, Leandro Nini; GPL-2.0-or-later) behind host/engines.h
#include "SID.h"
#include "engines.h"
using namespace reSIDfp;

extern "C" void *rfp_new(int model, double clock, double fs, int method)
{
    SID *s = new SID();
    s->setChipModel(model ? CSG8580 : MOS6581);
    s->setSamplingParameters(clock, (SamplingMethod)method, fs);
    return s;
}
extern "C" void rfp_write(void *e, int reg, int val) { ((SID *)e)->write(reg, (uint8_t)val); }
extern "C" int rfp_clock(void *e, int cycles, short *buf, int max)
{
    (void)max;   /* the caller sizes buf for cycles * fs / clock + margin */
    return ((SID *)e)->clock((unsigned)cycles, buf);
}
extern "C" void rfp_free(void *e) { delete (SID *)e; }
