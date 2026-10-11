/* the steps of compiler-rt's __muldf3: significands, wide multiply, variable 64-bit shifts and
 * compares (probes/softfloat/run.sh) */
#include <stdint.h>
#ifdef NATIVE
#include <stdio.h>
static uint32_t OUTB[256];
#define RES OUTB
#else
#define RES ((volatile uint32_t *)0x01C80000u)
#endif
volatile uint64_t A, B; volatile uint32_t SH;
#define N(f) __attribute__((noinline)) f
N(uint64_t sig(uint64_t a)) { return (a & 0x000FFFFFFFFFFFFFull) | 0x0010000000000000ull; }
N(uint64_t lo32mul(uint64_t a, uint64_t b)) { return (a & 0xffffffffu) * (b & 0xffffffffu); }
N(uint64_t himul(uint64_t a, uint64_t b)) { return (a >> 32) * (b >> 32); }
N(void wide(uint64_t a, uint64_t b, uint64_t *hi, uint64_t *lo)) {
  const uint64_t plolo = (a & 0xffffffff) * (b & 0xffffffff), plohi = (a & 0xffffffff) * (b >> 32);
  const uint64_t philo = (a >> 32) * (b & 0xffffffff), phihi = (a >> 32) * (b >> 32);
  const uint64_t r0 = plolo & 0xffffffff, r1 = (plolo >> 32) + (plohi & 0xffffffff) + (philo & 0xffffffff);
  *lo = r0 + (r1 << 32); *hi = (plohi >> 32) + (philo >> 32) + (r1 >> 32) + phihi; }
N(uint64_t vshl(uint64_t a, uint32_t s)) { return a << s; }
N(uint64_t vshr(uint64_t a, uint32_t s)) { return a >> s; }
N(int ult(uint64_t a, uint64_t b)) { return a < b; }
N(int uge(uint64_t a, uint64_t b)) { return a >= b; }
N(int ugt(uint64_t a, uint64_t b)) { return a > b; }
N(int sgt(int64_t a, int64_t b)) { return a > b; }
N(int eq(uint64_t a, uint64_t b)) { return a == b; }
int main(void) {
  A = 0x412E10C000000000ull; B = 0x40E5888000000000ull; SH = 11;
  uint64_t r[24]; int k = 0, i; uint64_t hi, lo;
  uint64_t sa = sig(A), sb = sig(B);
  r[k++] = sa; r[k++] = sb; r[k++] = lo32mul(sa, sb); r[k++] = himul(sa, sb);
  wide(sa << 11, sb, &hi, &lo); r[k++] = hi; r[k++] = lo;
  r[k++] = vshl(sa, SH); r[k++] = vshl(sa, SH + 30); r[k++] = vshr(sa, SH + 30); r[k++] = vshr(sa, 64 - SH);
  r[k++] = ult(sa, sb); r[k++] = ult(sb, sa); r[k++] = uge(sa, sb); r[k++] = ugt(sa, sa); r[k++] = sgt((int64_t)sa, -1);
  r[k++] = eq(sa, sa); r[k++] = eq(sa, sb); r[k++] = ult(0x100000000ull, 0x0FFFFFFFFull);
  for (i = 0; i < k; i++) { RES[2 + 2 * i] = (uint32_t)r[i]; RES[3 + 2 * i] = (uint32_t)(r[i] >> 32); }
  RES[1] = k; RES[0] = 0x53494442u;
#ifdef NATIVE
  for (i = 0; i < 2 + 2 * k; i++) printf("%08x\n", RES[i]); return 0;
#else
  for (;;) {}
#endif
}
