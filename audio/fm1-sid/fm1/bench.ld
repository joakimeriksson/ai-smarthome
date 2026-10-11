/* Bench image: code at the app XIP base (+0x120 like the stock SPL hand-off), data/bss in
 * the FM-1's SRAM where Felucca keeps its RAM + POOL (0x01C08000.., 432 KiB), stacks above. */
MEMORY
{
    XIP (rx)  : ORIGIN = 0x02000120, LENGTH = 0x80000
    RAM (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x6C000
}
SECTIONS
{
    .text : { KEEP(*(.text.crt0)) *(.text*) *(.rodata*) . = ALIGN(4); } > XIP
    .data : { . = ALIGN(4); __data_start = .; *(.data*) *(.sdata*) . = ALIGN(4); __data_end = .; } > RAM AT > XIP
    __data_load = LOADADDR(.data);
    .bss (NOLOAD) : { . = ALIGN(4); __bss_start = .; *(.bss*) *(.sbss*) *(COMMON) . = ALIGN(4); __bss_end = .; } > RAM
    /DISCARD/ : { *(.comment) *(.note*) }
}
