//! fm1-emu: run an FM-1 firmware image in the emulated SoC.
//!
//! Usage:
//!   fm1-emu --bin app.bin [--flash decrypted.bin] [--entry 0x02000000] [--steps N] [--trace K] [--quiet]
//!
//! Loads the image at the XIP base (0x02000000), boots from `--entry` and
//! reports: instructions retired, per-class histogram, unknown-class halts
//! and the unknown-MMIO bring-up list.

use std::collections::HashMap;
use std::process::ExitCode;

use fm1_core::{Bus, CoreError, Cpu};
use fm1_soc::{Soc, XIP_BASE, RAM_BASE};

const DEFAULT_RAM: usize = 1 * 1024 * 1024;
const DEFAULT_STEPS: u64 = 5_000_000;

/// Flash offset of `app.bin` inside the JLFS app area (FM-1-RE: XIP address
/// = flash offset - 0x4120 + 0x02000000). `--flash` maps the whole decrypted
/// flash image so reads past the end of app.bin (the `.data` tail, cfg
/// files) see what the hardware sees.
const APP_FLASH_OFFSET: usize = 0x4120;

struct Args {
    bin: String,
    flash: Option<String>,
    entry: u32,
    steps: u64,
    trace: Option<u64>,
    quiet: bool,
    ram: usize,
    /// print every change of this RAM word (pc, old -> new)
    watch: Option<u32>,
}

fn main() -> ExitCode {
    if std::env::args().any(|a| a == "--coverage") {
        return coverage_report();
    }
    let args = match parse_args() {
        Some(a) => a,
        None => {
            eprintln!(
                "usage: fm1-emu --bin <app.bin> [--flash decrypted.bin] [--entry 0x02000000] \
                 [--steps N] [--trace K] [--ram bytes] [--quiet]"
            );
            return ExitCode::from(2);
        }
    };

    let mut image = match std::fs::read(&args.bin) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("error: cannot read {}: {e}", args.bin);
            return ExitCode::FAILURE;
        }
    };
    if let Some(flash) = &args.flash {
        match std::fs::read(flash) {
            Ok(f) if f.len() > APP_FLASH_OFFSET && f[APP_FLASH_OFFSET..].starts_with(&image) => {
                image = f[APP_FLASH_OFFSET..].to_vec();
            }
            Ok(_) => {
                eprintln!("error: {flash} does not contain {} at {APP_FLASH_OFFSET:#x}", args.bin);
                return ExitCode::FAILURE;
            }
            Err(e) => {
                eprintln!("error: cannot read {flash}: {e}");
                return ExitCode::FAILURE;
            }
        }
    }
    // pad the XIP window so sparse reads-return-0 behaviour is explicit
    image.resize(image.len().max(1) , 0);

    let mut soc = Soc::new(args.ram, image);
    let mut cpu = Cpu::new(args.entry);
    // The SPL enters the app with r0 -> its boot-parameter struct, whose
    // first word points at a chip-info block (boot_hwinfo_save at
    // 0x020000C6 copies both into 0x01C7FD50). Hand the CRT an all-zero
    // pair at the top of RAM so those reads stay inside memory.
    let params = RAM_BASE + 0x7fc00;
    soc.write32(params, params + 0x40);
    cpu.regs[0] = params;
    // cpu1 (core id 1) is held until cpu0 releases it with `0x10008 |= 8`
    // in cpu1_boot_start; it then boots from the vector at 0x02000098.
    let mut cpus: Vec<Cpu> = vec![cpu];
    let mut cpu1_started = false;
    let mut report_core = 0usize;

    if !args.quiet {
        println!(
            "fm1-emu: {} bytes at {XIP_BASE:#010x}, entry {:#010x}, ram {} bytes at {RAM_BASE:#010x}",
            soc.xip.len(),
            args.entry,
            soc.ram.len(),
        );
    }

    let mut hist: HashMap<&'static str, u64> = HashMap::new();
    let mut pchist: HashMap<u32, u64> = HashMap::new();
    let mut halt: Option<CoreError> = None;
    let mut nop_run = 0u32;
    let mut watch_val = args.watch.map(|a| soc.read32(a));
    let mut last_pc = cpus[0].pc;
    let mut total_steps: u64 = 0;
    let mut ring: Vec<u32> = Vec::new();
    // last executed instructions (pc, class, sp) for the halt report
    let mut tail: std::collections::VecDeque<(u32, &'static str, u32)> = std::collections::VecDeque::new();

    let dump_every: u64 = 1 << 20;
    let mut stop = false;
    for _ in 0..args.steps {
        if !cpu1_started && soc.read32(0x10008) & 8 != 0 {
            // Where cpu1 really starts is not settled (docs/isa-notes.md):
            // the vector at 0x02000098 `rti`s into the middle of an
            // instruction of cpu_ipc_call_sync. The routine that
            // acknowledges the boot (b[0x01C1FF08] = 1) is the RAM function
            // at 0x01C022B6 (flash 0x02086AD6), so enter there with the
            // stacks the vector would have set.
            let mut c1 = Cpu::new(RAM_BASE + 0x22b6);
            c1.core_id = 1;
            c1.usp = RAM_BASE + 0x15eb4;
            c1.sp = RAM_BASE + 0x16eb4;
            cpus.push(c1);
            cpu1_started = true;
            if !args.quiet {
                println!("cpu1 released at step {total_steps} (0x10008 bit 3 set)");
            }
        }
        for ci in 0..cpus.len() {
            let cpu = &mut cpus[ci];
            total_steps += 1;
            if total_steps > 0 && total_steps % dump_every == 0 {
                let _ = fm1_soc::write_bmp("work/lcd.bmp", &soc.lcd.fb, soc.lcd.inverted);
            }
            last_pc = cpu.pc;
            let tail_name = soc_instruction_name(&soc, &cpu, last_pc).unwrap_or("?");
            if tail.len() >= 80 {
                tail.pop_front();
            }
            tail.push_back((last_pc, tail_name, cpu.sp));
            // a run of literal-zero `nop`s means we fell into empty RAM
            if tail_name == "nop" { nop_run += 1 } else { nop_run = 0 }
            if nop_run > 24 {
                halt = Some(CoreError::Decode(fm1_isa::DecodeError::UnknownInstruction { raw: 0, addr: last_pc }));
                println!("halt: nop slide (>24 consecutive nops) at {last_pc:#010x}");
                report_core = ci;
                stop = true;
                break;
            }
            match cpu.step(&mut soc) {
                Ok(()) => {
                    if let (Some(a), Some(old)) = (args.watch, watch_val) {
                        let now = soc.read32(a);
                        if now != old {
                            println!("watch {a:#010x}: {old:#010x} -> {now:#010x} at pc={last_pc:#010x} [{}]", cpu.insn_count);
                            watch_val = Some(now);
                        }
                    }
                    if let Some(e) = soc_instruction_name(&soc, &cpu, last_pc) {
                        *hist.entry(e).or_insert(0) += 1;
                    }
                    *pchist.entry(last_pc).or_insert(0) += 1;
                    ring.push(last_pc);
                    if ring.len() > 12 {
                        ring.remove(0);
                    }
                    if let Some(k) = args.trace {
                        if cpu.insn_count <= k && !args.quiet {
                            println!(
                                "[{count:8}] pc={pc:#010x} sp={sp:#010x} insn={insn} r0={r0:#010x}",
                                count = cpu.insn_count,
                                pc = last_pc,
                                sp = cpu.sp,
                                insn = soc_instruction_name(&soc, &cpu, last_pc)
                                    .unwrap_or("?"),
                                r0 = cpu.regs[0],
                            );
                        }
                    }
                }
                Err(e) => {
                    halt = Some(e);
                    report_core = ci;
                    stop = true;
                    report_core = ci;
                stop = true;
                break;
                }
            }
        }
        if stop {
            break;
        }
    }
    let cpu = &cpus[report_core];

    if !args.quiet {
        let stopped = halt.is_some() || true;
        let mut top: Vec<(&'static str, u64)> = hist.into_iter().collect();
        top.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        let total: u64 = top.iter().map(|(_, c)| c).sum();
        println!(
            "stopped after {} instructions ({}, hist top-{} of {} classes):",
            cpu.insn_count,
            if halt.is_some() { "halt" } else { "step limit" },
            top.len().min(12),
            top.len().min(1) * 0 + top.len().max(1),
        );
        for (name, n) in top.iter().take(12) {
            println!("  {name:<28} {n:8} ({:5.1}%)", 100.0 * *n as f64 / total as f64);
        }
        if total > 0 {
            let _ = total;
        }
        let mut pcs: Vec<(u32, u64)> = pchist.into_iter().collect();
        pcs.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        println!("last executed pcs:");
        for (i, pc) in ring.iter().enumerate() {
            print!("{}{pc:#x}", if i == 0 { "" } else { " -> " });
        }
        println!();
        println!("pc histogram top-8:");
        for (pc, n) in pcs.iter().take(8) {
            println!("  {pc:#010x}  {n}");
        }
        {
            let _ = fm1_soc::write_bmp("work/lcd.bmp", &soc.lcd.fb, soc.lcd.inverted);
            let con = soc.console_string();
            if !con.is_empty() {
                println!("console ({} bytes):", con.len());
                for line in con.lines().take(20) {
                    println!("  | {line}");
                }
            }
            println!(
                "lcd frames={} inverted={} display_on={}",
                soc.lcd.frames, soc.lcd.inverted, soc.lcd.display_on,
            );
        }
        if let Some(e) = &halt {
            println!("last instructions before the halt:");
            for (pc, name, sp) in &tail {
                println!("  {pc:#010x} sp={sp:#010x} {name}");
            }
            println!("halt reason: {e:?}");
            println!("  pc={:#010x} sp={:#010x} rets={:#010x}", cpu.pc, cpu.sp, cpu.rets);
            for (i, r) in cpu.regs.iter().enumerate() {
                print!("r{i}={r:#010x} ");
            }
            println!();
        }
        let mmio = soc.unknown_accesses();
        if !mmio.is_empty() {
            // one line per (address, direction), in first-hit order
            let mut seen: Vec<(u32, bool, u32, u64)> = Vec::new();
            for a in mmio {
                match seen.iter_mut().find(|s| s.0 == a.addr && s.1 == a.is_write) {
                    Some(s) => s.3 += 1,
                    None => seen.push((a.addr, a.is_write, a.value, 1)),
                }
            }
            println!(
                "{} unknown MMIO accesses at {} addresses (bring-up list, first 24):",
                mmio.len(),
                seen.len()
            );
            for (addr, is_write, value, n) in seen.iter().take(24) {
                let op = if *is_write { "write" } else { "read " };
                println!("  {op} @ {addr:#010x} first value={value:#010x} x{n}");
            }
        }
        let _ = stopped;
    }
    ExitCode::SUCCESS
}

/// The SoC doesn't track names; recover the executed class name by decoding
/// at the PC the step started from (cheap; runs once per step only under
/// tracing).
fn soc_instruction_name(_soc: &Soc, cpu: &Cpu, pc: u32) -> Option<&'static str> {
    if let Ok(win) = fetch_window(_soc, pc) {
        if let Ok(insn) = fm1_isa::decode_win(win, pc) {
            let _ = cpu;
            return Some(insn.entry.name);
        }
    }
    None
}

fn fetch_window(soc: &Soc, pc: u32) -> Result<u64, ()> {
    if pc >= XIP_BASE && (pc - XIP_BASE) + 6 <= soc.xip.len() as u32 {
        let o = (pc - XIP_BASE) as usize;
        let b = &soc.xip[o..o + 6];
        let mut w = 0u64;
        for (i, byte) in b.iter().enumerate() {
            w |= (*byte as u64) << (8 * i);
        }
        return Ok(w);
    }
    // RAM code (copied by the firmware itself) decodes too
    if pc >= RAM_BASE && (pc - RAM_BASE) + 6 <= soc.ram.len() as u32 {
        let mut w = 0u64;
        for i in 0..6u32 {
            w |= (soc.ram.read8(pc - RAM_BASE + i) as u64) << (8 * i);
        }
        return Ok(w);
    }
    Err(())
}

/// `--coverage`: execute the first corpus sample of every ISA class on a
/// scratch SoC and report the classes whose semantics are missing, grouped
/// by printed shape and weighted by corpus count. The to-do list for the
/// core, in priority order.
fn coverage_report() -> ExitCode {
    use std::collections::BTreeMap;
    let mut unsupported: BTreeMap<&'static str, (u64, Vec<&'static str>)> = BTreeMap::new();
    let mut no_slots: BTreeMap<&'static str, (u64, Vec<&'static str>)> = BTreeMap::new();
    let (mut ok_n, mut ok_w, mut total_w) = (0u64, 0u64, 0u64);
    for e in fm1_isa::ISA.iter() {
        total_w += e.count as u64;
        let Some(&sample) = e.samples.first() else { continue };
        let mut image = sample.to_le_bytes().to_vec();
        image.resize(64, 0);
        let mut soc = Soc::new(64 * 1024, image);
        let mut cpu = Cpu::new(XIP_BASE);
        cpu.sp = RAM_BASE + 0x8000;
        for r in cpu.regs.iter_mut() {
            *r = RAM_BASE + 0x1000;
        }
        match cpu.step(&mut soc) {
            Ok(()) => {
                ok_n += 1;
                ok_w += e.count as u64;
            }
            Err(CoreError::Unsupported { .. }) | Err(CoreError::MissingSlot { .. }) => {
                let bucket = if e.slots.is_empty() { &mut no_slots } else { &mut unsupported };
                let ent = bucket.entry(e.syntax).or_insert((0, Vec::new()));
                ent.0 += e.count as u64;
                ent.1.push(e.name);
            }
            Err(_) => {}
        }
    }
    println!(
        "{ok_n} classes execute ({:.1}% of corpus instructions by weight)",
        100.0 * ok_w as f64 / total_w.max(1) as f64
    );
    for (title, map) in [("no semantics for the shape (slots solved)", &unsupported), ("operand slots unsolved", &no_slots)] {
        let mut rows: Vec<_> = map.iter().collect();
        rows.sort_by_key(|(_, (w, _))| std::cmp::Reverse(*w));
        let w: u64 = rows.iter().map(|(_, (w, _))| w).sum();
        println!("-- {title}: {} shapes, {:.1}% of corpus", rows.len(), 100.0 * w as f64 / total_w.max(1) as f64);
        for (syntax, (w, names)) in rows.iter().take(60) {
            println!("  {w:6}  {syntax:<40} {}", names.join(" "));
        }
    }
    ExitCode::SUCCESS
}

fn parse_args() -> Option<Args> {
    let a: Vec<String> = std::env::args().collect();
    let mut i = 1;
    let mut args = Args {
        bin: String::new(),
        flash: None,
        entry: XIP_BASE, // reset vector; the CRT sets sp/ssp and copies .data
        steps: DEFAULT_STEPS,
        trace: None,
        quiet: false,
        ram: DEFAULT_RAM,
        watch: None,
    };
    let mut have_bin = false;
    while i < a.len() {
        match a[i].as_str() {
            "--bin" => {
                args.bin = a.get(i + 1)?.clone();
                have_bin = true;
                i += 2;
            }
            "--entry" => {
                args.entry = parse_hex(a.get(i + 1)?)?;
                i += 2;
            }
            "--flash" => {
                args.flash = Some(a.get(i + 1)?.clone());
                i += 2;
            }
            "--steps" => {
                args.steps = a.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "--trace" => {
                args.trace = Some(a.get(i + 1)?.parse::<u64>().ok()?);
                i += 2;
            }
            "--ram" => {
                args.ram = a.get(i + 1)?.parse().ok()?;
                i += 2;
            }
            "--watch" => {
                args.watch = Some(parse_hex(a.get(i + 1)?)?);
                i += 2;
            }
            "--quiet" => {
                args.quiet = true;
                i += 1;
            }
            _ => return None,
        }
    }
    if have_bin {
        Some(args)
    } else {
        None
    }
}

fn parse_hex(s: &str) -> Option<u32> {
    u32::from_str_radix(s.trim_start_matches("0x"), 16).ok()
}
