/* Minimal pi32v2 entry for emulator probes: the SPL/runner jumps to the
 * first byte (expects `goto +4; rts`), we set the stacks and call main.
 * Results are left in RAM for `fm1-emu --dump`. */
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
