"""Unpack the 40 ROM presets by running the firmware's own recall routine.

Usage: uv run --with py65 python decode_rom.py <cpu_image.bin> <out.json>

The presets are 40 packed 25-byte records at $D000 (200 bits: nine 8-bit
knobs, eight 7-bit, nine 4-bit, one 6-bit switch field, four 3-bit radio
groups, three 2-bit, six 2-bit pairs). Rather than re-implement the bit
unpacker we load the image into a 6502 emulator, set the program number in
zero page ($61 = program 0..9, $62 = bank 0..3, $60 bit 6 clear = ROM) and
call the recall routine at $E08B; it leaves the 40 parameter values in
$38..$5F. Index meaning: see gen_factory.py.
"""
import json, sys
from py65.devices.mpu6502 import MPU


def recall(img: bytes, prog: int, bank: int, ram: bytes = b'') -> list[int]:
    m = MPU()
    for i, b in enumerate(img):
        m.memory[0xD800 + i] = b
    for i in range(2048):
        m.memory[0xD000 + i] = img[i]
    for i, b in enumerate(ram):
        m.memory[0x0800 + i] = b
    m.memory[0xD8] = 0
    m.memory[0x60] = 0x40 if ram else 0x00
    m.memory[0x61] = prog
    m.memory[0x62] = bank
    m.sp = 0xFD
    m.memory[0x1FE] = 0xFD
    m.memory[0x1FF] = 0xFF  # fake return address -> $FFFE
    m.pc = 0xE08B
    for _ in range(200_000):
        if m.pc == 0xFFFE:
            break
        m.step()
    else:
        raise SystemExit('recall routine did not return')
    return [m.memory[0x38 + i] for i in range(40)]


if __name__ == '__main__':
    img = open(sys.argv[1], 'rb').read()
    presets = [recall(img, n % 10, n // 10) for n in range(40)]
    json.dump(presets, open(sys.argv[2], 'w'))
    for n, p in enumerate(presets):
        print(f'{(n // 10 + 1) * 10 + n % 10:3d}', ' '.join(f'{v:3d}' for v in p))
