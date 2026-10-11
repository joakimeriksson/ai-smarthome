// host/replay.cc - play a register stream (host/demo.c record) on several SID engines.
//
//   build/sid_replay LOG.sidlog OUTPREFIX [engine ...]
//
// engines: own (src/sid.c), r016-fast, r016-interp, r016-resample (reSID 0.16), r10-fast,
// r10-resample (reSID 1.0), rfp-decimate, rfp-resample (reSIDfp). Writes OUTPREFIX.<engine>.wav
// and prints the host cost per second of audio. Every chip is clocked to the cycle of each
// write (sample * clock / fs), so all engines get the same input.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
extern "C" {
#include "../src/sid.h"
}
#include "engines.h"

struct Ev { uint32_t pos; uint8_t chip, reg, val, pad; };
struct Log { uint32_t model, fs, clock, chips, samples, nev, mix; std::vector<Ev> ev; };

static Log load(const char *path)
{
    Log l;
    char magic[8];
    FILE *f = fopen(path, "rb");
    if (!f || fread(magic, 1, 8, f) != 8 || memcmp(magic, "SIDLOG1", 8)) {
        fprintf(stderr, "%s: not a sidlog\n", path);
        exit(1);
    }
    uint32_t h[7];
    if (fread(h, 4, 7, f) != 7) exit(1);
    l.model = h[0]; l.fs = h[1]; l.clock = h[2]; l.chips = h[3]; l.samples = h[4]; l.nev = h[5]; l.mix = h[6];
    l.ev.resize(l.nev);
    if (fread(l.ev.data(), 8, l.nev, f) != l.nev) exit(1);
    fclose(f);
    return l;
}

static void wav(const std::string &path, const std::vector<int32_t> &x, uint32_t fs)
{
    FILE *f = fopen(path.c_str(), "wb");
    uint32_t n = (uint32_t)x.size(), v;
    fwrite("RIFF", 1, 4, f); v = 36 + n * 2; fwrite(&v, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f); v = 16; fwrite(&v, 4, 1, f);
    v = 1 | 1u << 16; fwrite(&v, 4, 1, f); fwrite(&fs, 4, 1, f); v = fs * 2; fwrite(&v, 4, 1, f);
    v = 2 | 16u << 16; fwrite(&v, 4, 1, f); fwrite("data", 1, 4, f); v = n * 2; fwrite(&v, 4, 1, f);
    for (int32_t s : x) {
        int16_t o = (int16_t)(s > 32767 ? 32767 : s < -32768 ? -32768 : s);
        fwrite(&o, 2, 1, f);
    }
    fclose(f);
}

typedef void *(*NewF)(int, double, double, int);
typedef void (*WrF)(void *, int, int);
typedef int (*ClkF)(void *, int, short *, int);
typedef void (*FreeF)(void *);
struct Eng { const char *name; NewF mk; WrF wr; ClkF clk; FreeF fr; int method; };
static const Eng ENGINES[] = {
    {"r016-fast", r016_new, r016_write, r016_clock, r016_free, 0},
    {"r016-interp", r016_new, r016_write, r016_clock, r016_free, 1},
    {"r016-resample", r016_new, r016_write, r016_clock, r016_free, 2},
    {"r10-fast", r10_new, r10_write, r10_clock, r10_free, 0},
    {"r10-resample", r10_new, r10_write, r10_clock, r10_free, 2},
    {"rfp-decimate", rfp_new, rfp_write, rfp_clock, rfp_free, 0},
    {"rfp-resample", rfp_new, rfp_write, rfp_clock, rfp_free, 1},
};

static uint64_t cyc_of(const Log &l, uint32_t pos) { return (uint64_t)pos * l.clock / l.fs; }

// one chip's samples on a reSID-family engine
static std::vector<int32_t> run_chip(const Log &l, const Eng &e, uint32_t chip)
{
    std::vector<int32_t> out;
    std::vector<short> buf(1 << 16);
    void *s = e.mk((int)l.model, l.clock, l.fs, e.method);
    uint64_t done = 0;
    auto clock_to = [&](uint64_t target) {
        while (done < target) {
            int step = (int)std::min<uint64_t>(target - done, 200000);
            int n = e.clk(s, step, buf.data(), (int)buf.size());
            out.insert(out.end(), buf.begin(), buf.begin() + n);
            done += (uint64_t)step;
        }
    };
    for (const Ev &v : l.ev) {
        if (v.chip != chip) continue;
        clock_to(cyc_of(l, v.pos));
        e.wr(s, v.reg, v.val);
    }
    clock_to(cyc_of(l, l.samples) + 64);
    e.fr(s);
    out.resize(l.samples, 0);
    return out;
}

// one chip on src/sid.c, rendering sample by sample between writes as the demo did
static std::vector<int32_t> run_own(const Log &l, uint32_t chip)
{
    std::vector<int32_t> out(l.samples);
    sid_t s;
    sid_init(&s, (sid_model_t)l.model, l.clock, l.fs);
    uint32_t pos = 0;
    for (const Ev &v : l.ev) {
        if (v.chip != chip) continue;
        if (v.pos > pos) { sid_render(&s, &out[pos], v.pos - pos); pos = v.pos; }
        sid_write(&s, v.reg, v.val);
    }
    if (l.samples > pos) sid_render(&s, &out[pos], l.samples - pos);
    return out;
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s LOG OUTPREFIX [engine ...]\n", argv[0]);
        return 2;
    }
    Log l = load(argv[1]);
    std::vector<std::string> want;
    for (int i = 3; i < argc; i++) want.push_back(argv[i]);
    if (want.empty()) {
        want.push_back("own");
        for (const Eng &e : ENGINES) want.push_back(e.name);
    }
    double secs = l.samples / (double)l.fs;
    for (const std::string &w : want) {
        const Eng *e = nullptr;
        for (const Eng &x : ENGINES) if (w == x.name) e = &x;
        if (!e && w != "own") { fprintf(stderr, "unknown engine %s\n", w.c_str()); return 2; }
        std::vector<int32_t> mix(l.samples, 0);
        auto t0 = std::chrono::steady_clock::now();
        for (uint32_t c = 0; c < l.chips; c++) {
            std::vector<int32_t> x = e ? run_chip(l, *e, c) : run_own(l, c);
            for (uint32_t i = 0; i < l.samples; i++) mix[i] += x[i] * (int32_t)l.mix >> 8;
        }
        double dt = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
        wav(std::string(argv[2]) + "." + w + ".wav", mix, l.fs);
        printf("%-14s %6.2f ms per second of audio per chip\n", w.c_str(), dt * 1000 / secs / l.chips);
    }
    return 0;
}
