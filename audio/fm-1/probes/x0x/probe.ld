/* probes/harness/probe.ld plus the .data load bounds (the probe copies .data itself) */
MEMORY
{
    XIP (rx)  : ORIGIN = 0x02000120, LENGTH = 0x80000
    RAM (rwx) : ORIGIN = 0x01C08000, LENGTH = 0x38000
}
SECTIONS
{
    .text : { KEEP(*(.text.crt0)) *(.text*) *(.rodata*) . = ALIGN(4); } > XIP
    .data : { . = ALIGN(4); __data_start = .; *(.data*) *(.sdata*) . = ALIGN(4); __data_end = .; } > RAM AT > XIP
    __data_load = LOADADDR(.data);
    .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) } > RAM
    /DISCARD/ : { *(.comment) *(.note*) }
}
