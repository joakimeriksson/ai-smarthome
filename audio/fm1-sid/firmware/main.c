/* firmware/main.c - a SID player for the M-VAVE FM-1: C64 tunes (PSID) played by their own
 * 6502 code (player/psid.c, floooh's m6502) on the FM-1's CPU, the SID rendered by reSID 0.16
 * (fast) or by fm1-sid's own model (src/sid.c), the three voices, sync / ring and the filter
 * drawn on the 240x240 LCD.
 *
 * Built on Felucca's hardware layer (ext/Felucca/firmware/hal, crt0.S, fm1_vec.S, fm1_isr.S;
 * GPL-3.0-only), so this firmware is GPL-3.0-only too.
 *
 * Keys: PRESETS / SELECT encoder or OCT- / OCT+ = tune, PLAY = pause, EDIT = engine (reSID /
 * own), FX = 6581 / 8580. Hold OCT- and OCT+ for 3 s: the USB update mode (UBOOT).
 *
 * Timing: the main loop runs the play routine up to three frames ahead and queues its SID
 * writes with their C64 cycle; the audio interrupt (ALNK0, 128 frames a half buffer) clocks
 * the SID engine to each write's cycle and applies it, so the writes land cycle-exact for
 * reSID and to the sample for the own model.
 * SPDX-License-Identifier: GPL-3.0-only */
#include <stdint.h>
#include "fm1_cc.h"
#include "fm1_time.h"
#include "fm1_irq.h"
#include "fm1_sys.h"
#include "fm1_gpio.h"
#include "fm1_timer.h"
#include "fm1_lcd_hw.h"
#include "fm1_audio.h"
#include "fm1_input.h"
#include "sid.h"
#include "psid.h"

void *memset(void *d, int c, unsigned long n) { unsigned char *p = d; while (n--) *p++ = (unsigned char)c; return d; }
void *memcpy(void *d, const void *s, unsigned long n) { unsigned char *p = d; const unsigned char *q = s; while (n--) *p++ = *q++; return d; }
int memcmp(const void *a, const void *b, unsigned long n)
{
    const unsigned char *p = a, *q = b;
    for (; n; n--, p++, q++)
        if (*p != *q)
            return *p - *q;
    return 0;
}

#include "assets.h"

/* reSID (firmware/resid_glue.cc) */
void rs_init(int model, double clock, double fs);
void rs_write(int reg, int val);
int rs_clock(int *cycles, short *buf, int n);
void rs_env(unsigned char env[3]);

#define HALF_FRAMES 128u
#define HALF_WORDS (HALF_FRAMES * 2u)
#define FS_HZ 44118u                       /* 24 MHz / 544 = 44117.6 */
#define CPS_Q16 1463569u                   /* SID cycles per output sample, Q16: 985248 * 544 / 24e6 */
#define OUT_SHIFT 8                        /* 16-bit -> 24-bit (the SID engines peak well below full scale) */

/* ------------------------------------------------------------------------------- state --- */
static int32_t abuf[2u * HALF_WORDS] __attribute__((aligned(4)));
static uint8_t psid_mem[70000] __attribute__((aligned(8)));   /* psid_t (64 KB RAM inside) */
#define P ((psid_t *)psid_mem)
static sid_t own;

typedef struct { uint32_t cyc; uint8_t reg, val; } ev_t;
#define NEV 4096u
static ev_t evq[NEV];
static volatile uint32_t ev_head, ev_tail;  /* main loop writes head, the audio ISR tail */
static uint32_t gen_cyc, call_base;         /* main loop: the next play call; this call's start */
static volatile uint32_t play_cyc;          /* audio ISR: the SID's time */
static uint32_t cyc_frac;
static volatile uint8_t running, engine, model;    /* engine 0 reSID, 1 own */
static volatile uint8_t regs[32];           /* the registers as written, for the display */
static int16_t scope[512];
static volatile uint32_t scope_w;
static volatile uint32_t isr_ticks, isr_halves;
static uint32_t play_idx, played_ms;
static volatile uint32_t ms;

/* ------------------------------------------------------------------- the play routine --- */
static void on_write(void *user, uint32_t cycle, uint32_t reg, uint32_t val)
{
    uint32_t h = ev_head;
    (void)user;
    if (h - ev_tail >= NEV)                 /* full: drop (should not happen with the look-ahead) */
        return;
    evq[h % NEV].cyc = call_base + cycle;
    evq[h % NEV].reg = (uint8_t)reg;
    evq[h % NEV].val = (uint8_t)val;
    ev_head = h + 1;
}

static void generate(void)
{
    while (running && gen_cyc - play_cyc < 3u * PSID_PAL_FRAME && ev_head - ev_tail < NEV - 600u) {
        call_base = gen_cyc;
        psid_play(P);
        gen_cyc += psid_period(P);
    }
}

/* ------------------------------------------------------------------------ audio ISR --- */
static void apply(const ev_t *e)
{
    regs[e->reg & 31] = e->val;
    if (engine)
        sid_write(&own, e->reg, e->val);
    else
        rs_write(e->reg, e->val);
}

static void render_resid(short *out)
{
    uint32_t got = 0;
    while (got < HALF_FRAMES) {
        int dt;
        uint32_t t = ev_tail;
        if (t != ev_head && (int32_t)(evq[t % NEV].cyc - play_cyc) <= 0) {
            apply(&evq[t % NEV]);
            ev_tail = t + 1;
            continue;
        }
        dt = t != ev_head ? (int)(evq[t % NEV].cyc - play_cyc) : 100000;
        {
            int left = dt;
            got += (uint32_t)rs_clock(&left, out + got, (int)(HALF_FRAMES - got));
            play_cyc += (uint32_t)(dt - left);
        }
    }
}

static void render_own(short *out)
{
    static int32_t tmp[HALF_FRAMES];
    uint32_t got = 0, i;
    while (got < HALF_FRAMES) {
        uint32_t t = ev_tail, k = HALF_FRAMES - got;
        if (t != ev_head) {
            int32_t d = (int32_t)(evq[t % NEV].cyc - play_cyc);
            if (d <= 0) {
                apply(&evq[t % NEV]);
                ev_tail = t + 1;
                continue;
            }
            if ((uint32_t)d < k * 23u)       /* samples until the write (CPS ~ 22.33) */
                k = (((uint32_t)d << 16) + CPS_Q16 - 1u) / CPS_Q16;
            if (!k)
                k = 1;
            if (k > HALF_FRAMES - got)
                k = HALF_FRAMES - got;
        }
        sid_render(&own, tmp, k);
        for (i = 0; i < k; i++) {
            int32_t v = tmp[i];
            out[got + i] = (short)(v > 32767 ? 32767 : v < -32768 ? -32768 : v);
            cyc_frac += CPS_Q16;
            play_cyc += cyc_frac >> 16;
            cyc_frac &= 0xffffu;
        }
        got += k;
    }
}

void fm1_alnk0_irq(void)
{
    uint8_t p = fm1_audio_pending();
    fm1_audio_ack_aux(p);
    if (p & FM1_AUDIO_HALF) {
        uint32_t t0 = fm1_ticks(), i;
        int32_t *o = &abuf[fm1_audio_free_half() * HALF_WORDS];
        static short s[HALF_FRAMES];
        if (running) {
            if (engine)
                render_own(s);
            else
                render_resid(s);
        } else {
            for (i = 0; i < HALF_FRAMES; i++)
                s[i] = 0;
        }
        for (i = 0; i < HALF_FRAMES; i++) {
            o[2u * i] = o[2u * i + 1u] = (int32_t)s[i] * (1 << OUT_SHIFT);
            if (i & 1u)
                scope[scope_w++ & 511u] = s[i];
        }
        fm1_audio_ack_half();
        isr_ticks += fm1_ticks() - t0;
        isr_halves++;
    }
}

void fm1_timer5_irq(void)
{
    static uint32_t last, acc;
    uint32_t now;
    fm1_timer5_ack();
    fm1_input_tick();
    now = fm1_ticks();
    acc += now - last;
    last = now;
    while (acc >= 24000u) {
        acc -= 24000u;
        ms++;
    }
}

/* the ISR wrappers (Felucca's hal/fm1_isr.S) */
void isr_alnk0(void);
void isr_timer5(void);

static void fm1_fault(const fm1_crash_t *c)
{
    (void)c;
    fm1_reboot();
}

/* ------------------------------------------------------------------------------ LCD --- */
static uint16_t fb[240 * 240];

static void lcd_cmd(uint8_t c, const uint8_t *d, uint32_t n)
{
    static uint8_t buf[8];
    uint32_t i;
    fm1_lcd_send_cmd(c);
    fm1_lcd_wait();
    if (n) {
        for (i = 0; i < n; i++)
            buf[i] = d[i];
        fm1_lcd_send_data(buf, n);
        fm1_lcd_wait();
    }
    fm1_lcd_deselect();
}

static void lcd_init(void)
{
    static const uint8_t c565 = 0x55, mad = 0x00;
    fm1_lcd_hw_init();
    fm1_delay_ms(80);
    lcd_cmd(0x01, 0, 0);
    fm1_delay_ms(150);
    lcd_cmd(0x11, 0, 0);
    fm1_delay_ms(120);
    lcd_cmd(0x3A, &c565, 1);
    lcd_cmd(0x36, &mad, 1);
    lcd_cmd(0x21, 0, 0);
    lcd_cmd(0x13, 0, 0);
    fm1_lcd_baud(4);
    lcd_cmd(0x29, 0, 0);
}

static void lcd_frame(void)
{
    static const uint8_t win[4] = {0, 0, 0, 239};
    uint32_t y;
    lcd_cmd(0x2A, win, 4);
    lcd_cmd(0x2B, win, 4);
    fm1_lcd_send_cmd(0x2C);
    fm1_lcd_wait();
    for (y = 0; y < 240; y += 24) {          /* in strips: 11520 bytes a DMA */
        fm1_lcd_send_data(fb + y * 240, 240u * 24u * 2u);
        fm1_lcd_wait();
    }
    fm1_lcd_deselect();
}

/* RGB565, byte-swapped as the panel takes it */
#define RGB(r, g, b) ((uint16_t)((((r) & 0xF8) << 8 | ((g) & 0xFC) << 3 | (b) >> 3) >> 8 | \
                                 (((r) & 0xF8) << 8 | ((g) & 0xFC) << 3 | (b) >> 3) << 8))
/* the C64's palette */
#define C_BLUE   RGB(0x35, 0x28, 0x79)
#define C_LBLUE  RGB(0x6C, 0x5E, 0xB5)
#define C_WHITE  RGB(0xFF, 0xFF, 0xFF)
#define C_CYAN   RGB(0x70, 0xA4, 0xB2)
#define C_YELLOW RGB(0xB8, 0xC7, 0x6F)
#define C_LGREEN RGB(0x9A, 0xD2, 0x84)
#define C_LRED   RGB(0x9A, 0x67, 0x59)
#define C_GREY   RGB(0x95, 0x95, 0x95)
#define C_DGREY  RGB(0x44, 0x44, 0x44)
#define C_DARK   RGB(0x20, 0x18, 0x4c)
#define C_ORANGE RGB(0xD8, 0x8C, 0x3C)

static void fill(int x, int y, int w, int h, uint16_t c)
{
    int i, j;
    for (j = y; j < y + h; j++)
        for (i = x; i < x + w; i++)
            if ((unsigned)i < 240u && (unsigned)j < 240u)
                fb[j * 240 + i] = c;
}

static int text(int x, int y, const char *s, uint16_t c)
{
    for (; *s; s++, x += 8) {
        unsigned ch = (unsigned char)*s;
        const uint8_t *g;
        int r, b;
        if (ch < 32 || ch > 126)
            ch = '?';
        g = FONT + (ch - 32u) * 12u;
        for (r = 0; r < 12; r++)
            for (b = 0; b < 8; b++)
                if (g[r] >> (7 - b) & 1)
                    if ((unsigned)(x + b) < 240u && (unsigned)(y + r) < 240u)
                        fb[(y + r) * 240 + x + b] = c;
    }
    return x;
}

static char *fmt_u(char *p, uint32_t v, int width)
{
    char t[10];
    int n = 0;
    do { t[n++] = (char)('0' + v % 10u); v /= 10u; } while (v && n < 10);
    while (n < width) t[n++] = '0';
    while (n) *p++ = t[--n];
    *p = 0;
    return p;
}

static char *cat(char *p, const char *s) { while (*s) *p++ = *s++; *p = 0; return p; }

/* the note nearest a frequency register (PAL), e.g. "C#4"; "---" when 0 */
static void note_name(uint32_t freq, char *out)
{
    static const char *const N[12] = {"C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-"};
    static const uint32_t Q8[12] = {4561991, 4833262, 5120662, 5425153, 5747749, 6089528,
                                    6451630, 6835264, 7241710, 7672325, 8128545, 8611893};   /* MIDI 84..95 */
    uint32_t v = freq << 8, best = 0, bd = 0xffffffffu, i;
    int oct = 6;
    if (!freq) { cat(out, "---"); return; }
    while (v < 4432000u) { v <<= 1; oct--; }           /* into C6 .. B6 (a quarter tone below C6) */
    while (v >= 8864000u) { v >>= 1; oct++; }
    for (i = 0; i < 12; i++) {
        uint32_t d = v > Q8[i] ? v - Q8[i] : Q8[i] - v;
        if (d < bd) { bd = d; best = i; }
    }
    if (best == 0 && v > 8300000u) { oct++; }          /* closer to the next C */
    out = cat(out, N[best]);
    if (oct < 0) oct = 0;
    *out++ = (char)('0' + (oct > 9 ? 9 : oct));
    *out = 0;
}

static void bar(int x, int y, int w, int h, uint32_t v, uint32_t max, uint16_t c)
{
    int f = (int)((uint32_t)w * (v > max ? max : v) / max);
    fill(x, y, w, h, C_DARK);
    fill(x, y, f, h, c);
}

static void badge(int x, int y, const char *s, int on, uint16_t c)
{
    int w = 0;
    const char *q = s;
    while (*q++) w += 8;
    fill(x - 2, y - 1, w + 4, 13, on ? c : C_DARK);
    text(x, y, s, on ? C_BLUE : C_DGREY);
}

static void draw(void)
{
    static const char *const WAVES[4] = {"T", "S", "P", "N"};
    char line[64], *p;
    uint8_t env[3];
    uint32_t v, i, load;
    const psid_info_t *info = psid_info(P);
    if (engine) {
        env[0] = own.v[0].env; env[1] = own.v[1].env; env[2] = own.v[2].env;
    } else {
        rs_env(env);
    }
    fill(0, 0, 240, 240, C_BLUE);
    /* header */
    fill(0, 0, 240, 14, C_LBLUE);
    text(2, 1, "FM-1 SID", C_WHITE);
    text(240 - 8 * 13 - 2, 1, engine ? "fm1-sid model" : "  reSID  0.16", C_YELLOW);
    /* tune */
    text(2, 17, info->name, C_WHITE);
    p = cat(line, info->author);
    text(2, 30, line, C_CYAN);
    p = cat(line, "Tune ");
    p = fmt_u(p, play_idx + 1u, 1);
    p = cat(p, "/");
    p = fmt_u(p, NPLAY, 1);
    p = cat(p, "  ");
    p = fmt_u(p, played_ms / 60000u, 1);
    p = cat(p, ":");
    p = fmt_u(p, played_ms / 1000u % 60u, 2);
    p = cat(p, model ? "  8580" : "  6581");
    p = cat(p, running ? "" : "  PAUSE");
    text(2, 43, line, C_LGREEN);
    /* CPU: the audio ISR's share of its period */
    load = isr_halves ? isr_ticks / isr_halves * 100u / (HALF_FRAMES * 544u) : 0;
    isr_ticks = isr_halves = 0;            /* the next frame shows the last 40 ms */
    p = cat(line, "CPU ");
    p = fmt_u(p, load, 1);
    cat(p, "%");
    text(240 - 8 * 8, 43, line, C_GREY);
    /* voices */
    for (i = 0; i < 3; i++) {
        int y = 58 + (int)i * 36, w;
        uint8_t ctrl = regs[i * 7 + 4];
        uint32_t freq = regs[i * 7] | (uint32_t)regs[i * 7 + 1] << 8;
        uint32_t pw = (regs[i * 7 + 2] | (uint32_t)(regs[i * 7 + 3] & 15) << 8);
        char nn[8];
        line[0] = 'V'; line[1] = (char)('1' + i); line[2] = 0;
        text(2, y, line, C_WHITE);
        for (w = 0; w < 4; w++)
            badge(26 + w * 14, y, WAVES[w], ctrl >> (4 + w) & 1, C_YELLOW);
        badge(86, y, "SYNC", ctrl & 2, C_ORANGE);
        badge(126, y, "RING", ctrl & 4, C_ORANGE);
        badge(166, y, "G", ctrl & 1, C_LGREEN);
        badge(180, y, "F", regs[0x17] >> i & 1, C_CYAN);
        note_name(freq, nn);
        text(204, y, nn, C_WHITE);
        bar(2, y + 15, 170, 8, env[i], 255, C_LGREEN);
        bar(178, y + 15, 60, 8, (ctrl & 0x40) ? pw : 0, 4095, C_YELLOW);
    }
    /* filter */
    {
        int y = 168;
        uint32_t fc = (regs[0x15] & 7u) | (uint32_t)regs[0x16] << 3, mv = regs[0x18];
        text(2, y, "FILTER", C_WHITE);
        badge(58, y, "LP", mv & 0x10, C_CYAN);
        badge(82, y, "BP", mv & 0x20, C_CYAN);
        badge(106, y, "HP", mv & 0x40, C_CYAN);
        badge(130, y, "3OFF", mv & 0x80, C_LRED);
        p = cat(line, "VOL ");
        fmt_u(p, mv & 15u, 2);
        text(176, y, line, C_GREY);
        text(2, y + 14, "CUT", C_GREY);
        bar(30, y + 16, 140, 7, fc, 2047, C_CYAN);
        text(176, y + 14, "RES", C_GREY);
        bar(202, y + 16, 36, 7, regs[0x17] >> 4, 15, C_ORANGE);
    }
    /* scope: the last 240 samples (every other one), scaled to the window's peak */
    {
        uint32_t w0 = scope_w - 240u, x;
        int prev = 220, peak = 512;
        fill(0, 198, 240, 42, C_DARK);
        for (x = 0; x < 240; x++) {
            int a = scope[(w0 + x) & 511u];
            if (a < 0) a = -a;
            if (a > peak) peak = a;
        }
        for (x = 0; x < 240; x++) {
            int yv = 219 - scope[(w0 + x) & 511u] * 19 / peak, a, b;
            if (yv < 199) yv = 199;
            if (yv > 239) yv = 239;
            a = prev < yv ? prev : yv;
            b = prev < yv ? yv : prev;
            fill((int)x, a, 1, b - a + 1, C_LGREEN);
            prev = yv;
        }
    }
    (void)v;
}

/* ---------------------------------------------------------------------------- tunes --- */
/* (re)start playlist entry idx; header: take the chip model from the tune */
static void start(uint32_t idx, int header)
{
    uint32_t t, i;
    running = 0;
    fm1_delay_ms(4);                        /* the ISR finishes the half it is in */
    play_idx = idx % NPLAY;
    psid_load(P, TUNES[PLAYLIST[play_idx].tune].data, TUNES[PLAYLIST[play_idx].tune].len, on_write, 0);
    if (header)
        model = psid_info(P)->model;
    if (engine)
        sid_init(&own, model ? SID_8580 : SID_6581, SID_CLOCK_PAL, FS_HZ);
    else
        rs_init(model, 985248.0, 24000000.0 / 544.0);
    for (i = 0; i < 32; i++)
        regs[i] = 0;
    ev_head = ev_tail = 0;
    play_cyc = 0;
    cyc_frac = 0;
    call_base = 0;
    t = psid_init(P, PLAYLIST[play_idx].song);
    gen_cyc = (t / PSID_PAL_FRAME + 1u) * PSID_PAL_FRAME;
    played_ms = 0;
    running = 1;
}

/* ----------------------------------------------------------------------------- main --- */
static void fm1_main(void)
{
    uint32_t last_draw = 0, last_ms = 0, hold = 0;
    lcd_init();
    fm1_input_init();
    fm1_audio_init(abuf, HALF_WORDS, isr_alnk0, 3);
    fm1_timer5_start(isr_timer5, 4);
    fm1_irq_enable_all();
    start(0, 1);
    for (;;) {
        uint32_t rel, e, now;
        int32_t step;
        fm1_wdt_feed();
        generate();
        now = ms;
        if (running)
            played_ms += now - last_ms;
        last_ms = now;
        e = fm1_input_edges(&rel);
        step = fm1_enc_take(6) + fm1_enc_take(0);
        if (e & (1u << 1)) step++;
        if (e & (1u << 0)) step--;
        if (step) {
            start((play_idx + NPLAY * 8u + (uint32_t)step) % NPLAY, 1);
        }
        if (e & (1u << 12))
            running = !running;
        if (e & (1u << 6)) {
            engine = !engine;
            start(play_idx, 0);
        }
        if (e & (1u << 2)) {
            model = !model;
            start(play_idx, 0);
        }
        /* OCT- and OCT+ held 3 s: the USB update mode */
        if ((fm1_in.buttons & 3u) == 3u) {
            if (!hold) hold = now;
            else if (now - hold > 3000u) {
                fm1_audio_stop();
                fm1_enter_uboot();
            }
        } else {
            hold = 0;
        }
        if (now - last_draw >= 40u) {
            last_draw = now;
            draw();
            lcd_frame();
        }
    }
}

void fm1_cstart(void)
{
    extern uint32_t _bss_start[], _bss_end[], _data_start[], _data_end[], _data_load[];
    typedef void (*ctor_t)(void);
    extern ctor_t __init_array_start[], __init_array_end[];
    uint32_t *w;
    ctor_t *c;
    fm1_time_init();
    fm1_wdt_arm(0x0D);
    fm1_irq_init();
    for (w = _bss_start; w < _bss_end; w++)
        *w = 0;
    for (w = _data_start; w < _data_end; w++)
        *w = _data_load[w - _data_start];
    for (c = __init_array_start; c < __init_array_end; c++)
        (*c)();
    fm1_mailbox_clear();
    fm1_main();
}
