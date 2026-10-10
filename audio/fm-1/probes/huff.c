/* Differential probe for Felucca's Huffman 4-bit alpha decoder (gfx.c
 * hc_lut + cv_alpha_hc, copied without the canvas): decode three glyphs
 * packed by tools/gen_aa_font.py and compare with the values packed. */
#include "harness/probe.h"
#include "huff_data.h"

#define HC_FONTS 3
static struct { const uint8_t *hc; uint16_t lut[256]; } hc_tab[HC_FONTS];
static const uint16_t *hc_lut(const uint8_t *hc)
{
    uint32_t k, len, code = 0, sym = 15, i;
    for (k = 0; k < HC_FONTS - 1u && hc_tab[k].hc && hc_tab[k].hc != hc; k++)
        ;
    if (hc_tab[k].hc != hc) {
        hc_tab[k].hc = hc;
        for (i = 0; i < 256u; i++)
            hc_tab[k].lut[i] = 0;
        for (len = 1; len <= 8u; len++, code <<= 1)
            for (i = 0; i < hc[len - 1u]; i++, code++, sym++) {
                uint32_t a = code << (8u - len), n = 1u << (8u - len);
                while (n--)
                    hc_tab[k].lut[a + n] = (uint16_t)(hc[sym] | len << 8);
            }
    }
    return hc_tab[k].lut;
}

static uint8_t out[64];

static void decode(uint32_t w, uint32_t h, const uint8_t *d, const uint8_t *hc)
{
    const uint16_t *lut = hc_lut(hc);
    uint32_t gy, v = 0, run = 0, acc = 0, nb = 0, o = 0;
    for (gy = 0; gy < h; gy++) {
        uint32_t gx = 0;
        while (gx < w) {
            uint32_t n, k;
            if (!run) {
                uint32_t e, s;
                while (nb < 16u) {
                    acc = acc << 8 | *d++;
                    nb += 8;
                }
                e = lut[(acc >> (nb - 8u)) & 255u];
                if (e) {
                    nb -= e >> 8;
                    s = e & 255u;
                } else {
                    uint32_t code = 0, first = 0, idx = 0, len = 0;
                    for (;;) {
                        code |= (acc >> --nb) & 1u;
                        if (code - first < hc[len])
                            break;
                        idx += hc[len];
                        first = (first + hc[len]) << 1;
                        code <<= 1;
                        len++;
                    }
                    s = hc[15u + idx + code - first];
                }
                v = s & 15u;
                run = (s >> 4) + 1u;
            }
            n = run < w - gx ? run : w - gx;
            for (k = 0; k < n; k++)
                out[o++] = (uint8_t)v;
            gx += n;
            run -= n;
        }
    }
}

int main(void)
{
    uint32_t i;
    volatile uint32_t eight = 8, fifteen = 15, ten = 10;
    /* the reverse-subtract / shift forms the compiler used in gfx.c */
    p_check(eight - ten, (uint32_t)-2);
    p_check(fifteen - ten, 5);
    p_check(1u << (eight - 3u), 32);
    p_check((0xDEADBEEFu << 8) | 0x42u, 0xADBEEF42u);
    decode(6, 7, G0, HC);
    for (i = 0; i < GN[0]; i++) p_check(out[i], E0[i]);
    decode(9, 5, G1, HC);
    for (i = 0; i < GN[1]; i++) p_check(out[i], E1[i]);
    decode(12, 4, G2, HC);
    for (i = 0; i < GN[2]; i++) p_check(out[i], E2[i]);
    p_done();
    return 0;
}
