//! Timed peripherals and the front panel, modelled from what Felucca's HAL
//! (reference/Felucca/firmware/hal/*.h) programs and from the RE docs:
//!
//! * a cycle counter (`CPU_HZ`, one instruction per cycle) paces everything;
//! * TIMER4 `0x10800`: free-running 24 MHz time base (CNT at +4);
//! * TIMER5 `0x10900`: 10 kHz tick (PRD at 6 MHz), pending CON bit 15,
//!   acknowledged by writing bit 14, IRQ 63;
//! * ALNK0 `0x12E00`: I2S out, double-buffered DMA of `LEN` int32 words per
//!   half (L/R, a 24-bit sample in the low bits of each word) at 44.1 kHz; a finished half sets
//!   CON2 bit 7 (cleared by writing bit 3), CON0 bit 15 = the half playing,
//!   IRQ 11;
//! * SARADC `0x13100`: CON (start = bit 6, done = bit 7, channel bits 8-11),
//!   RES = 10-bit value — MASTER pot on ch 4, battery on ch 3;
//! * the interrupt controller: enable/priority nibbles at `0x1EEF100`
//!   (one per source, bit 0 enable, bits 1-3 priority), software latch
//!   set/clear at `0x1EEF1A0/1A4` (bit b = IRQ 120+b), RAM vector table at
//!   `0x01C7FE00`;
//! * the key/encoder matrix: 11 columns from two 74HC595s (PA4 SER, PA3
//!   SRCLK, PA1 RCLK, MSB first, a low bit selects the column), rows PA0,
//!   PA5-PA8, PB7 with pull-ups (low = closed).

use std::collections::VecDeque;

pub const CPU_HZ: u64 = 240_000_000;
/// CPU cycles per TIMER4 tick (24 MHz).
const T4_DIV: u64 = 10;
/// CPU cycles per I2S frame: 544 TIMER4 ticks (Felucca audio.c DAC_TICKS).
const FRAME_CYCLES: u64 = 544 * T4_DIV;
/// CPU cycles per TIMER5 count (OSC/4 = 6 MHz).
const T5_DIV: u64 = 40;
/// Encoder contacts move one quadrature state every 2 ms when turning.
const ENC_STEP_CYCLES: u64 = CPU_HZ / 500;

pub const IRQ_ALNK0: u8 = 11;
pub const IRQ_TIMER5: u8 = 63;
pub const VEC_BASE: u32 = 0x01C7_FE00;

/// Key id at (packed row bit, physical column), -1 = none
/// (hal/fm1_input.h FM1_KEYMAP). Ids 0..13 are buttons, 14..40 note keys
/// (F3 .. G5).
const KEYMAP: [[i8; 11]; 6] = [
    [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
    [5, 11, 4, 10, 3, 9, 2, 8, -1, -1, -1],
    [34, 35, 36, 37, 38, 40, 39, 13, 7, 6, 12],
    [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33],
    [0, 1, 15, 14, 17, 16, 19, 18, 20, 21, 22],
    [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
];
/// Encoder i: contact A at (col, row), B at (col, row) (FM1_ENC).
const ENC: [[u8; 4]; 7] = [
    [0, 0, 1, 0],
    [2, 0, 3, 0],
    [8, 1, 9, 1],
    [8, 0, 9, 0],
    [6, 0, 7, 0],
    [4, 0, 5, 0],
    [0, 5, 1, 5],
];
/// Quadrature states in turning order: (A, B).
const GRAY: [(u8, u8); 4] = [(0, 0), (1, 0), (1, 1), (0, 1)];

pub struct Periph {
    pub cycles: u64,
    // TIMER4
    t4_con: u32,
    t4_base: u64,
    // TIMER5
    t5_con: u32,
    t5_prd: u32,
    t5_next: u64,
    t5_pending: bool,
    // ALNK0
    alnk_con0: u32,
    alnk_con1: u32,
    alnk_con3: u32,
    alnk_pend: u32,
    alnk_adr: u32,
    alnk_len: u32,
    alnk_half: u32,
    alnk_next: u64,
    /// Interleaved L/R 16-bit samples played so far.
    pub audio: Vec<i16>,
    pub audio_halves: u64,
    // SARADC
    adc_con: u32,
    pub adc_value: [u16; 16],
    // interrupt controller
    pub ilat: u32,
    // key matrix
    sr_shift: u16,
    sr_latched: u16,
    pa_out: u32,
    pub keys_down: [bool; 41],
    enc_state: [u8; 7],
    enc_pending: [i32; 7],
    enc_next: [u64; 7],
    /// Scheduled front-panel actions: (cycle, action).
    pub script: VecDeque<(u64, Action)>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Key { id: u8, down: bool },
    /// Turn encoder `enc` by `clicks` detents (+ = clockwise).
    Enc { enc: u8, clicks: i32 },
    /// Set ADC channel `ch` to `value` (0..1023).
    Adc { ch: u8, value: u16 },
}

impl Default for Periph {
    fn default() -> Self {
        let mut adc_value = [512u16; 16];
        adc_value[3] = 640; // battery: full (ui_draw.c: >= 591 is 3 bars)
        adc_value[4] = 900; // MASTER pot
        Self {
            cycles: 0,
            t4_con: 0,
            t4_base: 0,
            t5_con: 0,
            t5_prd: 0,
            t5_next: u64::MAX,
            t5_pending: false,
            alnk_con0: 0,
            alnk_con1: 0,
            alnk_con3: 0,
            alnk_pend: 0,
            alnk_adr: 0,
            alnk_len: 0,
            alnk_half: 0,
            alnk_next: u64::MAX,
            audio: Vec::new(),
            audio_halves: 0,
            adc_con: 0,
            adc_value,
            ilat: 0,
            sr_shift: 0xffff,
            sr_latched: 0xffff,
            pa_out: 0,
            keys_down: [false; 41],
            enc_state: [0; 7],
            enc_pending: [0; 7],
            enc_next: [0; 7],
            script: VecDeque::new(),
        }
    }
}

/// What the cycle advance found due; the caller moves the audio half out
/// of RAM because the peripheral block has no bus of its own.
#[derive(Debug, Default)]
pub struct Due {
    /// A half buffer finished playing: (RAM address, words).
    pub audio_half: Option<(u32, u32)>,
    pub actions: Vec<Action>,
}

impl Periph {
    pub fn ms(&self) -> u64 {
        self.cycles * 1000 / CPU_HZ
    }

    pub fn cycle_of_ms(ms: u64) -> u64 {
        ms * (CPU_HZ / 1000)
    }

    /// Advance `n` cycles; returns what came due.
    pub fn advance(&mut self, n: u64) -> Due {
        self.cycles += n;
        let mut due = Due::default();
        if self.cycles >= self.t5_next {
            self.t5_pending = true;
            let period = (self.t5_prd.max(1) as u64) * T5_DIV;
            self.t5_next += period;
            if self.t5_next <= self.cycles {
                self.t5_next = self.cycles + period;
            }
        }
        if self.cycles >= self.alnk_next {
            let words = self.alnk_len.max(2);
            due.audio_half = Some((self.alnk_adr.wrapping_add(self.alnk_half * words * 4), words));
            self.alnk_half ^= 1;
            self.alnk_pend |= 0x80;
            self.alnk_next += (words as u64 / 2) * FRAME_CYCLES;
            self.audio_halves += 1;
        }
        for i in 0..7 {
            if self.enc_pending[i] != 0 && self.cycles >= self.enc_next[i] {
                let s = self.enc_state[i] as i32;
                self.enc_state[i] = ((s + self.enc_pending[i].signum()) & 3) as u8;
                self.enc_pending[i] -= self.enc_pending[i].signum();
                self.enc_next[i] = self.cycles + ENC_STEP_CYCLES;
            }
        }
        while let Some((at, _)) = self.script.front() {
            if *at > self.cycles {
                break;
            }
            let (_, a) = self.script.pop_front().unwrap();
            self.apply(&a);
            due.actions.push(a);
        }
        due
    }

    pub fn apply(&mut self, a: &Action) {
        match *a {
            Action::Key { id, down } => {
                if (id as usize) < 41 {
                    self.keys_down[id as usize] = down;
                }
            }
            Action::Enc { enc, clicks } => {
                if (enc as usize) < 7 {
                    // one detent = one full quadrature cycle (4 transitions);
                    // clockwise runs the Gray sequence backwards (Felucca
                    // flips the stock decoder's sign: + = clockwise)
                    self.enc_pending[enc as usize] -= clicks * 4;
                    self.enc_next[enc as usize] = self.cycles;
                }
            }
            Action::Adc { ch, value } => {
                if (ch as usize) < 16 {
                    self.adc_value[ch as usize] = value.min(1023);
                }
            }
        }
    }

    /// The highest-priority enabled, pending source: (irq, prio).
    pub fn pending_irq(&self, icfg: impl Fn(u8) -> u32) -> Option<(u8, u8)> {
        let mut best: Option<(u8, u8)> = None;
        let mut consider = |n: u8| {
            let nib = (icfg(n) >> ((n & 7) * 4)) & 0xf;
            if nib & 1 != 0 {
                let prio = ((nib >> 1) & 7) as u8;
                if best.map_or(true, |(_, p)| prio > p) {
                    best = Some((n, prio));
                }
            }
        };
        if self.t5_pending {
            consider(IRQ_TIMER5);
        }
        if self.alnk_pend & 0xf0 != 0 && self.alnk_con0 & 0x800 != 0 {
            consider(IRQ_ALNK0);
        }
        for b in 0..8u8 {
            if self.ilat & (1 << b) != 0 {
                consider(120 + b);
            }
        }
        best
    }

    // ---- registers ------------------------------------------------------

    /// Reads handled here; `None` = plain SFR storage.
    pub fn read(&mut self, addr: u32) -> Option<u32> {
        Some(match addr {
            0x10800 => self.t4_con,
            0x10804 => {
                if self.t4_con & 1 != 0 {
                    ((self.cycles - self.t4_base) / T4_DIV) as u32
                } else {
                    0
                }
            }
            0x10900 => self.t5_con | if self.t5_pending { 0x8000 } else { 0 },
            0x10904 => {
                if self.t5_con & 1 != 0 && self.t5_next != u64::MAX {
                    let period = (self.t5_prd.max(1) as u64) * T5_DIV;
                    (((period - (self.t5_next - self.cycles).min(period)) / T5_DIV) % self.t5_prd.max(1) as u64) as u32
                } else {
                    0
                }
            }
            0x10908 => self.t5_prd,
            0x12e00 => (self.alnk_con0 & !0x8000) | (self.alnk_half << 15),
            0x12e04 => self.alnk_con1,
            0x12e08 => self.alnk_pend,
            0x12e0c => self.alnk_con3,
            0x12e1c => self.alnk_adr,
            0x12e20 => self.alnk_len,
            0x13100 => self.adc_con | if self.adc_con & 0x40 != 0 { 0x80 } else { 0 },
            0x13104 => self.adc_value[((self.adc_con >> 8) & 0xf) as usize] as u32,
            0x1eef1a0 | 0x1eef1a4 => self.ilat,
            0x50004 => self.pa_in(),
            0x50044 => self.pb_in(),
            _ => return None,
        })
    }

    /// Writes handled here; returns false for plain SFR storage.
    pub fn write(&mut self, addr: u32, v: u32) -> bool {
        match addr {
            0x10800 => {
                if self.t4_con & 1 == 0 && v & 1 != 0 {
                    self.t4_base = self.cycles;
                }
                self.t4_con = v & !0x4000;
            }
            0x10804 => self.t4_base = self.cycles,
            0x10808 => {}
            0x10900 => {
                if v & 0x4000 != 0 {
                    self.t5_pending = false;
                }
                let was = self.t5_con & 1;
                self.t5_con = v & !0xc000;
                if was == 0 && v & 1 != 0 {
                    self.t5_next = self.cycles + (self.t5_prd.max(1) as u64) * T5_DIV;
                } else if v & 1 == 0 {
                    self.t5_next = u64::MAX;
                }
            }
            0x10904 => {}
            0x10908 => self.t5_prd = v,
            0x12e00 => {
                let was = self.alnk_con0 & 0x800;
                self.alnk_con0 = v & 0xffff & !0x8000;
                if was == 0 && v & 0x800 != 0 {
                    self.alnk_half = 0;
                    self.alnk_next = self.cycles + (self.alnk_len.max(2) as u64 / 2) * FRAME_CYCLES;
                } else if v & 0x800 == 0 {
                    self.alnk_next = u64::MAX;
                }
            }
            0x12e04 => self.alnk_con1 = v & 0xffff,
            0x12e08 => self.alnk_pend &= !((v & 0xf) << 4), // bits 0-3 clear pendings 4-7
            0x12e0c => self.alnk_con3 = v & 0xff,
            0x12e1c => self.alnk_adr = v,
            0x12e20 => self.alnk_len = v & 0xffff,
            0x13100 => self.adc_con = v,
            0x13104 => {}
            0x1eef1a0 => self.ilat |= v,
            0x1eef1a4 => self.ilat &= !v,
            0x50000 => self.pa_write(v),
            _ => return false,
        }
        true
    }

    // ---- key matrix -----------------------------------------------------

    fn pa_write(&mut self, v: u32) {
        let old = self.pa_out;
        self.pa_out = v;
        if old & 8 == 0 && v & 8 != 0 {
            // SRCLK rising edge: shift SER (PA4) in, MSB first
            self.sr_shift = (self.sr_shift << 1) | ((v >> 4) & 1) as u16;
        }
        if old & 2 == 0 && v & 2 != 0 {
            // RCLK rising edge: outputs follow the shift register
            self.sr_latched = self.sr_shift;
        }
    }

    /// Row bits (0..5) pulled low by a closed contact in a selected column.
    fn closed_rows(&self) -> u32 {
        let mut rows = 0u32;
        for col in 0..11usize {
            if self.sr_latched & (1 << col) != 0 {
                continue; // column not selected (active low)
            }
            for row in 0..6usize {
                let id = KEYMAP[row][col];
                if id >= 0 && self.keys_down[id as usize] {
                    rows |= 1 << row;
                }
            }
            for (i, e) in ENC.iter().enumerate() {
                let (a, b) = GRAY[self.enc_state[i] as usize];
                if e[0] as usize == col && a != 0 {
                    rows |= 1 << e[1];
                }
                if e[2] as usize == col && b != 0 {
                    rows |= 1 << e[3];
                }
            }
        }
        rows
    }

    fn pa_in(&self) -> u32 {
        let r = self.closed_rows();
        // row 0 = PA0, rows 1-4 = PA5..PA8; everything else reads as pulled up
        let low = (r & 1) | ((r & 0x1e) << 4);
        (self.pa_out | 0xffff) & !low
    }

    fn pb_in(&self) -> u32 {
        let r = self.closed_rows();
        0xffff & !(((r >> 5) & 1) << 7)
    }
}

/// Logical names from Felucca's panel.c mapped to matrix key ids.
pub fn key_id(name: &str) -> Option<u8> {
    let n = name.to_ascii_uppercase();
    let buttons = [
        ("OCTDN", 0), ("OCTUP", 1), ("FX", 2), ("SCL", 3), ("ENV", 4), ("LFO", 5), ("EDIT", 6),
        ("GLO", 7), ("HOME", 8), ("SAVE", 9), ("ARP", 10), ("SEQ", 11), ("PLAY", 12), ("REC", 13),
    ];
    if let Some((_, id)) = buttons.iter().find(|(b, _)| *b == n) {
        return Some(*id);
    }
    if let Some(k) = n.strip_prefix('K') {
        return k.parse::<u8>().ok().filter(|&k| k < 41);
    }
    if let Some(note) = n.strip_prefix('N') {
        // note keys: n0 = F3 .. n26 = G5
        return note.parse::<u8>().ok().filter(|&k| k < 27).map(|k| 14 + k);
    }
    None
}

/// Encoder names (panel.c PANEL_DEFAULT) to matrix encoder index.
pub fn enc_id(name: &str) -> Option<u8> {
    let n = name.to_ascii_uppercase();
    match n.as_str() {
        "SELECT" => Some(0),
        "ALGO" | "ALGORITHM" => Some(1),
        "PRESET" | "PRESETS" => Some(6),
        "K1" => Some(2),
        "K2" => Some(3),
        "K3" => Some(4),
        "K4" => Some(5),
        _ => n.strip_prefix("ENC").and_then(|e| e.parse::<u8>().ok()).filter(|&e| e < 7),
    }
}
