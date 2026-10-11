/* SID player firmware memory map: Felucca's (ext/Felucca/firmware/app.ld) with one RAM region
 * for data + bss (the SRAM from 0x01C08000 to the stacks) and reSID's 128 KB of waveform
 * tables (wave*.o .data, only ever read) left in flash. A tune pack (firmware/main.c) is
 * appended to the image at _pack.
 * SPDX-License-Identifier: GPL-3.0-only */
MEMORY
{
    XIP    (rx)  : ORIGIN = 0x02000120, LENGTH = 0x8DFBC
    RAM    (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x6C000
    NOINIT (rw)  : ORIGIN = 0x01C7C000, LENGTH = 0x3D50
}
SECTIONS
{
    .text : {
        KEEP(*(.text.crt0)) *(.text*) *(.rodata*)
        *wave6581*.o(.data*) *wave8580*.o(.data*)
        . = ALIGN(4);
        __init_array_start = .; KEEP(*(.init_array*)) KEEP(*(.ctors*)) __init_array_end = .;
        _etext = .;
    } > XIP
    .data : { . = ALIGN(4); _data_start = .; *(.data*) *(.sdata*) . = ALIGN(4); _data_end = .; } > RAM AT > XIP
    _data_load = LOADADDR(.data);
    _pack = ALIGN(_data_load + SIZEOF(.data), 4);   /* the image's end: a tune pack goes here */
    .bss (NOLOAD) : { _bss_start = .; *(.bss*) *(.sbss*) *(COMMON) *(.pool*) . = ALIGN(4); _bss_end = .; } > RAM
    .noinit (NOLOAD) : { *(.noinit*) } > NOINIT
    _guard0 = 0x01C74000; _ustack_lo = 0x01C74100; _ustack_top = 0x01C7A000;
    _guard1 = 0x01C7A000; _sstack_lo = 0x01C7A100; _sstack_top = 0x01C7C000;
    /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }
}
