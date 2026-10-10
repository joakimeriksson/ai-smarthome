//! Play the emulated FM-1 live.
//!
//!   fm1-live [--bin work/felucca_xip.bin] [--entry 0x02000120] [--mhz 240]
//!   fm1-live --bench 3000          # headless: how fast does it run?
//!
//! The emulator runs on its own thread, paced to the wall clock: its
//! emulated time stays a little ahead of real time and the I2S output is
//! streamed to the default audio device. The window is the FM-1's front
//! panel (panel.rs): click or drag across the keys, click buttons, drag a
//! knob up/down or scroll over it; MASTER is the volume pot. Button and key
//! LEDs follow the firmware's LED lines.
//!
//! Keyboard: A W S E D F T G Y H U J K O L P ; ' = C4..F5 (piano layout),
//! Z / X = OCT- / OCT+, Space = PLAY, R = REC, 1..0 = FX SCL ENV LFO EDIT
//! GLO HOME SAVE ARP SEQ, Left/Right = SELECT, Up/Down = PRESETS,
//! , / . = ALGORITHM, Esc quits.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use fm1_core::{Bus, Cpu};
use fm1_soc::{Action, Soc, VEC_BASE};
use minifb::{Key, KeyRepeat, MouseButton, MouseMode, Window, WindowOptions};
use panel::{Ctl, ENCS, H, W};

mod panel;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const RAM_BASE: u32 = 0x01c0_0000;
const RAM_SIZE: usize = 1 << 20;
/// How far emulated time runs ahead of the wall clock before audio starts.
const LEAD_MS: f64 = 60.0;
/// Once the firmware streams audio, the emulator runs whenever less than
/// this much sound is queued: the audio device sets the pace.
const AUDIO_TARGET_MS: f64 = 50.0;

struct Opts {
    bin: String,
    entry: u32,
    mhz: u64,
    bench: Option<u64>,
    /// Headless: run this many ms with a chord held, save the panel image.
    shot: Option<u64>,
    /// What runs, for the window title.
    name: String,
}

/// The firmware catalog web/firmwares.json as (id, name, version, image path): each image is
/// reference/firmwares/<id>.xip.bin (tools/fetch_firmwares.mjs). A small scan for the string
/// fields, enough for this file; no JSON dependency.
fn catalog() -> Vec<(String, String, String, String)> {
    let Ok(text) = std::fs::read_to_string("web/firmwares.json") else { return Vec::new() };
    let field = |obj: &str, key: &str| -> Option<String> {
        let at = obj.find(&format!("\"{key}\": \""))? + key.len() + 5;
        Some(obj[at..at + obj[at..].find('"')?].to_string())
    };
    text.split("{ \"id\"").skip(1).filter_map(|chunk| {
        let obj = format!("{{ \"id\"{chunk}");
        let id = field(&obj, "id")?;
        let path = format!("reference/firmwares/{id}.xip.bin");
        Some((id, field(&obj, "name")?, field(&obj, "version")?, path))
    }).collect()
}

fn parse() -> Option<Opts> {
    let a: Vec<String> = std::env::args().collect();
    let mut o = Opts { bin: "work/felucca_xip.bin".into(), entry: 0x0200_0120, mhz: 240, bench: None, shot: None,
                       name: "Felucca".into() };
    let mut i = 1;
    while i < a.len() {
        match a[i].as_str() {
            "--bin" => {
                o.bin = a.get(i + 1)?.clone();
                o.name = o.bin.rsplit('/').next().unwrap_or("").trim_end_matches(".bin").trim_end_matches(".xip").to_string();
            }
            "--fw" => {
                // a firmware from web/firmwares.json by id (`--fw list` lists them)
                let want = a.get(i + 1)?;
                let cat = catalog();
                if want == "list" {
                    for (id, name, ver, path) in &cat {
                        let have = if std::path::Path::new(path).exists() { "" } else { "  (missing: node tools/fetch_firmwares.mjs)" };
                        println!("{id:14} {name} {ver}{have}");
                    }
                    std::process::exit(0);
                }
                let (_, name, ver, path) = cat.into_iter().find(|f| &f.0 == want)?;
                o.bin = path;
                o.name = format!("{name} {ver}");
            }
            "--entry" => o.entry = u32::from_str_radix(a.get(i + 1)?.trim_start_matches("0x"), 16).ok()?,
            "--mhz" => o.mhz = a.get(i + 1)?.parse().ok()?,
            "--bench" => o.bench = Some(a.get(i + 1)?.parse().ok()?),
            "--shot" => o.shot = Some(a.get(i + 1)?.parse().ok()?),
            _ => return None,
        }
        i += 2;
    }
    Some(o)
}

/// The machine: cpu0 + SoC, stepped with interrupts and the peripheral clock.
struct Machine {
    cpu: Cpu,
    soc: Soc,
    /// FM1_SKIP_LOG: where idle skips happen (pc -> count).
    skip_log: Option<std::collections::HashMap<u32, u64>>,
    /// Run micro-ops in blocks (FM1_NO_BLOCKS=1: the reference per-step loop).
    blocks: bool,
    pending_tick: bool,
    /// FM1_WATCH_LEDPUT=after_ms: report led_put(…, 25, on) calls (debug)
    watch_call: Option<(u32, u64)>,
    watch_hits: u32,
}

impl Machine {
    fn new(o: &Opts) -> std::io::Result<Self> {
        let image = std::fs::read(&o.bin)?;
        let mut soc = Soc::new(RAM_SIZE, image);
        soc.periph.hz = o.mhz * 1_000_000;
        soc.periph.skip_idle = true;
        let mut cpu = Cpu::new(o.entry);
        cpu.jit_on = std::env::var("FM1_NO_JIT").is_err();
        // the SPL's boot-parameter struct (see fm1-emu): an all-zero pair
        let params = RAM_BASE + 0x7fc00;
        soc.write32(params, params + 0x40);
        cpu.regs[0] = params;
        let skip_log = std::env::var("FM1_SKIP_LOG").ok().map(|_| Default::default());
        let blocks = std::env::var("FM1_NO_BLOCKS").is_err();
        let watch_call = std::env::var("FM1_WATCH_LEDPUT").ok().and_then(|v| v.parse().ok()).map(|ms| (0x0201_ad60u32, ms));
        let blocks = blocks && watch_call.is_none();
        Ok(Self { cpu, soc, skip_log, blocks, pending_tick: false, watch_call, watch_hits: 0 })
    }

    fn run(&mut self, n: u32) -> Result<(), String> {
        if !self.blocks {
            return self.run_steps(n);
        }
        let mut done = 0u32;
        // the next instruction's tick already happened (and found something due)
        let mut ticked = std::mem::take(&mut self.pending_tick);
        while done < n {
            if ticked || self.soc.periph.tick() {
                self.soc.advance(0);
            }
            ticked = false;
            self.soc.periph.in_isr = !self.cpu.irq_levels.is_empty();
            if self.soc.periph.any_pending() {
                if let Some((irq, prio)) = self.soc.pending_irq() {
                    if self.cpu.irq_ready(prio) {
                        let handler = self.soc.read32(VEC_BASE + 4 * irq as u32);
                        self.cpu.interrupt(handler, prio);
                    }
                }
            }
            match self.cpu.run_fast(&mut self.soc, n - done) {
                Ok((0, _)) => {
                    if let Err(e) = self.cpu.step(&mut self.soc) {
                        return Err(format!("{e:?} at pc {:#010x}", self.cpu.pc));
                    }
                    done += 1;
                }
                Ok((k, due)) => {
                    done += k;
                    ticked = due;
                }
                Err(e) => return Err(format!("{e:?} at pc {:#010x}", self.cpu.pc)),
            }
        }
        // the next instruction's tick may already have happened: carry it
        self.pending_tick = ticked;
        Ok(())
    }

    /// The reference loop: one instruction per iteration.
    fn run_steps(&mut self, n: u32) -> Result<(), String> {
        for _ in 0..n {
            if self.soc.periph.tick() {
                self.soc.advance(0);
            }
            self.soc.periph.in_isr = !self.cpu.irq_levels.is_empty();
            if self.soc.periph.any_pending() {
                if let Some((irq, prio)) = self.soc.pending_irq() {
                    if self.cpu.irq_ready(prio) {
                        let handler = self.soc.read32(VEC_BASE + 4 * irq as u32);
                        self.cpu.interrupt(handler, prio);
                    }
                }
            }
            if let Some((bpc, after)) = self.watch_call {
                if self.cpu.pc == bpc && self.cpu.regs[2] != 0 && self.soc.periph.ms() >= after && self.watch_hits < 60 {
                    self.watch_hits += 1;
                    println!("led_put(arr {:#x}, id {}, on {}) from {:#010x}", self.cpu.regs[0], self.cpu.regs[1], self.cpu.regs[2], self.cpu.rets);
                }
            }
            let (pc, sk) = (self.cpu.pc, self.soc.periph.skipped);
            if let Err(e) = self.cpu.step(&mut self.soc) {
                return Err(format!("{e:?} at pc {:#010x}", self.cpu.pc));
            }
            if self.skip_log.is_some() && self.soc.periph.skipped != sk {
                *self.skip_log.as_mut().unwrap().entry(pc).or_insert(0) += 1;
            }
        }
        Ok(())
    }
}

/// Ask for a performance core: macOS runs default-QoS background threads on
/// the efficiency cores, which made the emulator ~40% slower than on main.
fn high_priority() {
    #[cfg(target_os = "macos")]
    {
        extern "C" {
            fn pthread_set_qos_class_self_np(qos_class: u32, relative_priority: i32) -> i32;
        }
        const QOS_CLASS_USER_INTERACTIVE: u32 = 0x21;
        unsafe {
            pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE, 0);
        }
    }
}

fn bench(o: &Opts, ms: u64) {
    let mut m = match Machine::new(o) {
        Ok(m) => m,
        Err(e) => return eprintln!("cannot read {}: {e}", o.bin),
    };
    if std::env::var("FM1_BENCH_NOKEYS").is_ok() {
        m.soc.periph.script.clear();
    } else if script_keys(&mut m) {
    } else {
    m.soc.periph.script.push_back((m.soc.periph.cycle_of_ms(800), Action::Key { id: 21, down: true }));
    m.soc.periph.script.push_back((m.soc.periph.cycle_of_ms(900), Action::Key { id: 25, down: true }));
    m.soc.periph.script.push_back((m.soc.periph.cycle_of_ms(1000), Action::Key { id: 28, down: true }));
    }
    m.cpu.profile = std::env::var("FM1_BENCH_ROUTES").is_ok();
    let t = Instant::now();
    let mut insns = 0u64;
    let mut pcs: std::collections::HashMap<u32, u64> = std::collections::HashMap::new();
    let sample = std::env::var("FM1_BENCH_PCS").is_ok();
    while m.soc.periph.ms() < ms {
        if sample && m.soc.periph.ms() > ms / 2 {
            for _ in 0..1000 {
                if let Err(e) = m.run(97) {
                    eprintln!("halt: {e}");
                    break;
                }
                *pcs.entry(m.cpu.pc).or_insert(0) += 1;
            }
            insns += 97_000;
            continue;
        }
        if let Err(e) = m.run(100_000) {
            eprintln!("halt: {e}");
            break;
        }
        insns += 100_000;
    }
    if sample {
        let mut v: Vec<_> = pcs.into_iter().collect();
        v.sort_by(|a, b| b.1.cmp(&a.1));
        let tot: u64 = v.iter().map(|x| x.1).sum();
        for (pc, n) in v.iter().take(25) {
            println!("pc {pc:#010x} {:5.1}%", 100.0 * *n as f64 / tot as f64);
        }
    }
    let wall = t.elapsed().as_secs_f64();
    println!("icache: {} decodes for {} instructions", m.cpu.decodes, insns);
    if let Ok(path) = std::env::var("FM1_BENCH_WAV") {
        let bytes: Vec<u8> = m.soc.periph.audio.iter().flat_map(|s| s.to_le_bytes()).collect();
        let _ = std::fs::write(&path, bytes);
        println!("audio: {} samples -> {path}", m.soc.periph.audio.len());
    }
    if m.cpu.profile {
        let tot: u64 = m.cpu.route_hist.iter().sum();
        println!("slow path: {} of {} instructions ({:.1}%)", tot, insns, 100.0 * tot as f64 / insns as f64);
        for (i, n) in m.cpu.route_hist.iter().enumerate().filter(|(_, n)| **n > 0) {
            println!("route {i:2}: {:5.1}%", 100.0 * *n as f64 / tot as f64);
        }
        let mut v: Vec<_> = m.cpu.slow_hist.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        for (name, n) in v.iter().take(40) {
            println!("slow {name:28} {:5.2}%", 100.0 * **n as f64 / tot as f64);
        }
    }
    let p = &m.soc.periph;
    println!(
        "{} ms emulated at {} MHz in {:.2} s wall: {:.2}x real time, {:.1} M instructions/s, {:.0}% of cycles skipped as idle",
        p.ms(),
        o.mhz,
        wall,
        p.ms() as f64 / 1000.0 / wall,
        insns as f64 / wall / 1e6,
        100.0 * p.skipped as f64 / p.cycles.max(1) as f64
    );
}

// ---------------------------------------------------------------- audio --

struct AudioRing {
    q: Mutex<VecDeque<i16>>,
    /// Set once the firmware has produced sound (silence before that is boot).
    started: AtomicBool,
    underruns: AtomicU64,
}

fn start_audio(ring: Arc<AudioRing>) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let dev = host.default_output_device().ok_or("no audio output device")?;
    let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
    if cfg.sample_format() != cpal::SampleFormat::F32 {
        return Err(format!("output format {:?} not handled (f32 only)", cfg.sample_format()));
    }
    let channels = cfg.channels() as usize;
    let rate = cfg.sample_rate().0 as f64;
    let step = 44_100.0 / rate; // source frames per output frame
    let (mut pos, mut cur, mut next) = (0.0f64, (0.0f32, 0.0f32), (0.0f32, 0.0f32));
    let stream = dev
        .build_output_stream(
            &cfg.config(),
            move |out: &mut [f32], _| {
                let mut q = ring.q.lock().unwrap();
                let mut starved = false;
                for frame in out.chunks_mut(channels) {
                    pos += step;
                    while pos >= 1.0 {
                        pos -= 1.0;
                        cur = next;
                        next = match (q.pop_front(), q.pop_front()) {
                            (Some(l), Some(r)) => (l as f32 / 32768.0, r as f32 / 32768.0),
                            _ => {
                                starved = true;
                                (0.0, 0.0)
                            }
                        };
                    }
                    let f = pos as f32;
                    let (l, r) = (cur.0 + (next.0 - cur.0) * f, cur.1 + (next.1 - cur.1) * f);
                    for (c, s) in frame.iter_mut().enumerate() {
                        *s = if c % 2 == 0 { l } else { r };
                    }
                }
                if starved && ring.started.load(Ordering::Relaxed) {
                    ring.underruns.fetch_add(1, Ordering::Relaxed);
                }
            },
            |e| eprintln!("audio: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

/// Headless panel picture: C4-E4-G4 held from 0.8 s, PLAY pressed at 1.2 s,
/// the panel drawn at `ms` into work/panel.ppm.
/// FM1_BENCH_KEYS=ms:id[,ms:id^,ms:eN:clicks...]: queue key presses (`^`: release) and
/// encoder turns. False when the variable is unset.
fn script_keys(m: &mut Machine) -> bool {
    let Ok(keys) = std::env::var("FM1_BENCH_KEYS") else { return false };
    for k in keys.split(',') {
        if let Some((t, rest)) = k.split_once(':') {
            // `ms:eN:clicks` turns matrix encoder N
            if let Some((e, c)) = rest.strip_prefix('e').and_then(|r| r.split_once(':')) {
                if let (Ok(t), Ok(enc), Ok(clicks)) = (t.trim().parse::<u64>(), e.parse::<u8>(), c.parse::<i32>()) {
                    let at = m.soc.periph.cycle_of_ms(t);
                    m.soc.periph.script.push_back((at, Action::Enc { enc, clicks }));
                }
                continue;
            }
            let id = rest;
            let (id, down) = match id.trim().strip_suffix('^') { Some(i) => (i, false), None => (id.trim(), true) };
            if let (Ok(t), Ok(id)) = (t.trim().parse::<u64>(), id.parse::<u8>()) {
                let at = m.soc.periph.cycle_of_ms(t);
                m.soc.periph.script.push_back((at, Action::Key { id, down }));
            }
        }
    }
    m.soc.periph.script.make_contiguous().sort_by_key(|(c, _)| *c);
    true
}

fn shot(o: &Opts, ms: u64) {
    let mut m = match Machine::new(o) {
        Ok(m) => m,
        Err(e) => return eprintln!("cannot read {}: {e}", o.bin),
    };
    if std::env::var("FM1_NO_SKIP").is_ok() {
        m.soc.periph.skip_idle = false;
    }
    let scripted = script_keys(&mut m);
    let held: &[u8] = if scripted { &[] } else { &[21u8, 25, 28] };
    let key_at: u64 = std::env::var("FM1_KEY_AT").ok().and_then(|v| v.parse().ok()).unwrap_or(800);
    let key_up: Option<u64> = std::env::var("FM1_KEY_UP").ok().and_then(|v| v.parse().ok());
    for &id in held {
        let at = m.soc.periph.cycle_of_ms(key_at);
        m.soc.periph.script.push_back((at, Action::Key { id, down: true }));
        if let Some(up) = key_up {
            let at = m.soc.periph.cycle_of_ms(up);
            m.soc.periph.script.push_back((at, Action::Key { id, down: false }));
        }
    }
    m.soc.periph.script.make_contiguous().sort_by_key(|(c, _)| *c);
    if std::env::var("FM1_NO_PLAY").is_err() && !scripted {
        let at = m.soc.periph.cycle_of_ms(1200);
        m.soc.periph.script.push_back((at, Action::Key { id: 12, down: true }));
        let at = m.soc.periph.cycle_of_ms(1350);
        m.soc.periph.script.push_back((at, Action::Key { id: 12, down: false }));
    }
    let skip_from: u64 = std::env::var("FM1_SKIP_FROM").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let want_skip = m.soc.periph.skip_idle;
    m.soc.periph.skip_idle = want_skip && skip_from == 0;
    while m.soc.periph.ms() + 40 < ms {
        if want_skip && m.soc.periph.ms() >= skip_from {
            m.soc.periph.skip_idle = true;
        }
        if let Err(e) = m.run(100_000) {
            return eprintln!("halt: {e}");
        }
    }
    println!("irq levels at the end: {:?}, ie {}, skipped {} cycles", m.cpu.irq_levels, m.cpu.ie, m.soc.periph.skipped);
    let _ = m.soc.periph.led_take();
    let (mut in_isr, mut total) = (0u64, 0u64);
    while m.soc.periph.ms() < ms {
        if let Err(e) = m.run(1) {
            return eprintln!("halt: {e}");
        }
        total += 1;
        if !m.cpu.irq_levels.is_empty() {
            in_isr += 1;
        }
    }
    println!(
        "last 40 ms: {:.0}% of instructions in ISRs = {:.1} M ISR instructions per second (clock {} MHz)",
        100.0 * in_isr as f64 / total.max(1) as f64,
        in_isr as f64 / 0.04 / 1e6,
        m.soc.periph.hz / 1_000_000
    );
    let leds = m.soc.periph.led_take();
    if let Some(log) = &m.skip_log {
        let mut v: Vec<_> = log.iter().collect();
        v.sort_by(|a, b| b.1.cmp(a.1));
        for (pc, n) in v.iter().take(12) {
            println!("skip at {:#010x} x{n}", pc);
        }
    }
    let mut down = [false; 41];
    if key_up.is_none() {
        for &id in held {
            down[id as usize] = true;
        }
    }
    if let Some(a) = std::env::var("FM1_DUMP").ok().and_then(|v| u32::from_str_radix(v.trim_start_matches("0x"), 16).ok()) {
        let w: Vec<String> = (0..4).map(|i| format!("{:08x}", m.soc.read32(a + 4 * i))).collect();
        println!("dump {a:#x}: {}", w.join(" "));
    }
    if let Ok(path) = std::env::var("FM1_DUMPRAM") {
        let bytes: Vec<u8> = (0..RAM_SIZE as u32 / 4).flat_map(|i| m.soc.read32(RAM_BASE + 4 * i).to_le_bytes()).collect();
        let _ = std::fs::write(&path, bytes);
    }
    let fr: Vec<String> = (0..41).filter(|&i| leds[i] > 0.0).map(|i| format!("{i}:{:.3}", leds[i])).collect();
    println!("LED on-fractions: {}", fr.join(" "));
    let st = panel::State {
        lcd: &m.soc.lcd.fb,
        enc_clicks: &[0, 0, 0, 3, -2, 0, 5],
        pot: m.soc.periph.adc_value[4],
        down: &down,
        leds: &leds,
        turning: &[0, 0, 0, 0, 0, 0, 0, 0],
    };
    let mut buf = vec![0u32; W * H];
    panel::draw(&mut buf, &panel::base(), &st);
    let mut ppm = format!("P6\n{W} {H}\n255\n").into_bytes();
    for p in &buf {
        ppm.extend_from_slice(&[(p >> 16) as u8, (p >> 8) as u8, *p as u8]);
    }
    let lit: Vec<usize> = (0..41).filter(|&i| leds[i] > 0.01).collect();
    match std::fs::write("work/panel.ppm", ppm) {
        Ok(()) => {
            let a = &m.soc.periph.audio;
            let tail = &a[a.len().saturating_sub(44_100)..];
            let peak = tail.iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
            println!("work/panel.ppm at {} ms; LEDs lit: {lit:?}; audio peak over the last 0.5 s: {peak}", m.soc.periph.ms())
        }
        Err(e) => eprintln!("work/panel.ppm: {e}"),
    }
}

// ---------------------------------------------------------------- input --

fn piano(k: Key) -> Option<u8> {
    // C4 = note key 7 = matrix id 21
    let semis = match k {
        Key::A => 0, Key::W => 1, Key::S => 2, Key::E => 3, Key::D => 4, Key::F => 5, Key::T => 6,
        Key::G => 7, Key::Y => 8, Key::H => 9, Key::U => 10, Key::J => 11, Key::K => 12, Key::O => 13,
        Key::L => 14, Key::P => 15, Key::Semicolon => 16, Key::Apostrophe => 17,
        _ => return None,
    };
    Some(21 + semis)
}

fn button(k: Key) -> Option<u8> {
    Some(match k {
        Key::Z => 0, Key::X => 1, Key::Space => 12, Key::R => 13,
        Key::Key1 => 2, Key::Key2 => 3, Key::Key3 => 4, Key::Key4 => 5, Key::Key5 => 6,
        Key::Key6 => 7, Key::Key7 => 8, Key::Key8 => 9, Key::Key9 => 10, Key::Key0 => 11,
        _ => return None,
    })
}

/// Pixels of vertical mouse drag per encoder click.
const DRAG_PER_CLICK: f32 = 12.0;

fn main() {
    let Some(o) = parse() else {
        eprintln!("usage: fm1-live [--fw ID | --fw list | --bin work/felucca_xip.bin] [--entry 0x02000120] [--mhz 240] [--bench MS]");
        std::process::exit(2);
    };
    if let Some(ms) = o.shot {
        return shot(&o, ms);
    }
    if let Some(ms) = o.bench {
        if std::env::var("FM1_BENCH_THREAD").is_ok() {
            let o2 = Opts { bin: o.bin.clone(), ..o };
            return std::thread::spawn(move || { high_priority(); bench(&o2, ms) }).join().unwrap();
        }
        return bench(&o, ms);
    }
    let mut m = match Machine::new(&o) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("cannot read {}: {e}", o.bin);
            std::process::exit(1);
        }
    };
    let mut pot = m.soc.periph.adc_value[4];

    let ring = Arc::new(AudioRing { q: Mutex::new(VecDeque::new()), started: AtomicBool::new(false), underruns: AtomicU64::new(0) });
    let _stream = match start_audio(ring.clone()) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("audio off: {e}");
            None
        }
    };
    let lcd = Arc::new(Mutex::new(vec![0u16; 240 * 240]));
    let leds = Arc::new(Mutex::new([0f32; 41]));
    let status = Arc::new(Mutex::new(String::from("booting")));
    let quit = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<Action>();

    let audio_ok = _stream.is_some();
    let emu = {
        let (ring, lcd, leds, status, quit) = (ring.clone(), lcd.clone(), leds.clone(), status.clone(), quit.clone());
        std::thread::spawn(move || {
            high_priority();
            let start = Instant::now();
            let mut offset_ms = 0.0f64; // wall-clock time given up after falling behind
            let mut last_lcd = Instant::now();
            let mut last_stat = Instant::now();
            let (mut stat_emu, mut stat_wall) = (0u64, Instant::now());
            while !quit.load(Ordering::Relaxed) {
                while let Ok(a) = rx.try_recv() {
                    m.soc.periph.apply(&a);
                }
                let real = start.elapsed().as_secs_f64() * 1000.0 - offset_ms;
                let emu_ms = m.soc.periph.cycles as f64 * 1000.0 / m.soc.periph.hz as f64;
                if real - emu_ms > 250.0 {
                    offset_ms += real - emu_ms - LEAD_MS; // too far behind: resync, do not race
                }
                let buffered = ring.q.lock().unwrap().len() as f64 / 88.2;
                let behind = if audio_ok && m.soc.periph.audio_halves > 0 {
                    buffered < AUDIO_TARGET_MS
                } else {
                    emu_ms < real + LEAD_MS
                };
                if behind {
                    if let Err(e) = m.run(20_000) {
                        *status.lock().unwrap() = format!("halted: {e}");
                        eprintln!("halted: {e}");
                        break;
                    }
                } else {
                    std::thread::sleep(Duration::from_millis(1));
                }
                if !m.soc.periph.audio.is_empty() {
                    let mut q = ring.q.lock().unwrap();
                    q.extend(m.soc.periph.audio.drain(..));
                    ring.started.store(true, Ordering::Relaxed);
                    let cap = 44_100 * 2 / 4; // 250 ms
                    if q.len() > cap {
                        let extra = q.len() - cap;
                        q.drain(..extra);
                    }
                }
                if last_lcd.elapsed() >= Duration::from_millis(16) {
                    lcd.lock().unwrap().copy_from_slice(&m.soc.lcd.fb);
                    *leds.lock().unwrap() = m.soc.periph.led_take();
                    last_lcd = Instant::now();
                }
                if last_stat.elapsed() >= Duration::from_millis(500) {
                    let e = m.soc.periph.ms();
                    let speed = (e - stat_emu) as f64 / stat_wall.elapsed().as_secs_f64() / 1000.0;
                    let buffered = ring.q.lock().unwrap().len() as f64 / 88.2;
                    *status.lock().unwrap() = format!(
                        "{:.2}x real time | {} MHz | audio {:.0} ms buffered, {} underruns",
                        speed, m.soc.periph.hz / 1_000_000, buffered, ring.underruns.load(Ordering::Relaxed)
                    );
                    if e / 2000 != stat_emu / 2000 {
                        eprintln!("[{:5.1} s] {}", e as f64 / 1000.0, status.lock().unwrap());
                    }
                    stat_emu = e;
                    stat_wall = Instant::now();
                    last_stat = Instant::now();
                }
            }
        })
    };

    let mut win = match Window::new(&format!("FM-1 · {} (emulated)", o.name), W, H, WindowOptions::default()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("window: {e}");
            quit.store(true, Ordering::Relaxed);
            let _ = emu.join();
            return;
        }
    };
    win.set_target_fps(60);
    let base = panel::base();
    let mut buf = vec![0u32; W * H];
    let mut down = [false; 41];
    let mut enc_clicks = [0i32; 7];
    let mut turning = [0u32; 8];
    let mut scroll_acc = [0f32; 8];
    let mut shown_leds = [0f32; 41];
    let mut grab: Option<Ctl> = None;
    let mut was_pressed = false;
    let (mut last_y, mut drag_acc) = (0f32, 0f32);
    let mut last_title = Instant::now();
    eprintln!("mouse: click/drag the keys, click buttons, drag or scroll the knobs (MASTER = volume)");
    eprintln!("keys: A W S E D F T G Y H U J K O L P ; ' = C4..F5, Z/X OCT, Space PLAY, R REC, 1..0 buttons, arrows and , . for SELECT/PRESETS/ALGORITHM; Esc quits");

    while win.is_open() && !win.is_key_down(Key::Escape) {
        let turn = |i: usize, clicks: i32, enc_clicks: &mut [i32; 7], turning: &mut [u32; 8]| {
            enc_clicks[i] += clicks;
            turning[i] = 10;
            let _ = tx.send(Action::Enc { enc: ENCS[i].1, clicks });
        };

        // ---- mouse
        let pos = win.get_mouse_pos(MouseMode::Clamp);
        let pressed = win.get_mouse_down(MouseButton::Left);
        if let Some((mx, my)) = pos {
            if pressed && !was_pressed {
                grab = panel::hit(mx, my);
                last_y = my;
                drag_acc = 0.0;
            } else if pressed {
                match grab {
                    // glissando: the held note follows the pointer across keys
                    Some(Ctl::Key(_)) => {
                        if let Some(Ctl::Key(k)) = panel::hit(mx, my) {
                            grab = Some(Ctl::Key(k));
                        }
                    }
                    Some(Ctl::Enc(i)) => {
                        drag_acc += last_y - my;
                        while drag_acc >= DRAG_PER_CLICK {
                            drag_acc -= DRAG_PER_CLICK;
                            turn(i, 1, &mut enc_clicks, &mut turning);
                        }
                        while drag_acc <= -DRAG_PER_CLICK {
                            drag_acc += DRAG_PER_CLICK;
                            turn(i, -1, &mut enc_clicks, &mut turning);
                        }
                    }
                    Some(Ctl::Pot) => {
                        let v = (pot as f32 + (last_y - my) * 4.0).clamp(0.0, 1023.0) as u16;
                        if v != pot {
                            pot = v;
                            turning[7] = 10;
                            let _ = tx.send(Action::Adc { ch: 4, value: pot });
                        }
                    }
                    _ => {}
                }
                last_y = my;
            }
            if let Some((_, dy)) = win.get_scroll_wheel() {
                match panel::hit(mx, my) {
                    Some(Ctl::Enc(i)) => {
                        scroll_acc[i] += dy;
                        while scroll_acc[i] >= 1.0 {
                            scroll_acc[i] -= 1.0;
                            turn(i, 1, &mut enc_clicks, &mut turning);
                        }
                        while scroll_acc[i] <= -1.0 {
                            scroll_acc[i] += 1.0;
                            turn(i, -1, &mut enc_clicks, &mut turning);
                        }
                    }
                    Some(Ctl::Pot) => {
                        pot = (pot as f32 + dy * 24.0).clamp(0.0, 1023.0) as u16;
                        turning[7] = 10;
                        let _ = tx.send(Action::Adc { ch: 4, value: pot });
                    }
                    _ => {}
                }
            }
        }
        if !pressed {
            grab = None;
        }
        was_pressed = pressed;

        // ---- held keys and buttons: computer keyboard + mouse
        let mut want = [false; 41];
        for k in win.get_keys() {
            if let Some(id) = piano(k).or_else(|| button(k)) {
                want[id as usize] = true;
            }
        }
        if let Some(Ctl::Key(id) | Ctl::Btn(id)) = grab {
            want[id as usize] = true;
        }
        for id in 0..41 {
            if want[id] != down[id] {
                down[id] = want[id];
                let _ = tx.send(Action::Key { id: id as u8, down: want[id] });
            }
        }
        for k in win.get_keys_pressed(KeyRepeat::Yes) {
            match k {
                Key::Left => turn(0, -1, &mut enc_clicks, &mut turning),
                Key::Right => turn(0, 1, &mut enc_clicks, &mut turning),
                Key::Down => turn(1, -1, &mut enc_clicks, &mut turning),
                Key::Up => turn(1, 1, &mut enc_clicks, &mut turning),
                Key::Comma => turn(2, -1, &mut enc_clicks, &mut turning),
                Key::Period => turn(2, 1, &mut enc_clicks, &mut turning),
                _ => {}
            }
        }
        for t in turning.iter_mut() {
            *t = t.saturating_sub(1);
        }

        // ---- draw: LEDs fade out over a few frames instead of flickering
        {
            let l = leds.lock().unwrap();
            for i in 0..41 {
                shown_leds[i] = l[i].max(shown_leds[i] * 0.8);
            }
        }
        {
            let fb = lcd.lock().unwrap();
            let st = panel::State { lcd: &fb, enc_clicks: &enc_clicks, pot, down: &down, leds: &shown_leds, turning: &turning };
            panel::draw(&mut buf, &base, &st);
        }
        if win.update_with_buffer(&buf, W, H).is_err() {
            break;
        }
        if last_title.elapsed() >= Duration::from_millis(500) {
            win.set_title(&format!("FM-1 · {} — {}", o.name, status.lock().unwrap()));
            last_title = Instant::now();
        }
    }
    quit.store(true, Ordering::Relaxed);
    let _ = emu.join();
}
