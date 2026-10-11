/* pi32v2 ISA probes: one construct per function.
 * Compile: clang -target pi32v2 -O1 -ffreestanding -nostdlib
 * Each function's disassembly is a (source -> bytes -> mnemonic) triple
 * for isa/fm1.yaml. */

int add32(int a, int b) { return a + b; }
int sub32(int a, int b) { return a - b; }
int mul32(int a, int b) { return a * b; }
int shl32(int a, int b) { return a << b; }
int shr32(int a, int b) { return a >> b; }        /* arithmetic, signed */
unsigned lsr32(unsigned a, int b) { return a >> b; }
int and32(int a, int b) { return a & b; }
int or32(int a, int b) { return a | b; }
int xor32(int a, int b) { return a ^ b; }
int neg32(int a) { return -a; }
int not32(int a) { return ~a; }
int imm_small(void) { return 42; }
int imm_big(void) { return 0x12345678; }

int loadw(const int *p) { return *p; }
void storew(int *p, int v) { *p = v; }
int load_off(const int *p) { return p[7]; }
char loadb(const char *p) { return *p; }
short loadh(const short *p) { return *p; }

int cond(int a, int b) { return a < b ? a : b; }
int loop_sum(const int *p, int n) {
    int s = 0;
    for (int i = 0; i < n; i++) s += p[i];
    return s;
}
int call_add(int a, int b) { return add32(a, b) + 1; }
