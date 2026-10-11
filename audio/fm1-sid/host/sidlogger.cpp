// host/sidlogger.cpp - the register stream of a C64 tune from libsidplayfp's full C64 emulation
// (PSID and RSID, every SID of multi-SID tunes), as a sidlog v2 for host/replay.cc.
//
//   build/sidlogger TUNE.sid OUT.sidlog [song] [seconds] [6581|8580]
//
// Links a libsidplayfp 2.6.0 built with tools/libsidplayfp-2.6.0-sidlog.patch (ext/, see
// tools/fetch_ext.sh): the patch calls fm1sid_write_hook with the C64 clock on every SID write.
// Cycles count from the first write (libsidplayfp's power-on stretch is dropped).
// libsidplayfp is GPL-2.0-or-later, so this program's binary is too.
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "sidplayfp/SidConfig.h"
#include "sidplayfp/SidInfo.h"
#include "sidplayfp/SidTune.h"
#include "sidplayfp/SidTuneInfo.h"
#include "sidplayfp/builders/residfp.h"
#include "sidplayfp/sidplayfp.h"

extern "C" void (*fm1sid_write_hook)(const void *chip, unsigned long long clk, unsigned addr, unsigned data);

struct Ev { uint32_t cyc; uint8_t chip, reg, val, pad; };
static std::vector<Ev> evs;
static std::vector<const void *> chips;
static unsigned long long first = ~0ull, last;

static void hook(const void *chip, unsigned long long clk, unsigned addr, unsigned data)
{
    size_t c = 0;
    while (c < chips.size() && chips[c] != chip)
        c++;
    if (c == chips.size())
        chips.push_back(chip);
    if (first == ~0ull)
        first = clk;
    last = clk;
    evs.push_back({(uint32_t)(clk - first), (uint8_t)c, (uint8_t)(addr & 0x1f), (uint8_t)data, 0});
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s TUNE.sid OUT.sidlog [song] [seconds] [6581|8580]\n", argv[0]);
        return 2;
    }
    const unsigned secs = argc > 4 ? (unsigned)atoi(argv[4]) : 30;
    const double clock = 985248.0;
    SidTune tune(argv[1]);
    if (!tune.getStatus()) {
        fprintf(stderr, "%s: %s\n", argv[1], tune.statusString());
        return 1;
    }
    const unsigned song = tune.selectSong(argc > 3 ? (unsigned)atoi(argv[3]) : 0);
    const SidTuneInfo *ti = tune.getInfo();
    int model = ti->sidModel(0) == SidTuneInfo::SIDMODEL_8580 ? 1 : 0;
    if (argc > 5)
        model = atoi(argv[5]) == 8580;

    sidplayfp engine;
    ReSIDfpBuilder rs("fm1sid");
    rs.create(engine.info().maxsids());
    SidConfig cfg = engine.config();
    cfg.frequency = 44100;
    cfg.playback = SidConfig::MONO;
    cfg.sidEmulation = &rs;
    cfg.defaultSidModel = model ? SidConfig::MOS8580 : SidConfig::MOS6581;
    cfg.forceSidModel = argc > 5;
    cfg.defaultC64Model = SidConfig::PAL;
    cfg.forceC64Model = true;
    if (!engine.config(cfg) || !engine.load(&tune)) {
        fprintf(stderr, "sidlogger: %s\n", engine.error());
        return 1;
    }
    fprintf(stderr, "%s / %s / %s\n  %s, song %u of %u, %s\n", ti->infoString(0), ti->numberOfInfoStrings() > 1 ? ti->infoString(1) : "",
            ti->numberOfInfoStrings() > 2 ? ti->infoString(2) : "", ti->formatString(), song, ti->songs(), model ? "8580" : "6581");

    fm1sid_write_hook = hook;
    std::vector<short> buf(4410);
    const unsigned long long want = (unsigned long long)(secs * clock);
    for (int guard = 0; guard < 4000; guard++) {
        engine.play(buf.data(), (uint_least32_t)buf.size());
        if (first != ~0ull && last - first >= want + 20000)
            break;
    }
    fm1sid_write_hook = nullptr;

    uint32_t keep = 0;
    for (const Ev &e : evs)
        if (e.cyc < want)
            evs[keep++] = e;
    uint32_t h[7] = {(uint32_t)model, 44100, 985248, (uint32_t)chips.size(), secs * 44100u, keep, chips.size() > 1 ? 200u : 256u};
    FILE *f = fopen(argv[2], "wb");
    if (!f) {
        perror(argv[2]);
        return 1;
    }
    fwrite("SIDLOG2", 1, 8, f);
    fwrite(h, 4, 7, f);
    fwrite(evs.data(), 8, keep, f);
    fclose(f);
    fprintf(stderr, "  %s: %u writes, %zu SID(s), %u s\n", argv[2], keep, chips.size(), secs);
    return 0;
}
