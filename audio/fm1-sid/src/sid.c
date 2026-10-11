/* sid.c - MOS 6581 / 8580 model (see sid.h)
 * SPDX-License-Identifier: BSD-2-Clause */
#include "sid.h"

enum { ENV_ATTACK, ENV_DECAY, ENV_RELEASE };

#ifdef SID_LOG
void (*sid_log_init)(const sid_t *s);
void (*sid_log_write)(const sid_t *s, uint32_t reg, uint32_t val);
void (*sid_log_render)(const sid_t *s, uint32_t n);
#endif

/* cycles between envelope steps, per 4-bit rate (attack; decay and release use the same
 * periods and divide them further with the exponential counter) */
static const uint16_t RATE[16] = {9, 32, 63, 95, 149, 220, 267, 313,
                                  392, 977, 1954, 3126, 3907, 11720, 19532, 31251};

/* the decay / release divider: the slope flattens as the level falls */
static inline uint32_t exp_period(uint32_t env)
{
    return env > 0x5D ? 1u : env > 0x36 ? 2u : env > 0x1A ? 4u : env > 0x0E ? 8u : env > 0x06 ? 16u : env ? 30u : 1u;
}

/* ------------------------------------------------------------------------------------------
 * Combined waveforms. The real chip connects the selected waveform generators to the same
 * DAC inputs, so a bit is only high when every selected wave drives it high, and a high bit
 * between low neighbours is pulled down as well. Model: a bit survives when all components
 * set it and the weighted share of set component bits around it (+-4 bits, weights halving
 * with the distance) reaches a threshold; the 6581 pulls harder than the 8580. Tables per
 * model, indexed by the accumulator's top 12 bits; the pulse combos are the output while
 * the pulse is high (low pulse: 0). */
#define COMB_ST  0               /* saw + tri */
#define COMB_PT  1               /* pulse + tri */
#define COMB_PS  2               /* pulse + saw */
#define COMB_PST 3               /* pulse + saw + tri */
static uint16_t comb_tab[2][4][4096];
static uint8_t comb_ready[2];
/* waveform bits (ctrl >> 4 & 7: tri 1, saw 2, pulse 4) -> table, -1: not combined */
static const int8_t COMB_OF[8] = {-1, -1, -1, COMB_ST, -1, COMB_PT, COMB_PS, COMB_PST};

static void comb_build(uint32_t model)
{
    static const uint8_t W[5] = {16, 8, 4, 2, 1};
    static const uint8_t SETS[4] = {3, 5, 6, 7};
    uint32_t thr = model == SID_6581 ? 205u : 172u;   /* share of 256 */
    uint32_t t, idx, i;
    for (t = 0; t < 4; t++) {
        uint32_t set = SETS[t];
        for (idx = 0; idx < 4096; idx++) {
            uint32_t comp[3], nc = 0, out = 0;
            if (set & 1u)
                comp[nc++] = ((idx & 0x800u) ? idx ^ 0xFFFu : idx) << 1 & 0xFFEu;   /* triangle */
            if (set & 2u)
                comp[nc++] = idx;                                                     /* saw */
            if (set & 4u)
                comp[nc++] = 0xFFFu;                                                  /* pulse high */
            uint32_t cnt[12], c;
            for (i = 0; i < 12; i++)
                for (cnt[i] = 0, c = 0; c < nc; c++)
                    cnt[i] += comp[c] >> i & 1u;
            for (i = 0; i < 12; i++) {
                uint32_t num = 0, den = 0;
                int32_t d;
                if (cnt[i] != nc)
                    continue;
                for (d = -4; d <= 4; d++) {
                    int32_t j = (int32_t)i + d;
                    uint32_t w = W[d < 0 ? -d : d];
                    if (j < 0 || j > 11)
                        continue;
                    num += w * cnt[j];
                    den += w;
                }
                if (num * 256u >= thr * den * nc)   /* share of set bits around i >= thr / 256 */
                    out |= 1u << i;
            }
            comb_tab[model][t][idx] = (uint16_t)out;
        }
    }
    comb_ready[model] = 1;
}

/* ------------------------------------------------------------------------------------------
 * Filter cutoff. 8580: close to linear, ~30 Hz to ~12 kHz. 6581: the S-shaped curve of a
 * typical chip (flat around 200 Hz in the lower third, steep in the middle): points every
 * 128 steps of the 11-bit register, interpolated. Real 6581s differ from chip to chip. */
static const uint16_t FC6581[17] = {220, 225, 240, 270, 330, 450, 700, 1150, 1900,
                                    2900, 4100, 5400, 6800, 8300, 9900, 11600, 13000};

static uint32_t cutoff_hz(uint32_t model, uint32_t fc)
{
    if (model == SID_8580)
        return 30u + fc * 12000u / 2047u;
    {
        uint32_t i = fc >> 7, f = fc & 127u;
        return FC6581[i] + (((uint32_t)FC6581[i + 1] - FC6581[i]) * f >> 7);
    }
}

/* the TPT state variable filter's coefficients, Q12: g = tan(pi fc / fs) (Pade 3/2,
 * < 1 % off below 0.42 fs), k = 1 / Q, a1 = 1 / (1 + g (g + k)), a2 = g a1, a3 = g a2 */
static void filter_coefs(sid_t *s)
{
    uint32_t hz = cutoff_hz(s->model, s->fc), top = s->fs * 42u / 100u;
    int32_t x, x2, g, k, den;
    uint32_t res = s->res_filt >> 4;
    if (hz > top)
        hz = top;
    x = (int32_t)(hz * 12868u / s->fs);                   /* pi * 4096 = 12868 */
    x2 = x * x >> 12;
    g = x * (15 * 4096 - x2) / (15 * 4096 - 6 * x2);
    /* Q = 0.707 .. 1.707 (8580), .. 2.0 (6581: rings a little more) */
    k = (int32_t)((4096u * 4096u) / (2896u + res * (s->model == SID_6581 ? 353u : 273u)));
    den = 4096 + (g * (g + k) >> 12);
    s->a1 = (4096 * 4096) / den;
    s->a2 = g * s->a1 >> 12;
    s->a3 = g * s->a2 >> 12;
    s->k = k;
}

/* ------------------------------------------------------------------------------------------ */
static void voice_reset(sid_voice_t *v)
{
    v->acc = 0;
    v->freq = 0;
    v->pw = 0;
    v->lfsr = 0x7FFFFFu;
    v->noise = 0;
    v->out = 0;
    v->ctrl = 0;
    v->msb_rose = 0;
    v->env = 0;
    v->state = ENV_RELEASE;
    v->ad = v->sr = 0;
    v->hold_zero = 1;
    v->exp_cnt = 0;
    v->rate_cnt = 0;
    v->rate_period = RATE[0];
}

static inline uint32_t noise_bits(uint32_t r)
{
    return (r >> 9 & 0x800u) | (r >> 8 & 0x400u) | (r >> 5 & 0x200u) | (r >> 3 & 0x100u) |
           (r >> 2 & 0x080u) | (r << 1 & 0x040u) | (r << 3 & 0x020u) | (r << 4 & 0x010u);
}

void sid_reset(sid_t *s)
{
    uint32_t i;
    for (i = 0; i < 3; i++)
        voice_reset(&s->v[i]);
    for (i = 0; i < 32; i++)
        s->reg[i] = 0;
    s->res_filt = s->mode_vol = 0;
    s->fc = 0;
    s->cyc_frac = 0;
    s->ic1 = s->ic2 = 0;
    s->hp_x1 = s->hp_y1 = 0;
    filter_coefs(s);
}

void sid_init(sid_t *s, sid_model_t model, uint32_t clock_hz, uint32_t fs)
{
    uint32_t r;
    s->model = (uint8_t)model;
    s->fs = fs;
    /* clock / fs in Q16 without 64-bit arithmetic: integer part, then two 8-bit digits */
    s->cyc_q16 = clock_hz / fs << 16;
    r = clock_hz % fs;
    s->cyc_q16 |= (r << 8) / fs << 8;
    r = (r << 8) % fs;
    s->cyc_q16 |= (r << 8) / fs;
    if (model == SID_6581) {
        s->voice_zero = 0x380;
        s->mixer_dc = -12000;
    } else {
        s->voice_zero = 0x800;
        s->mixer_dc = 0;
    }
    if (!comb_ready[model])
        comb_build(model);
    sid_reset(s);
#ifdef SID_LOG
    if (sid_log_init)
        sid_log_init(s);
#endif
}

void sid_write(sid_t *s, uint32_t reg, uint32_t val)
{
    reg &= 0x1Fu;
    val &= 0xFFu;
#ifdef SID_LOG
    if (sid_log_write)
        sid_log_write(s, reg, val);
#endif
    s->reg[reg] = (uint8_t)val;
    if (reg < 21) {
        sid_voice_t *v = &s->v[reg / 7u];
        switch (reg % 7u) {
        case SID_FREQ_LO: v->freq = (v->freq & 0xFF00u) | val; break;
        case SID_FREQ_HI: v->freq = (v->freq & 0x00FFu) | val << 8; break;
        case SID_PW_LO: v->pw = (v->pw & 0xF00u) | val; break;
        case SID_PW_HI: v->pw = (v->pw & 0x0FFu) | (val & 15u) << 8; break;
        case SID_CTRL: {
            uint32_t was = v->ctrl;
            v->ctrl = (uint8_t)val;
            if ((val & SID_GATE) && !(was & SID_GATE)) {
                v->state = ENV_ATTACK;
                v->rate_period = RATE[v->ad >> 4];
                v->hold_zero = 0;
            } else if (!(val & SID_GATE) && (was & SID_GATE)) {
                v->state = ENV_RELEASE;
                v->rate_period = RATE[v->sr & 15u];
            }
            if (val & SID_TEST) {
                v->acc = 0;
                v->lfsr = 0x7FFFFFu;
                v->noise = noise_bits(v->lfsr);
            }
            break;
        }
        case SID_AD:
            v->ad = (uint8_t)val;
            if (v->state == ENV_ATTACK)
                v->rate_period = RATE[val >> 4];
            else if (v->state == ENV_DECAY)
                v->rate_period = RATE[val & 15u];
            break;
        case SID_SR:
            v->sr = (uint8_t)val;
            if (v->state == ENV_RELEASE)
                v->rate_period = RATE[val & 15u];
            break;
        }
        return;
    }
    switch (reg) {
    case SID_FC_LO: s->fc = (uint16_t)((s->fc & 0x7F8u) | (val & 7u)); filter_coefs(s); break;
    case SID_FC_HI: s->fc = (uint16_t)((s->fc & 7u) | val << 3); filter_coefs(s); break;
    case SID_RES_FILT: s->res_filt = (uint8_t)val; filter_coefs(s); break;
    case SID_MODE_VOL: s->mode_vol = (uint8_t)val; break;
    }
}

uint32_t sid_read(sid_t *s, uint32_t reg)
{
    switch (reg & 0x1Fu) {
    case SID_OSC3: return s->v[2].out >> 4;
    case SID_ENV3: return s->v[2].env;
    case SID_POTX:
    case SID_POTY: return 0xFF;
    default: return 0;
    }
}

/* ------------------------------------------------------------------------------------------ */
/* advance the phase by c cycles; count the noise clocks (rising edges of bit 19) */
static inline void osc_clock(sid_voice_t *v, uint32_t c)
{
    uint32_t old = v->acc, nw, edges;
    if (v->ctrl & SID_TEST) {
        v->msb_rose = 0;
        return;
    }
    nw = old + v->freq * c;                               /* < 2^25: no overflow */
    v->msb_rose = (uint8_t)((~old & nw & 0x800000u) != 0);
    edges = ((nw + 0x80000u) >> 20) - ((old + 0x80000u) >> 20);
    if (edges) {
        uint32_t r = v->lfsr;
        do {
            r = (r << 1 | ((r >> 22 ^ r >> 17) & 1u)) & 0x7FFFFFu;
        } while (--edges);
        v->lfsr = r;
        v->noise = noise_bits(r);
    }
    v->acc = nw & 0xFFFFFFu;
}

/* hard sync: v restarts where it would be after the source's MSB rose inside the batch */
static inline void osc_sync(sid_voice_t *v, const sid_voice_t *src)
{
    if ((v->ctrl & SID_SYNC) && src->msb_rose && src->freq) {
        uint32_t since = (src->acc & 0x7FFFFFu) / src->freq;  /* cycles since the rise */
        v->acc = v->freq * since & 0xFFFFFFu;
    }
}

static inline void env_clock(sid_voice_t *v, uint32_t c)
{
    for (;;) {
        uint32_t dist = (v->rate_period - v->rate_cnt) & 0x7FFFu;
        if (!dist)
            dist = 0x8000u;                               /* equal now: the next hit is a full wrap away */
        if (c < dist) {
            v->rate_cnt = (uint16_t)((v->rate_cnt + c) & 0x7FFFu);
            return;
        }
        c -= dist;
        v->rate_cnt = 0;
        if (v->state != ENV_ATTACK && ++v->exp_cnt < exp_period(v->env))
            continue;
        v->exp_cnt = 0;
        if (v->hold_zero)
            continue;
        switch (v->state) {
        case ENV_ATTACK:
            if (++v->env == 0xFF) {
                v->state = ENV_DECAY;
                v->rate_period = RATE[v->ad & 15u];
            }
            break;
        case ENV_DECAY:
            if (v->env != (v->sr >> 4) * 0x11u)
                v->env--;
            break;
        default:
            v->env--;
            break;
        }
        /* the freeze at zero is a decay / release thing: an attack started at 0xFF wraps the
         * 8-bit counter to 0 and counts on up (a retrigger at full level re-attacks from 0) */
        if (!v->env && v->state != ENV_ATTACK)
            v->hold_zero = 1;
    }
}

/* the 12-bit waveform output; ring_msb: the ring source's MSB */
static inline uint32_t wave_out(const sid_t *s, sid_voice_t *v, uint32_t ring_msb)
{
    uint32_t w = (uint32_t)v->ctrl >> 4, acc = v->acc, out, pulse;
    if (!w)
        return v->out;                                    /* no waveform: the DAC holds the last value */
    pulse = (v->ctrl & SID_TEST) || (acc >> 12) >= v->pw ? 0xFFFu : 0u;
    switch (w & 7u) {
    case 0: out = 0xFFFu; break;                          /* noise alone */
    case 1: {
        uint32_t msb = (acc ^ ((v->ctrl & SID_RING) ? ring_msb : 0u)) & 0x800000u;
        out = ((msb ? ~acc : acc) >> 11) & 0xFFFu;
        break;
    }
    case 2: out = acc >> 12; break;
    case 4: out = pulse; break;
    default:
        out = (w & 4u) && !pulse ? 0u : comb_tab[s->model][COMB_OF[w & 7u]][acc >> 12];
        break;
    }
    if (w & 8u)
        out &= v->noise;
    v->out = out;
    return out;
}

static void render(sid_t *s, int32_t *out, uint32_t n, int add)
{
    uint32_t i, j;
    uint32_t filt = s->res_filt & 7u, vol = s->mode_vol & 15u;
    uint32_t mute3 = (s->mode_vol & SID_3OFF) && !(filt & 4u);
    uint32_t mode = s->mode_vol & 0x70u;
    int32_t zero = s->voice_zero;
#ifdef SID_LOG
    if (sid_log_render)
        sid_log_render(s, n);
#endif
    if (!filt)
        s->ic1 = s->ic2 = 0;
    for (i = 0; i < n; i++) {
        uint32_t c;
        int32_t vo[3], fin = 0, dry = s->mixer_dc, y;
        s->cyc_frac += s->cyc_q16;
        c = s->cyc_frac >> 16;
        s->cyc_frac &= 0xFFFFu;
        for (j = 0; j < 3; j++)
            osc_clock(&s->v[j], c);
        osc_sync(&s->v[0], &s->v[2]);
        osc_sync(&s->v[1], &s->v[0]);
        osc_sync(&s->v[2], &s->v[1]);
        for (j = 0; j < 3; j++) {
            sid_voice_t *v = &s->v[j];
            uint32_t w;
            env_clock(v, c);
            w = wave_out(s, v, s->v[j ? j - 1u : 2u].acc & 0x800000u);
            vo[j] = ((int32_t)w - zero) * (int32_t)v->env >> 5;
        }
        for (j = 0; j < 3; j++) {
            if (filt >> j & 1u)
                fin += vo[j];
            else if (j < 2 || !mute3)
                dry += vo[j];
        }
        if (filt) {
            int32_t v1, v2, v3 = fin - s->ic2;
            v1 = (s->a1 * s->ic1 >> 12) + (s->a2 * v3 >> 12);
            v2 = s->ic2 + (s->a2 * s->ic1 >> 12) + (s->a3 * v3 >> 12);
            s->ic1 = 2 * v1 - s->ic1;
            s->ic2 = 2 * v2 - s->ic2;
            if (mode & SID_LP)
                dry += v2;
            if (mode & SID_BP)
                dry += v1;
            if (mode & SID_HP)
                dry += fin - (s->k * v1 >> 12) - v2;
        }
        /* master volume (three full voices ~ -3 dBFS before the AC coupling, which can swing a
         * pulse's DC up by as much again), then the AC coupling (~14 Hz) */
        y = dry * (int32_t)vol * 32 >> 10;
        s->hp_y1 = y - s->hp_x1 + s->hp_y1 - (s->hp_y1 >> 9);
        s->hp_x1 = y;
        if (add)
            out[i] += s->hp_y1;
        else
            out[i] = s->hp_y1;
    }
}

void sid_render(sid_t *s, int32_t *out, uint32_t n) { render(s, out, n, 0); }
void sid_render_add(sid_t *s, int32_t *out, uint32_t n) { render(s, out, n, 1); }
