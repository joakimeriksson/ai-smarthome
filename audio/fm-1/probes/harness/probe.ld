/* Probe image: code at the app XIP base (+0x120 like the stock SPL hand-off),
 * data/bss in RAM. Results live in .bss at a fixed address (see probe.h). */
MEMORY
{
    XIP (rx)  : ORIGIN = 0x02000120, LENGTH = 0x40000
    RAM (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x40000
}
SECTIONS
{
    .text : { KEEP(*(.text.crt0)) *(.text*) *(.rodata*) . = ALIGN(4); } > XIP
    .data : { . = ALIGN(4); *(.data*) *(.sdata*) . = ALIGN(4); } > RAM AT > XIP
    .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) } > RAM
    /DISCARD/ : { *(.comment) *(.note*) }
}
