//! FM-1 SoC: memory map + peripherals.
//!
//! Memory map (recon + Felucca HAL headers + corpus literals):
//!   0x0200_0000  XIP flash (app window) — code runs from here
//!   0x01c0_0000  data RAM (≥512 KiB; BOOT_STATE at 0x01C7FD80 observed)
//!   0x5000_0-    GPIO ports A..H (0x40 stride: OUT+0, DIR+8, DIE+C, PU+10, PD+14)
//!   0x5100_|     IOMAP
//!   0x1000_-0x1002  clock
//!   0x1080_0/0x1090_0  TIMER4/TIMER5 (CNT reads = synthetic progress)
//!   0x11c0_0-    SPI0 = external NOR flash (model in spiflash.rs; CS = PD0)
//!   0x11d0_0-    SPI1 = LCD (ST7789-class 240×240, model in lcd.rs)
//!   0x1180_0-    USB
//!   0x1210_0-    UART1 (MIDI IN)
//!   0x1310_0-    ADC
//!   0x1eee000-   interrupt controller (0x1eee008 bit14 = ready, polled by the
//!                RAM early-init; the rest stored bits)
//!   0x1eee240    DBG_MSG debug box (console)
//!   0x01f0_0000  SRAM banks (256 KiB; cleared by the early init, config block at 0x1f28000)
//!   0x01c0xxxx 'negative' long-call targets are RAM-resident .data code
//!   (copied from flash 0x02084820 by the CRT), not a mask ROM
//!
//! Policy: unknown MMIO accesses are logged and return a benign default —
//! never silently swallowed. The access log is the reverse-engineering
//! roadmap.

use fm1_core::Bus;

mod lcd;
pub mod periph;
mod ram;
mod spiflash;

pub use lcd::{write_bmp, Lcd};
pub use periph::{Action, Periph, CPU_HZ, VEC_BASE};
pub use ram::Ram;
pub use spiflash::SpiFlash;

pub const XIP_BASE: u32 = 0x0200_0000;
pub const RAM_BASE: u32 = 0x01c0_0000;
pub const OVL_BASE: u32 = 0x0400_0000;
pub const SRAM2_BASE: u32 = 0x01f0_0000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownAccess {
    pub addr: u32,
    pub width: u8,
    pub is_write: bool,
    pub value: u32,
}

enum Region {
    Xip,
    Ram,
    Ovl,
    Gpio,
    Iomap,
    Clk,
    Timer,
    Spi0,
    Spi1,
    Usb,
    Uart1,
    Adc,
    Dbg,
    Irqc,
    /// Interrupt controller enable/priority words and software latch.
    Irqc2,
    /// ALNK0 I2S out.
    Alnk,
    Sram2,
    Unknown,
}

/// The SoC bus: XIP flash + data RAM + modeled peripherals + a logged stub.
pub struct Soc {
    pub xip: Vec<u8>,
    pub ram: Ram,
    pub lcd: Lcd,
    /// SPI0 + the external NOR flash (1 MiB; `--flash` image loaded at 0).
    pub flash: SpiFlash,
    /// Console bytes written through DBG_MSG / UART-style debug boxes.
    pub console: Vec<u8>,
    /// Overlay RAM (second bank, 0x04000000), written by the app CRT.
    pub ovl: Ram,
    /// SRAM banks at 0x01f00000 (cleared by the RAM early init).
    pub sram2: Ram,
    /// monotonic "time" for peripheral counters
    pub ticks: u64,
    /// Timers, audio DMA, ADC, interrupt controller and the front panel.
    pub periph: Periph,
    sfr: std::collections::HashMap<u32, u32>,
    unknown_log: Vec<UnknownAccess>,
}

fn dbg_line(addr: u32) -> &'static str {
    match addr & !3 {
        0x1eee240 => "wr_en",
        0x1eee244 => "msg",
        0x1eee248 => "msg_clr",
        _ => "dbg",
    }
}

impl Soc {
    /// `ram_size` in bytes; `xip` = the app binary mapped at XIP_BASE.
    pub fn new(ram_size: usize, xip: Vec<u8>) -> Self {
        Self {
            xip,
            ram: Ram::new(ram_size),
            ovl: Ram::new(512 * 1024),
            sram2: Ram::new(256 * 1024),
            lcd: Lcd::new(),
            flash: SpiFlash::new(),
            console: Vec::new(),
            ticks: 0,
            periph: Periph::default(),
            sfr: std::collections::HashMap::new(),
            unknown_log: Vec::new(),
        }
    }

    /// All unknown accesses so far — the peripheral bring-up TODO list.
    /// Advance the peripheral clock by `n` CPU cycles, moving any finished
    /// audio half out of RAM (int32 L/R holding a 24-bit sample in the low
    /// bits — Felucca writes Q15 << 7, audio.c OUT_SHIFT — so >> 8 to i16).
    pub fn advance(&mut self, n: u64) {
        let due = self.periph.advance(n);
        if let Some((adr, words)) = due.audio_half {
            for i in 0..words {
                let w = self.read32(adr.wrapping_add(i * 4)) as i32;
                self.periph.audio.push((w >> 8).clamp(-32768, 32767) as i16);
            }
        }
    }

    /// The highest-priority enabled pending interrupt: (irq, prio).
    #[inline]
    pub fn pending_irq(&self) -> Option<(u8, u8)> {
        self.periph.pending_irq()
    }

    pub fn unknown_accesses(&self) -> &[UnknownAccess] {
        &self.unknown_log
    }

    /// The debug console contents (DBG_MSG box writes).
    pub fn console_string(&self) -> String {
        String::from_utf8_lossy(&self.console).into_owned()
    }

    fn log_unknown(&mut self, addr: u32, width: u8, is_write: bool, value: u32) {
        self.unknown_log.push(UnknownAccess {
            addr,
            width,
            is_write,
            value,
        });
        // keep the last 8192..16384 (dropping one at a time shifted the whole log per access)
        if self.unknown_log.len() >= 16384 {
            self.unknown_log.drain(..8192);
        }
    }

    fn region(&self, addr: u32) -> Region {
        match addr {
            a if a >= XIP_BASE && (a - XIP_BASE) < self.xip.len() as u32 => Region::Xip,
            a if a >= RAM_BASE && (a - RAM_BASE) < self.ram.len() as u32 => Region::Ram,
            a if a >= OVL_BASE && (a - OVL_BASE) < self.ovl.len() as u32 => Region::Ovl,
            a if a >= SRAM2_BASE && (a - SRAM2_BASE) < self.sram2.len() as u32 => Region::Sram2,
            0x1eee000..=0x1eee0ff => Region::Irqc,
            0x1eef000..=0x1eef3ff => Region::Irqc2,
            0x12e00..=0x12e3f => Region::Alnk,
            0x50000..=0x501ff => Region::Gpio,
            0x51000..=0x5103f => Region::Iomap,
            0x10000..=0x1001f => Region::Clk,
            0x10500..=0x1091f => Region::Timer,
            0x11c00..=0x11c1f => Region::Spi0,
            0x11d00..=0x11d1f => Region::Spi1,
            0x11800..=0x1183f => Region::Usb,
            0x12100..=0x1212f => Region::Uart1,
            0x13100..=0x1311f => Region::Adc,
            0x1eee240..=0x1eee24f => Region::Dbg,
            _ => Region::Unknown,
        }
    }

    fn sfr_get(&mut self, addr: u32) -> u32 {
        *self.sfr.get(&addr).unwrap_or(&0)
    }

    fn sfr_set(&mut self, addr: u32, v: u32) {
        self.sfr.insert(addr, v);
    }

    /// SPI1/MMIO side effects on 32-bit writes.
    fn spi1_write(&mut self, addr: u32, value: u32) {
        match addr {
            0x11d00 => {
                // CON: bit14 pending-clear acknowledged silently
                let stored = self.sfr_get(addr);
                self.sfr_set(addr, (stored & !0x4000) | (value & !0x4000));
            }
            0x11d04 => self.sfr_set(addr, value), // BAUD
            0x11d08 => {
                // BUF: single byte, D/C = PC8 state
                let pc = self.sfr_get(0x50080);
                self.lcd.feed(value as u8, pc & 0x100 != 0);
                self.sfr_set(addr, value);
            }
            0x11d0c => self.sfr_set(addr, value), // ADR
            0x11d10 => {
                // CNT: DMA `value` bytes from RAM[ADR] through the panel
                let adr = self.sfr_get(0x11d0c);
                let pc = self.sfr_get(0x50080);
                let n = value.min(0x40000);
                // the DMA source is a bus address (RAM, SRAM or XIP)
                let bytes: Vec<u8> = (0..n).map(|i| self.read8(adr.wrapping_add(i))).collect();
                for b in bytes {
                    self.lcd.feed(b, pc & 0x100 != 0);
                }
                self.sfr_set(addr, 0);
            }
            _ => self.sfr_set(addr, value),
        }
    }

    fn timer_read(&mut self, addr: u32) -> u32 {
        // "time" base ticks so timeout/wait loops make progress; count
        // registers report a moving value, the rest stored bits.
        self.ticks = self.ticks.wrapping_add(1);
        if addr & 0xff == 0x04 {
            let t = (self.ticks * 7) as u32;
            return t;
        }
        self.sfr_get(addr)
    }
}

impl Bus for Soc {
    #[inline(always)]
    fn tick(&mut self) -> bool {
        self.periph.tick()
    }
    #[inline(always)]
    fn irq_pending(&self) -> bool {
        self.periph.any_pending()
    }
    fn jit_mem(&mut self) -> Option<fm1_core::JitMem> {
        Some(fm1_core::JitMem {
            ram: self.ram.as_mut_ptr(),
            ram_base: RAM_BASE,
            ram_len: self.ram.len() as u32,
            xip: self.xip.as_ptr(),
            xip_base: XIP_BASE,
            xip_len: self.xip.len() as u32,
        })
    }
    #[inline]
    fn tick_room(&self) -> u64 {
        self.periph.tick_room()
    }
    #[inline]
    fn add_ticks(&mut self, n: u64) {
        self.periph.cycles += n;
    }
    #[inline]
    fn next_tick_due(&self) -> bool {
        self.periph.next_tick_due()
    }

    // RAM fast paths: same results as the region dispatch below (byte and
    // halfword accesses select within the aligned word), without walking it

    #[inline(always)]
    fn read8(&mut self, addr: u32) -> u8 {
        let o = addr.wrapping_sub(RAM_BASE);
        if (o as usize) < self.ram.len() {
            return self.ram.read8(o);
        }
        self.read32(addr & !3).to_le_bytes()[(addr & 3) as usize]
    }

    #[inline(always)]
    fn read16(&mut self, addr: u32) -> u16 {
        // halfwords sit at offsets 0 and 2 of the word (the old `>> 8` for
        // offset 2 returned bytes 1-2 and sheared every 16-bit pixel canvas)
        let v = self.read32(addr & !3);
        (v >> ((addr & 2) * 8)) as u16
    }

    #[inline(always)]
    fn read32(&mut self, addr: u32) -> u32 {
        let o = addr.wrapping_sub(RAM_BASE) as usize;
        if o + 4 <= self.ram.len() {
            return self.ram.read32(o as u32);
        }
        let x = addr.wrapping_sub(XIP_BASE) as usize;
        if x + 4 <= self.xip.len() {
            return u32::from_le_bytes([self.xip[x], self.xip[x + 1], self.xip[x + 2], self.xip[x + 3]]);
        }
        self.read32_slow(addr)
    }

    #[inline(always)]
    fn write8(&mut self, addr: u32, value: u8) {
        let o = addr.wrapping_sub(RAM_BASE);
        if (o as usize) < self.ram.len() {
            return self.ram.write8(o, value);
        }
        self.write8_slow(addr, value)
    }

    #[inline(always)]
    fn write16(&mut self, addr: u32, value: u16) {
        // merged at (addr & 2) within the aligned word, as the slow path does
        let o = (addr & !1).wrapping_sub(RAM_BASE) as usize;
        if o + 2 <= self.ram.len() && addr & 1 == 0 {
            return self.ram.write16(o as u32, value);
        }
        self.write16_slow(addr, value)
    }

    #[inline(always)]
    fn write32(&mut self, addr: u32, value: u32) {
        let o = addr.wrapping_sub(RAM_BASE) as usize;
        if o + 4 <= self.ram.len() {
            return self.ram.write32(o as u32, value);
        }
        self.write32_slow(addr, value)
    }
}

impl Soc {
    #[inline(never)]
    fn read32_slow(&mut self, addr: u32) -> u32 {
        match self.region(addr) {
            Region::Xip => {
                let o = (addr - XIP_BASE) as usize;
                let g = |i: usize| self.xip.get(i).copied().unwrap_or(0);
                u32::from_le_bytes([g(o), g(o + 1), g(o + 2), g(o + 3)])
            }
            Region::Ram => self.ram.read32(addr - RAM_BASE),
            Region::Ovl => self.ovl.read32(addr - OVL_BASE),
            Region::Sram2 => self.sram2.read32(addr - SRAM2_BASE),
            Region::Irqc => {
                // 0x1eee008 bit 14: controller ready (the early init spins on it)
                let v = self.sfr_get(addr);
                if addr == 0x1eee008 { v | 0x4000 } else { v }
            }
            Region::Iomap | Region::Usb | Region::Uart1 | Region::Clk => self.sfr_get(addr),
            Region::Gpio | Region::Adc | Region::Alnk | Region::Irqc2 => {
                match self.periph.read(addr) {
                    Some(v) => v,
                    None => self.sfr_get(addr),
                }
            }
            Region::Timer => {
                match self.periph.read(addr) {
                    Some(v) => v,
                    None => self.timer_read(addr),
                }
            }
            Region::Spi0 => self.flash.read(addr),
            Region::Spi1 => {
                if addr == 0x11d00 {
                    // CON: always report transfer-done so polls finish
                    self.sfr_get(addr) | 0x8000
                } else if addr == 0x11d10 {
                    self.sfr_get(addr)
                } else {
                    self.sfr_get(addr)
                }
            }
            Region::Dbg => self.sfr_get(addr),
            Region::Unknown => {
                self.log_unknown(addr, 4, false, 0);
                0
            }
        }
    }

    #[inline(never)]
    fn write8_slow(&mut self, addr: u32, value: u8) {
        let cur = self.read32(addr & !3);
        let shift = (addr & 3) * 8;
        let mask = !(0xffu32 << shift);
        let merged = (cur & mask) | ((value as u32) << shift);
        self.write32(addr & !3, merged);
    }

    #[inline(never)]
    fn write16_slow(&mut self, addr: u32, value: u16) {
        let cur = self.read32(addr & !3);
        let shift = (addr & 2) * 8;
        let mask = !(0xffffu32 << shift);
        let merged = (cur & mask) | ((value as u32) << shift);
        self.write32(addr & !3, merged);
    }

    #[inline(never)]
    fn write32_slow(&mut self, addr: u32, value: u32) {
        match self.region(addr) {
            Region::Xip => self.log_unknown(addr, 4, true, value), // flash writes go via the ROM
            Region::Ram => self.ram.write32(addr - RAM_BASE, value),
            Region::Ovl => self.ovl.write32(addr - OVL_BASE, value),
            Region::Sram2 => self.sram2.write32(addr - SRAM2_BASE, value),
            Region::Irqc => self.sfr_set(addr, value),
            Region::Gpio => {
                // PD0 drives the flash chip select; PA1/PA3/PA4 clock the
                // key-matrix shift registers
                if addr == 0x500c0 {
                    self.flash.set_cs(value & 1 == 0);
                }
                self.periph.write(addr, value);
                self.sfr_set(addr, value)
            }
            Region::Alnk | Region::Irqc2 => {
                if !self.periph.write(addr, value) {
                    self.sfr_set(addr, value);
                }
            }
            Region::Spi0 => self.flash.write(addr, value),
            Region::Iomap => self.sfr_set(addr, value),
            Region::Clk => self.sfr_set(addr, value),
            Region::Usb => self.sfr_set(addr, value),
            Region::Uart1 => self.sfr_set(addr, value),
            Region::Adc => {
                if !self.periph.write(addr, value) {
                    self.sfr_set(addr, value);
                }
            }
            Region::Timer => {
                if !self.periph.write(addr, value) {
                    self.sfr_set(addr, value);
                }
            }
            Region::Spi1 => self.spi1_write(addr, value),
            Region::Dbg => {
                match dbg_line(addr) {
                    "msg" => {
                        self.console.extend_from_slice(&value.to_le_bytes());
                    }
                    _ => {}
                }
                self.sfr_set(addr, value);
            }
            Region::Unknown => self.log_unknown(addr, 4, true, value),
        }
    }
}
