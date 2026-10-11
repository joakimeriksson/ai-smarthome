/* host/sidplay.c - play a PSID tune's 6502 code and record its SID writes, cycle-exact, as a
 * register stream (sidlog v2) for host/replay.cc to play on every SID engine.
 *
 *   build/sidplay TUNE.sid OUT.sidlog [song] [seconds] [model]
 *     song     1-based (default: the tune's start song)
 *     seconds  length (default 30)
 *     model    6581 | 8580 (default: the tune's header, else 6581)
 *
 * The C64 here is a 6502 (all official opcodes, decimal mode, the common undocumented ones),
 * 64 KB of RAM, the $01 banking of the I/O area, CIA 1 timer A as the PSID speed source and
 * the SID registers ($D400-$D7FF, mirrored every 32 bytes). No ROMs, no VIC, no NMIs: enough
 * for PSID tunes (init + a play routine called each frame); RSID tunes are refused.
 * OSC3 / ENV3 reads return a running pseudo-random byte / 0.
 *
 * sidlog v2 = v1 (see host/demo.c record) with "SIDLOG2" and C64 cycles instead of samples in
 * the events, so the replay clocks each engine to the cycle of each write.
 * SPDX-License-Identifier: BSD-2-Clause */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PAL_CLOCK 985248u
#define PAL_FRAME 19656u                  /* 312 lines x 63 cycles */
#define FS 44100u

/* ------------------------------------------------------------------------------------------ */
static uint8_t mem[65536];
static uint8_t a, x, y, s, p;
static uint16_t pc;
static uint64_t cyc;                      /* C64 cycles */
static uint16_t cia_latch = 0x4025;       /* CIA 1 timer A (KERNAL default: ~60 Hz on PAL) */
static uint32_t rnd = 0x1234567u;

enum { FC = 1, FZ = 2, FI = 4, FD = 8, FB = 16, FU = 32, FV = 64, FN = 128 };

typedef struct { uint32_t cyc; uint8_t chip, reg, val, pad; } ev_t;
static ev_t *evs;
static uint32_t nev, cap;

static int io_on(void) { uint8_t b = mem[1] & 7; return (b & 3) && (b & 4); }

static uint8_t rd(uint16_t ad)
{
    if (ad >= 0xD000 && ad < 0xE000 && io_on()) {
        if (ad >= 0xD400 && ad < 0xD800) {
            uint8_t r = ad & 0x1f;
            if (r == 0x1b) { rnd = rnd * 1103515245u + 12345u; return (uint8_t)(rnd >> 16); }
            return 0;
        }
        if (ad == 0xD012) return (uint8_t)((cyc / 63) % 312);      /* raster line, for busy-waits */
        if (ad == 0xD011) return (uint8_t)(((cyc / 63) % 312) >> 1 & 0x80);
        if (ad == 0xDC04) return (uint8_t)cia_latch;
        if (ad == 0xDC05) return (uint8_t)(cia_latch >> 8);
        return 0;
    }
    return mem[ad];
}

static void wr(uint16_t ad, uint8_t v)
{
    if (ad >= 0xD000 && ad < 0xE000 && io_on()) {
        if (ad >= 0xD400 && ad < 0xD800) {
            if (nev == cap) {
                cap = cap ? cap * 2 : 65536;
                evs = realloc(evs, cap * sizeof *evs);
            }
            evs[nev].cyc = (uint32_t)cyc;
            evs[nev].chip = 0;
            evs[nev].reg = ad & 0x1f;
            evs[nev].val = v;
            evs[nev++].pad = 0;
        } else if (ad == 0xDC04) {
            cia_latch = (uint16_t)((cia_latch & 0xff00) | v);
        } else if (ad == 0xDC05) {
            cia_latch = (uint16_t)((cia_latch & 0x00ff) | v << 8);
        }
        return;
    }
    mem[ad] = v;
}

/* ------------------------------------------------------------------------------------------ */
enum { IMP, ACC, IMM, ZP, ZPX, ZPY, ABS, ABX, ABY, IND, IZX, IZY, REL };
enum {
    JAM, ADC, AND, ASL, BCC, BCS, BEQ, BIT, BMI, BNE, BPL, BRK, BVC, BVS, CLC, CLD, CLI, CLV, CMP,
    CPX, CPY, DEC, DEX, DEY, EOR, INC, INX, INY, JMP, JSR, LDA, LDX, LDY, LSR, NOP, ORA, PHA, PHP,
    PLA, PLP, ROL, ROR, RTI, RTS, SBC, SEC, SED, SEI, STA, STX, STY, TAX, TAY, TSX, TXA, TXS, TYA,
    LAX, SAX, DCP, ISC, SLO, RLA, SRE, RRA, ANC, ALR, ARR, SBX, SHA, SHX, SHY, TAS, LAS, XAA
};
static const struct { uint8_t code, op, mode; } OPS[] = {
    {0x00,BRK,IMP},{0x01,ORA,IZX},{0x05,ORA,ZP},{0x06,ASL,ZP},{0x08,PHP,IMP},{0x09,ORA,IMM},{0x0A,ASL,ACC},
    {0x0D,ORA,ABS},{0x0E,ASL,ABS},{0x10,BPL,REL},{0x11,ORA,IZY},{0x15,ORA,ZPX},{0x16,ASL,ZPX},{0x18,CLC,IMP},
    {0x19,ORA,ABY},{0x1D,ORA,ABX},{0x1E,ASL,ABX},{0x20,JSR,ABS},{0x21,AND,IZX},{0x24,BIT,ZP},{0x25,AND,ZP},
    {0x26,ROL,ZP},{0x28,PLP,IMP},{0x29,AND,IMM},{0x2A,ROL,ACC},{0x2C,BIT,ABS},{0x2D,AND,ABS},{0x2E,ROL,ABS},
    {0x30,BMI,REL},{0x31,AND,IZY},{0x35,AND,ZPX},{0x36,ROL,ZPX},{0x38,SEC,IMP},{0x39,AND,ABY},{0x3D,AND,ABX},
    {0x3E,ROL,ABX},{0x40,RTI,IMP},{0x41,EOR,IZX},{0x45,EOR,ZP},{0x46,LSR,ZP},{0x48,PHA,IMP},{0x49,EOR,IMM},
    {0x4A,LSR,ACC},{0x4C,JMP,ABS},{0x4D,EOR,ABS},{0x4E,LSR,ABS},{0x50,BVC,REL},{0x51,EOR,IZY},{0x55,EOR,ZPX},
    {0x56,LSR,ZPX},{0x58,CLI,IMP},{0x59,EOR,ABY},{0x5D,EOR,ABX},{0x5E,LSR,ABX},{0x60,RTS,IMP},{0x61,ADC,IZX},
    {0x65,ADC,ZP},{0x66,ROR,ZP},{0x68,PLA,IMP},{0x69,ADC,IMM},{0x6A,ROR,ACC},{0x6C,JMP,IND},{0x6D,ADC,ABS},
    {0x6E,ROR,ABS},{0x70,BVS,REL},{0x71,ADC,IZY},{0x75,ADC,ZPX},{0x76,ROR,ZPX},{0x78,SEI,IMP},{0x79,ADC,ABY},
    {0x7D,ADC,ABX},{0x7E,ROR,ABX},{0x81,STA,IZX},{0x84,STY,ZP},{0x85,STA,ZP},{0x86,STX,ZP},{0x88,DEY,IMP},
    {0x8A,TXA,IMP},{0x8C,STY,ABS},{0x8D,STA,ABS},{0x8E,STX,ABS},{0x90,BCC,REL},{0x91,STA,IZY},{0x94,STY,ZPX},
    {0x95,STA,ZPX},{0x96,STX,ZPY},{0x98,TYA,IMP},{0x99,STA,ABY},{0x9A,TXS,IMP},{0x9D,STA,ABX},{0xA0,LDY,IMM},
    {0xA1,LDA,IZX},{0xA2,LDX,IMM},{0xA4,LDY,ZP},{0xA5,LDA,ZP},{0xA6,LDX,ZP},{0xA8,TAY,IMP},{0xA9,LDA,IMM},
    {0xAA,TAX,IMP},{0xAC,LDY,ABS},{0xAD,LDA,ABS},{0xAE,LDX,ABS},{0xB0,BCS,REL},{0xB1,LDA,IZY},{0xB4,LDY,ZPX},
    {0xB5,LDA,ZPX},{0xB6,LDX,ZPY},{0xB8,CLV,IMP},{0xB9,LDA,ABY},{0xBA,TSX,IMP},{0xBC,LDY,ABX},{0xBD,LDA,ABX},
    {0xBE,LDX,ABY},{0xC0,CPY,IMM},{0xC1,CMP,IZX},{0xC4,CPY,ZP},{0xC5,CMP,ZP},{0xC6,DEC,ZP},{0xC8,INY,IMP},
    {0xC9,CMP,IMM},{0xCA,DEX,IMP},{0xCC,CPY,ABS},{0xCD,CMP,ABS},{0xCE,DEC,ABS},{0xD0,BNE,REL},{0xD1,CMP,IZY},
    {0xD5,CMP,ZPX},{0xD6,DEC,ZPX},{0xD8,CLD,IMP},{0xD9,CMP,ABY},{0xDD,CMP,ABX},{0xDE,DEC,ABX},{0xE0,CPX,IMM},
    {0xE1,SBC,IZX},{0xE4,CPX,ZP},{0xE5,SBC,ZP},{0xE6,INC,ZP},{0xE8,INX,IMP},{0xE9,SBC,IMM},{0xEA,NOP,IMP},
    {0xEC,CPX,ABS},{0xED,SBC,ABS},{0xEE,INC,ABS},{0xF0,BEQ,REL},{0xF1,SBC,IZY},{0xF5,SBC,ZPX},{0xF6,INC,ZPX},
    {0xF8,SED,IMP},{0xF9,SBC,ABY},{0xFD,SBC,ABX},{0xFE,INC,ABX},
    /* undocumented */
    {0x03,SLO,IZX},{0x07,SLO,ZP},{0x0F,SLO,ABS},{0x13,SLO,IZY},{0x17,SLO,ZPX},{0x1B,SLO,ABY},{0x1F,SLO,ABX},
    {0x23,RLA,IZX},{0x27,RLA,ZP},{0x2F,RLA,ABS},{0x33,RLA,IZY},{0x37,RLA,ZPX},{0x3B,RLA,ABY},{0x3F,RLA,ABX},
    {0x43,SRE,IZX},{0x47,SRE,ZP},{0x4F,SRE,ABS},{0x53,SRE,IZY},{0x57,SRE,ZPX},{0x5B,SRE,ABY},{0x5F,SRE,ABX},
    {0x63,RRA,IZX},{0x67,RRA,ZP},{0x6F,RRA,ABS},{0x73,RRA,IZY},{0x77,RRA,ZPX},{0x7B,RRA,ABY},{0x7F,RRA,ABX},
    {0x83,SAX,IZX},{0x87,SAX,ZP},{0x8F,SAX,ABS},{0x97,SAX,ZPY},
    {0xA3,LAX,IZX},{0xA7,LAX,ZP},{0xAF,LAX,ABS},{0xB3,LAX,IZY},{0xB7,LAX,ZPY},{0xBF,LAX,ABY},{0xAB,LAX,IMM},
    {0xC3,DCP,IZX},{0xC7,DCP,ZP},{0xCF,DCP,ABS},{0xD3,DCP,IZY},{0xD7,DCP,ZPX},{0xDB,DCP,ABY},{0xDF,DCP,ABX},
    {0xE3,ISC,IZX},{0xE7,ISC,ZP},{0xEF,ISC,ABS},{0xF3,ISC,IZY},{0xF7,ISC,ZPX},{0xFB,ISC,ABY},{0xFF,ISC,ABX},
    {0x0B,ANC,IMM},{0x2B,ANC,IMM},{0x4B,ALR,IMM},{0x6B,ARR,IMM},{0xCB,SBX,IMM},{0xEB,SBC,IMM},{0x8B,XAA,IMM},
    {0x93,SHA,IZY},{0x9F,SHA,ABY},{0x9E,SHX,ABY},{0x9C,SHY,ABX},{0x9B,TAS,ABY},{0xBB,LAS,ABY},
    {0x1A,NOP,IMP},{0x3A,NOP,IMP},{0x5A,NOP,IMP},{0x7A,NOP,IMP},{0xDA,NOP,IMP},{0xFA,NOP,IMP},
    {0x80,NOP,IMM},{0x82,NOP,IMM},{0x89,NOP,IMM},{0xC2,NOP,IMM},{0xE2,NOP,IMM},
    {0x04,NOP,ZP},{0x44,NOP,ZP},{0x64,NOP,ZP},{0x14,NOP,ZPX},{0x34,NOP,ZPX},{0x54,NOP,ZPX},{0x74,NOP,ZPX},
    {0xD4,NOP,ZPX},{0xF4,NOP,ZPX},{0x0C,NOP,ABS},{0x1C,NOP,ABX},{0x3C,NOP,ABX},{0x5C,NOP,ABX},{0x7C,NOP,ABX},
    {0xDC,NOP,ABX},{0xFC,NOP,ABX},
};
static const uint8_t CYC[256] = {
    7,6,0,8,3,3,5,5,3,2,2,2,4,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,0,8,3,3,5,5,4,2,2,2,4,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,0,8,3,3,5,5,3,2,2,2,3,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
    6,6,0,8,3,3,5,5,4,2,2,2,5,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
    2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,6,0,6,4,4,4,4,2,5,2,5,5,5,5,5,
    2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4, 2,5,0,5,4,4,4,4,2,4,2,4,4,4,4,4,
    2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
    2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6, 2,5,0,8,4,4,6,6,2,4,2,7,4,4,7,7,
};
static uint8_t op_of[256], mode_of[256];

static void setnz(uint8_t v) { p = (uint8_t)((p & ~(FZ | FN)) | (v ? 0 : FZ) | (v & FN)); }
static void push(uint8_t v) { mem[0x100 + s--] = v; }
static uint8_t pull(void) { return mem[0x100 + ++s]; }

static void adc(uint8_t v)
{
    unsigned c = p & FC;
    if (p & FD) {
        unsigned t = (a & 0xf) + (v & 0xf) + c;
        if (t > 9) t += 6;
        t = t <= 0x0f ? (t & 0xf) + (a & 0xf0) + (v & 0xf0) : (t & 0xf) + (a & 0xf0) + (v & 0xf0) + 0x10;
        p = (uint8_t)(p & ~(FZ | FN | FV | FC));
        if (!((a + v + c) & 0xff)) p |= FZ;
        if (t & 0x80) p |= FN;
        if (((a ^ t) & 0x80) && !((a ^ v) & 0x80)) p |= FV;
        if ((t & 0x1f0) > 0x90) t += 0x60;
        if ((t & 0xff0) > 0xf0) p |= FC;
        a = (uint8_t)t;
    } else {
        unsigned t = a + v + c;
        p = (uint8_t)(p & ~(FV | FC));
        if (~(a ^ v) & (a ^ t) & 0x80) p |= FV;
        if (t > 0xff) p |= FC;
        a = (uint8_t)t;
        setnz(a);
    }
}

static void sbc(uint8_t v)
{
    if (p & FD) {
        unsigned c = p & FC ? 0 : 1, t = a - v - c, ta = (a & 0xf) - (v & 0xf) - c;
        ta = ta & 0x10 ? ((ta - 6) & 0xf) | ((a & 0xf0) - (v & 0xf0) - 0x10) : (ta & 0xf) | ((a & 0xf0) - (v & 0xf0));
        if (ta & 0x100) ta -= 0x60;
        p = (uint8_t)(p & ~(FV | FC));
        if (t < 0x100) p |= FC;
        if (((a ^ t) & 0x80) && ((a ^ v) & 0x80)) p |= FV;
        setnz((uint8_t)t);
        a = (uint8_t)ta;
    } else {
        adc((uint8_t)~v);
    }
}

static void cmp(uint8_t r, uint8_t v)
{
    unsigned t = r - v;
    p = (uint8_t)((p & ~FC) | (r >= v ? FC : 0));
    setnz((uint8_t)t);
}

/* one instruction; returns 0 on a JAM */
static int step(void)
{
    uint8_t opc = rd(pc++), op = op_of[opc], mode = mode_of[opc], v = 0;
    uint16_t ad = 0;
    int cross = 0, extra = 0;
    uint64_t c0 = cyc;
    switch (mode) {
    case IMM: ad = pc++; break;
    case ZP: ad = rd(pc++); break;
    case ZPX: ad = (uint8_t)(rd(pc++) + x); break;
    case ZPY: ad = (uint8_t)(rd(pc++) + y); break;
    case ABS: ad = (uint16_t)(rd(pc) | rd((uint16_t)(pc + 1)) << 8); pc += 2; break;
    case ABX: case ABY: {
        uint16_t b = (uint16_t)(rd(pc) | rd((uint16_t)(pc + 1)) << 8);
        pc += 2;
        ad = (uint16_t)(b + (mode == ABX ? x : y));
        cross = (ad ^ b) & 0xff00 ? 1 : 0;
        break;
    }
    case IND: {
        uint16_t b = (uint16_t)(rd(pc) | rd((uint16_t)(pc + 1)) << 8);
        pc += 2;
        ad = (uint16_t)(rd(b) | rd((uint16_t)((b & 0xff00) | ((b + 1) & 0xff))) << 8);
        break;
    }
    case IZX: { uint8_t z = (uint8_t)(rd(pc++) + x); ad = (uint16_t)(rd(z) | rd((uint8_t)(z + 1)) << 8); break; }
    case IZY: {
        uint8_t z = rd(pc++);
        uint16_t b = (uint16_t)(rd(z) | rd((uint8_t)(z + 1)) << 8);
        ad = (uint16_t)(b + y);
        cross = (ad ^ b) & 0xff00 ? 1 : 0;
        break;
    }
    case REL: { int8_t o = (int8_t)rd(pc++); ad = (uint16_t)(pc + o); break; }
    default: break;
    }
    /* writes land on the instruction's last cycle */
    cyc = c0 + CYC[opc] - 1;
#define LD() (mode == ACC ? a : rd(ad))
#define ST(val) do { uint8_t _v = (uint8_t)(val); if (mode == ACC) a = _v; else wr(ad, _v); } while (0)
#define READ_X do { extra += cross; } while (0)
#define BR(cond) do { if (cond) { extra += 1 + (((pc ^ ad) & 0xff00) ? 1 : 0); pc = ad; } } while (0)
    switch (op) {
    case JAM: return 0;
    case ADC: READ_X; adc(rd(ad)); break;
    case SBC: READ_X; sbc(rd(ad)); break;
    case AND: READ_X; a &= rd(ad); setnz(a); break;
    case ORA: READ_X; a |= rd(ad); setnz(a); break;
    case EOR: READ_X; a ^= rd(ad); setnz(a); break;
    case CMP: READ_X; cmp(a, rd(ad)); break;
    case CPX: cmp(x, rd(ad)); break;
    case CPY: cmp(y, rd(ad)); break;
    case BIT: v = rd(ad); p = (uint8_t)((p & ~(FZ | FV | FN)) | (v & (FV | FN)) | ((a & v) ? 0 : FZ)); break;
    case LDA: READ_X; a = rd(ad); setnz(a); break;
    case LDX: READ_X; x = rd(ad); setnz(x); break;
    case LDY: READ_X; y = rd(ad); setnz(y); break;
    case LAX: READ_X; a = x = rd(ad); setnz(a); break;
    case STA: wr(ad, a); break;
    case STX: wr(ad, x); break;
    case STY: wr(ad, y); break;
    case SAX: wr(ad, a & x); break;
    case ASL: v = LD(); p = (uint8_t)((p & ~FC) | (v >> 7)); v <<= 1; setnz(v); ST(v); break;
    case LSR: v = LD(); p = (uint8_t)((p & ~FC) | (v & 1)); v >>= 1; setnz(v); ST(v); break;
    case ROL: { uint8_t c = p & FC; v = LD(); p = (uint8_t)((p & ~FC) | (v >> 7)); v = (uint8_t)(v << 1 | c); setnz(v); ST(v); break; }
    case ROR: { uint8_t c = p & FC; v = LD(); p = (uint8_t)((p & ~FC) | (v & 1)); v = (uint8_t)(v >> 1 | c << 7); setnz(v); ST(v); break; }
    case INC: v = (uint8_t)(rd(ad) + 1); setnz(v); wr(ad, v); break;
    case DEC: v = (uint8_t)(rd(ad) - 1); setnz(v); wr(ad, v); break;
    case SLO: v = rd(ad); p = (uint8_t)((p & ~FC) | (v >> 7)); v <<= 1; wr(ad, v); a |= v; setnz(a); break;
    case RLA: { uint8_t c = p & FC; v = rd(ad); p = (uint8_t)((p & ~FC) | (v >> 7)); v = (uint8_t)(v << 1 | c); wr(ad, v); a &= v; setnz(a); break; }
    case SRE: v = rd(ad); p = (uint8_t)((p & ~FC) | (v & 1)); v >>= 1; wr(ad, v); a ^= v; setnz(a); break;
    case RRA: { uint8_t c = p & FC; v = rd(ad); p = (uint8_t)((p & ~FC) | (v & 1)); v = (uint8_t)(v >> 1 | c << 7); wr(ad, v); adc(v); break; }
    case DCP: v = (uint8_t)(rd(ad) - 1); wr(ad, v); cmp(a, v); break;
    case ISC: v = (uint8_t)(rd(ad) + 1); wr(ad, v); sbc(v); break;
    case ANC: a &= rd(ad); setnz(a); p = (uint8_t)((p & ~FC) | (a >> 7)); break;
    case ALR: a &= rd(ad); p = (uint8_t)((p & ~FC) | (a & 1)); a >>= 1; setnz(a); break;
    case ARR: {
        a &= rd(ad);
        a = (uint8_t)(a >> 1 | (p & FC) << 7);
        setnz(a);
        p = (uint8_t)((p & ~(FC | FV)) | ((a >> 6) & 1) | (((a >> 6) ^ (a >> 5)) & 1 ? FV : 0));
        break;
    }
    case SBX: { unsigned t = (unsigned)(a & x) - rd(ad); x = (uint8_t)t; p = (uint8_t)((p & ~FC) | (t < 0x100 ? FC : 0)); setnz(x); break; }
    case XAA: a = (uint8_t)((a | 0xee) & x & rd(ad)); setnz(a); break;
    case SHA: wr(ad, (uint8_t)(a & x & ((ad >> 8) + 1))); break;
    case SHX: wr(ad, (uint8_t)(x & ((ad >> 8) + 1))); break;
    case SHY: wr(ad, (uint8_t)(y & ((ad >> 8) + 1))); break;
    case TAS: s = a & x; wr(ad, (uint8_t)(s & ((ad >> 8) + 1))); break;
    case LAS: READ_X; a = x = s = rd(ad) & s; setnz(a); break;
    case NOP: READ_X; break;
    case INX: x++; setnz(x); break;
    case INY: y++; setnz(y); break;
    case DEX: x--; setnz(x); break;
    case DEY: y--; setnz(y); break;
    case TAX: x = a; setnz(x); break;
    case TAY: y = a; setnz(y); break;
    case TXA: a = x; setnz(a); break;
    case TYA: a = y; setnz(a); break;
    case TSX: x = s; setnz(x); break;
    case TXS: s = x; break;
    case PHA: push(a); break;
    case PHP: push(p | FB | FU); break;
    case PLA: a = pull(); setnz(a); break;
    case PLP: p = (uint8_t)((pull() & ~FB) | FU); break;
    case CLC: p &= (uint8_t)~FC; break;
    case SEC: p |= FC; break;
    case CLD: p &= (uint8_t)~FD; break;
    case SED: p |= FD; break;
    case CLI: p &= (uint8_t)~FI; break;
    case SEI: p |= FI; break;
    case CLV: p &= (uint8_t)~FV; break;
    case BPL: BR(!(p & FN)); break;
    case BMI: BR(p & FN); break;
    case BVC: BR(!(p & FV)); break;
    case BVS: BR(p & FV); break;
    case BCC: BR(!(p & FC)); break;
    case BCS: BR(p & FC); break;
    case BNE: BR(!(p & FZ)); break;
    case BEQ: BR(p & FZ); break;
    case JMP: pc = ad; break;
    case JSR: pc--; push((uint8_t)(pc >> 8)); push((uint8_t)pc); pc = ad; break;
    case RTS: pc = (uint16_t)(pull() | pull() << 8); pc++; break;
    case RTI: p = (uint8_t)((pull() & ~FB) | FU); pc = (uint16_t)(pull() | pull() << 8); break;
    case BRK: pc++; push((uint8_t)(pc >> 8)); push((uint8_t)pc); push(p | FB | FU); p |= FI;
              pc = (uint16_t)(mem[0xfffe] | mem[0xffff] << 8); break;
    }
    cyc = c0 + CYC[opc] + extra;
    return 1;
}

/* call a routine (JSR, or an interrupt entry with RTI) until it returns to the sentinel;
 * the KERNAL's IRQ exits ($EA31 / $EA81 / $FEBC) count as returns (no ROM here) */
static void call(uint16_t ad, uint8_t acc, int irq, uint64_t max)
{
    uint64_t end = cyc + max;
    s = 0xff;
    push(0x00);                            /* returns to $0001 (RTS) or $0000 (RTI) */
    push(0x00);
    if (irq)
        push(p);
    a = acc;
    pc = ad;
    while (cyc < end) {
        if (pc <= 0x0001 || pc == 0xEA31 || pc == 0xEA81 || pc == 0xFEBC)
            return;
        if (!step()) {
            fprintf(stderr, "sidplay: JAM at %04x\n", (uint16_t)(pc - 1));
            return;
        }
    }
}

static uint16_t be16(const uint8_t *b) { return (uint16_t)(b[0] << 8 | b[1]); }

int main(int argc, char **argv)
{
    FILE *f;
    static uint8_t buf[65536 + 0x80];
    size_t n;
    uint16_t ver, off, load, init, play, songs, start, flags = 0;
    uint32_t speed, song, secs = 30, model = 0, i;
    uint64_t total;
    if (argc < 3) {
        fprintf(stderr, "usage: %s TUNE.sid OUT.sidlog [song] [seconds] [6581|8580]\n", argv[0]);
        return 2;
    }
    for (i = 0; i < sizeof OPS / sizeof OPS[0]; i++) {
        op_of[OPS[i].code] = OPS[i].op;
        mode_of[OPS[i].code] = OPS[i].mode;
    }
    f = fopen(argv[1], "rb");
    if (!f) { perror(argv[1]); return 1; }
    n = fread(buf, 1, sizeof buf, f);
    fclose(f);
    if (n < 0x76 || memcmp(buf, "PSID", 4)) {
        fprintf(stderr, "%s: not a PSID tune (RSID needs a full C64)\n", argv[1]);
        return 1;
    }
    ver = be16(buf + 4); off = be16(buf + 6); load = be16(buf + 8); init = be16(buf + 10);
    play = be16(buf + 12); songs = be16(buf + 14); start = be16(buf + 16);
    speed = (uint32_t)be16(buf + 18) << 16 | be16(buf + 20);
    if (ver >= 2 && n >= 0x7c)
        flags = be16(buf + 0x76);
    if (!load) {
        load = (uint16_t)(buf[off] | buf[off + 1] << 8);
        off += 2;
    }
    if (!init)
        init = load;
    song = argc > 3 && atoi(argv[3]) > 0 ? (uint32_t)atoi(argv[3]) : start ? start : 1;
    if (argc > 4) secs = (uint32_t)atoi(argv[4]);
    model = ((flags >> 4) & 3) == 2 ? 1 : 0;
    if (argc > 5) model = atoi(argv[5]) == 8580;
    memcpy(mem + load, buf + off, n - off > 65536u - load ? 65536u - load : n - off);
    mem[1] = 0x37;
    fprintf(stderr, "%.32s / %.32s / %.32s\n  load %04x init %04x play %04x, song %u of %u, %s, %s\n",
            (char *)buf + 0x16, (char *)buf + 0x36, (char *)buf + 0x56, load, init, play, song, songs,
            speed >> ((song - 1) & 31) & 1 ? "CIA timer" : "VBI 50 Hz", model ? "8580" : "6581");

    /* init with the song in A, then the play routine (or the installed IRQ) once per period */
    p = FU | FI;
    cyc = 0;
    call(init, (uint8_t)(song - 1), 0, 5 * PAL_CLOCK);
    total = (uint64_t)secs * PAL_CLOCK;
    {
        uint64_t t = (cyc / PAL_FRAME + 1) * PAL_FRAME;
        int cia = speed >> ((song - 1) & 31) & 1;
        while (t < total) {
            uint16_t ad = play;
            uint32_t period = cia ? (uint32_t)cia_latch + 1u : PAL_FRAME;
            int irq = 0;
            if (!ad) {                    /* the tune installed its own interrupt handler */
                ad = (mem[1] & 2) ? (uint16_t)(mem[0x314] | mem[0x315] << 8) : (uint16_t)(mem[0xfffe] | mem[0xffff] << 8);
                irq = 1;
            }
            cyc = t;
            call(ad, 0, irq, PAL_FRAME * 2);
            t += period < 1000 ? PAL_FRAME : period;
        }
    }
    {
        uint32_t h[7] = {model, FS, PAL_CLOCK, 1, (uint32_t)((uint64_t)secs * FS), 0, 256};
        uint32_t keep = 0;
        for (i = 0; i < nev; i++)          /* writes past the end (a long last frame) are dropped */
            if (evs[i].cyc < total)
                evs[keep++] = evs[i];
        h[5] = keep;
        f = fopen(argv[2], "wb");
        if (!f) { perror(argv[2]); return 1; }
        fwrite("SIDLOG2", 1, 8, f);
        fwrite(h, 4, 7, f);
        fwrite(evs, 8, keep, f);
        fclose(f);
        fprintf(stderr, "  %s: %u writes in %u s\n", argv[2], keep, secs);
    }
    return 0;
}
