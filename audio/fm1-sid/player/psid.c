/* player/psid.c - see psid.h
 * SPDX-License-Identifier: BSD-2-Clause */
#include <string.h>
#include "psid.h"

#define CHIPS_IMPL
#define CHIPS_ASSERT(c) ((void)0)
#ifndef assert
#define assert(c) ((void)0)              /* m6502.h marks unreachable decoder slots with it */
#endif
#include "m6502.h"

struct psid {
    m6502_t cpu;
    uint64_t pins;
    psid_info_t info;
    psid_write_fn wr;
    void *user;
    uint32_t cycle;                       /* cycles into the current call */
    uint32_t song;
    uint16_t cia_latch;
    uint32_t rnd;
    uint8_t mem[65536];
};

uint32_t psid_size(void) { return (uint32_t)sizeof(psid_t); }
const psid_info_t *psid_info(const psid_t *p) { return &p->info; }

static int io_on(const psid_t *p)
{
    uint8_t b = p->mem[1] & 7;
    return (b & 3) && (b & 4);
}

static uint8_t bus_read(psid_t *p, uint16_t ad)
{
    if (ad >= 0xD000 && ad < 0xE000 && io_on(p)) {
        if (ad >= 0xD400 && ad < 0xD800) {
            if ((ad & 0x1f) == 0x1b) {                 /* OSC3: a running random byte */
                p->rnd = p->rnd * 1103515245u + 12345u;
                return (uint8_t)(p->rnd >> 16);
            }
            return 0;
        }
        if (ad == 0xD012)
            return (uint8_t)((p->cycle / 63) % 312);   /* raster line, for busy-waits */
        if (ad == 0xD011)
            return (uint8_t)((((p->cycle / 63) % 312) >> 1) & 0x80);
        if (ad == 0xDC04)
            return (uint8_t)p->cia_latch;
        if (ad == 0xDC05)
            return (uint8_t)(p->cia_latch >> 8);
        return 0;
    }
    return p->mem[ad];
}

static void bus_write(psid_t *p, uint16_t ad, uint8_t v)
{
    if (ad >= 0xD000 && ad < 0xE000 && io_on(p)) {
        if (ad >= 0xD400 && ad < 0xD800)
            p->wr(p->user, p->cycle, ad & 0x1fu, v);
        else if (ad == 0xDC04)
            p->cia_latch = (uint16_t)((p->cia_latch & 0xff00) | v);
        else if (ad == 0xDC05)
            p->cia_latch = (uint16_t)((p->cia_latch & 0x00ff) | v << 8);
        return;
    }
    p->mem[ad] = v;
}

/* run from ad until the routine returns to the sentinel at $0000 / $0001 (RTI / RTS) or into
 * a KERNAL interrupt exit (no ROM here), at most max cycles */
static uint32_t call(psid_t *p, uint16_t ad, uint8_t a, int irq, uint32_t max)
{
    uint64_t pins;
    uint8_t s = 0xff;
    p->mem[0x100 + s--] = 0x00;           /* return address $0000: RTS lands on $0001 */
    p->mem[0x100 + s--] = 0x00;
    if (irq)
        p->mem[0x100 + s--] = m6502_p(&p->cpu) | 0x20;
    m6502_set_s(&p->cpu, s);
    m6502_set_a(&p->cpu, a);
    m6502_set_x(&p->cpu, 0);
    m6502_set_y(&p->cpu, 0);
    pins = M6502_SYNC;                    /* the "prefetch" that starts execution at ad */
    M6502_SET_ADDR(pins, ad);
    M6502_SET_DATA(pins, p->mem[ad]);
    m6502_set_pc(&p->cpu, ad);
    p->cycle = 0;
    while (p->cycle < max) {
        uint16_t addr;
        pins = m6502_tick(&p->cpu, pins);
        p->cycle++;
        addr = M6502_GET_ADDR(pins);
        if ((pins & M6502_SYNC) && (addr <= 1 || addr == 0xEA31 || addr == 0xEA81 || addr == 0xFEBC))
            break;
        if (pins & M6502_RW) {
            M6502_SET_DATA(pins, bus_read(p, addr));
        } else {
            bus_write(p, addr, M6502_GET_DATA(pins));
        }
    }
    p->pins = pins;
    return p->cycle;
}

static uint16_t be16(const uint8_t *b) { return (uint16_t)(b[0] << 8 | b[1]); }

static void str32(char *d, const uint8_t *s)
{
    memcpy(d, s, 32);
    d[32] = 0;
}

int psid_load(psid_t *p, const uint8_t *b, uint32_t n, psid_write_fn wr, void *user)
{
    uint16_t ver, off, flags = 0;
    uint32_t len;
    m6502_desc_t desc;
    if (n < 0x76 || memcmp(b, "PSID", 4))
        return -1;
    memset(p, 0, sizeof *p);
    memset(&desc, 0, sizeof desc);
    m6502_init(&p->cpu, &desc);
    p->wr = wr;
    p->user = user;
    p->cia_latch = 0x4025;
    p->rnd = 0x1234567u;
    ver = be16(b + 4);
    off = be16(b + 6);
    p->info.load = be16(b + 8);
    p->info.init = be16(b + 10);
    p->info.play = be16(b + 12);
    p->info.songs = be16(b + 14);
    p->info.start = be16(b + 16);
    p->info.speed = (uint32_t)be16(b + 18) << 16 | be16(b + 20);
    str32(p->info.name, b + 0x16);
    str32(p->info.author, b + 0x36);
    str32(p->info.released, b + 0x56);
    if (ver >= 2 && n >= 0x7c)
        flags = be16(b + 0x76);
    p->info.model = ((flags >> 4) & 3) == 2 ? 1 : 0;
    if (!p->info.load) {
        p->info.load = (uint16_t)(b[off] | b[off + 1] << 8);
        off += 2;
    }
    if (!p->info.init)
        p->info.init = p->info.load;
    len = n - off;
    if (len > 65536u - p->info.load)
        len = 65536u - p->info.load;
    memcpy(p->mem + p->info.load, b + off, len);
    p->mem[1] = 0x37;
    return 0;
}

uint32_t psid_init(psid_t *p, uint32_t song)
{
    if (!song)
        song = p->info.start ? p->info.start : 1;
    p->song = song;
    m6502_set_p(&p->cpu, 0x24);           /* I set */
    return call(p, p->info.init, (uint8_t)(song - 1), 0, 5u * PSID_PAL_CLOCK);
}

uint32_t psid_period(const psid_t *p)
{
    if (p->info.speed >> ((p->song - 1) & 31) & 1) {
        uint32_t t = (uint32_t)p->cia_latch + 1u;
        return t < 1000 ? PSID_PAL_FRAME : t;
    }
    return PSID_PAL_FRAME;
}

uint32_t psid_play(psid_t *p)
{
    uint16_t ad = p->info.play;
    int irq = 0;
    if (!ad) {                            /* the tune installed its own interrupt handler */
        ad = (p->mem[1] & 2) ? (uint16_t)(p->mem[0x314] | p->mem[0x315] << 8)
                             : (uint16_t)(p->mem[0xfffe] | p->mem[0xffff] << 8);
        irq = 1;
    }
    return call(p, ad, 0, irq, 2u * PSID_PAL_FRAME);
}
