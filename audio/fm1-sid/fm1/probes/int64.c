#include <stdint.h>
#ifdef NATIVE
#include <stdio.h>
static uint32_t OUTB[256];
#define RES OUTB
#else
#define RES ((volatile uint32_t *)0x01C80000u)
#endif
volatile uint64_t A, B, C;
volatile uint32_t S1, S2, S3, X, Y;
#define N(f) __attribute__((noinline)) f
N(uint64_t shl(uint64_t a, uint32_t s)) { return a << s; }
N(uint64_t shr(uint64_t a, uint32_t s)) { return a >> s; }
N(int64_t sar(int64_t a, uint32_t s)) { return a >> s; }
N(uint64_t add(uint64_t a, uint64_t b)) { return a + b; }
N(uint64_t sub(uint64_t a, uint64_t b)) { return a - b; }
N(uint64_t mul(uint64_t a, uint64_t b)) { return a * b; }
N(uint64_t mulw(uint32_t a, uint32_t b)) { return (uint64_t)a * b; }
N(int lt(uint64_t a, uint64_t b)) { return a < b; }
N(int slt(int64_t a, int64_t b)) { return a < b; }
N(int clz(uint32_t a)) { return __builtin_clz(a); }
N(int clzll(uint64_t a)) { return __builtin_clzll(a); }
N(uint64_t orr(uint64_t a, uint64_t b)) { return a | (b & 0xFFFFFFFFFull); }
N(uint64_t neg(uint64_t a)) { return -a; }
N(uint32_t hi(uint64_t a)) { return (uint32_t)(a >> 32); }
int main(void) {
  A = 0x412E10C000000000ull; B = 0x40E5888000000000ull; C = 0x0010000000000001ull;
  S1 = 11; S2 = 37; S3 = 1; X = 0x00012345; Y = 0x80000000u;
  int k = 0;
  uint64_t r[32];
  r[k++] = shl(A, S1); r[k++] = shl(A, S2); r[k++] = shl(C, S3); r[k++] = shr(A, S1); r[k++] = shr(A, S2);
  r[k++] = (uint64_t)sar((int64_t)(A | 0x8000000000000000ull), S1); r[k++] = (uint64_t)sar((int64_t)(A | 0x8000000000000000ull), S2);
  r[k++] = add(A, B); r[k++] = add(0xFFFFFFFFull, 1); r[k++] = sub(A, B); r[k++] = sub(B, A); r[k++] = sub(0x100000000ull, 1);
  r[k++] = mul(A, B); r[k++] = mul(0x123456789ull, 0x987654321ull); r[k++] = mulw(0xFFFFFFFFu, 0xFFFFFFFFu); r[k++] = mulw(X, Y);
  r[k++] = lt(A, B); r[k++] = lt(B, A); r[k++] = lt(0x100000000ull, 0xFFFFFFFFull); r[k++] = slt(-1, 1); r[k++] = slt((int64_t)A, -5);
  r[k++] = clz(X); r[k++] = clz(Y); r[k++] = clzll(C); r[k++] = clzll(0x123ull); r[k++] = orr(A, B); r[k++] = neg(A); r[k++] = hi(A);
  for (int i = 0; i < k; i++) { RES[2 + 2 * i] = (uint32_t)r[i]; RES[3 + 2 * i] = (uint32_t)(r[i] >> 32); }
  RES[1] = k;
  RES[0] = 0x53494442u;
#ifdef NATIVE
  for (int i = 0; i < 2 + 2 * k; i++) printf("%08x\n", RES[i]);
  return 0;
#else
  for (;;) {}
#endif
}
