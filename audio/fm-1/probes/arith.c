/* Differential probe: every expression is computed at run time from
 * `volatile` inputs (so the compiler emits real pi32v2 instructions) and
 * compared against the same expression folded at compile time by LLVM.
 * A mismatch means the emulator's semantics for some instruction differ
 * from the compiler's model of the ISA. */
#include "harness/probe.h"

#define T(expr_rt, expr_ct) p_check((uint32_t)(expr_rt), (uint32_t)(expr_ct))

static uint8_t buf[64];
static uint16_t hbuf[32];
static uint32_t wbuf[32];

int main(void)
{
    volatile int32_t a = 1234567, b = -89, c = 7, z = 0;
    volatile uint32_t ua = 0xDEADBEEFu, ub = 0x12345678u, uc = 13u, big = 0x80000000u;
    volatile int64_t la = -1234567890123LL, lb = 987654321LL;
    volatile uint64_t lua = 0xFEDCBA9876543210ull;
    int i;

    /* arithmetic */
    T(a + b, 1234567 + -89);
    T(a - b, 1234567 - -89);
    T(a * b, 1234567 * -89);
    T(a / c, 1234567 / 7);
    T(a % c, 1234567 % 7);
    T(b / c, -89 / 7);
    T(b % c, -89 % 7);
    T(ua / uc, 0xDEADBEEFu / 13u);
    T(ua % uc, 0xDEADBEEFu % 13u);
    T(-a, -1234567);
    T(~ua, ~0xDEADBEEFu);
    T(a + 6000 + 4000, 1234567 + 10000);
    T(a - 300, 1234567 - 300);
    T(a + 0x4000, 1234567 + 0x4000);
    T(a * 3, 1234567 * 3);
    T(a * 240, 1234567 * 240);
    T(a * 241, 1234567 * 241);
    T(ua * 0x10001u, 0xDEADBEEFu * 0x10001u);

    /* shifts and rotates */
    T(ua << uc, 0xDEADBEEFu << 13);
    T(ua >> uc, 0xDEADBEEFu >> 13);
    T(a >> 5, 1234567 >> 5);
    T(b >> 3, -89 >> 3);
    T((uint32_t)b >> 3, (uint32_t)-89 >> 3);
    T(ua << 1, 0xDEADBEEFu << 1);
    T(ua >> 31, 0xDEADBEEFu >> 31);
    T(b >> 31, -89 >> 31);
    T(ua << 0, 0xDEADBEEFu);
    T((ua << 7) | (ua >> 25), (0xDEADBEEFu << 7) | (0xDEADBEEFu >> 25));

    /* logic and masks */
    T(ua & 0xFF, 0xDEADBEEFu & 0xFF);
    T(ua & 0xFF00, 0xDEADBEEFu & 0xFF00);
    T(ua & 0x3FC, 0xDEADBEEFu & 0x3FC);
    T(ua & ~0x38u, 0xDEADBEEFu & ~0x38u);
    T(ua & 0xFFFF00FFu, 0xDEADBEEFu & 0xFFFF00FFu);
    T(ua | 0x810, 0xDEADBEEFu | 0x810);
    T(ua | 0x80000, 0xDEADBEEFu | 0x80000);
    T(ua ^ 0x5F005F, 0xDEADBEEFu ^ 0x5F005F);
    T(ua ^ ub, 0xDEADBEEFu ^ 0x12345678u);
    T(ua & ub, 0xDEADBEEFu & 0x12345678u);
    T(ua | ub, 0xDEADBEEFu | 0x12345678u);
    T(ua & ~ub, 0xDEADBEEFu & ~0x12345678u);
    T(ua | (1u << uc), 0xDEADBEEFu | (1u << 13));
    T(ua & ~(1u << uc), 0xDEADBEEFu & ~(1u << 13));
    T((ua >> 5) & 0x3F, (0xDEADBEEFu >> 5) & 0x3F);          /* uextra */
    T((int32_t)(ua << 10) >> 20, (int32_t)(0xDEADBEEFu << 10) >> 20); /* sextra */
    T((ua & ~0xFF00u) | ((ub & 0xFF) << 8), (0xDEADBEEFu & ~0xFF00u) | ((0x12345678u & 0xFF) << 8)); /* insert */
    T((uint8_t)ua, 0xEF);
    T((int8_t)ua, (int8_t)0xEF);
    T((uint16_t)ua, 0xBEEF);
    T((int16_t)ua, (int16_t)0xBEEF);
    T(ua >> 16, 0xDEAD);
    T((ua >> 8) & 0xFF, 0xBE);
    T(__builtin_bswap32(ua), 0xEFBEADDEu);
    T(__builtin_clz(uc), 28);
    T(__builtin_clz(big), 0);

    /* comparisons (signed / unsigned) */
    T(a < b, 0); T(a > b, 1); T(b < 0, 1); T(ua > ub, 1); T((int32_t)ua > (int32_t)ub, 0);
    T(ua < big, 0); T(ua >= big, 1); T(a == 1234567, 1); T(a != 1234567, 0);
    T(b <= -89, 1); T(b < -89, 0); T(c >= 8, 0); T(uc > 12u, 1); T(uc <= 13u, 1);
    T((a < b) ? a : b, -89);
    T(a < 1000000 ? 1 : 2, 2);
    T(b > -100 ? 3 : 4, 3);
    T(ua > 0x3FFu ? 5 : 6, 5);
    T((int32_t)ua < 0 ? 7 : 8, 7);
    T(uc < 2111u, 1); T(ua > 4000u, 1); T(uc >= 3000u, 0); T(a != 3999, 1); T(b == -1985, 0);
    T(a > 2111 ? 9 : 10, 9); T(b > -2111 ? 11 : 12, 11);

    /* 64-bit */
    T((uint32_t)(la + lb), (uint32_t)(-1234567890123LL + 987654321LL));
    T((uint32_t)((la + lb) >> 32), (uint32_t)((-1234567890123LL + 987654321LL) >> 32));
    T((uint32_t)(la * lb), (uint32_t)(-1234567890123LL * 987654321LL));
    T((uint32_t)((la * lb) >> 32), (uint32_t)((-1234567890123LL * 987654321LL) >> 32));
    T((uint32_t)(lua >> 13), (uint32_t)(0xFEDCBA9876543210ull >> 13));
    T((uint32_t)((lua >> 13) >> 32), (uint32_t)((0xFEDCBA9876543210ull >> 13) >> 32));
    T((uint32_t)(lua << 9), (uint32_t)(0xFEDCBA9876543210ull << 9));
    T((uint32_t)((lua << 9) >> 32), (uint32_t)((0xFEDCBA9876543210ull << 9) >> 32));
    T((uint32_t)(la >> 7), (uint32_t)(-1234567890123LL >> 7));
    T((uint32_t)((la >> 7) >> 32), (uint32_t)((-1234567890123LL >> 7) >> 32));
    T((uint32_t)((int64_t)a * (int64_t)b), (uint32_t)(1234567LL * -89LL));
    T((uint32_t)(((int64_t)a * (int64_t)b) >> 32), (uint32_t)((1234567LL * -89LL) >> 32));
    T((uint32_t)(((uint64_t)ua * (uint64_t)ub) >> 32), (uint32_t)((0xDEADBEEFull * 0x12345678ull) >> 32));
    T((uint32_t)(lua / 1000u), (uint32_t)(0xFEDCBA9876543210ull / 1000u));
    T((uint32_t)(la / 1000), (uint32_t)(-1234567890123LL / 1000));

    /* memory: widths, signs, offsets, pre/post increment, indexed */
    for (i = 0; i < 64; i++) buf[i] = (uint8_t)(i * 37 + 1);
    for (i = 0; i < 32; i++) hbuf[i] = (uint16_t)(i * 3001 + 7);
    for (i = 0; i < 32; i++) wbuf[i] = 0x01010101u * (uint32_t)i + 0xA5000000u;
    T(buf[5], (uint8_t)(5 * 37 + 1));
    T((int8_t)buf[7], (int8_t)(uint8_t)(7 * 37 + 1));
    T(buf[63], (uint8_t)(63 * 37 + 1));
    T(hbuf[9], (uint16_t)(9 * 3001 + 7));
    T((int16_t)hbuf[11], (int16_t)(uint16_t)(11 * 3001 + 7));
    T(wbuf[17], 0x01010101u * 17u + 0xA5000000u);
    T(wbuf[(int)uc], 0x01010101u * 13u + 0xA5000000u);
    T(hbuf[(int)uc], (uint16_t)(13 * 3001 + 7));
    T(buf[(int)uc * 3], (uint8_t)(39 * 37 + 1));
    {
        const uint8_t *p = buf + 10;
        uint32_t s = 0;
        for (i = 0; i < 20; i++) s += *p++;
        {
            uint32_t e = 0; int k;
            for (k = 10; k < 30; k++) e += (uint8_t)(k * 37 + 1);
            T(s, e);
        }
        T(*(p - 1), (uint8_t)(29 * 37 + 1));
        T(p[-7], (uint8_t)(23 * 37 + 1));
    }
    {
        const uint16_t *q = hbuf + 30;
        T(*--q, (uint16_t)(29 * 3001 + 7));
        T(*--q, (uint16_t)(28 * 3001 + 7));
        T(q[-20], (uint16_t)(8 * 3001 + 7));
    }
    {
        uint32_t *w = wbuf;
        uint32_t acc = 0;
        for (i = 0; i < 8; i++) acc ^= *w++;
        T(acc, (0xA5000000u) ^ (0xA5000000u + 0x01010101u) ^ (0xA5000000u + 0x02020202u) ^ (0xA5000000u + 0x03030303u)
             ^ (0xA5000000u + 0x04040404u) ^ (0xA5000000u + 0x05050505u) ^ (0xA5000000u + 0x06060606u) ^ (0xA5000000u + 0x07070707u));
        T(w[-3], 0x01010101u * 5u + 0xA5000000u);
    }
    /* byte/halfword stores and read-modify-write */
    buf[3] = (uint8_t)ua; T(buf[3], 0xEF);
    hbuf[2] = (uint16_t)ub; T(hbuf[2], 0x5678);
    wbuf[4] |= 0x80; T(wbuf[4], (0x01010101u * 4u + 0xA5000000u) | 0x80);
    wbuf[4] &= ~0x100u; T(wbuf[4], ((0x01010101u * 4u + 0xA5000000u) | 0x80) & ~0x100u);
    wbuf[6] += 515; T(wbuf[6], 0x01010101u * 6u + 0xA5000000u + 515);
    wbuf[7] ^= 0x3FC; T(wbuf[7], (0x01010101u * 7u + 0xA5000000u) ^ 0x3FC);

    /* row/column addressing like a 240-wide canvas */
    {
        uint32_t y = (uint32_t)c, x = (uint32_t)uc;
        T(y * 240 + x, 7u * 240u + 13u);
        T((y << 8) - (y << 4) + x, 7u * 240u + 13u);
        T(y * 240u * 2u + x * 2u, 2u * (7u * 240u + 13u));
    }
    p_done();
    return 0;
}
