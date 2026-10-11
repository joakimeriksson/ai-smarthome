/* sidsynth.c - see sidsynth.h
 * SPDX-License-Identifier: BSD-2-Clause */
#include "sidsynth.h"

#define P SID_PULSE
#define S SID_SAW
#define T SID_TRI
#define N SID_NOISE

const sid_patch_t SID_PATCHES[] = {
    {.name = "SAW LEAD", .ad = 0x09, .sr = 0xA9, .wt_len = 1, .wt_ctrl = {S},
     .filter = SID_LP, .res = 6, .cutoff = 1100, .cut_lo = 0, .cut_hi = 2047,
     .vib_delay = 18, .vib_speed = 24, .vib_depth = 48, .hr = 1},
    {.name = "PWM BASS", .ad = 0x08, .sr = 0x48, .wt_len = 1, .wt_ctrl = {P},
     .pw = 0x300, .pw_speed = 40, .pw_lo = 0x200, .pw_hi = 0xD00,
     .filter = SID_LP, .res = 10, .cutoff = 900, .cut_speed = -12, .cut_lo = 250, .cut_hi = 2047, .hr = 1},
    {.name = "MAJ CHORD", .ad = 0x00, .sr = 0xB6, .wt_len = 3, .wt_loop = 0,
     .wt_ctrl = {P, P, P}, .wt_note = {0, 4, 7},
     .pw = 0x800, .pw_speed = 24, .pw_lo = 0x300, .pw_hi = 0xC00, .hr = 1},
    {.name = "MIN CHORD", .ad = 0x00, .sr = 0xB6, .wt_len = 3, .wt_loop = 0,
     .wt_ctrl = {P, P, P}, .wt_note = {0, 3, 7},
     .pw = 0x800, .pw_speed = 24, .pw_lo = 0x300, .pw_hi = 0xC00, .hr = 1},
    {.name = "SYNC LEAD", .ad = 0x0A, .sr = 0xB8, .wt_len = 1, .wt_ctrl = {S}, .wt_note = {12},
     .mod = SID_SYNC, .mod_note = 0, .mod_sweep = 48,
     .vib_delay = 25, .vib_speed = 20, .vib_depth = 40, .hr = 1},
    {.name = "RING BELL", .ad = 0x0A, .sr = 0x0A, .wt_len = 1, .wt_ctrl = {T},
     .mod = SID_RING, .mod_note = 19},
    {.name = "KICK", .ad = 0x08, .sr = 0x00, .wt_len = 8, .wt_loop = 8,
     .wt_ctrl = {N, P, P, P, T, T, T, T}, .wt_note = {24, 0, -4, -8, -12, -15, -18, -20},
     .pw = 0x800, .hr = 1},
    {.name = "SNARE", .ad = 0x09, .sr = 0x00, .wt_len = 4, .wt_loop = 3,
     .wt_ctrl = {N, P, N, N}, .wt_note = {36, 10, 30, 27},
     .pw = 0x800, .hr = 1},
    {.name = "HAT", .ad = 0x05, .sr = 0x00, .wt_len = 1, .wt_ctrl = {N}, .wt_note = {48},
     .filter = SID_HP, .res = 2, .cutoff = 1500, .cut_lo = 0, .cut_hi = 2047},
    {.name = "RESO PAD", .ad = 0xA8, .sr = 0xCA, .wt_len = 1, .wt_ctrl = {S},
     .filter = SID_LP, .res = 13, .cutoff = 150, .cut_speed = 10, .cut_lo = 0, .cut_hi = 1500,
     .vib_delay = 30, .vib_speed = 12, .vib_depth = 24},
    {.name = "P&S ORGAN", .ad = 0x00, .sr = 0xF4, .wt_len = 1, .wt_ctrl = {P | S}, .pw = 0x800},
    {.name = "BP SWEEP", .ad = 0x0A, .sr = 0x99, .wt_len = 1, .wt_ctrl = {S},
     .filter = SID_BP, .res = 15, .cutoff = 300, .cut_speed = 24, .cut_lo = 0, .cut_hi = 1800},
};
const uint32_t SID_NPATCHES = sizeof SID_PATCHES / sizeof SID_PATCHES[0];

#undef P
#undef S
#undef T
#undef N

/* the frequency register, Q8, for MIDI 84..95 at the PAL clock: hz * 2^24 / 985248 * 256 */
static const uint32_t NOTE_Q8[12] = {4561991, 4833262, 5120662, 5425153, 5747749, 6089528,
                                     6451630, 6835264, 7241710, 7672325, 8128545, 8611893};

/* pitch in Q8 MIDI notes -> 16-bit frequency register (between semitones: linear) */
static uint32_t note_reg(int32_t pitch)
{
    uint32_t n, f, a, b;
    int32_t oct;
    if (pitch < 0)
        pitch = 0;
    n = (uint32_t)pitch >> 8;
    f = (uint32_t)pitch & 255u;
    a = NOTE_Q8[n % 12u];
    b = n % 12u == 11u ? NOTE_Q8[0] * 2u : NOTE_Q8[n % 12u + 1u];
    a += (b - a) * f >> 8;
    oct = (int32_t)(n / 12u) - 7;
    if (oct < 0)
        a = -oct >= 31 ? 0 : a >> -oct;
    else if (oct > 0)
        a = oct >= 4 || a >= (0x1000000u >> oct) ? 0x1000000u : a << oct;
    a = (a + 128u) >> 8;
    return a > 0xFFFFu ? 0xFFFFu : a;
}

/* a register write to chip c: ours, or the caller's engine */
static void cw(sidsyn_t *y, uint32_t c, uint32_t reg, uint32_t val)
{
    if (y->write)
        y->write(y->user, c, reg, val);
    else
        sid_write(&y->chip[c], reg, val);
}

static uint32_t venv(const sidsyn_t *y, const syn_voice_t *v)
{
    return y->env ? y->env(y->user, v->chip, v->idx) : y->chip[v->chip].v[v->idx].env;
}

static void wr(sidsyn_t *y, const syn_voice_t *v, uint32_t r, uint32_t val)
{
    cw(y, v->chip, v->idx * 7u + r, val);
}

static void chip_filter(sidsyn_t *y, uint32_t c)
{
    int32_t fc = y->cut[c] + y->cut_ofs;
    fc = fc < 0 ? 0 : fc > 2047 ? 2047 : fc;
    cw(y, c, SID_FC_LO, (uint32_t)fc & 7u);
    cw(y, c, SID_FC_HI, (uint32_t)fc >> 3);
    cw(y, c, SID_RES_FILT, (uint32_t)y->p.res << 4 | (y->p.filter ? (y->voice >= 0 ? 1u << y->voice : 7u) : 0u));
    cw(y, c, SID_MODE_VOL, y->p.filter | y->vol);
}

/* the voice's pitch, pulse width and control byte from its state */
static void voice_regs(sidsyn_t *y, syn_voice_t *v)
{
    const sid_patch_t *p = &y->p;
    int32_t pitch = ((int32_t)v->note + y->transpose + p->wt_note[v->pos]) * 256 + v->sweep;
    uint32_t fr, ctrl;
    if (p->vib_depth && v->frame >= p->vib_delay) {
        int32_t ph = v->vib & 1023, tri = (ph < 512 ? ph : 1023 - ph) - 256;   /* -256..255 */
        pitch += tri * p->vib_depth >> 8;
    }
    fr = note_reg(pitch);
    wr(y, v, SID_FREQ_LO, fr & 0xFFu);
    wr(y, v, SID_FREQ_HI, fr >> 8);
    wr(y, v, SID_PW_LO, (uint32_t)v->pw & 0xFFu);
    wr(y, v, SID_PW_HI, (uint32_t)v->pw >> 8);
    ctrl = p->wt_ctrl[v->pos] | p->mod | (v->held ? SID_GATE : 0u);
    if (ctrl != v->ctrl) {
        wr(y, v, SID_CTRL, ctrl);
        v->ctrl = (uint8_t)ctrl;
    }
    if (p->mod && y->voice < 0) {                     /* voice 3: the silent sync / ring source */
        fr = note_reg(((int32_t)v->note + y->transpose + p->mod_note) * 256);
        cw(y, v->chip, 14 + SID_FREQ_LO, fr & 0xFFu);
        cw(y, v->chip, 14 + SID_FREQ_HI, fr >> 8);
        cw(y, v->chip, 14 + SID_CTRL, SID_TRI);
    }
}

static void voice_start(sidsyn_t *y, syn_voice_t *v)
{
    const sid_patch_t *p = &y->p;
    v->pos = 0;
    v->frame = 0;
    v->sweep = 0;
    v->vib = 0;
    v->pw = p->pw;
    v->pw_dir = 1;
    wr(y, v, SID_AD, p->ad);
    wr(y, v, SID_SR, p->sr);
    if (v->ctrl & SID_GATE) {                         /* a gate edge restarts the attack */
        v->ctrl &= (uint8_t)~SID_GATE;
        wr(y, v, SID_CTRL, v->ctrl);
    }
    voice_regs(y, v);
    y->cut[v->chip] = p->cutoff;                      /* the newest note restarts its chip's sweep */
    chip_filter(y, v->chip);
}

void sidsyn_set_patch(sidsyn_t *y, const sid_patch_t *p)
{
    uint32_t i, c;
    sidsyn_all_off(y);
    y->p = *p;
    y->nslots = y->voice >= 0 ? 1u : p->mod ? y->nchips : y->nchips * 3u;
    for (i = 0; i < y->nslots; i++) {
        syn_voice_t *v = &y->v[i];
        v->chip = (uint8_t)(y->voice >= 0 ? 0u : p->mod ? i : i / 3u);
        v->idx = (uint8_t)(y->voice >= 0 ? (uint32_t)y->voice : p->mod ? 0u : i % 3u);
        v->busy = v->held = v->hr_left = 0;
        v->ctrl = 0;
    }
    for (c = 0; c < y->nchips; c++) {
        for (i = 0; i < 3; i++)
            if (y->voice < 0 || (int)i == y->voice)
                cw(y, c, i * 7u + SID_CTRL, 0);
        y->cut[c] = p->cutoff;
        chip_filter(y, c);
    }
}

void sidsyn_init(sidsyn_t *y, uint32_t nchips, sid_model_t model, uint32_t fs)
{
    uint32_t c;
    if (nchips < 1)
        nchips = 1;
    if (nchips > SYN_MAXCHIPS)
        nchips = SYN_MAXCHIPS;
    y->nchips = nchips;
    y->nslots = 0;
    y->fs = fs;
    y->rate = 50;
    y->tick_left = 0;
    y->tick_err = 0;
    y->clock_age = 0;
    y->cut_ofs = 0;
    y->transpose = 0;
    y->vol = 15;
    y->voice = -1;
    y->write = 0;
    y->env = 0;
    y->user = 0;
    for (c = 0; c < nchips; c++)
        sid_init(&y->chip[c], model, SID_CLOCK_PAL, fs);
    sidsyn_set_patch(y, &SID_PATCHES[0]);
}

void sidsyn_set_voice(sidsyn_t *y, int voice)
{
    sid_patch_t p = y->p;
    sidsyn_all_off(y);
    y->voice = (int8_t)(voice < 0 || voice > 2 ? -1 : voice);
    sidsyn_set_patch(y, &p);
}

void sidsyn_note_on(sidsyn_t *y, uint32_t note)
{
    syn_voice_t *best = 0;
    uint32_t i, best_score = 0;
    /* the same note again, else the quietest released slot, else the oldest held one */
    for (i = 0; i < y->nslots; i++) {
        syn_voice_t *v = &y->v[i];
        uint32_t score;
        if (v->busy && v->note == note) {
            best = v;
            break;
        }
        if (!v->busy)
            score = 0x7FFFFFFFu - v->age;
        else if (!v->held)
            score = 0x40000000u - venv(y, v) * 0x100000u - (v->age & 0xFFFFFu);
        else
            score = 0x100000u - (v->age & 0xFFFFFu);
        if (!best || score > best_score) {
            best = v;
            best_score = score;
        }
    }
    if (!best)
        return;
    best->note = (uint8_t)note;
    best->held = 1;
    best->age = ++y->clock_age;
    if (y->p.hr && best->busy && venv(y, best)) {
        best->hr_left = y->p.hr;                      /* hard restart: silence it for a frame first */
        wr(y, best, SID_AD, 0);
        wr(y, best, SID_SR, 0);
        best->ctrl &= (uint8_t)~SID_GATE;
        wr(y, best, SID_CTRL, best->ctrl);
    } else {
        best->hr_left = 0;
        voice_start(y, best);
    }
    best->busy = 1;
}

void sidsyn_note_off(sidsyn_t *y, uint32_t note)
{
    uint32_t i;
    for (i = 0; i < y->nslots; i++) {
        syn_voice_t *v = &y->v[i];
        if (!v->busy || !v->held || v->note != note)
            continue;
        v->held = 0;
        if (v->hr_left) {                             /* released before it started */
            v->hr_left = 0;
            v->busy = 0;
            continue;
        }
        v->ctrl &= (uint8_t)~SID_GATE;
        wr(y, v, SID_CTRL, v->ctrl);
    }
}

void sidsyn_all_off(sidsyn_t *y)
{
    uint32_t i;
    for (i = 0; i < y->nslots; i++)
        if (y->v[i].busy)
            sidsyn_note_off(y, y->v[i].note);
}

/* one frame of the driver: tables, sweeps, LFOs -> registers */
static void tick(sidsyn_t *y)
{
    const sid_patch_t *p = &y->p;
    uint32_t i, c;
    for (i = 0; i < y->nslots; i++) {
        syn_voice_t *v = &y->v[i];
        if (!v->busy)
            continue;
        if (v->hr_left) {
            if (!--v->hr_left)
                voice_start(y, v);
            continue;
        }
        v->frame++;
        if (v->pos + 1u < p->wt_len)
            v->pos++;
        else if (p->wt_loop < p->wt_len)
            v->pos = p->wt_loop;
        if (p->pw_speed) {
            v->pw += p->pw_speed * v->pw_dir;
            if (v->pw > p->pw_hi) {
                v->pw = p->pw_hi;
                v->pw_dir = -v->pw_dir;
            } else if (v->pw < p->pw_lo) {
                v->pw = p->pw_lo;
                v->pw_dir = -v->pw_dir;
            }
        }
        if (p->mod_sweep) {
            v->sweep += p->mod_sweep;
            if (v->sweep > 36 * 256)
                v->sweep = 36 * 256;
            if (v->sweep < -24 * 256)
                v->sweep = -24 * 256;
        }
        if (v->frame >= p->vib_delay)
            v->vib += p->vib_speed;
        voice_regs(y, v);
        if (!v->held && !venv(y, v))
            v->busy = 0;
    }
    for (c = 0; c < y->nchips; c++) {
        if (!p->filter)
            continue;
        y->cut[c] += p->cut_speed;
        if (y->cut[c] < p->cut_lo)
            y->cut[c] = p->cut_lo;
        if (y->cut[c] > p->cut_hi)
            y->cut[c] = p->cut_hi;
        chip_filter(y, c);
    }
}

void sidsyn_tick(sidsyn_t *y)
{
    tick(y);
}

void sidsyn_render(sidsyn_t *y, int32_t *out, uint32_t n)
{
    int32_t *o = out;
    uint32_t i, c, left = n;
    for (i = 0; i < n; i++)
        out[i] = 0;
    while (left) {
        uint32_t chunk;
        if (!y->tick_left) {
            tick(y);
            y->tick_left = y->fs / y->rate;
            y->tick_err += y->fs % y->rate;
            if (y->tick_err >= y->rate) {
                y->tick_err -= y->rate;
                y->tick_left++;
            }
        }
        chunk = left < y->tick_left ? left : y->tick_left;
        for (c = 0; c < y->nchips; c++)
            sid_render_add(&y->chip[c], o, chunk);
        o += chunk;
        left -= chunk;
        y->tick_left -= chunk;
    }
    if (y->nchips > 1) {
        int32_t g = (int32_t)(512u / (y->nchips + 1u));
        for (i = 0; i < n; i++)
            out[i] = out[i] * g >> 8;
    }
}
