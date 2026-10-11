/* soft double (compiler-rt __muldf3 / __divdf3 / __adddf3 / __fixdfsi) and one float divide,
 * as reSID's sampling setup uses them (probes/softfloat/run.sh) */
#include <stdint.h>
#ifdef NATIVE
#include <stdio.h>
static uint32_t OUTB[16];
#define RES OUTB
#else
#define RES ((volatile uint32_t *)0x01C80000u)
#endif
volatile double clk, fs;
__attribute__((noinline)) int f1(double a, double b) { return (int)(a / b * (1 << 16) + 0.5); }
__attribute__((noinline)) double f2(double a, double b) { return a / b; }
__attribute__((noinline)) double f3(double a, double b) { return a * b; }
__attribute__((noinline)) double f4(double a, double b) { return a + b; }
__attribute__((noinline)) int f5(double a) { return (int)a; }
__attribute__((noinline)) float f6(float a, float b) { return a / b; }
int main(void) {
  union { double d; uint32_t w[2]; } u;
  clk = 985248.0; fs = 44100.0;
  RES[2] = f1(clk, fs);
  u.d = f2(clk, fs); RES[3] = u.w[0]; RES[4] = u.w[1];
  u.d = f3(clk, fs); RES[5] = u.w[0]; RES[6] = u.w[1];
  u.d = f4(clk, fs); RES[7] = u.w[0]; RES[8] = u.w[1];
  RES[9] = f5(clk);
  { union { float f; uint32_t w; } v; v.f = f6(985248.0f, 44100.0f); RES[10] = v.w; }
  RES[1] = 9;
  RES[0] = 0x53494442u;
#ifdef NATIVE
  for (int i = 0; i < 11; i++) printf("%08x\n", RES[i]);
  return 0;
#else
  for (;;) {}
#endif
}
