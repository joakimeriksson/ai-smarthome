//! The FM-1 emulator for the browser. One WebAssembly module, two users:
//!
//! * the AudioWorklet runs the machine (`fm1_*`): boot from a firmware image, render audio
//!   frames on demand (the emulator runs until the I2S DMA has produced them, so the audio
//!   device paces it), take key / encoder / pot input, expose the LCD and LED state;
//! * the page draws the front panel (`panel_*`, the same code as the native window) and
//!   hit-tests the pointer.
//!
//! Plain `extern "C"` exports and pointers into linear memory: no bindings generator needed.

use fm1_core::{Bus, Cpu};
use fm1_soc::{machine, Action, Soc};
use std::collections::VecDeque;

#[path = "../../fm1-live/src/panel.rs"]
mod panel;

const RAM_BASE: u32 = 0x01c0_0000;
const RAM_SIZE: usize = 1 << 20;

struct Machine {
    cpu: Cpu,
    /// the second core once the firmware releases it (fm1_soc::machine)
    cpu1: Option<Cpu>,
    soc: Soc,
    pending_tick: bool,
    /// interleaved L/R i16 not yet handed out
    audio: VecDeque<i16>,
    halted: bool,
}

impl Machine {
    /// `stock_flash`: M-VAVE's firmware, whose flash chip and boot parameters come along.
    fn new(image: Vec<u8>, entry: u32, mhz: u32, stock_flash: Option<&[u8]>) -> Self {
        let mut soc = Soc::new(RAM_SIZE, image);
        soc.periph.hz = mhz as u64 * 1_000_000;
        soc.periph.skip_idle = true;
        let mut cpu = Cpu::new(entry);
        cpu.user = true; // the SPL hands cpu0 over in user mode (fm1-core's Cpu::user)
        let params = RAM_BASE + 0x7fc00;
        soc.write32(params, params + 0x40);
        cpu.regs[0] = params;
        if let Some(f) = stock_flash {
            cpu.regs[0] = fm1_soc::stock_boot(&mut soc, f, params);
        }
        Machine { cpu, cpu1: None, soc, pending_tick: false, audio: VecDeque::new(), halted: false }
    }

    /// fm1-live's loop: cpu0's blocks (interrupts exact at block granularity), cpu1 beside.
    fn run(&mut self, n: u32) {
        let jit = self.cpu.jit_on;
        let Machine { cpu, cpu1, soc, pending_tick, .. } = self;
        if machine::run_dual(cpu1, soc, n, RAM_SIZE, jit, |soc, k| machine::run_blocks(cpu, soc, k, pending_tick)).is_err() {
            self.halted = true;
        }
    }
}

static mut M: Option<Machine> = None;
static mut OUT_L: [f32; 1024] = [0.0; 1024];
static mut OUT_R: [f32; 1024] = [0.0; 1024];
static mut LEDS: [f32; 41] = [0.0; 41];
static mut INSNS: u64 = 0;

#[allow(static_mut_refs)]
fn machine() -> Option<&'static mut Machine> {
    // SAFETY: wasm32 is single-threaded per instance; every export runs to completion.
    unsafe { M.as_mut() }
}

/// Bytes for JS to copy a firmware image into (never freed: one image per instance).
#[no_mangle]
pub extern "C" fn fm1_alloc(len: u32) -> *mut u8 {
    let mut v = vec![0u8; len as usize];
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Boot the image at `ptr` (from fm1_alloc). `entry` 0x02000120 for Felucca.
#[no_mangle]
pub extern "C" fn fm1_boot(ptr: *mut u8, len: u32, entry: u32, mhz: u32) {
    // SAFETY: ptr/len come from fm1_alloc and JS filled them.
    let image = unsafe { Vec::from_raw_parts(ptr, len as usize, len as usize) };
    unsafe { M = Some(Machine::new(image, entry, mhz, None)) };
}

/// Boot M-VAVE's stock firmware from its whole update package (.fwsc) at `ptr`, with a DX7
/// 32-voice bank (.syx) for patch slots 1-32 at `syx` when `syx_len` is not 0 (both from
/// fm1_alloc). Returns 0, or 1 when the package does not unpack (the machine is not booted).
#[no_mangle]
pub extern "C" fn fm1_boot_fwsc(ptr: *mut u8, len: u32, syx: *mut u8, syx_len: u32, mhz: u32) -> u32 {
    // SAFETY: as fm1_boot.
    let pkg = unsafe { Vec::from_raw_parts(ptr, len as usize, len as usize) };
    let bank = (syx_len != 0).then(|| unsafe { Vec::from_raw_parts(syx, syx_len as usize, syx_len as usize) });
    match fm1_soc::stock_from_package(&pkg, bank.as_deref()) {
        Ok(st) => {
            unsafe { M = Some(Machine::new(st.xip, st.entry, mhz, Some(&st.flash))) };
            0
        }
        Err(_) => 1,
    }
}

/// Render `frames` (<= 1024) stereo frames into the out buffers, running the machine until the
/// I2S DMA has produced them (at most `max_insns`). Returns the frames that are real audio.
#[no_mangle]
pub extern "C" fn fm1_render(frames: u32, max_insns: u32) -> u32 {
    let Some(m) = machine() else { return 0 };
    let frames = frames.min(1024) as usize;
    let mut spent = 0u32;
    while m.audio.len() < 2 * frames && spent < max_insns && !m.halted {
        m.run(20_000);
        spent += 20_000;
        m.audio.extend(m.soc.periph.audio.drain(..));
    }
    unsafe { INSNS += spent as u64 };
    let have = (m.audio.len() / 2).min(frames);
    #[allow(static_mut_refs)]
    unsafe {
        for i in 0..frames {
            if i < have {
                OUT_L[i] = m.audio.pop_front().unwrap_or(0) as f32 / 32768.0;
                OUT_R[i] = m.audio.pop_front().unwrap_or(0) as f32 / 32768.0;
            } else {
                OUT_L[i] = 0.0;
                OUT_R[i] = 0.0;
            }
        }
    }
    have as u32
}

#[no_mangle]
pub extern "C" fn fm1_out_l() -> *const f32 {
    #[allow(static_mut_refs)]
    unsafe { OUT_L.as_ptr() }
}

#[no_mangle]
pub extern "C" fn fm1_out_r() -> *const f32 {
    #[allow(static_mut_refs)]
    unsafe { OUT_R.as_ptr() }
}

/// The 240x240 RGB565 framebuffer.
#[no_mangle]
pub extern "C" fn fm1_lcd() -> *const u16 {
    machine().map_or(std::ptr::null(), |m| m.soc.lcd.fb.as_ptr())
}

/// The LEDs' on-fractions since the last call (41 floats).
#[no_mangle]
pub extern "C" fn fm1_leds() -> *const f32 {
    #[allow(static_mut_refs)]
    unsafe {
        if let Some(m) = machine() {
            LEDS = m.soc.periph.led_take();
        }
        LEDS.as_ptr()
    }
}

/// A key or button (matrix id 0..40) down / up.
#[no_mangle]
pub extern "C" fn fm1_key(id: u32, down: u32) {
    if let Some(m) = machine() {
        m.soc.periph.apply(&Action::Key { id: id as u8, down: down != 0 });
    }
}

/// Turn encoder `enc` (matrix encoder 0..6) by `clicks` (+ = clockwise).
#[no_mangle]
pub extern "C" fn fm1_enc(enc: u32, clicks: i32) {
    if let Some(m) = machine() {
        m.soc.periph.apply(&Action::Enc { enc: enc as u8, clicks });
    }
}

/// The MASTER pot, 0..1023.
#[no_mangle]
pub extern "C" fn fm1_pot(v: u32) {
    if let Some(m) = machine() {
        m.soc.periph.apply(&Action::Adc { ch: 4, value: v.min(1023) as u16 });
    }
}

/// Emulated milliseconds since boot.
#[no_mangle]
pub extern "C" fn fm1_ms() -> u32 {
    machine().map_or(0, |m| m.soc.periph.ms() as u32)
}

/// Instructions executed so far (for a speed readout), in millions.
#[no_mangle]
pub extern "C" fn fm1_minsns() -> u32 {
    unsafe { (INSNS / 1_000_000) as u32 }
}

#[no_mangle]
pub extern "C" fn fm1_halted() -> u32 {
    machine().map_or(1, |m| m.halted as u32)
}

// ---------------------------------------------------------------- the front panel (page side)

static mut PANEL_BASE: Vec<u32> = Vec::new();
static mut PANEL_BUF: Vec<u32> = Vec::new();
static mut PANEL_LCD: Vec<u16> = Vec::new();
static mut PANEL_LEDS: [f32; 41] = [0.0; 41];
static mut PANEL_DOWN: [bool; 41] = [false; 41];
static mut PANEL_ENC: [i32; 7] = [0; 7];
static mut PANEL_TURN: [u32; 8] = [0; 8];
static mut PANEL_POT: u16 = 900;

#[no_mangle]
pub extern "C" fn panel_width() -> u32 {
    panel::W as u32
}

#[no_mangle]
pub extern "C" fn panel_height() -> u32 {
    panel::H as u32
}

/// Where the page writes the LCD frame (240*240 RGB565) before `panel_draw`.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn panel_lcd() -> *mut u16 {
    unsafe {
        if PANEL_LCD.is_empty() {
            PANEL_LCD = vec![0; 240 * 240];
        }
        PANEL_LCD.as_mut_ptr()
    }
}

/// Where the page writes the 41 LED levels before `panel_draw`.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn panel_leds() -> *mut f32 {
    unsafe { PANEL_LEDS.as_mut_ptr() }
}

/// UI state for the drawing: a key held, an encoder's clicks, the pot, a knob's glow.
#[no_mangle]
pub extern "C" fn panel_set(kind: u32, i: u32, v: i32) {
    unsafe {
        match kind {
            0 if i < 41 => PANEL_DOWN[i as usize] = v != 0,
            1 if i < 7 => PANEL_ENC[i as usize] = v,
            2 => PANEL_POT = v.clamp(0, 1023) as u16,
            3 if i < 8 => PANEL_TURN[i as usize] = v.max(0) as u32,
            _ => {}
        }
    }
}

/// Draw the panel; returns the RGBA bytes (W*H*4) for an ImageData.
#[no_mangle]
#[allow(static_mut_refs)]
pub extern "C" fn panel_draw() -> *const u8 {
    unsafe {
        if PANEL_BASE.is_empty() {
            PANEL_BASE = panel::base();
            PANEL_BUF = vec![0; panel::W * panel::H];
        }
        if PANEL_LCD.is_empty() {
            PANEL_LCD = vec![0; 240 * 240];
        }
        let st = panel::State {
            lcd: &PANEL_LCD,
            enc_clicks: &PANEL_ENC,
            pot: PANEL_POT,
            down: &PANEL_DOWN,
            leds: &PANEL_LEDS,
            turning: &PANEL_TURN,
        };
        panel::draw(&mut PANEL_BUF, &PANEL_BASE, &st);
        // 0RGB -> RGBA bytes in place (little endian: R G B A)
        for p in PANEL_BUF.iter_mut() {
            let (r, g, b) = ((*p >> 16) & 255, (*p >> 8) & 255, *p & 255);
            *p = r | g << 8 | b << 16 | 0xff00_0000;
        }
        PANEL_BUF.as_ptr() as *const u8
    }
}

/// What is under the pointer: -1 nothing, 0..6 an encoder (index into the panel's list), 7 the
/// pot, 100 + id a button or key (matrix id).
#[no_mangle]
pub extern "C" fn panel_hit(x: f32, y: f32) -> i32 {
    match panel::hit(x, y) {
        Some(panel::Ctl::Enc(i)) => i as i32,
        Some(panel::Ctl::Pot) => 7,
        Some(panel::Ctl::Btn(id)) | Some(panel::Ctl::Key(id)) => 100 + id as i32,
        None => -1,
    }
}

/// The matrix encoder of panel encoder `i` (SELECT, ALGO, PRESET, K1..K4 order of the panel).
#[no_mangle]
pub extern "C" fn panel_enc_id(i: u32) -> u32 {
    panel::ENCS.get(i as usize).map_or(0, |e| e.1 as u32)
}
