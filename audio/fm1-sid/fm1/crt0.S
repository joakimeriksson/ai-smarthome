/* Bare-metal pi32v2 entry for the emulator (as fm-1/probes/harness/crt0.S): the runner jumps
 * to the first byte (expects `goto +4; rts`); set the stacks and call main. */
	.section .text.crt0,"ax",@progbits
	.globl _start
_start:
	goto 1f
	rts
1:	cli
	sp = 0x01C7A000
	ssp = 0x01C7C000
	call main
	goto .
