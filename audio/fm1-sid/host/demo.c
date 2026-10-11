/* host/demo.c - self tests, demo renders and a cost estimate for the SID model on the host.
 *
 *   make            builds build/sid_demo
 *   build/sid_demo test           checks timing / pitch / stability against the chip's specs
 *   build/sid_demo wav [dir]      one WAV per patch (8580) and a four-chip song (6581, 8580)
 *   build/sid_demo hash           the checksum the FM-1 bench (fm1/bench.c) must reproduce
 *   build/sid_demo bench          host cost per sample
 * SPDX-License-Identifier: BSD-2-Clause */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "../src/sid.h"
#include "../src/sidsynth.h"

#define FS 44100u

static void write_wav(const char *path, const int32_t *x, uint32_t n)
{
    FILE *f = fopen(path, "wb");
    uint32_t i, v;
    if (!f) {
        perror(path);
        exit(1);
    }
    fwrite("RIFF", 1, 4, f);
    v = 36 + n * 2; fwrite(&v, 4, 1, f);
    fwrite("WAVEfmt ", 1, 8, f);
    v = 16; fwrite(&v, 4, 1, f);
    v = 1 | 1u << 16; fwrite(&v, 4, 1, f);          /* PCM, mono */
    v = FS; fwrite(&v, 4, 1, f);
    v = FS * 2; fwrite(&v, 4, 1, f);
    v = 2 | 16u << 16; fwrite(&v, 4, 1, f);
    fwrite("data", 1, 4, f);
    v = n * 2; fwrite(&v, 4, 1, f);
    for (i = 0; i < n; i++) {
        int32_t s = x[i];
        int16_t o = (int16_t)(s > 32767 ? 32767 : s < -32768 ? -32768 : s);
        fwrite(&o, 2, 1, f);
    }
    fclose(f);
    printf("  %s (%.1f s)\n", path, n / (double)FS);
}

/* ---------------------------------------------------------------------------------------- */
static int fails, checks;
static void check(int ok, const char *what, double got, double lo, double hi)
{
    checks++;
    if (!ok)
        fails++;
    printf("  [%s] %-46s %10.2f  (%.2f .. %.2f)\n", ok ? " ok " : "FAIL", what, got, lo, hi);
}
static void range(const char *what, double got, double lo, double hi) { check(got >= lo && got <= hi, what, got, lo, hi); }

static void voice_setup(sid_t *s, uint32_t freq, uint32_t ctrl, uint32_t ad, uint32_t sr)
{
    sid_write(s, SID_FREQ_LO, freq & 0xFF);
    sid_write(s, SID_FREQ_HI, freq >> 8);
    sid_write(s, SID_PW_HI, 8);
    sid_write(s, SID_AD, ad);
    sid_write(s, SID_SR, sr);
    sid_write(s, SID_MODE_VOL, 15);
    sid_write(s, SID_CTRL, ctrl);
}

static int test(void)
{
    sid_t s;
    static int32_t buf[FS * 4];
    uint32_t i, n;
    printf("SID model self test\n");

    /* pitch: 440 Hz is register 7493 at the PAL clock; count saw wraps over 2 s */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_SAW | SID_GATE, 0x00, 0xF0);
    n = 0;
    for (i = 0; i < 2 * FS; i++) {
        uint32_t before = s.v[0].acc;
        sid_render(&s, buf, 1);
        if (s.v[0].acc < before)
            n++;
    }
    range("saw 440 Hz (reg 7493): cycles in 2 s / 2", n / 2.0, 439.5, 440.5);

    /* attack: rate 2 = 63 cycles a step, 255 steps = 16.3 ms */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_PULSE | SID_GATE, 0x20, 0xF0);
    for (i = 0; i < FS && s.v[0].env < 255; i++)
        sid_render(&s, buf, 1);
    range("attack rate 2 to 0xFF (ms, datasheet 16)", i * 1000.0 / FS, 15.5, 17.0);

    /* attack rate 9 = 977 cycles a step: 252.9 ms */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_PULSE | SID_GATE, 0x90, 0xF0);
    for (i = 0; i < FS && s.v[0].env < 255; i++)
        sid_render(&s, buf, 1);
    range("attack rate 9 to 0xFF (ms, datasheet 250)", i * 1000.0 / FS, 245.0, 260.0);

    /* decay 0xFF -> sustain 8 (0x88) at rate 4 (spec 114 ms for the full range, exponential) */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_PULSE | SID_GATE, 0x04, 0x80);
    for (i = 0; i < FS && s.v[0].env < 255; i++)
        sid_render(&s, buf, 1);
    for (n = 0; n < FS && s.v[0].env != 0x88; n++)
        sid_render(&s, buf, 1);
    range("decay rate 4, 0xFF -> 0x88 (ms, 119 x 149 cyc)", n * 1000.0 / FS, 17.0, 19.0);
    sid_render(&s, buf, FS / 2);
    range("sustain holds at 0x88", s.v[0].env, 0x88, 0x88);

    /* release rate 6: 267 cycles a step, divided by the exponential counter below 0x5E: from
     * 0x88, 42 x 1 + 39 x 2 + 28 x 4 + 12 x 8 + 8 x 16 + 7 x 30 = 666 steps = 180 ms (the
     * datasheet's 204 ms decay / release for rate 6 is the same curve from 0xFF, x3 attack) */
    sid_write(&s, SID_SR, 0x86);
    sid_write(&s, SID_CTRL, SID_PULSE);
    for (n = 0; n < 4 * FS && s.v[0].env; n++)
        sid_render(&s, buf, 1);
    range("release rate 6 from 0x88 to 0 (ms, 180)", n * 1000.0 / FS, 171.0, 189.0);
    sid_render(&s, buf, FS / 10);
    range("released voice stays at 0", s.v[0].env, 0, 0);

    /* ADSR bug: a long attack, the counter far past a short period, then the short one: the
     * counter has to wrap through 0x7FFF (~33 ms of nothing) before the next step */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_PULSE | SID_GATE, 0xF0, 0xF0);
    sid_render(&s, buf, 300);                       /* 300 samples ~ 6700 cycles into 31251 */
    {
        uint32_t e0 = s.v[0].env;
        sid_write(&s, SID_AD, 0x00);                 /* rate 0: period 9 < counter */
        for (n = 0; n < FS && s.v[0].env == e0; n++)
            sid_render(&s, buf, 1);
        range("ADSR bug: wait after lowering the rate (ms)", n * 1000.0 / FS, 20.0, 34.0);
    }

    /* a retrigger at full level (sustain F) must not freeze the envelope at 0 */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493, SID_PULSE | SID_GATE, 0x00, 0xF0);
    sid_render(&s, buf, FS / 10);
    sid_write(&s, SID_CTRL, SID_PULSE);
    sid_write(&s, SID_CTRL, SID_PULSE | SID_GATE);
    sid_render(&s, buf, FS / 10);
    range("retrigger at 0xFF: level 0.1 s later", s.v[0].env, 255, 255);

    /* noise: 23-bit LFSR, from the reset value; the output must move */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 30000, SID_NOISE | SID_GATE, 0x00, 0xF0);
    {
        uint32_t chg = 0, last = 0;
        for (i = 0; i < FS / 10; i++) {
            sid_render(&s, buf, 1);
            chg += s.v[0].out != last;
            last = s.v[0].out;
        }
        range("noise output changes per sample (share)", chg / (FS / 10.0), 0.5, 1.0);
    }

    /* hard sync: voice 1 synced to voice 3: voice 1's period = voice 3's */
    sid_init(&s, SID_8580, SID_CLOCK_PAL, FS);
    voice_setup(&s, 7493 * 3 + 1234, SID_SAW | SID_SYNC | SID_GATE, 0x00, 0xF0);
    sid_write(&s, 14 + SID_FREQ_LO, 7493 & 0xFF);
    sid_write(&s, 14 + SID_FREQ_HI, 7493 >> 8);
    sid_write(&s, 14 + SID_CTRL, SID_TRI);
    {
        uint32_t resets = 0;
        for (i = 0; i < FS; i++) {
            sid_render(&s, buf, 1);
            resets += s.v[2].msb_rose;
        }
        range("sync source rises in 1 s (Hz)", resets, 439, 441);
    }

    /* the filter at full resonance and every cutoff: no blow-up (three full saws at full
     * resonance may go past 16 bits, as they clip on the real chip; the callers clamp) */
    for (n = 0; n < 2; n++) {
        int32_t peak = 0;
        uint32_t fc;
        sid_init(&s, n ? SID_8580 : SID_6581, SID_CLOCK_PAL, FS);
        for (i = 0; i < 3; i++) {
            sid_write(&s, i * 7 + SID_FREQ_HI, 0x08 + i * 3);
            sid_write(&s, i * 7 + SID_SR, 0xF0);
            sid_write(&s, i * 7 + SID_CTRL, SID_SAW | SID_GATE);
        }
        sid_write(&s, SID_RES_FILT, 0xF7);
        for (fc = 0; fc < 2048; fc += 16) {
            sid_write(&s, SID_FC_LO, fc & 7);
            sid_write(&s, SID_FC_HI, fc >> 3);
            sid_write(&s, SID_MODE_VOL, 0x1F);
            sid_render(&s, buf, 400);
            for (i = 0; i < 400; i++)
                peak = abs(buf[i]) > peak ? abs(buf[i]) : peak;
        }
        range(n ? "8580 LP res 15, 3 saws, cutoff sweep: peak" : "6581 LP res 15, 3 saws, cutoff sweep: peak",
              peak, 8000, 98304);
    }

    /* 6581 digis: toggling the volume register makes a square wave */
    sid_init(&s, SID_6581, SID_CLOCK_PAL, FS);
    {
        int32_t lo = 0, hi = 0;
        for (i = 0; i < 200; i++) {
            sid_write(&s, SID_MODE_VOL, (i / 20) & 1 ? 15 : 0);
            sid_render(&s, buf, 1);
            lo = buf[0] < lo ? buf[0] : lo;
            hi = buf[0] > hi ? buf[0] : hi;
        }
        range("6581 volume-register digi swing", hi - lo, 4000, 40000);
    }

    printf("%d / %d checks passed\n", checks - fails, checks);
    return fails ? 1 : 0;
}

/* ---------------------------------------------------------------------------------------- */
/* a phrase for one patch: a line, then a three-note chord */
static uint32_t phrase(sidsyn_t *y, int32_t *out, int drum)
{
    static const uint8_t LINE[] = {48, 55, 60, 63, 67, 72, 67, 60};
    uint32_t pos = 0, k;
    const uint32_t step = FS / 5;
    if (drum) {
        for (k = 0; k < 8; k++) {
            sidsyn_note_on(y, 48 + (k & 1) * 12);
            sidsyn_render(y, out + pos, step / 3);
            sidsyn_note_off(y, 48 + (k & 1) * 12);
            sidsyn_render(y, out + pos + step / 3, step - step / 3);
            pos += step;
        }
        sidsyn_render(y, out + pos, FS / 2);
        return pos + FS / 2;
    }
    for (k = 0; k < sizeof LINE; k++) {
        sidsyn_note_on(y, LINE[k]);
        sidsyn_render(y, out + pos, step * 4 / 5);
        sidsyn_note_off(y, LINE[k]);
        sidsyn_render(y, out + pos + step * 4 / 5, step / 5);
        pos += step;
    }
    sidsyn_note_on(y, 48);
    sidsyn_note_on(y, 52);
    sidsyn_note_on(y, 55);
    sidsyn_render(y, out + pos, FS * 3 / 2);
    pos += FS * 3 / 2;
    sidsyn_all_off(y);
    sidsyn_render(y, out + pos, FS);
    return pos + FS;
}

/* a four-chip song, one sidsyn per track: bass, chords, lead, drums. 16 steps a bar, 125 BPM */
#define SONG_BARS 8
static uint32_t song(sid_model_t model, int32_t *out)
{
    static sidsyn_t trk[4];
    static int32_t tmp[FS];
    static const int8_t BASS[16] = {36, -1, 36, 48, -1, 36, 46, -1, 36, -1, 48, 36, -1, 43, 46, 48};
    static const int8_t ROOT[4] = {0, -4, -7, -2};   /* C, Ab, F, Bb */
    static const int8_t LEAD[32] = {72, -1, 75, -1, 79, -1, -1, 77, 75, -1, 74, -1, 72, -1, -1, -1,
                                    70, -1, 72, -1, 74, -1, 77, -1, 75, -1, -1, -1, 74, -1, 70, -1};
    static const char DRUM[16] = "K.hSh.KhK.hSh.Sh";
    const uint32_t step = FS * 60 / 125 / 4;
    uint32_t bar, st, t, i, pos = 0;
    int8_t held[4] = {-1, -1, -1, -1};
    sidsyn_init(&trk[0], 1, model, FS);
    sidsyn_set_patch(&trk[0], &SID_PATCHES[1]);      /* PWM BASS */
    sidsyn_init(&trk[1], 1, model, FS);
    sidsyn_set_patch(&trk[1], &SID_PATCHES[2]);      /* MAJ CHORD */
    sidsyn_init(&trk[2], 1, model, FS);
    sidsyn_set_patch(&trk[2], &SID_PATCHES[4]);      /* SYNC LEAD */
    sidsyn_init(&trk[3], 1, model, FS);
    trk[1].vol = 9;
    for (bar = 0; bar < SONG_BARS; bar++) {
        int32_t root = ROOT[bar & 3];
        for (st = 0; st < 16; st++) {
            int8_t b = BASS[st];
            char d = DRUM[st];
            if (b >= 0) {
                if (held[0] >= 0)
                    sidsyn_note_off(&trk[0], (uint32_t)held[0]);
                held[0] = (int8_t)(b + root);
                sidsyn_note_on(&trk[0], (uint32_t)held[0]);
            }
            if (st == 0 || st == 10) {
                if (held[1] >= 0)
                    sidsyn_note_off(&trk[1], (uint32_t)held[1]);
                held[1] = (int8_t)(60 + root);
                sidsyn_note_on(&trk[1], (uint32_t)held[1]);
            }
            if (bar >= 2) {
                int8_t l = LEAD[(bar & 1) * 16 + st];
                if (l >= 0) {
                    if (held[2] >= 0)
                        sidsyn_note_off(&trk[2], (uint32_t)held[2]);
                    held[2] = (int8_t)(l + (bar >= 4 ? root : 0));
                    sidsyn_note_on(&trk[2], (uint32_t)held[2]);
                }
            }
            if (d != '.') {
                sidsyn_set_patch(&trk[3], &SID_PATCHES[d == 'K' ? 6 : d == 'S' ? 7 : 8]);
                sidsyn_note_on(&trk[3], 48);
                held[3] = 48;
            } else if (held[3] >= 0) {
                sidsyn_note_off(&trk[3], 48);
                held[3] = -1;
            }
            for (i = 0; i < step; i++)
                out[pos + i] = 0;
            for (t = 0; t < 4; t++) {
                sidsyn_render(&trk[t], tmp, step);
                for (i = 0; i < step; i++)
                    out[pos + i] += tmp[i] * 160 >> 8;   /* four chips: -4 dB each */
            }
            pos += step;
        }
    }
    for (t = 0; t < 4; t++)
        sidsyn_all_off(&trk[t]);
    for (i = 0; i < FS; i++)
        out[pos + i] = 0;
    for (t = 0; t < 4; t++) {
        sidsyn_render(&trk[t], tmp, FS);
        for (i = 0; i < FS; i++)
            out[pos + i] += tmp[i] * 160 >> 8;
    }
    return pos + FS;
}

static int wavs(const char *dir)
{
    static int32_t buf[FS * 40];
    char path[512];
    uint32_t p, n;
    static sidsyn_t y;
    printf("rendering to %s/\n", dir);
    for (p = 0; p < SID_NPATCHES; p++) {
        const char *nm = SID_PATCHES[p].name;
        char clean[32];
        uint32_t k;
        for (k = 0; nm[k] && k < sizeof clean - 1; k++)
            clean[k] = (char)(nm[k] == ' ' || nm[k] == '&' ? '_' : nm[k] + (nm[k] >= 'A' && nm[k] <= 'Z' ? 32 : 0));
        clean[k] = 0;
        sidsyn_init(&y, 1, SID_8580, FS);
        sidsyn_set_patch(&y, &SID_PATCHES[p]);
        n = phrase(&y, buf, p >= 6 && p <= 8);
        snprintf(path, sizeof path, "%s/patch_%02u_%s.wav", dir, p, clean);
        write_wav(path, buf, n);
    }
    n = song(SID_6581, buf);
    snprintf(path, sizeof path, "%s/song_6581.wav", dir);
    write_wav(path, buf, n);
    n = song(SID_8580, buf);
    snprintf(path, sizeof path, "%s/song_8580.wav", dir);
    write_wav(path, buf, n);
    return 0;
}

/* ---------------------------------------------------------------------------------------- */
/* the bench workload (shared with fm1/bench.c): one chip, three voices + filter, 0.25 s */
#include "../fm1/workload.h"

#ifdef SID_LOG
/* ---------------------------------------------------------------------------------------- */
/* record: the register stream of every demo piece, for host/replay.cc to play on reSID,
 * reSID 1.0 and reSIDfp. File (little-endian): "SIDLOG1\0", then u32 model, fs, clock,
 * chips, samples, events, mix (Q8 per chip), then per event u32 sample, u8 chip, reg, val, 0.
 * Each chip keeps its own sample count: a write at sample k lands before that chip's
 * sample k, wherever the demo renders it from. */
#define LOG_MAX 400000
static struct { const sid_t *s; uint32_t pos; } lchip[8];
static uint32_t lnchips;
static struct { uint32_t pos; uint8_t chip, reg, val, pad; } lev[LOG_MAX];
static uint32_t lnev;

static uint32_t lchip_of(const sid_t *s)
{
    uint32_t i;
    for (i = 0; i < lnchips; i++)
        if (lchip[i].s == s)
            return i;
    fprintf(stderr, "record: unknown chip\n");
    exit(1);
}
static void log_init(const sid_t *s)
{
    uint32_t i;
    for (i = 0; i < lnchips; i++)
        if (lchip[i].s == s) {
            lchip[i].pos = 0;
            return;
        }
    lchip[lnchips].s = s;
    lchip[lnchips++].pos = 0;
}
static void log_write(const sid_t *s, uint32_t reg, uint32_t val)
{
    uint32_t c = lchip_of(s);
    if (lnev >= LOG_MAX) {
        fprintf(stderr, "record: log full\n");
        exit(1);
    }
    lev[lnev].pos = lchip[c].pos;
    lev[lnev].chip = (uint8_t)c;
    lev[lnev].reg = (uint8_t)reg;
    lev[lnev].val = (uint8_t)val;
    lev[lnev++].pad = 0;
}
static void log_render(const sid_t *s, uint32_t n) { lchip[lchip_of(s)].pos += n; }

static void log_save(const char *path, uint32_t model, uint32_t samples, uint32_t mix)
{
    FILE *f = fopen(path, "wb");
    uint32_t h[7] = {model, FS, SID_CLOCK_PAL, lnchips, samples, lnev, mix};
    if (!f) {
        perror(path);
        exit(1);
    }
    fwrite("SIDLOG1", 1, 8, f);
    fwrite(h, 4, 7, f);
    fwrite(lev, 8, lnev, f);
    fclose(f);
    printf("  %s (%u chips, %u writes)\n", path, lnchips, lnev);
}

static int record(const char *dir)
{
    static int32_t buf[FS * 40];
    static sidsyn_t y;
    char path[512];
    uint32_t p, n, m;
    sid_log_init = log_init;
    sid_log_write = log_write;
    sid_log_render = log_render;
    printf("recording to %s/\n", dir);
    for (m = 0; m < 2; m++) {
        const char *mn = m ? "8580" : "6581";
        for (p = 0; p <= SID_NPATCHES; p++) {
            const sid_patch_t *pt = &SID_PATCHES[p < SID_NPATCHES ? p : 2];
            lnchips = lnev = 0;
            sidsyn_init(&y, 1, (sid_model_t)m, FS);
            sidsyn_set_patch(&y, pt);
            if (p == SID_NPATCHES)
                y.transpose = 24;                  /* HI CHORD: two octaves up, where aliasing shows */
            n = phrase(&y, buf, p >= 6 && p <= 8);
            if (p < SID_NPATCHES)
                snprintf(path, sizeof path, "%s/patch%02u_%s.sidlog", dir, p, mn);
            else
                snprintf(path, sizeof path, "%s/hichord_%s.sidlog", dir, mn);
            log_save(path, m, n, 256);
            snprintf(path + strlen(path) - 7, 16, ".own.wav");
            write_wav(path, buf, n);
        }
        if (!m) {                                  /* the FM-1 bench workload (fm1/workload.h, 6581) */
            lnchips = lnev = 0;
            wl_run(buf, WL_SAMPLES);
            snprintf(path, sizeof path, "%s/workload.sidlog", dir);
            log_save(path, 0, WL_SAMPLES, 256);
        }
        lnchips = lnev = 0;
        n = song((sid_model_t)m, buf);
        snprintf(path, sizeof path, "%s/song_%s.sidlog", dir, mn);
        log_save(path, m, n, 160);
        snprintf(path + strlen(path) - 7, 16, ".own.wav");
        write_wav(path, buf, n);
    }
    return 0;
}
#endif


static int hash(void)
{
    static int32_t buf[WL_SAMPLES];
    uint32_t h;
    wl_run(buf, WL_SAMPLES);
    h = wl_hash(buf, WL_SAMPLES);
    printf("workload hash %08x (%u samples)\n", h, WL_SAMPLES);
    write_wav("build/workload_host.wav", buf, WL_SAMPLES);
    return 0;
}

static int bench(void)
{
    static sidsyn_t y;
    static int32_t buf[256];
    uint32_t chips, i;
    for (chips = 1; chips <= 4; chips++) {
        clock_t t0;
        double sec;
        const uint32_t secs = 20;
        sidsyn_init(&y, chips, SID_6581, FS);
        sidsyn_set_patch(&y, &SID_PATCHES[0]);
        for (i = 0; i < chips * 3; i++)
            sidsyn_note_on(&y, 48 + i * 4);
        t0 = clock();
        for (i = 0; i < secs * FS / 256; i++)
            sidsyn_render(&y, buf, 256);
        sec = (double)(clock() - t0) / CLOCKS_PER_SEC;
        printf("  %u chip(s), %2u voices, filter on: %.1f us per second of audio (%.3f %% of a host core)\n",
               chips, chips * 3, sec * 1e6 / secs, sec * 100.0 / secs);
    }
    return 0;
}

int main(int argc, char **argv)
{
    const char *cmd = argc > 1 ? argv[1] : "test";
    if (!strcmp(cmd, "test"))
        return test();
    if (!strcmp(cmd, "wav"))
        return wavs(argc > 2 ? argv[2] : "build");
    if (!strcmp(cmd, "hash"))
        return hash();
    if (!strcmp(cmd, "bench"))
        return bench();
#ifdef SID_LOG
    if (!strcmp(cmd, "record"))
        return record(argc > 2 ? argv[2] : "build/cmp");
#endif
    fprintf(stderr, "usage: %s test | wav [dir] | hash | bench\n", argv[0]);
    return 2;
}
