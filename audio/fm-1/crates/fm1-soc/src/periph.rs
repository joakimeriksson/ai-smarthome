//! Timed peripherals and the front panel, modelled from what Felucca's HAL
//! (reference/Felucca/firmware/hal/*.h) programs and from the RE docs:
//!
//! * a cycle counter (`hz`, one instruction per cycle; 240 MHz like the
//!   chip, lower for live play) paces everything, and the timers convert
//!   cycles to real time so the firmware's clock stays right at any `hz`;
//! * with `skip_idle`, a tight loop polling TIMER4 outside an ISR (a delay)
//!   jumps the clock to the next timed event instead of spinning;
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
/// TIMER4 counts the 24 MHz crystal; TIMER5 runs from OSC/4.
const T4_HZ: u64 = 24_000_000;
const T5_HZ: u64 = 6_000_000;
/// TIMER4 ticks per I2S frame (Felucca audio.c DAC_TICKS: 44.1 kHz).
const FRAME_T4: u64 = 544;

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
    /// Emulated CPU clock (cycles per second of firmware time).
    pub hz: u64,
    /// Jump over TIMER4 polling loops (see the module notes).
    pub skip_idle: bool,
    /// Set by the runner while cpu0 is inside an ISR (no skipping there).
    pub in_isr: bool,
    last_cnt_read: u64,
    /// Consecutive close TIMER4 reads outside ISRs (a poll needs 3).
    cnt_streak: u32,
    /// Nothing timed happens before this cycle (0 = recompute): `advance`
    /// returns at once until then.
    next_due: u64,
    /// Cycles jumped over by `skip_idle`.
    pub skipped: u64,
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
    /// Enable/priority words at 0x1EEF100 (one nibble per source).
    pub icfg: [u32; 32],
    // key matrix
    sr_shift: u16,
    sr_latched: u16,
    pa_out: u32,
    ph_out: u32,
    /// Front-panel LEDs: cycles each key/button LED has been lit, and the
    /// cycle of the last change of the LED lines or the column latch.
    led_acc: [u64; 41],
    led_last: u64,
    led_since: u64,
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
            hz: CPU_HZ,
            skip_idle: false,
            in_isr: false,
            last_cnt_read: 0,
            cnt_streak: 0,
            next_due: 0,
            skipped: 0,
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
            icfg: [0; 32],
            sr_shift: 0xffff,
            sr_latched: 0xffff,
            pa_out: 0,
            ph_out: 0,
            led_acc: [0; 41],
            led_last: 0,
            led_since: 0,
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
        self.cycles * 1000 / self.hz
    }

    pub fn cycle_of_ms(&self, ms: u64) -> u64 {
        ms * self.hz / 1000
    }

    fn t5_period(&self) -> u64 {
        (self.t5_prd.max(1) as u64 * self.hz / T5_HZ).max(1)
    }

    fn half_period(&self) -> u64 {
        (self.alnk_len.max(2) as u64 / 2 * FRAME_T4 * self.hz / T4_HZ).max(1)
    }

    fn enc_step(&self) -> u64 {
        self.hz / 500 // contacts move one quadrature state every 2 ms
    }

    /// The next cycle at which something timed happens.
    fn next_event(&self) -> u64 {
        let mut n = self.t5_next.min(self.alnk_next);
        if let Some((at, _)) = self.script.front() {
            n = n.min(*at);
        }
        for i in 0..7 {
            if self.enc_pending[i] != 0 {
                n = n.min(self.enc_next[i]);
            }
        }
        n
    }

    /// Advance `n` cycles; returns what came due.
    pub fn advance(&mut self, n: u64) -> Due {
        self.cycles += n;
        let mut due = Due::default();
        if self.cycles < self.next_due {
            return due;
        }
        if self.cycles >= self.t5_next {
            self.t5_pending = true;
            let period = self.t5_period();
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
            self.alnk_next += self.half_period();
            self.audio_halves += 1;
        }
        for i in 0..7 {
            if self.enc_pending[i] != 0 && self.cycles >= self.enc_next[i] {
                let s = self.enc_state[i] as i32;
                self.enc_state[i] = ((s + self.enc_pending[i].signum()) & 3) as u8;
                self.enc_pending[i] -= self.enc_pending[i].signum();
                self.enc_next[i] = self.cycles + self.enc_step();
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
        self.next_due = self.next_event();
        due
    }

    pub fn apply(&mut self, a: &Action) {
        self.next_due = 0;
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

    /// One cycle; true when something timed is due (call `advance(0)`).
    #[inline(always)]
    pub fn tick(&mut self) -> bool {
        self.cycles += 1;
        self.cycles >= self.next_due
    }

    /// Ticks that can pass before one is due (a tick is due once cycles reach next_due).
    #[inline]
    pub fn tick_room(&self) -> u64 {
        self.next_due.saturating_sub(self.cycles + 1)
    }

    #[inline]
    pub fn next_tick_due(&self) -> bool {
        self.cycles + 1 >= self.next_due
    }

    /// Any interrupt source pending at all (before enables and priorities).
    #[inline(always)]
    pub fn any_pending(&self) -> bool {
        self.t5_pending || self.alnk_pend & 0xf0 != 0 || self.ilat != 0
    }

    /// The highest-priority enabled, pending source: (irq, prio).
    pub fn pending_irq(&self) -> Option<(u8, u8)> {
        let icfg = |n: u8| self.icfg[(n >> 3) as usize];
        if !self.t5_pending && self.alnk_pend & 0xf0 == 0 && self.ilat == 0 {
            return None;
        }
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
                if self.t4_con & 1 == 0 {
                    return Some(0);
                }
                // three reads close together outside ISRs: a polling loop.
                // (Reads inside an ISR neither count nor trigger: a single
                // main-loop read right after the tick ISR's own read once
                // skipped time in ui_input and the notes went silent.)
                if self.skip_idle && !self.in_isr {
                    if self.cycles - self.last_cnt_read < 64 {
                        self.cnt_streak += 1;
                    } else {
                        self.cnt_streak = 0;
                    }
                    if self.cnt_streak >= 2 {
                        // never past the next event, and at most 20 us at a
                        // time: the loop re-checks its own deadline (an
                        // uncapped jump once crossed a whole boot delay)
                        let next = self.next_event().min(self.cycles + self.hz / 50_000);
                        if next > self.cycles + 1 {
                            self.skipped += next - 1 - self.cycles;
                            self.cycles = next - 1;
                            self.next_due = 0;
                        }
                    }
                    self.last_cnt_read = self.cycles;
                }
                ((self.cycles - self.t4_base) as u128 * T4_HZ as u128 / self.hz as u128) as u32
            }
            0x10900 => self.t5_con | if self.t5_pending { 0x8000 } else { 0 },
            0x10904 => {
                if self.t5_con & 1 != 0 && self.t5_next != u64::MAX {
                    let period = self.t5_period();
                    let into = period - (self.t5_next - self.cycles).min(period);
                    ((into * T5_HZ / self.hz) % self.t5_prd.max(1) as u64) as u32
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
            0x1eef100..=0x1eef17f => self.icfg[((addr - 0x1eef100) / 4) as usize],
            0x50004 => self.pa_in(),
            0x50044 => self.pb_in(),
            _ => return None,
        })
    }

    /// Writes handled here; returns false for plain SFR storage.
    pub fn write(&mut self, addr: u32, v: u32) -> bool {
        self.next_due = 0; // a timer or DMA may have been (re)programmed
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
                    self.t5_next = self.cycles + self.t5_period();
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
                    self.alnk_next = self.cycles + self.half_period();
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
            0x1eef100..=0x1eef17f => self.icfg[((addr - 0x1eef100) / 4) as usize] = v,
            0x1eef1a0 => self.ilat |= v,
            0x1eef1a4 => self.ilat &= !v,
            0x50000 => {
                self.led_credit();
                self.pa_write(v);
            }
            0x501c0 => {
                self.led_credit();
                self.ph_out = v;
            }
            _ => return false,
        }
        true
    }

    // ---- LEDs ---------------------------------------------------------------
    // LED lines PA9, PA10, PH6, PH9 light the LED in the latched column on
    // row bit 1, 2, 3, 4 (hal/fm1_input.h fm1__led_lines); the LED belongs to
    // the key or button at that (row, column) of the matrix.

    fn led_credit(&mut self) {
        let dt = self.cycles - self.led_last;
        self.led_last = self.cycles;
        if dt == 0 {
            return;
        }
        let lines = ((self.pa_out >> 8) & 2) | ((self.pa_out >> 8) & 4) | ((self.ph_out >> 3) & 8) | ((self.ph_out >> 5) & 16);
        if lines == 0 {
            return;
        }
        for col in 0..11usize {
            if self.sr_latched & (1 << col) != 0 {
                continue;
            }
            for row in 1..5usize {
                if lines & (1 << row) != 0 {
                    let id = KEYMAP[row][col];
                    if id >= 0 {
                        self.led_acc[id as usize] += dt;
                    }
                }
            }
        }
    }

    /// The fraction of time each LED was lit since the last call.
    pub fn led_take(&mut self) -> [f32; 41] {
        self.led_credit();
        let span = (self.cycles - self.led_since).max(1) as f32;
        self.led_since = self.cycles;
        let mut out = [0f32; 41];
        for (o, a) in out.iter_mut().zip(self.led_acc.iter_mut()) {
            *o = *a as f32 / span;
            *a = 0;
        }
        out
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
    if let Some(k) = note_name(&n) {
        return Some(14 + k);
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

/// `C4`, `F#3`, `Bb4` -> note-key index (0 = F3 .. 26 = G5).
fn note_name(n: &str) -> Option<u8> {
    let b = n.as_bytes();
    let base = match *b.first()? {
        b'C' => 0, b'D' => 2, b'E' => 4, b'F' => 5, b'G' => 7, b'A' => 9, b'B' => 11,
        _ => return None,
    };
    let (acc, rest) = match b.get(1) {
        Some(b'#') => (1, &n[2..]),
        Some(b'B') if b.len() == 3 => (-1, &n[2..]), // "BB4" after uppercasing = Bb4
        _ => (0, &n[1..]),
    };
    let oct: i32 = rest.parse().ok()?;
    let midi = (oct + 1) * 12 + base + acc;
    let k = midi - 53; // F3 = MIDI 53
    (0..27).contains(&k).then_some(k as u8)
}
