/* LCD model probe: drive SPI1 exactly like Felucca's hal/fm1_lcd_hw.h and
 * draw a known pattern — vertical stripes 8 px wide in a full-screen
 * window via DMA, then a white horizontal line at y = 120 via a 240x1
 * window. The rendered frame must show straight stripes (no shear) and a
 * straight line: anything else is the SoC/LCD model, not the firmware. */
#include <stdint.h>

#define REG32(a) (*(volatile uint32_t *)(a))
#define PC_OUT REG32(0x50080u)
#define PC_DIR REG32(0x50088u)
#define SPI_CON REG32(0x11D00u)
#define SPI_BUF REG32(0x11D08u)
#define SPI_ADR REG32(0x11D0Cu)
#define SPI_CNT REG32(0x11D10u)
#define CS (1u << 7)
#define DC (1u << 8)

static uint16_t line[240];

static void wait(void)
{
    uint32_t n;
    for (n = 0; n < 4000000u && !(SPI_CON & 0x8000u); n++)
        ;
    SPI_CON |= 0x4000u;
}
static void cmd(uint8_t c)
{
    PC_OUT &= ~DC; PC_OUT &= ~CS; SPI_CON |= 0x4000u; SPI_BUF = c; wait(); PC_OUT |= CS;
}
static void data(const void *p, uint32_t n)
{
    PC_OUT |= DC; PC_OUT &= ~CS; SPI_CON |= 0x4000u; SPI_ADR = (uint32_t)(uintptr_t)p; SPI_CNT = n; wait(); PC_OUT |= CS;
}
static void window(uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1)
{
    static uint8_t a[4];
    a[0] = (uint8_t)(x0 >> 8); a[1] = (uint8_t)x0; a[2] = (uint8_t)(x1 >> 8); a[3] = (uint8_t)x1;
    cmd(0x2A); data(a, 4);
    a[0] = (uint8_t)(y0 >> 8); a[1] = (uint8_t)y0; a[2] = (uint8_t)(y1 >> 8); a[3] = (uint8_t)y1;
    cmd(0x2B); data(a, 4);
    cmd(0x2C);
}

int main(void)
{
    uint32_t x, y;
    PC_DIR &= ~(CS | DC);
    cmd(0x11); cmd(0x21); cmd(0x29);
    /* big-endian RGB565 over the wire, as the panel expects */
    for (x = 0; x < 240; x++) {
        uint16_t c = ((x / 8) & 1) ? 0xF800 : 0x001F;   /* red / blue stripes */
        line[x] = (uint16_t)((c >> 8) | (c << 8));
    }
    window(0, 0, 239, 239);
    for (y = 0; y < 240; y++)
        data(line, 480);
    for (x = 0; x < 240; x++) line[x] = 0xFFFF;
    window(0, 120, 239, 120);
    data(line, 480);
    for (;;)
        ;
    return 0;
}
