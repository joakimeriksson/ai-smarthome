//! SPI0 (0x11C00) driving the external SPI NOR flash.
//!
//! The firmware talks to the flash directly (with the SFC/XIP switched off)
//! for JEDEC probing, status reads, sector erase and page program — the
//! stock app in `norflash_*`, Felucca in `hal/fm1_flash.h`. Register use as
//! seen there: CON bit15 = transfer pending (set when a byte transfer
//! completes), bit14 = clear pending (write), bit12 = direction (1 = rx),
//! bit3 = enable; BUF holds the byte to send / the byte received. Chip
//! select is PD0, driven as a GPIO by the firmware.
//!
//! The flash is a 1 MiB part reporting JEDEC `85 60 14` (Puya, as on real
//! units). Commands modelled: 9F (JEDEC id), 4B (unique id), 05/35 (status
//! 1/2), 06/04 (WREN/WRDI), 03/0B (read / fast read), 20 (4 KiB erase),
//! D8 (64 KiB erase), 02 (page program). Erase/program are instantaneous;
//! status never reports busy.

pub const SPI0_BASE: u32 = 0x11c00;
pub const FLASH_SIZE: usize = 1 << 20;

pub struct SpiFlash {
    pub mem: Vec<u8>,
    pub con: u32,
    pub buf: u32,
    cs_low: bool,
    cmd: u8,
    nbytes: usize,
    addr: u32,
    wel: bool,
    /// bytes in the current command (after the opcode), for address assembly
    pending_prog: Vec<u8>,
    /// JEDEC / unique-id reads
    pub jedec: [u8; 3],
}

impl SpiFlash {
    pub fn new() -> Self {
        Self {
            mem: vec![0xff; FLASH_SIZE],
            con: 0,
            buf: 0,
            cs_low: false,
            cmd: 0,
            nbytes: 0,
            addr: 0,
            wel: false,
            pending_prog: Vec::new(),
            jedec: [0x85, 0x60, 0x14],
        }
    }

    /// Load a flash image at offset 0 (the rest stays erased).
    pub fn load(&mut self, image: &[u8]) {
        let n = image.len().min(self.mem.len());
        self.mem[..n].copy_from_slice(&image[..n]);
    }

    pub fn set_cs(&mut self, low: bool) {
        if low && !self.cs_low {
            self.cmd = 0;
            self.nbytes = 0;
            self.pending_prog.clear();
        }
        if !low && self.cs_low && self.cmd == 0x02 {
            // page program commits on CS release
            for (i, b) in self.pending_prog.iter().enumerate() {
                let a = (self.addr as usize + i) & (FLASH_SIZE - 1);
                self.mem[a] &= *b;
            }
            self.pending_prog.clear();
            self.wel = false;
        }
        self.cs_low = low;
    }

    /// One byte exchanged on MOSI; returns the byte on MISO.
    fn transfer(&mut self, out: u8) -> u8 {
        if !self.cs_low {
            return 0xff;
        }
        let i = self.nbytes;
        self.nbytes += 1;
        if i == 0 {
            self.cmd = out;
            self.addr = 0;
            match out {
                0x06 => self.wel = true,
                0x04 => self.wel = false,
                _ => {}
            }
            return 0xff;
        }
        let k = i - 1; // byte index after the opcode
        match self.cmd {
            0x9f => self.jedec.get(k).copied().unwrap_or(0xff),
            0x4b => {
                // 4 dummy bytes then a 16-byte unique id
                if k < 4 { 0xff } else { [0x46, 0x4d, 0x31, 0x2d][(k - 4) & 3] }
            }
            0x05 => if self.wel { 0x02 } else { 0x00 },
            0x35 => 0x00,
            0x03 | 0x0b | 0x20 | 0xd8 | 0x02 => {
                if k < 3 {
                    self.addr = (self.addr << 8) | out as u32;
                    if k == 2 {
                        match self.cmd {
                            0x20 => self.erase(0x1000),
                            0xd8 => self.erase(0x10000),
                            _ => {}
                        }
                    }
                    0xff
                } else if self.cmd == 0x0b && k == 3 {
                    0xff // fast-read dummy byte
                } else if self.cmd == 0x02 {
                    self.pending_prog.push(out);
                    0xff
                } else if self.cmd == 0x03 || self.cmd == 0x0b {
                    let off = if self.cmd == 0x0b { k - 4 } else { k - 3 };
                    self.mem[(self.addr as usize + off) & (FLASH_SIZE - 1)]
                } else {
                    0xff
                }
            }
            _ => 0xff,
        }
    }

    fn erase(&mut self, size: usize) {
        if !self.wel {
            return;
        }
        let base = (self.addr as usize) & !(size - 1) & (FLASH_SIZE - 1);
        for b in &mut self.mem[base..(base + size).min(FLASH_SIZE)] {
            *b = 0xff;
        }
        self.wel = false;
    }

    pub fn read(&mut self, addr: u32) -> u32 {
        match addr - SPI0_BASE {
            0x0 => self.con,
            0x8 => self.buf,
            _ => 0,
        }
    }

    pub fn write(&mut self, addr: u32, value: u32) {
        match addr - SPI0_BASE {
            0x0 => {
                // bit14 clears the pending flag; bit15 itself is read-only
                let mut v = (value & !0x8000) | (self.con & 0x8000);
                if value & 0x4000 != 0 {
                    v &= !0xc000;
                }
                self.con = v;
            }
            0x8 => {
                // a BUF write starts one byte transfer (tx or, in rx mode, a
                // dummy out byte); the received byte lands in BUF with PND set
                let rx = self.transfer(value as u8);
                self.buf = if self.con & 0x1000 != 0 { rx as u32 } else { value & 0xff };
                self.con |= 0x8000;
            }
            _ => {}
        }
    }
}
