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

pub mod fwsc;
mod lcd;
pub mod machine;
pub mod periph;
mod ram;
mod spiflash;

pub use lcd::{write_bmp, Lcd};
pub use periph::{Action, Periph, CPU_HZ, VEC_BASE};
pub use ram::Ram;
pub use spiflash::{SpiFlash, FLASH_SIZE};

pub const XIP_BASE: u32 = 0x0200_0000;
pub const RAM_BASE: u32 = 0x01c0_0000;
pub const OVL_BASE: u32 = 0x0400_0000;
pub const SRAM2_BASE: u32 = 0x01f0_0000;
/// The stock firmware's .bd_base: what the BT baseband's window register 0x2FC44 reads.
pub const BT_WINDOW_BASE: u32 = 0x01c0_9e7c;
/// The flash offset behind XIP 0x02000000 (the stock layout: the app area starts at 0x4000).
pub const XIP_FLASH_OFFSET: usize = 0x4000;

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
    Ana,
    Bt,
    Spi2,
    Crc,
    Rand,
    XipFlash,
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
    /// Core 0 / 1 paused by the other (C0_CON / C1_CON bit 2 pulses, bit 3 resumes).
    paused: [bool; 2],
    /// The XIP window continues into the flash chip past the image (the stock layout; other
    /// firmwares' images read 0 past their end, as they always have here).
    pub xip_flash: bool,
    /// cpu0 set 0x10008 bit 3 (core 1's release); latched until the runner starts cpu1, as
    /// firmwares hold the bit only while they wait for core 1 to report in.
    pub cpu1_release: bool,
    /// FM1_AUDIO_TRACE: log each audio half-buffer (debugging the DMA's pace).
    audio_trace: bool,
    /// The CRC-16 unit's register (0x13504).
    crc: u16,
    /// The random number generator's state (JL_RAND, 0x13B00: R64L / R64H).
    rand: u64,
    /// The cores' hardware lock (`lockset` / `lockclr`): which core holds it.
    lock_owner: Option<u32>,
    /// FM1_GPIO_TRACE: GPIO register writes by address (debugging port use).
    pub gpio_writes: Option<std::collections::BTreeMap<u32, u64>>,
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
            paused: [false; 2],
            lock_owner: None,
            crc: 0,
            rand: 0x9e37_79b9_7f4a_7c15,
            cpu1_release: false,
            audio_trace: std::env::var_os("FM1_AUDIO_TRACE").is_some(),
            xip_flash: false,
            gpio_writes: std::env::var("FM1_GPIO_TRACE").ok().map(|_| Default::default()),
            unknown_log: Vec::new(),
        }
    }

    /// All unknown accesses so far — the peripheral bring-up TODO list.
    /// Advance the peripheral clock by `n` CPU cycles, moving any finished
    /// audio half out of RAM (int32 L/R holding a 24-bit sample in the low
    /// bits — Felucca writes Q15 << 7, audio.c OUT_SHIFT — so >> 8 to i16).
    pub fn advance(&mut self, n: u64) {
        let due = self.periph.advance(n);
        if let Some((at, b)) = due.uart_rx {
            self.write8(at, b);
        }
        if let Some((adr, words)) = due.audio_half {
            if self.audio_trace {
                eprintln!("half {} ms {}", self.periph.ms(), self.periph.cycles);
            }
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

    /// Core `core` (0, 1) is paused by the other through its CON register's bit 2
    /// (0x1EEE000 / 0x1EEE004): the stock firmware stops core 1 around flash work.
    pub fn core_paused(&self, core: u32) -> bool {
        core < 2 && self.paused[core as usize]
    }

    /// The highest-priority interrupt pending for core `core` (its own enable bank).
    pub fn pending_irq_for(&self, core: u32) -> Option<(u8, u8)> {
        self.periph.pending_irq_for(core)
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
            // past the loaded image the XIP window still shows the flash chip (the stock
            // firmware reads its USR preset area, which it writes over SPI, through XIP)
            a if self.xip_flash && a >= XIP_BASE && (a - XIP_BASE) as usize + XIP_FLASH_OFFSET < spiflash::FLASH_SIZE => Region::XipFlash,
            a if a >= RAM_BASE && (a - RAM_BASE) < self.ram.len() as u32 => Region::Ram,
            a if a >= OVL_BASE && (a - OVL_BASE) < self.ovl.len() as u32 => Region::Ovl,
            a if a >= SRAM2_BASE && (a - SRAM2_BASE) < self.sram2.len() as u32 => Region::Sram2,
            0x1eee000..=0x1eee0ff => Region::Irqc,
            0x1eef000..=0x1eef3ff => Region::Irqc2,
            0x12e00..=0x12e3f => Region::Alnk,
            0x50000..=0x501ff => Region::Gpio,
            0x51000..=0x5103f => Region::Iomap,
            0x10000..=0x1001f => Region::Clk,
            0x10400..=0x1091f => Region::Timer,
            0x11c00..=0x11c1f => Region::Spi0,
            0x11d00..=0x11d1f => Region::Spi1,
            0x11e00..=0x11e1f => Region::Spi2,
            0x11800..=0x1183f => Region::Usb,
            0x12100..=0x1212f => Region::Uart1,
            0x13100..=0x1311f => Region::Adc,
            0x13500..=0x1350f => Region::Crc,
            0x13b00..=0x13b07 => Region::Rand,
            0x11900..=0x119ff => Region::Ana,
            0x20000..=0x2ffff => Region::Bt,
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
                // CON: bit14 clears the pending transfer-done (and its IRQ 16)
                if value & 0x4000 != 0 {
                    self.periph.spi1_pending = false;
                }
                let stored = self.sfr_get(addr);
                self.sfr_set(addr, (stored & !0x4000) | (value & !0x4000));
            }
            0x11d04 => self.sfr_set(addr, value), // BAUD
            0x11d08 => {
                // BUF: single byte, D/C = PC8 state
                let pc = self.sfr_get(0x50080);
                self.lcd.feed(value as u8, pc & 0x100 != 0);
                self.sfr_set(addr, value);
                self.spi1_done();
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
                self.spi1_done();
            }
            _ => self.sfr_set(addr, value),
        }
    }

    /// SPI2 (0x11E00, CON/BAUD/BUF/ADR/CNT like SPI1): the stock firmware shifts the key
    /// matrix's column pattern into the two 74HC595s with it, one 2-byte DMA per column,
    /// driven by its IRQ 37 handler (which also reads the rows and pulses RCLK on PA1).
    fn spi2_write(&mut self, addr: u32, value: u32) {
        match addr {
            0x11e00 => {
                if value & 0x4000 != 0 {
                    self.periph.spi2_pending = false;
                }
                self.sfr_set(addr, value & !0xc000);
            }
            0x11e08 => {
                self.periph.sr_shift_byte(value as u8);
                self.sfr_set(addr, value);
                self.spi2_started(1);
            }
            0x11e10 => {
                let adr = self.sfr_get(0x11e0c);
                for i in 0..value.min(64) {
                    let b = self.read8(adr.wrapping_add(i));
                    self.periph.sr_shift_byte(b);
                }
                self.sfr_set(addr, 0);
                self.spi2_started(value);
            }
            _ => self.sfr_set(addr, value),
        }
    }

    fn spi2_started(&mut self, bytes: u32) {
        let con = self.sfr_get(0x11e00);
        let baud = self.sfr_get(0x11e04);
        self.periph.spi2_start(bytes, baud, con & 0x2000 != 0);
    }

    /// A SPI1 transfer finished (instantly here): with CON bit 13 (interrupt enable) that is
    /// IRQ 16, the stock LCD driver's DMA-done (its layer flush waits for the handler).
    fn spi1_done(&mut self) {
        if self.sfr_get(0x11d00) & 0x2000 != 0 {
            self.periph.spi1_pending = true;
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
    fn irq_window(&mut self) {
        if self.periph.any_pending() {
            self.periph.next_due = 0;
        }
    }

    fn idle(&mut self, core: u32) {
        if core == 0 {
            self.periph.idle();
        }
    }

    fn hw_lock(&mut self, core: u32, set: bool) -> bool {
        match (set, self.lock_owner) {
            (true, Some(c)) if c != core => false,
            (true, _) => {
                self.lock_owner = Some(core);
                true
            }
            (false, Some(c)) if c == core => {
                self.lock_owner = None;
                true
            }
            (false, _) => true,
        }
    }

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
            Region::XipFlash => {
                let o = (addr - XIP_BASE) as usize + XIP_FLASH_OFFSET;
                let g = |i: usize| self.flash.mem.get(i).copied().unwrap_or(0xff);
                u32::from_le_bytes([g(o), g(o + 1), g(o + 2), g(o + 3)])
            }
            Region::Ovl => self.ovl.read32(addr - OVL_BASE),
            Region::Sram2 => self.sram2.read32(addr - SRAM2_BASE),
            Region::Irqc => {
                // 0x1eee008 bit 14: controller ready (the early init spins on it);
                // 0x1eee000 / 0x1eee004 (C0_CON / C1_CON): see `core_paused`
                let v = self.sfr_get(addr);
                match addr {
                    0x1eee008 => v | 0x4000,
                    0x1eee000 | 0x1eee004 => {
                        let core = ((addr >> 2) & 1) as usize;
                        (v & !0x14) | if self.paused[core] { 0x10 } else { 0 }
                    }
                    _ => v,
                }
            }
            Region::Iomap | Region::Usb | Region::Clk => self.sfr_get(addr),
            // JL_ANA (analog: WLA, DAC trim). 0x11978 is the DAC trim measurement after the
            // strobe at the same word: bit 5 = conversion done, bits 8-15 = the value (mid
            // scale here), bit 18 = "this trim step is right". With these the stock
            // firmware's audio_ana calibration finishes at once instead of polling forever
            // (a trim only nudges the DAC's DC offset).
            Region::Ana => {
                let v = self.sfr_get(addr);
                if addr == 0x11978 { (v & !0xff00) | 0x4_0000 | 0x8000 | 0x20 } else { v }
            }
            // the Bluetooth baseband (bsfr 0x20000; no radio here): reads 0, writes are
            // dropped (self-clearing requests like bt_clkn_compare_arm's capture at 0x2001C
            // must read done), except 0x2FC44, the read-only base of the RAM window its
            // buffers live in (never written: fixed in hardware). The stock BT stack checks
            // buffers against it: descriptors within 2 KiB and below its own .bd_base + 1088
            // (the constant it loads next to the read), bulk buffers within 32 KiB. .bd_base
            // opens the BT bss (SDK btctler_lib_bss.ld): 0x01C09E7C in the stock V13 image.
            Region::Bt => {
                if addr == 0x2fc44 { BT_WINDOW_BASE } else { 0 }
            }
            Region::Gpio | Region::Adc | Region::Alnk | Region::Irqc2 | Region::Uart1 => {
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
            // SPI2: transfers finish at once (CON bit 15 reads done)
            Region::Spi2 => self.sfr_get(addr) | if addr == 0x11e00 { 0x8000 } else { 0 },
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
            Region::Crc => if addr == 0x13504 { self.crc as u32 } else { 0 },
            // JL_RAND (0x13B00 R64L, 0x13B04 R64H): a new number at every read, from a fixed
            // seed so runs repeat. Read as 0 it hung the stock firmware ~8 s after boot: a
            // routine in its audio driver parks the task when a random word equals a fixed
            // descrambled one, which real hardware never hits.
            Region::Rand => {
                let mut x = self.rand;
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                self.rand = x;
                (if addr == 0x13b00 { x } else { x >> 32 }) as u32
            }
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
            Region::Xip | Region::XipFlash => self.log_unknown(addr, 4, true, value), // flash writes go via the ROM
            Region::Ram => self.ram.write32(addr - RAM_BASE, value),
            Region::Ovl => self.ovl.write32(addr - OVL_BASE, value),
            Region::Sram2 => self.sram2.write32(addr - SRAM2_BASE, value),
            Region::Irqc => {
                if addr == 0x1eee000 || addr == 0x1eee004 {
                    // C0_CON / C1_CON: writing bit 2 pauses that core (bit 4 reads "paused");
                    // a write with bit 3 and without bit 2 runs it again. Both are pulses:
                    // the stock IPC pauses with `|= 4` and resumes with `|= 8` on the same word.
                    let core = ((addr >> 2) & 1) as usize;
                    if value & 4 != 0 {
                        self.paused[core] = true;
                    } else if value & 8 != 0 {
                        self.paused[core] = false;
                    }
                    self.sfr_set(addr, value & !0x14);
                } else {
                    self.sfr_set(addr, value);
                }
            }
            Region::Gpio => {
                if let Some(h) = self.gpio_writes.as_mut() {
                    *h.entry(addr).or_insert(0) += 1;
                }
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
            Region::Ana => self.sfr_set(addr, value),
            Region::Bt => {}
            Region::Clk => {
                if addr == 0x10008 && value & 8 != 0 && self.sfr_get(addr) & 8 == 0 {
                    self.cpu1_release = true;
                    self.periph.next_due = 0; // the runner looks at it before the next instruction
                }
                self.sfr_set(addr, value)
            }
            Region::Usb => self.sfr_set(addr, value),
            Region::Uart1 => {
                if !self.periph.write(addr, value) {
                    self.sfr_set(addr, value);
                }
            }
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
            Region::Spi2 => self.spi2_write(addr, value),
            // the CRC-16 unit (chip_crc16): [+4] = the register (the SDK seeds it with 0),
            // each write to [+0] feeds one byte through CRC-16/CCITT (0x1021, MSB first).
            // The stock NOR file system checks every directory entry with it.
            Region::Rand => {}
            Region::Crc => match addr {
                0x13500 => {
                    let mut c = self.crc ^ ((value as u16 & 0xff) << 8);
                    for _ in 0..8 {
                        c = if c & 0x8000 != 0 { (c << 1) ^ 0x1021 } else { c << 1 };
                    }
                    self.crc = c;
                }
                0x13504 => self.crc = value as u16,
                _ => {}
            },
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

/// M-VAVE's stock firmware out of its update package: the XIP window's contents (the app
/// area, unscrambled), the whole flash (the image as written, grown to the chip's size, the
/// USR patch area given this emulator's default bank when blank and then an optional DX7
/// bank in slots 1-32) and the entry point.
pub struct Stock {
    pub xip: Vec<u8>,
    pub flash: Vec<u8>,
    pub entry: u32,
}

pub fn stock_from_package(pkg: &[u8], syx: Option<&[u8]>) -> Result<Stock, String> {
    let u = fwsc::unpack(pkg)?;
    let mut flash = fwsc::full_flash(&u.raw, FLASH_SIZE);
    if let Some(usr) = fwsc::usr_offset(&u) {
        fwsc::usr_fill_defaults(&mut flash, usr);
        if let Some(b) = syx {
            fwsc::usr_load_syx(&mut flash, usr, b, 0)?;
        }
    }
    let app = u.entry("app.bin").map(|h| h.offset).unwrap_or(0x120);
    Ok(Stock { xip: u.xip, flash, entry: XIP_BASE + app as u32 })
}

/// Ready a Soc for the stock firmware: its flash chip, and the SPL's boot parameters at
/// `params`. Returns the value for r0.
pub fn stock_boot(soc: &mut Soc, flash: &[u8], params: u32) -> u32 {
    soc.flash.load(flash);
    soc.xip_flash = true;
    write_boot_info(soc, params, flash)
}

/// The boot-parameter block the SPL (uboot.boot) hands the stock app in r0, as the SDK's
/// `BOOT_DEVICE_INFO` (include_lib/system/boot.h) and the SPL's own code at 0x31B2..0x3200
/// build it: fs_info (-> the flash header copied right after the struct), sfc_base_addr (the
/// flash offset behind XIP 0x02000000: 0x4000), app_addr 0x02000000, chip_id, trim_value, an
/// 8-byte MAC, then the 32-byte flash header unmasked (CRC-16 keystream from 0xFFFF; its CRC
/// checks). The app copies parts of it to 0x01C7FD50 (boot_hwinfo_save) and its NOR file
/// system finds the flash from sfc_base_addr. Writes the block at `at` (RAM); returns `at`.
pub fn write_boot_info(soc: &mut Soc, at: u32, flash: &[u8]) -> u32 {
    let mut head = [0u8; 32];
    head.copy_from_slice(&flash[..32]);
    let mut key: u16 = 0xffff;
    for b in head.iter_mut() {
        *b ^= key as u8;
        key = (key << 1) ^ if key & 0x8000 != 0 { 0x1021 } else { 0 };
    }
    let words = [at + 24, 0x4000, XIP_BASE, 0, 0, 0];
    for (i, w) in words.iter().enumerate() {
        soc.write32(at + 4 * i as u32, *w);
    }
    for (i, b) in head.iter().enumerate() {
        soc.write8(at + 24 + i as u32, *b);
    }
    at
}
