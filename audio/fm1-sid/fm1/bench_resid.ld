/* fm1/bench.ld plus the C++ constructors (.init_array) */
MEMORY
{
    XIP (rx)  : ORIGIN = 0x02000120, LENGTH = 0x80000
    RAM (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x6C000
}
SECTIONS
{
    .text : { KEEP(*(.text.crt0)) *(.text*) *(.rodata*) . = ALIGN(4);
              __init_array_start = .; KEEP(*(.init_array*)) KEEP(*(.ctors*)) __init_array_end = .; } > XIP
    .data : { . = ALIGN(4); __data_start = .; *(.data*) *(.sdata*) . = ALIGN(4); __data_end = .; } > RAM AT > XIP
    __data_load = LOADADDR(.data);
    .bss (NOLOAD) : { . = ALIGN(4); __bss_start = .; *(.bss*) *(.sbss*) *(COMMON) . = ALIGN(4); __bss_end = .; } > RAM
    /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }
}
