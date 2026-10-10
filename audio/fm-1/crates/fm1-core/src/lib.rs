//! FM-1 CPU core: an interpreting fetch/decode/execute loop.
//!
//! The core never touches peripherals directly — every memory access goes
//! through [`Bus`], so the SoC layer owns the memory map (PLAN.md Phase 3).
//!
//! Semantics model (verified against the V13/V14/uboot/ota corpora, see
//! docs/isa-notes.md):
//! - push `[--sp] = {rets, rN..rB}`: `--sp` then store, iterating the list
//!   in printed order (first item ends up at the highest address);
//! - pop `{pc, rN..rB} = [sp++]`: read ascending, assign the printed list
//!   in REVERSE (last-listed reg gets the lowest slot, pc the highest);
//!   pc (the rets slot, highest) is read last and jumps;
//! - branch/call offsets are byte offsets from pc_next (Rel slots multiplied
//!   by the solver-found factor).

use fm1_isa::{DecodeError, Instruction, SlotKind};

/// The memory bus. Implemented by the SoC (or by plain RAM in unit tests).
///
/// Width-specific accessors keep MMIO side effects honest: a byte read must
/// not silently widen into a word read of a peripheral register.
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
mod jit;
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
mod jit_a64;
#[cfg(all(target_arch = "aarch64", target_os = "macos"))]
pub use jit::JitMem;
/// (no JIT on this host: the type exists so buses compile everywhere)
#[cfg(not(all(target_arch = "aarch64", target_os = "macos")))]
#[derive(Clone, Copy, Debug)]
pub struct JitMem {
    pub ram: *mut u8,
    pub ram_base: u32,
    pub ram_len: u32,
    pub xip: *const u8,
    pub xip_base: u32,
    pub xip_len: u32,
}

pub trait Bus {
    fn read8(&mut self, addr: u32) -> u8;
    fn read16(&mut self, addr: u32) -> u16;
    fn read32(&mut self, addr: u32) -> u32;
    fn write8(&mut self, addr: u32, value: u8);
    fn write16(&mut self, addr: u32, value: u16);
    fn write32(&mut self, addr: u32, value: u32);
    /// One clock cycle passed (one instruction). True when something timed
    /// is due, or a peripheral was touched, so the caller must service the
    /// SoC before the next instruction. Buses without a clock never are.
    #[inline(always)]
    fn tick(&mut self) -> bool {
        false
    }
    /// Is any interrupt source pending (before enables and priorities)?
    #[inline(always)]
    fn irq_pending(&self) -> bool {
        false
    }
    /// Host pointers for the JIT's inline memory paths (None: no JIT on this bus).
    fn jit_mem(&mut self) -> Option<JitMem> {
        None
    }
    /// Ticks that can pass before one of them is due.
    fn tick_room(&self) -> u64 {
        0
    }
    /// Let ticks pass that `tick_room` allowed.
    fn add_ticks(&mut self, _n: u64) {}
    /// Would the next tick be due?
    fn next_tick_due(&self) -> bool {
        true
    }
}

/// CPU architectural state.
#[derive(Debug, Default)]
pub struct Cpu {
    /// Core number reported by `cnum` (the AC791N is dual-core; cpu1 boots
    /// from the vector at 0x02000098 once cpu0 releases it).
    pub core_id: u32,
    pub pc: u32,
    pub regs: [u32; 16],
    pub sp: u32,
    pub ssp: u32,
    pub usp: u32,
    pub rets: u32,
    /// Total instructions retired (for traces and tests).
    pub insn_count: u64,
    /// Hardware repeat block `rep N rR { … }` / `rep N #k { … }`: the block
    /// is the N bytes after the rep instruction; when execution falls off
    /// its end the counter is decremented and, if non-zero, pc returns to
    /// the block start. `rep_end == 0` means no rep is active.
    pub rep_start: u32,
    pub rep_end: u32,
    /// Counter register (`rep N rR`, decremented in place) or `None` for
    /// the immediate-count form, which counts in `rep_count`.
    pub rep_reg: Option<usize>,
    pub rep_count: u32,
    /// Predicated `if {} else {}` blocks whose then-part is executing:
    /// (then_end, else_end) — reaching then_end jumps over the else-part.
    pub pred_skips: Vec<(u32, u32)>,
    /// Condition flag set by `testset` (see its arm for the assumed sense).
    pub cc: bool,
    /// Plain-storage special registers: icfg, reti, retx, rete, sspn, psr.
    pub sreg_store: [u32; 7],
    /// Dual-issue pair in flight: an instruction printed with a trailing `#`
    /// executes together with the next one, which still sees the old
    /// register values (`r5 = r3 #; b[r4+6] = r5` stores the old r5). The
    /// first instruction's register results are held here and committed
    /// after the second has run, unless the second wrote the same register.
    pub pair_pending: Option<([u32; 16], [u32; 16])>,
    /// Name of the last class with no semantics (halt reason).
    pub stuck_on: Option<&'static str>,
    /// `R = #h` rows not found in the observed-encoding table.
    pub unknown_const_count: u64,
    /// Decoded-instruction cache (see `fetch`): compact lines for the hot
    /// path, the full decode beside them.
    pub icache: Vec<Line>,
    pub icache_x: Vec<Option<LineX>>,
    /// Compile hot blocks to native code (AArch64 macOS hosts).
    pub jit_on: bool,
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    jit: Option<Box<jit::Jit>>,
    /// Straight-line blocks of micro-ops over XIP code (see `block_at`):
    /// the ops of every block back to back, the blocks, and a direct-mapped
    /// pc -> block+1 table (0 = none).
    bops: Vec<BOp>,
    blocks: Vec<(u32, u32, u32)>,
    bmap: Vec<u32>,
    /// Instructions per execute route (index 31 = the micro-op fast path),
    /// and per class name on the slow path — for tuning the dispatcher.
    pub route_hist: [u64; 32],
    pub slow_hist: std::collections::HashMap<&'static str, u64>,
    pub profile: bool,
    /// Instruction-cache misses (decodes) since reset.
    pub decodes: u64,
    /// Canonical syntax of the instruction executing (from its cache line).
    pub cur_syntax: &'static str,
    /// Global interrupt enable (`sti` / `cli`); `icfg` bit 8 is the second
    /// gate (the firmware's "master enable").
    pub ie: bool,
    /// Priorities of the ISRs in progress, innermost last: a source only
    /// interrupts a lower priority (Felucca nests TIMER5 at 4 into ALNK0
    /// at 3). `rti` pops.
    pub irq_levels: Vec<u8>,
    /// Nesting is open only while the running ISR has `reti` saved on the
    /// stack (Blackfin rule: pushing RETI enables nested interrupts, popping
    /// it disables them). Without this, a tick landing between an ISR's
    /// `{.., reti} = [sp++]` and its `rti` overwrote reti and the `rti`
    /// returned to itself forever.
    pub nest_ok: bool,
}

impl Cpu {
    pub fn new(entry: u32) -> Self {
        Self {
            pc: entry,
            ..Default::default()
        }
    }

    /// Would an interrupt of priority `prio` be taken now? Only between
    /// whole constructs: not inside a rep block, a predicated `if {}` or a
    /// dual-issue pair, whose state lives in the core rather than on the
    /// stack.
    pub fn irq_ready(&self, prio: u8) -> bool {
        self.ie
            && self.sreg_store[0] & 0x100 != 0
            && self.rep_end == 0
            && self.pred_skips.is_empty()
            && self.pair_pending.is_none()
            && self.irq_levels.last().map_or(true, |&l| prio > l && self.nest_ok)
    }

    /// Enter an interrupt handler: `reti` = the interrupted pc (the ISR
    /// wrapper saves `{psr, rets, reti}` itself and returns with `rti`).
    pub fn interrupt(&mut self, handler: u32, prio: u8) {
        self.sreg_store[1] = self.pc;
        self.irq_levels.push(prio);
        self.nest_ok = false;
        self.pc = handler;
    }

    /// The decoded instruction at pc, through a direct-mapped cache. Code in
    /// the XIP window cannot change, so a hit there skips even the fetch;
    /// elsewhere (RAM code) the fetched window must match the cached one.
    #[inline(never)]
    fn fetch<B: Bus>(&mut self, bus: &mut B) -> Result<usize, CoreError> {
        self.fetch_at(bus, self.pc)
    }

    fn fetch_at<B: Bus>(&mut self, bus: &mut B, pc: u32) -> Result<usize, CoreError> {
        // 256K lines cover 512 KiB of code without aliasing (Felucca's
        // image is 441 KiB; 64K lines re-decoded ~1M times per 6 s)
        const BITS: u32 = 18;
        if self.icache.is_empty() {
            self.icache = vec![Line::EMPTY; 1 << BITS];
            self.icache_x = vec![None; 1 << BITS];
        }
        let slot = ((pc >> 1) & ((1 << BITS) - 1)) as usize;
        let hit = self.icache[slot].pc == pc;
        if hit && (0x0200_0000..0x0400_0000).contains(&pc) {
            return Ok(slot);
        }
        let lo = bus.read32(pc) as u64;
        let hi = bus.read32(pc + 4) as u64;
        let win = (hi << 32) | lo;
        if hit && self.icache_x[slot].map_or(false, |x| x.win == win) {
            return Ok(slot);
        }
        self.decodes += 1;
        let insn = match fm1_isa::decode_win_cached(win, pc) {
            Ok(i) => i,
            // 64-bit pair ops the corpora never showed (e.g. `r3_r2 >>>= 39`)
            // share one raw layout; decode them without a table class
            Err(_) if matches!((win >> 8) & 0xff, 0xe1 | 0xf1) && matches!(win & 0xff, 0xd0 | 0xd8 | 0xf8 | 0xf6) => {
                fm1_isa::Instruction { addr: pc, raw: win, entry: &PAIR_OP_RAW }
            }
            Err(e) => return Err(CoreError::Decode(e)),
        };
        let alu4 = if insn.entry.len == 4 { decode_alu4(insn.raw) } else { None };
        let bittest = if insn.entry.name.starts_with("if") { decode_bittest(insn.raw, insn.entry.len) } else { None };
        let route = route_of(&insn, &alu4, &bittest);
        let syntax = canon_syntax(insn.entry);
        let mut fast = if route == ROUTE_SYNTAX { fast_of(&insn, syntax) } else { fast_raw(route, &insn, &alu4, &bittest) };
        if route == 14 && (0x0200_0000..0x0400_0000).contains(&pc) {
            if let Some(blk) = decode_if_block(insn.raw) {
                let next_pc = pc + insn.entry.len as u32;
                let then_end = self.block_end(bus, next_pc, blk.then_units);
                let else_end = self.block_end(bus, then_end, blk.else_units);
                let (rk, rv) = rhs_kind(blk.rhs);
                let (td, ed) = (then_end.wrapping_sub(next_pc), else_end.wrapping_sub(then_end));
                if td <= 0xffff && ed <= 0xffff {
                    fast = Some(Fast::IfBlk {
                        a: blk.reg as u8, rk, fam: blk.fam as u8, alt: blk.alt,
                        has_else: blk.else_units > 0, rv, then_d: td as u16, else_d: ed as u16,
                    });
                }
            }
        }
        let pair_head = insn.entry.syntax.trim_end().ends_with('#');
        let pre = Pre { route, fast, alu4, bittest, pair_head, syntax };
        let fast = fast.map(Fast::specialise);
        // (a predicated block without an else part is a conditional jump: no careful path)
        let careful = pair_head || matches!(fast, Some(Fast::IfBlk { has_else: true, .. }));
        self.icache[slot] = Line { pc, len: insn.entry.len, pair_head, careful, fast };
        self.icache_x[slot] = Some(LineX { win, entry: insn.entry, pre });
        Ok(slot)
    }

    /// Run micro-ops back to back: the first instruction has been paid for
    /// by the caller's clock tick, every following one ticks the bus here.
    /// Stops before an instruction that needs `step` (slow path, dual-issue
    /// pair, predicated block, rep loop), after `budget` instructions, or
    /// when the bus reports something due — then the tick for the next
    /// instruction has already happened and `due` is true. Interrupt
    /// readiness can only change at those points, so the caller's per-
    /// instruction interrupt check is exact at block granularity.
    ///
    /// Returns (instructions executed, due). 0 = the instruction at pc
    /// needs `step`.
    #[inline]
    pub fn run_fast<B: Bus>(&mut self, bus: &mut B, budget: u32) -> Result<(u32, bool), CoreError> {
        if trace_on() {
            return Ok((0, false));
        }
        let mut n = 0u32;
        // pair / predicated block / rep loop in progress: every instruction
        // then takes the careful path (it can end one and free interrupts)
        let mut careful = self.pair_pending.is_some() || !self.pred_skips.is_empty() || self.rep_end != 0;
        // pc and the retired count live in locals on the plain path; they
        // are written back before anything that reads them (`synced`: the
        // part of n already added to insn_count)
        let mut pc = self.pc;
        let mut synced = 0u32;
        let jit_mem = if self.jit_on { bus.jit_mem() } else { None };
        macro_rules! sync {
            () => {{
                self.pc = pc;
                self.insn_count += (n - synced) as u64;
                synced = n;
            }};
        }
        loop {
            // the budget is checked per block (a block is at most 32 ops)
            if n >= budget {
                sync!();
                return Ok((n, false));
            }
            let blk = match self.block_at(bus, pc) {
                Ok(b) => b,
                Err(e) => {
                    sync!();
                    return Err(e);
                }
            };
            let Some((id, start, len)) = blk else {
                sync!();
                return Ok((n, false));
            };
            #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
            if self.jit_on && !careful {
                if let Some(mem) = jit_mem {
                    if self.jit.is_none() {
                        self.jit = jit::Jit::new().map(Box::new);
                    }
                    let code = match self.jit.as_mut() {
                        Some(j) => j.entry::<B>(id, &self.bops[start as usize..(start + len) as usize], pc, &mem),
                        None => None,
                    };
                    if let Some((code, _)) = code {
                        // (the code checks itself that its ticks fall before anything is due)
                        let extra = if n == 0 { 0 } else { 1 };
                        sync!();
                        // SAFETY: code was compiled for this bus type and memory map
                        let (k, slot) = unsafe { jit::run(code, self, bus, &mem, extra) };
                        if k > 0 {
                            n += k;
                            pc = self.pc;
                            if !slot.is_null() {
                                // a chainable exit came back: link it once its target is compiled
                                if let Some(body) = self.jit_body_at(pc) {
                                    // SAFETY: slots are leaked u64s owned by the compiled code
                                    unsafe { *slot = body as u64 };
                                }
                            }
                            continue;
                        }
                    }
                }
            }
            #[cfg(not(all(target_arch = "aarch64", target_os = "macos")))]
            let _ = (id, &jit_mem);
            for i in start..start + len {
                // SAFETY: build_block pushed start..start+len into bops and
                // bops is only cleared together with the block table
                let op = unsafe { *self.bops.get_unchecked(i as usize) };
                if n > 0 && bus.tick() {
                    // this instruction's tick is spent; the caller services
                    // the SoC and then runs it without ticking again
                    sync!();
                    return Ok((n, true));
                }
                let next_pc = pc + op.len as u32;
                if !(careful || op.careful) {
                    // plain micro-op: cannot start or end a pair, block or loop
                    pc = self.exec_fast(bus, op.fast, next_pc).unwrap_or(next_pc);
                    n += 1;
                } else {
                    sync!();
                    // (finish() inside counts this instruction itself)
                    let (still, stop) = self.exec_careful(bus, op.fast, op.pair_head, careful, next_pc);
                    n += 1;
                    synced = n;
                    pc = self.pc;
                    careful = still;
                    if stop {
                        return Ok((n, false));
                    }
                }
                if pc != next_pc {
                    break; // taken branch, skip or loop: look up the next block
                }
            }
        }
    }

    /// The block of micro-ops starting at pc (XIP code only): built on first
    /// use from the decoded lines, ending after anything that may jump, before
    /// an instruction without a micro-op, or at 32 ops. None: pc is outside
    /// XIP or its first instruction needs `step`.
    #[inline]
    fn block_at<B: Bus>(&mut self, bus: &mut B, pc: u32) -> Result<Option<(usize, u32, u32)>, CoreError> {
        if !(0x0200_0000..0x0400_0000).contains(&pc) {
            return Ok(None);
        }
        if !self.bmap.is_empty() {
            let id = self.bmap[(pc >> 1) as usize & (self.bmap.len() - 1)];
            if id != 0 {
                let (bpc, start, len) = self.blocks[id as usize - 1];
                if bpc == pc {
                    return Ok(Some((id as usize - 1, start, len)));
                }
            }
        }
        self.build_block(bus, pc)
    }

    /// The compiled body of the block starting at pc, if there is one.
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    fn jit_body_at(&self, pc: u32) -> Option<*const u8> {
        if self.bmap.is_empty() {
            return None;
        }
        let id = self.bmap[(pc >> 1) as usize & (self.bmap.len() - 1)];
        if id == 0 || self.blocks[id as usize - 1].0 != pc {
            return None;
        }
        self.jit.as_ref()?.body(id as usize - 1)
    }

    #[inline(never)]
    fn build_block<B: Bus>(&mut self, bus: &mut B, pc: u32) -> Result<Option<(usize, u32, u32)>, CoreError> {
        const BITS: u32 = 18;
        if self.bmap.is_empty() {
            self.bmap = vec![0; 1 << BITS];
        }
        if self.bops.len() > 1 << 22 {
            // (cannot happen for one image, but never grow without bound)
            self.bops.clear();
            self.blocks.clear();
            self.bmap.iter_mut().for_each(|x| *x = 0);
            #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
            if let Some(j) = self.jit.as_mut() {
                j.reset();
            }
        }
        let start = self.bops.len() as u32;
        let mut p = pc;
        while (self.bops.len() as u32 - start) < 32 && (0x0200_0000..0x0400_0000).contains(&p) {
            let slot = self.fetch_at(bus, p)?;
            let l = self.icache[slot];
            let Some(f) = l.fast else { break };
            self.bops.push(BOp { fast: f, len: l.len, careful: l.careful, pair_head: l.pair_head });
            p += l.len as u32;
            if f.may_jump() {
                break;
            }
        }
        let len = self.bops.len() as u32 - start;
        if len == 0 {
            return Ok(None);
        }
        self.blocks.push((pc, start, len));
        let slot = (pc >> 1) as usize & ((1 << BITS) - 1);
        self.bmap[slot] = self.blocks.len() as u32;
        Ok(Some((self.blocks.len() - 1, start, len)))
    }

    /// The careful path of `run_fast`: pair heads, predicated blocks, and
    /// anything while a pair, block or rep loop is in progress. A pair,
    /// block or loop holds interrupts back; when this instruction ends one
    /// and an interrupt is pending, the per-step loop would take it right
    /// here, so the block stops (second result). The first result: still in
    /// a pair, block or loop.
    #[inline(never)]
    fn exec_careful<B: Bus>(&mut self, bus: &mut B, f: Fast, head: bool, gated: bool, next_pc: u32) -> (bool, bool) {
        let jumped = if !head && self.pair_pending.is_none() {
            self.exec_fast(bus, f, next_pc)
        } else {
            self.exec_fast_paired(bus, f, head, next_pc)
        };
        self.finish(jumped, next_pc);
        let still = self.pair_pending.is_some() || !self.pred_skips.is_empty() || self.rep_end != 0;
        (still, gated && !still && bus.irq_pending())
    }

    /// A micro-op that heads or closes a dual-issue pair: exactly `step`'s
    /// rule (the head's register results are held back until the second
    /// instruction has run). Out of line: pairs are the rarer case.
    #[inline(never)]
    fn exec_fast_paired<B: Bus>(&mut self, bus: &mut B, f: Fast, head: bool, next_pc: u32) -> Option<u32> {
        let pending = self.pair_pending.take();
        let before = self.regs;
        let jumped = self.exec_fast(bus, f, next_pc);
        if let Some((old, new)) = pending {
            for i in 0..16 {
                if new[i] != old[i] && self.regs[i] == old[i] {
                    self.regs[i] = new[i];
                }
            }
        }
        if head {
            let after = self.regs;
            self.regs = before;
            self.pair_pending = Some((before, after));
        }
        jumped
    }

    /// Fetch/decode/execute one instruction. Fetches a 6-byte window (the
    /// longest pi32v2 instruction); short instructions zero-extend.
    pub fn step<B: Bus>(&mut self, bus: &mut B) -> Result<(), CoreError> {
        let slot = self.fetch(bus)?;
        let l = self.icache[slot];
        let next_pc = self.pc + l.len as u32;
        // hot path: a micro-op outside any dual-issue pair
        if let (Some(f), false, true) = (l.fast, l.pair_head, self.pair_pending.is_none()) {
            if !trace_on() {
                if self.profile {
                    self.route_hist[31] += 1;
                }
                let jumped = self.exec_fast(bus, f, next_pc);
                self.finish(jumped, next_pc);
                return Ok(());
            }
        }
        let x = self.icache_x[slot].expect("decoded line");
        if self.profile {
            self.route_hist[(x.pre.route as usize).min(30)] += 1;
            *self.slow_hist.entry(x.entry.name).or_insert(0) += 1;
        }
        let insn = Instruction { addr: self.pc, raw: x.win, entry: x.entry };
        let is_pair_head = x.pre.pair_head;
        self.cur_syntax = x.pre.syntax;
        let before = self.regs;
        let pending = self.pair_pending.take();
        let res = self.execute(bus, &insn, &x.pre, next_pc);
        if let Some((old, new)) = pending {
            // commit the pair head's results the second instruction didn't override
            for i in 0..16 {
                if new[i] != old[i] && self.regs[i] == old[i] {
                    self.regs[i] = new[i];
                }
            }
        }
        if is_pair_head && res.is_ok() {
            let after = self.regs;
            self.regs = before;
            self.pair_pending = Some((before, after));
        }
        res
    }

    fn set_sreg_named(&mut self, n: &str, v: u32) {
        match n {
            "rets" => self.rets = v,
            "sp" => self.sp = v,
            "ssp" => self.ssp = v,
            "usp" => self.usp = v,
            _ => self.set_sreg(n, v),
        }
    }

    fn sreg_index(n: &str) -> usize {
        match n { "icfg" => 0, "reti" => 1, "retx" => 2, "rete" => 3, "sspn" => 4, "sr4" => 6, _ => 5 }
    }
    fn sregs(&self, n: &str) -> u32 {
        if n == "cnum" {
            self.core_id
        } else if n == "icfg" {
            // low byte: the ISR priorities in progress (`icfg & 0xff` is the
            // RTOS's "in interrupt context" test)
            let active = self.irq_levels.iter().fold(0u32, |m, &p| m | 1 << p);
            (self.sreg_store[0] & !0xff) | active
        } else {
            self.sreg_store[Self::sreg_index(n)]
        }
    }
    fn set_sreg(&mut self, n: &str, v: u32) {
        self.sreg_store[Self::sreg_index(n)] = v;
    }

    /// Execute a precomputed micro-op: the same semantics as the matching
    /// `exec_syntax` shape, with operands and branch targets resolved once.
    #[inline]
    fn exec_fast<B: Bus>(&mut self, bus: &mut B, f: Fast, next_pc: u32) -> Option<u32> {
        let _ = next_pc;
        let base = |cpu: &Self, b: Base| match b { Base::Reg(r) => cpu.regs[r as usize], Base::Sp => cpu.sp };
        match f {
            Fast::Mov { d, s } => self.regs[(d & 15) as usize] = self.regs[(s & 15) as usize],
            Fast::MovI { d, v } => self.regs[(d & 15) as usize] = v,
            Fast::Alu3 { d, a, b, op } => self.regs[(d & 15) as usize] = alu(op, self.regs[(a & 15) as usize], self.regs[(b & 15) as usize]),
            Fast::Alu3I { d, a, v, op } => self.regs[(d & 15) as usize] = alu(op, self.regs[(a & 15) as usize], v),
            Fast::Alu2 { d, b, op } => self.regs[(d & 15) as usize] = alu(op, self.regs[(d & 15) as usize], self.regs[(b & 15) as usize]),
            Fast::Alu2I { d, v, op } => self.regs[(d & 15) as usize] = alu(op, self.regs[(d & 15) as usize], v),
            Fast::Ld { d, b, off, w, signed } => {
                let a = base(self, b).wrapping_add(off);
                self.regs[(d & 15) as usize] = match (w, signed) {
                    (1, false) => bus.read8(a) as u32,
                    (1, true) => bus.read8(a) as i8 as i32 as u32,
                    (2, false) => bus.read16(a) as u32,
                    (2, true) => bus.read16(a) as i16 as i32 as u32,
                    _ => bus.read32(a),
                };
            }
            Fast::St { s, b, off, w } => {
                let a = base(self, b).wrapping_add(off);
                let v = self.regs[(s & 15) as usize];
                match w {
                    1 => bus.write8(a, v as u8),
                    2 => bus.write16(a, v as u16),
                    _ => bus.write32(a, v),
                }
            }
            Fast::BrI { a, v, cond, target } => {
                if cond_true(cond, self.regs[(a & 15) as usize], v) {
                    return Some(target);
                }
            }
            Fast::BrR { a, b, cond, target } => {
                if cond_true(cond, self.regs[(a & 15) as usize], self.regs[(b & 15) as usize]) {
                    return Some(target);
                }
            }
            Fast::Goto { target } => return Some(target),
            Fast::Call { target } => {
                self.rets = next_pc;
                return Some(target);
            }
            Fast::Rts => return Some(self.rets),
            Fast::A4 { d, s, op, rk, rv } => {
                let rhs = match rk { 0 => self.regs[(rv & 15) as usize], 1 => rv, _ => 1u32 << (self.regs[(rv & 15) as usize] & 31) };
                self.regs[(d & 15) as usize] = alu(op, self.regs[(s & 15) as usize], rhs);
            }
            Fast::BitBr { r, mk, ne, mv, target } => {
                let mask = match mk { 0 => self.regs[(mv & 15) as usize], 1 => mv, _ => 1u32 << (self.regs[(mv & 15) as usize] & 31) };
                if ((self.regs[(r & 15) as usize] & mask) != 0) == ne {
                    return Some(target);
                }
            }
            Fast::LdIdx { d, b, i, sh, w, signed } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(self.regs[(i & 15) as usize] << sh);
                self.regs[(d & 15) as usize] = ld_w(bus, w, signed, a);
            }
            Fast::StIdx { s, b, i, sh, w } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(self.regs[(i & 15) as usize] << sh);
                st_w(bus, w, a, self.regs[(s & 15) as usize]);
            }
            Fast::Rmw { b, w, op, off, v } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(off);
                let nv = match op {
                    RmwOp::Mov => v,
                    RmwOp::Or => ld_w(bus, w, false, a) | v,
                    RmwOp::And => ld_w(bus, w, false, a) & v,
                    RmwOp::Xor => ld_w(bus, w, false, a) ^ v,
                    RmwOp::Add => ld_w(bus, w, false, a).wrapping_add(v),
                    RmwOp::Sub => ld_w(bus, w, false, a).wrapping_sub(v),
                };
                st_w(bus, w, a, nv);
            }
            Fast::LdPost { d, b, w, signed, inc } => {
                let a = self.regs[(b & 15) as usize];
                self.regs[(d & 15) as usize] = ld_w(bus, w, signed, a);
                self.regs[(b & 15) as usize] = self.regs[(b & 15) as usize].wrapping_add(inc);
            }
            Fast::StPost { s, b, w, inc } => {
                let a = self.regs[(b & 15) as usize];
                st_w(bus, w, a, self.regs[(s & 15) as usize]);
                self.regs[(b & 15) as usize] = self.regs[(b & 15) as usize].wrapping_add(inc);
            }
            Fast::DecBr { r, cond, v, target } => {
                let x = self.regs[(r & 15) as usize].wrapping_sub(1);
                self.regs[(r & 15) as usize] = x;
                if cond_true(cond, x, v) {
                    return Some(target);
                }
            }
            Fast::MemA4 { b, off, op, rk, rv } => {
                let rhs = match rk { 0 => self.regs[(rv & 15) as usize], 1 => rv, _ => 1u32 << (self.regs[(rv & 15) as usize] & 31) };
                let a = (self.regs[(b & 15) as usize] as i64 + off as i64) as u32;
                let cur = bus.read32(a);
                bus.write32(a, alu(op, cur, rhs));
            }
            Fast::Nop => {}
            Fast::BrIEq { a, v, target } => {
                if self.regs[(a & 15) as usize] == v {
                    return Some(target);
                }
            }
            Fast::BrINe { a, v, target } => {
                if self.regs[(a & 15) as usize] != v {
                    return Some(target);
                }
            }
            Fast::LdW { d, b, off } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(off);
                self.regs[(d & 15) as usize] = bus.read32(a);
            }
            Fast::LdWSp { d, off } => {
                let a = self.sp.wrapping_add(off);
                self.regs[(d & 15) as usize] = bus.read32(a);
            }
            Fast::LdBu { d, b, off } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(off);
                self.regs[(d & 15) as usize] = bus.read8(a) as u32;
            }
            Fast::StW { s, b, off } => {
                let a = self.regs[(b & 15) as usize].wrapping_add(off);
                bus.write32(a, self.regs[(s & 15) as usize]);
            }
            Fast::StWSp { s, off } => {
                let a = self.sp.wrapping_add(off);
                bus.write32(a, self.regs[(s & 15) as usize]);
            }
            Fast::AddRI { d, s, v } => {
                self.regs[(d & 15) as usize] = self.regs[(s & 15) as usize].wrapping_add(v);
            }
            Fast::ShlI { d, s, n } => {
                self.regs[(d & 15) as usize] = self.regs[(s & 15) as usize] << (n & 31);
            }
            Fast::SarI { d, s, n } => {
                self.regs[(d & 15) as usize] = ((self.regs[(s & 15) as usize] as i32) >> (n & 31)) as u32;
            }
            Fast::PushRets { n } => {
                let n = n as i32;
                let (top, bot) = (n.max(3), n.min(4));
                for r in std::iter::once(-1i32).chain((bot..=top).rev()) {
                    self.sp = self.sp.wrapping_sub(4);
                    let v = if r < 0 { self.rets } else { self.regs[(r & 15) as usize] };
                    bus.write32(self.sp, v);
                }
            }
            Fast::PopPc { n } => {
                let n = n as i32;
                let (top, bot) = (n.max(3), n.min(4));
                for r in bot..=top {
                    self.regs[(r & 15) as usize] = bus.read32(self.sp);
                    self.sp = self.sp.wrapping_add(4);
                }
                let j = bus.read32(self.sp);
                self.sp = self.sp.wrapping_add(4);
                return Some(j);
            }
            Fast::PushRet => {
                self.sp = self.sp.wrapping_sub(4);
                bus.write32(self.sp, self.rets);
            }
            Fast::PushMask { mask } => {
                self.sp = self.sp.wrapping_sub(4);
                bus.write32(self.sp, self.rets);
                for r in (0..16).rev() {
                    if mask >> r & 1 != 0 {
                        self.sp = self.sp.wrapping_sub(4);
                        bus.write32(self.sp, self.regs[r]);
                    }
                }
            }
            Fast::PopMask { mask } => {
                for r in 0..16 {
                    if mask >> r & 1 != 0 {
                        self.regs[r] = bus.read32(self.sp);
                        self.sp = self.sp.wrapping_add(4);
                    }
                }
                let j = bus.read32(self.sp);
                self.sp = self.sp.wrapping_add(4);
                return Some(j);
            }
            Fast::PopRet => {
                let j = bus.read32(self.sp);
                self.sp = self.sp.wrapping_add(4);
                return Some(j);
            }
            Fast::MinMax { d, a, b, kind } => {
                let (x, y) = (self.regs[(a & 15) as usize], self.regs[(b & 15) as usize]);
                self.regs[(d & 15) as usize] = match kind {
                    0 => (x as i32).min(y as i32) as u32,
                    1 => (x as i32).max(y as i32) as u32,
                    2 => x.min(y),
                    _ => x.max(y),
                };
            }
            Fast::IfBlk { a, rk, fam, alt, has_else, rv, then_d, else_d } => {
                let x = self.regs[(a & 15) as usize];
                let y = match rk { 0 => self.regs[(rv & 15) as usize], 1 => rv, _ => 1u32 << (self.regs[(rv & 15) as usize] & 31) };
                let taken = if fam == 2 { ((x & y) != 0) == alt } else { cmp_cond(fam as u64, alt, x, y) };
                let then_end = next_pc.wrapping_add(then_d as u32);
                if taken {
                    if has_else {
                        let else_end = then_end.wrapping_add(else_d as u32);
                        self.pred_skips.retain(|&(te, _)| te != then_end);
                        self.pred_skips.push((then_end, else_end));
                    }
                } else {
                    return Some(then_end);
                }
            }
            Fast::Ext { d, s, part, signed } => {
                let x = self.regs[(s & 15) as usize];
                self.regs[(d & 15) as usize] = match (part, signed) {
                    (0, false) => x & 0xff,
                    (0, true) => x as u8 as i8 as i32 as u32,
                    (1, false) => x & 0xffff,
                    (1, true) => x as u16 as i16 as i32 as u32,
                    (_, false) => x >> 16,
                    (_, true) => ((x >> 16) as u16 as i16 as i32) as u32,
                };
            }
        }
        None
    }

    /// Semantics keyed by the printed shape (`insn.entry.syntax`), with the
    /// operands read from the solver-verified slots in printed order. This
    /// is the fallback for every class without a hand-verified arm: a
    /// shape handled here executes for all its length/encoding variants at
    /// once. `-#i` operands carry their sign in the slot value, and the
    /// trailing ` #` (flag-setting variants) is ignored.
    ///
    /// Returns Ok(None) when the shape is unknown.
    fn exec_syntax<B: Bus>(
        &mut self,
        bus: &mut B,
        insn: &Instruction,
        next_pc: u32,
    ) -> Result<Option<Option<u32>>, CoreError> {
        let s = if self.cur_syntax.is_empty() { canon_syntax(insn.entry) } else { self.cur_syntax };
        let v = |cpu: &Self, i: usize| -> Result<u32, CoreError> { Ok(cpu.slot(insn, i)? as u32) };
        let r = |cpu: &Self, i: usize| -> Result<usize, CoreError> { cpu.reg(insn, i) };
        let mut jump: Option<u32> = None;

        // ---- branches: if[s] (<cond>) goto #i --------------------------
        if (s.starts_with("if (") || s.starts_with("ifs (")) && s.ends_with(") goto #i") {
            let signed = s.starts_with("ifs");
            let cond = &s[s.find('(').unwrap() + 1..s.len() - ") goto #i".len()];
            let (lhs, op, rhs, nslots): (u32, &str, u32, usize) =
                if let Some(rest) = cond.strip_prefix("(R & ") {
                    // (R & x) OP #i : slots r, mask, cmp, off
                    let (mask, op_rhs) = split2(rest, ") ").ok_or(CoreError::MissingSlot { name: insn.entry.name, pc: self.pc, slot: 9 })?;
                    let m = if mask == "R" { self.regs[r(self, 1)?] } else { v(self, 1)? };
                    let op = op_rhs.split(' ').next().unwrap_or("");
                    (self.regs[r(self, 0)?] & m, op, v(self, 2)?, 4)
                } else if let Some(rest) = cond.strip_prefix("--R ") {
                    let rr = r(self, 0)?;
                    self.regs[rr] = self.regs[rr].wrapping_sub(1);
                    let op = rest.split(' ').next().unwrap_or("");
                    (self.regs[rr], op, v(self, 1)?, 3)
                } else if let Some(rest) = cond.strip_prefix("R ") {
                    let mut it = rest.splitn(2, ' ');
                    let op = it.next().unwrap_or("");
                    let rhs_txt = it.next().unwrap_or("");
                    let rhs = if rhs_txt == "R" { self.regs[r(self, 1)?] } else { v(self, 1)? };
                    (self.regs[r(self, 0)?], op, rhs, 3)
                } else {
                    return Ok(None);
                };
            let taken = match (op, signed) {
                ("==", _) => lhs == rhs,
                ("!=", _) => lhs != rhs,
                ("<", false) => lhs < rhs,
                (">", false) => lhs > rhs,
                ("<=", false) => lhs <= rhs,
                (">=", false) => lhs >= rhs,
                ("<", true) => (lhs as i32) < (rhs as i32),
                (">", true) => (lhs as i32) > (rhs as i32),
                ("<=", true) => (lhs as i32) <= (rhs as i32),
                (">=", true) => (lhs as i32) >= (rhs as i32),
                _ => return Ok(None),
            };
            let off = self.slot(insn, nslots - 1)?;
            if taken {
                jump = Some((next_pc as i64 + off) as u32);
            }
            return Ok(Some(jump));
        }

        // ---- memory helpers ----------------------------------------------
        fn ld<B: Bus>(bus: &mut B, w: u8, signed: bool, a: u32) -> u32 {
            match (w, signed) {
                (1, false) => bus.read8(a) as u32,
                (1, true) => bus.read8(a) as i8 as i32 as u32,
                (2, false) => bus.read16(a) as u32,
                (2, true) => bus.read16(a) as i16 as i32 as u32,
                _ => bus.read32(a),
            }
        }
        fn st<B: Bus>(bus: &mut B, w: u8, a: u32, val: u32) {
            match w {
                1 => bus.write8(a, val as u8),
                2 => bus.write16(a, val as u16),
                _ => bus.write32(a, val),
            }
        }
        // width prefix of a memory operand: "b[" / "h[" / "["
        fn width_of(t: &str) -> Option<(u8, &str)> {
            if let Some(x) = t.strip_prefix("b[") { Some((1, x)) }
            else if let Some(x) = t.strip_prefix("h[") { Some((2, x)) }
            else if let Some(x) = t.strip_prefix("[") { Some((4, x)) }
            else { None }
        }

        // ---- loads: R = <mem> [(u)|(s)] ----------------------------------
        if let Some(rhs) = s.strip_prefix("R = ") {
            let (rhs, signed) = if let Some(x) = rhs.strip_suffix(" (s)") { (x, true) }
                else if let Some(x) = rhs.strip_suffix(" (u)") { (x, false) } else { (rhs, false) };
            if let Some((w, inner)) = width_of(rhs) {
                let d = r(self, 0)?;
                let inner = inner.strip_suffix(']').ok_or(CoreError::MissingSlot { name: insn.entry.name, pc: self.pc, slot: 9 })?;
                let (addr, post): (u32, Option<(usize, u32)>) = match inner {
                    "R+#i" => (self.regs[r(self, 1)?].wrapping_add(v(self, 2)?), None),
                    "sp+#i" => (self.sp.wrapping_add(v(self, 1)?), None),
                    "sp" => (self.sp, None),
                    "R+R" => (self.regs[r(self, 1)?].wrapping_add(self.regs[r(self, 2)?]), None),
                    "R+R<<#i" => (self.regs[r(self, 1)?].wrapping_add(self.regs[r(self, 2)?] << (v(self, 3)? & 31)), None),
                    "R++=#i" => { let b = r(self, 1)?; (self.regs[b], Some((b, v(self, 2)?))) }
                    "R++=R" => { let b = r(self, 1)?; (self.regs[b], Some((b, self.regs[r(self, 2)?]))) }
                    "++R=#i" => { let b = r(self, 1)?; self.regs[b] = self.regs[b].wrapping_add(v(self, 2)?); (self.regs[b], None) }
                    "++R=R" => { let b = r(self, 1)?; self.regs[b] = self.regs[b].wrapping_add(self.regs[r(self, 2)?]); (self.regs[b], None) }
                    _ => return Ok(None),
                };
                self.regs[d] = ld(bus, w, signed, addr);
                if let Some((b, inc)) = post {
                    self.regs[b] = self.regs[b].wrapping_add(inc);
                }
                return Ok(Some(None));
            }
        }

        // ---- stores / RMW: <mem> op= x -------------------------------------
        if let Some((w, inner)) = width_of(s) {
            if let Some((addr_txt, rest)) = split2(inner, "] ") {
                let (op, src) = rest.split_once(' ').ok_or(CoreError::MissingSlot { name: insn.entry.name, pc: self.pc, slot: 9 })?;
                // operand slots: address operands first, then the source
                let mut n = 0usize;
                // unknown address forms (block moves `[R+]`, …) fall through
                // to the dedicated handlers below
                let known = matches!(addr_txt, "R+#i" | "sp+#i" | "sp" | "R+R" | "R+R<<#i" | "R++=#i" | "R++=R" | "++R=#i" | "++R=R" | "--sp");
                let known = known && matches!(src, "R" | "#i" | "#h" | "rets");
                let (addr, post): (u32, Option<(usize, u32)>) = if !known { (0, None) } else { match addr_txt {
                    "R+#i" => { n = 2; (self.regs[r(self, 0)?].wrapping_add(v(self, 1)?), None) }
                    "sp+#i" => { n = 1; (self.sp.wrapping_add(v(self, 0)?), None) }
                    "sp" => (self.sp, None),
                    "R+R" => { n = 2; (self.regs[r(self, 0)?].wrapping_add(self.regs[r(self, 1)?]), None) }
                    "R+R<<#i" => { n = 3; (self.regs[r(self, 0)?].wrapping_add(self.regs[r(self, 1)?] << (v(self, 2)? & 31)), None) }
                    "R++=#i" => { n = 2; let b = r(self, 0)?; (self.regs[b], Some((b, v(self, 1)?))) }
                    "R++=R" => { n = 2; let b = r(self, 0)?; (self.regs[b], Some((b, self.regs[r(self, 1)?]))) }
                    "++R=#i" => { n = 2; let b = r(self, 0)?; self.regs[b] = self.regs[b].wrapping_add(v(self, 1)?); (self.regs[b], None) }
                    "++R=R" => { n = 2; let b = r(self, 0)?; self.regs[b] = self.regs[b].wrapping_add(self.regs[r(self, 1)?]); (self.regs[b], None) }
                    _ => { self.sp = self.sp.wrapping_sub(4); (self.sp, None) }
                } };
                // shifted-mask sources (`#i << R`, `~(#i << R)`, `~R`, `R << #i`)
                // are handled by the dedicated arms further down
                let val = if !known { None } else { match src {
                    "R" => Some(self.regs[r(self, n)?]),
                    "#i" | "#h" => Some(v(self, n)?),
                    "rets" => Some(self.rets),
                    _ => None,
                } };
                if let Some(val) = val {
                    let newv = match op {
                        "=" => val,
                        "|=" => ld(bus, w, false, addr) | val,
                        "&=" => ld(bus, w, false, addr) & val,
                        "^=" => ld(bus, w, false, addr) ^ val,
                        "+=" => ld(bus, w, false, addr).wrapping_add(val),
                        "-=" => ld(bus, w, false, addr).wrapping_sub(val),
                        _ => return Ok(None),
                    };
                    st(bus, w, addr, newv);
                    if let Some((b, inc)) = post {
                        self.regs[b] = self.regs[b].wrapping_add(inc);
                    }
                    return Ok(Some(None));
                }
            }
        }

        // ---- register pairs: rH_rL = d[...] / d[...] = rH_rL ---------------
        // the pair names are literal in the syntax (r1_r0, r3_r2, ...); the
        // low register takes the lower address
        let pair_of = |t: &str| -> Option<(usize, usize)> {
            let (h, l) = split2(t.strip_prefix('r')?, "_r")?;
            Some((h.parse().ok()?, l.parse().ok()?))
        };
        if let Some((lhs, rhs)) = split2(s, " = ") {
            let (pair, mem, is_load) = if let Some(p) = pair_of(lhs) {
                (Some(p), rhs, true)
            } else if let Some(p) = pair_of(rhs) {
                (Some(p), lhs, false)
            } else {
                (None, "", false)
            };
            if let (Some((hi, lo)), Some(inner)) = (pair, mem.strip_prefix("d[").and_then(|x| x.strip_suffix(']'))) {
                let (addr, post): (u32, Option<(usize, u32)>) = match inner {
                    "R+#i" => (self.regs[r(self, 0)?].wrapping_add(v(self, 1)?), None),
                    "sp+#i" => (self.sp.wrapping_add(v(self, 0)?), None),
                    "sp" => (self.sp, None),
                    "++R=#i" => {
                        let b = r(self, 0)?;
                        self.regs[b] = self.regs[b].wrapping_add(v(self, 1)?);
                        (self.regs[b], None)
                    }
                    "R++=#i" => { let b = r(self, 0)?; (self.regs[b], Some((b, v(self, 1)?))) }
                    _ => return Ok(None),
                };
                if is_load {
                    self.regs[lo] = bus.read32(addr);
                    self.regs[hi] = bus.read32(addr.wrapping_add(4));
                } else {
                    bus.write32(addr, self.regs[lo]);
                    bus.write32(addr.wrapping_add(4), self.regs[hi]);
                }
                if let Some((b, inc)) = post {
                    self.regs[b] = self.regs[b].wrapping_add(inc);
                }
                return Ok(Some(None));
            }
        }

        // ---- register-pair moves / 64-bit arithmetic ------------------------
        if let Some((lhs, rhs)) = split2(s, " = ") {
            if let Some((dh, dl)) = pair_of(lhs) {
                if let Some((sh_, sl)) = pair_of(rhs) {
                    let (a, b) = (self.regs[sh_], self.regs[sl]);
                    self.regs[dh] = a;
                    self.regs[dl] = b;
                    return Ok(Some(None));
                }
                if rhs == "#i" {
                    // printed operands are rH, rL, #i -> the immediate is slot 2
                    let imm = self.slot(insn, 2)?;
                    self.regs[dl] = imm as u32;
                    self.regs[dh] = (imm >> 32) as u32;
                    return Ok(Some(None));
                }
                if rhs == "R * R (s)" || rhs == "R * R (u)" {
                    let a = self.regs[r(self, 0)?];
                    let b = self.regs[r(self, 1)?];
                    let p = if rhs.ends_with("(s)") { (a as i32 as i64).wrapping_mul(b as i32 as i64) as u64 } else { (a as u64) * (b as u64) };
                    self.regs[dl] = p as u32;
                    self.regs[dh] = (p >> 32) as u32;
                    return Ok(Some(None));
                }
            }
        }
        if let Some((lhs, rhs)) = split2(s, " += ") {
            if let Some((dh, dl)) = pair_of(lhs) {
                if rhs == "R * R (s)" || rhs == "R * R (u)" {
                    let a = self.regs[r(self, 0)?];
                    let b = self.regs[r(self, 1)?];
                    let p = if rhs.ends_with("(s)") { (a as i32 as i64).wrapping_mul(b as i32 as i64) as u64 } else { (a as u64) * (b as u64) };
                    let acc = ((self.regs[dh] as u64) << 32 | self.regs[dl] as u64).wrapping_add(p);
                    self.regs[dl] = acc as u32;
                    self.regs[dh] = (acc >> 32) as u32;
                    return Ok(Some(None));
                }
            }
        }
        for (op, left) in [(" >>= #i", true), (" <<= #i", false)] {
            if let Some(lhs) = s.strip_suffix(op) {
                if let Some((dh, dl)) = pair_of(lhs) {
                    // 64-bit pair shift (`>>=` taken as logical: hardware-probe item)
                    let n = v(self, 0)? & 63;
                    let x = (self.regs[dh] as u64) << 32 | self.regs[dl] as u64;
                    let y = if n == 0 { x } else if left { x << n } else { x >> n };
                    self.regs[dl] = y as u32;
                    self.regs[dh] = (y >> 32) as u32;
                    return Ok(Some(None));
                }
            }
        }

        // ---- multi-register block moves with a register base -----------
        // `{rA, rB, ...} = [rN+]` / `[rN+] = {...}` (00 eb / 20 eb): base =
        // bits(0,3), 16-bit register mask at bits(16,31); the lowest register
        // takes the lowest address (same convention as the sp block pops).
        // `[rN++]` additionally advances the base past the block. Base
        // update for the plain `[rN+]` form assumed absent (probe item).
        if insn.entry.len == 4 && (insn.raw >> 8) & 0xff == 0xeb
            && ((s.starts_with("{") && has(s, "} = [R+")) || (s.starts_with("[R+") && has(s, "] = {")))
        {
            let raw = insn.raw;
            let base = (raw & 0xf) as usize;
            let regs: Vec<usize> = (0..16usize).filter(|&i| (raw >> (16 + i)) & 1 != 0).collect();
            let mut addr = self.regs[base];
            let store = s.starts_with("[");
            for &i in &regs {
                if store {
                    bus.write32(addr, self.regs[i]);
                } else {
                    self.regs[i] = bus.read32(addr);
                }
                addr = addr.wrapping_add(4);
            }
            if has(s, "[R++]") {
                self.regs[base] = addr;
            }
            return Ok(Some(None));
        }

        // ---- push/pop of named special registers ----------------------------
        // `[--sp] = {psr, rets, reti}` / `{psr, rets, reti} = [sp++]` (interrupt
        // prologues, context switches): same convention as the register
        // blocks — push in printed order (first item at the highest
        // address), pop ascending assigning the printed list reversed.
        fn named_list(list: &str) -> Option<Vec<String>> {
            let inner = list.strip_prefix('{')?.strip_suffix('}')?;
            let items: Vec<&str> = inner.split(", ").collect();
            if items.iter().all(|t| matches!(*t, "psr" | "rets" | "reti" | "retx" | "rete" | "sr4" | "icfg" | "sp" | "ssp" | "usp")) {
                Some(items.into_iter().map(String::from).collect())
            } else {
                None
            }
        }
        if let Some(list) = s.strip_prefix("[--sp] = ").and_then(named_list) {
            if list.iter().any(|n| n == "reti") {
                self.nest_ok = true;
            }
            for n in &list {
                let val = sreg_get_named(self, n);
                self.sp = self.sp.wrapping_sub(4);
                bus.write32(self.sp, val);
            }
            return Ok(Some(None));
        }
        if let Some(list) = s.strip_suffix(" = [sp++]").and_then(named_list) {
            if list.iter().any(|n| n == "reti") {
                self.nest_ok = false;
            }
            for n in list.iter().rev() {
                let val = bus.read32(self.sp);
                self.sp = self.sp.wrapping_add(4);
                self.set_sreg_named(n, val);
            }
            return Ok(Some(None));
        }

        // ---- table branches, plain block push/pop, cache ops ----------------
        match s {
            "tbb [R]" | "tbh [R]" => {
                // jump table right after the instruction: pc = next_pc +
                // 2 * table[R] (tbb: byte entries, R = index; tbh: halfword
                // entries, R = 2*index) — matches the vendor annotations,
                // e.g. tbh at 0x12dc, entry 0x1c8 -> 0x166e, the switch default.
                let idx = self.regs[r(self, 0)?];
                let e = if s.starts_with("tbb") { bus.read8(next_pc.wrapping_add(idx)) as u32 } else { bus.read16(next_pc.wrapping_add(idx)) as u32 };
                return Ok(Some(Some(next_pc.wrapping_add(2 * e))));
            }
            "[--sp] = {R*2}" | "{R*2} = [sp++]" | "[--sp] = {R*1}" | "{R*1} = [sp++]" => {
                // block push/pop without rets: 2-byte `6n 04` / `4n 04` with
                // the usual [max(n,3) .. min(n,4)] list; 4-byte `d8 e8` /
                // `d4 e8` carry a 16-bit register mask at bits 16-31.
                let raw = insn.raw;
                let regs: Vec<usize> = if insn.entry.len == 2 {
                    let n = (raw & 0xf) as usize;
                    (n.min(4)..=n.max(3)).rev().collect()
                } else {
                    (0..16usize).rev().filter(|&i| (raw >> (16 + i)) & 1 != 0).collect()
                };
                if s.starts_with("[--sp]") {
                    for &i in &regs {
                        self.sp = self.sp.wrapping_sub(4);
                        bus.write32(self.sp, self.regs[i]);
                    }
                } else {
                    for &i in regs.iter().rev() {
                        self.regs[i] = bus.read32(self.sp);
                        self.sp = self.sp.wrapping_add(4);
                    }
                }
                return Ok(Some(None));
            }
            "ssync" | "btbclr" | "iflush [R]" | "flush [R]" | "flushinv [R]" => return Ok(Some(None)),
            "cc = #i" => { self.cc = v(self, 0)? != 0; return Ok(Some(None)); }
            "callns R" => { self.rets = next_pc; return Ok(Some(Some(self.regs[r(self, 0)?]))); }
            "rti" => {
                self.irq_levels.pop();
                // back in an outer ISR: it was interrupted with reti on its stack
                self.nest_ok = !self.irq_levels.is_empty();
                return Ok(Some(Some(self.sregs("reti"))));
            }
            "R = sextra(R, p:#i, l:#i)" => {
                let d = r(self, 0)?;
                let src = self.regs[r(self, 1)?];
                let p = v(self, 2)? & 31;
                let l = v(self, 3)? & 31;
                let x = if l == 0 { src >> p } else { ((src >> p) << (32 - l)) as i32 as u32 >> (32 - l) };
                self.regs[d] = if l == 0 { x } else { (((src >> p) << (32 - l)) as i32 >> (32 - l)) as u32 };
                let _ = x;
                return Ok(Some(None));
            }
            "R.l = #i" | "R.h = #i" => {
                let d = r(self, 0)?;
                let imm = v(self, 1)? & 0xffff;
                self.regs[d] = if s.starts_with("R.l") { (self.regs[d] & 0xffff_0000) | imm } else { (self.regs[d] & 0xffff) | (imm << 16) };
                return Ok(Some(None));
            }
            "R <<= R" | "R >>= R" | "R >>>= R" | "R <<= #i" | "R >>= #i" | "R >>>= #i" => {
                let d = r(self, 0)?;
                let n = if s.ends_with('R') { self.regs[r(self, 1)?] & 31 } else { v(self, 1)? };
                let kind = s[2..].split('=').next().unwrap_or("<<");
                let x = self.regs[d];
                self.regs[d] = match kind {
                    "<<" => if n >= 32 { 0 } else { x << n },
                    ">>" => if n >= 32 { 0 } else { x >> n },
                    _ => if n >= 32 { ((x as i32) >> 31) as u32 } else { ((x as i32) >> n) as u32 },
                };
                return Ok(Some(None));
            }
            "R = R & ~R" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?] & !self.regs[r(self, 2)?]; return Ok(Some(None)); }
            "R = R & ~(#i << R)" | "R = R | (#i << R)" => {
                let d = r(self, 0)?;
                let a = self.regs[r(self, 1)?];
                let m = v(self, 2)?.wrapping_shl(self.regs[r(self, 3)?] & 31);
                self.regs[d] = if s.contains('~') { a & !m } else { a | m };
                return Ok(Some(None));
            }
            "[R+#i] &= ~(#i << R)" | "[R+#i] |= #i << R" | "[R+#i] &= ~R" | "[R+#i] |= R << #i" => {
                let addr = self.regs[r(self, 0)?].wrapping_add(v(self, 1)?);
                let m = match s {
                    "[R+#i] &= ~R" => self.regs[r(self, 2)?],
                    "[R+#i] |= R << #i" => self.regs[r(self, 2)?].wrapping_shl(v(self, 3)? & 31),
                    _ => v(self, 2)?.wrapping_shl(self.regs[r(self, 3)?] & 31),
                };
                let cur = bus.read32(addr);
                bus.write32(addr, if has(s, "&=") { cur & !m } else { cur | m });
                return Ok(Some(None));
            }
            _ => {}
        }

        // ---- special registers ------------------------------------------------
        // psr reads as 0 (no flags modelled yet); icfg/reti/retx/rete are
        // plain storage. `c` (carry) is assumed clear in the add/sub-with-
        // carry forms — a hardware-probe item.
        let sreg_get = |cpu: &Self, n: &str| -> Option<u32> {
            Some(match n {
                "rets" => cpu.rets,
                "sp" => cpu.sp,
                "ssp" => cpu.ssp,
                "usp" => cpu.usp,
                "psr" | "icfg" | "reti" | "retx" | "rete" | "sspn" | "cnum" => cpu.sregs(n),
                _ => return None,
            })
        };
        if let Some((lhs, rhs)) = split2(s, " = ") {
            if lhs == "R" && !rhs.contains(' ') && rhs != "R" && !rhs.starts_with('#') {
                if let Some(val) = sreg_get(self, rhs) {
                    let d = r(self, 0)?;
                    self.regs[d] = val;
                    return Ok(Some(None));
                }
            }
            if lhs != "R" && !lhs.contains(['[', '{', '.', '_']) && (rhs == "R" || rhs == "#i" || rhs == "#h" || sreg_get(self, rhs).is_some()) {
                let val = if rhs == "R" { self.regs[r(self, 0)?] }
                    else if rhs.starts_with('#') && insn.entry.len == 6 && (insn.raw >> 8) & 0xff == 0xff {
                        // 6-byte `<sreg> = #imm32` (`e0..ef ff <imm32-le>`, like `c0 ff` R = #i)
                        (insn.raw >> 16) as u32
                    }
                    else if rhs.starts_with('#') { v(self, 0)? }
                    else { sreg_get(self, rhs).unwrap() };
                match lhs {
                    "rets" => self.rets = val,
                    "sp" => self.sp = val,
                    "ssp" => self.ssp = val,
                    "usp" => self.usp = val,
                    "psr" | "icfg" | "reti" | "retx" | "rete" | "sspn" => self.set_sreg(lhs, val),
                    _ => return Ok(None),
                }
                return Ok(Some(None));
            }
        }

        // ---- bit-field / min-max / misc unary -------------------------------
        if let Some(rest) = s.strip_prefix("R <= insert(R, p:#i, l:#i)") {
            if rest.is_empty() {
                let d = r(self, 0)?;
                let src = self.regs[r(self, 1)?];
                let p = v(self, 2)? & 31;
                let l = v(self, 3)? & 31;
                let mask = if l == 0 { 0xffff_ffffu32 } else { (1u32 << l).wrapping_sub(1) };
                self.regs[d] = (self.regs[d] & !(mask << p)) | ((src & mask) << p);
                return Ok(Some(None));
            }
        }
        if s == "R = uextra(R, p:#i, l:#i)" {
            let d = r(self, 0)?;
            let src = self.regs[r(self, 1)?];
            let p = v(self, 2)? & 31;
            let l = v(self, 3)? & 31;
            let mask = if l == 0 { 0xffff_ffffu32 } else { (1u32 << l).wrapping_sub(1) };
            self.regs[d] = (src >> p) & mask;
            return Ok(Some(None));
        }
        match s {
            "R = smin(R, R)" | "R = smax(R, R)" | "R = umin(R, R)" | "R = umax(R, R)" => {
                // e4 and its flag-setting twin f4 share one layout: d bits
                // 28-31, a bits 20-23, b bits 24-27 (the f4 forms have too few
                // corpus samples for the slot solver)
                let raw = insn.raw;
                let (d, a, b) = if insn.entry.len == 4 && matches!((raw >> 8) & 0xff, 0xe4 | 0xf4) {
                    (((raw >> 28) & 0xf) as usize, self.regs[((raw >> 20) & 0xf) as usize], self.regs[((raw >> 24) & 0xf) as usize])
                } else {
                    (r(self, 0)?, self.regs[r(self, 1)?], self.regs[r(self, 2)?])
                };
                self.regs[d] = match &s[4..8] {
                    "smin" => (a as i32).min(b as i32) as u32,
                    "smax" => (a as i32).max(b as i32) as u32,
                    "umin" => a.min(b),
                    _ => a.max(b),
                };
                return Ok(Some(None));
            }
            "R = abs(R)" => { let d = r(self, 0)?; self.regs[d] = (self.regs[r(self, 1)?] as i32).wrapping_abs() as u32; return Ok(Some(None)); }
            "R = clz(R)" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].leading_zeros(); return Ok(Some(None)); }
            "R = rev8(R)" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].swap_bytes(); return Ok(Some(None)); }
            "R = R + R + c" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].wrapping_add(self.regs[r(self, 2)?]); return Ok(Some(None)); }
            "R = R - R - !c" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].wrapping_sub(self.regs[r(self, 2)?]).wrapping_sub(1); return Ok(Some(None)); }
            "R = R + R (ssat)" => {
                let d = r(self, 0)?;
                self.regs[d] = (self.regs[r(self, 1)?] as i32).saturating_add(self.regs[r(self, 2)?] as i32) as u32;
                return Ok(Some(None));
            }
            _ => {}
        }

        // ---- everything else ------------------------------------------------
        let sh = |x: u32, n: u32, kind: &str| -> u32 {
            match kind {
                "<<" | "<<<" => if n >= 32 { 0 } else { x << n },
                ">>" => if n >= 32 { 0 } else { x >> n },
                _ => if n >= 32 { ((x as i32) >> 31) as u32 } else { ((x as i32) >> n) as u32 },
            }
        };
        match s {
            "nop" | "csync" | "idle" | "lockclr" | "lockset" | "pfetch [R]"
            | "sti R" | "cli R" => {}
            "sti" => self.ie = true,
            "cli" => self.ie = false,
            "R = R" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?]; }
            "R = #i" | "R = #h" => { let d = r(self, 0)?; self.regs[d] = v(self, 1)?; }
            "R = cnum" => { let d = r(self, 0)?; self.regs[d] = self.core_id; }
            "R = sp" => { let d = r(self, 0)?; self.regs[d] = self.sp; }
            "R = sp + #i" => { let d = r(self, 0)?; self.regs[d] = self.sp.wrapping_add(v(self, 1)?); }
            "sp += #i" => {
                // 4-byte `f0 e8 <imm>`: sext13(bits(16,28)) (corpus: `f0 e8 2c 1d` = -724)
                let imm = if insn.entry.len == 4 && insn.raw & 0xffff == 0xe8f0 {
                    let f = ((insn.raw >> 16) & 0x1fff) as u32;
                    if f & 0x1000 != 0 { f | !0x1fff } else { f }
                } else {
                    v(self, 0)?
                };
                self.sp = self.sp.wrapping_add(imm);
            }
            "sp = R" => self.sp = self.regs[r(self, 0)?],
            "R = R + #i" | "R = R + #h" | "R = R - #i" | "R = R & #h" | "R = R | #h"
            | "R = R ^ #h" | "R = R * #h" | "R = R & #i" | "R = R | #i" | "R = R ^ #i" => {
                let d = r(self, 0)?;
                let a = self.regs[r(self, 1)?];
                let b = v(self, 2)?;
                self.regs[d] = match &s[6..7] {
                    "+" => a.wrapping_add(b),
                    "-" => a.wrapping_sub(b),
                    "&" => a & b,
                    "|" => a | b,
                    "^" => a ^ b,
                    _ => a.wrapping_mul(b),
                };
            }
            "R = #h - R" | "R = #i - R" => {
                let d = r(self, 0)?;
                self.regs[d] = v(self, 1)?.wrapping_sub(self.regs[r(self, 2)?]);
            }
            "R = R + R" | "R = R - R" | "R = R & R" | "R = R | R" | "R = R ^ R" | "R = R * R"
            | "R = R / R (s)" | "R = R / R (u)" | "R = R % R (s)" | "R = R % R (u)" => {
                let d = r(self, 0)?;
                let a = self.regs[r(self, 1)?];
                let b = self.regs[r(self, 2)?];
                self.regs[d] = match &s[6..7] {
                    "+" => a.wrapping_add(b),
                    "-" => a.wrapping_sub(b),
                    "&" => a & b,
                    "|" => a | b,
                    "^" => a ^ b,
                    "*" => a.wrapping_mul(b),
                    "/" if s.ends_with("(s)") => if b == 0 { 0 } else { (a as i32).wrapping_div(b as i32) as u32 },
                    "/" => if b == 0 { 0 } else { a / b },
                    _ if s.ends_with("(s)") => if b == 0 { 0 } else { (a as i32).wrapping_rem(b as i32) as u32 },
                    _ => if b == 0 { 0 } else { a % b },
                };
            }
            "R += #i" | "R -= #i" | "R |= #i" | "R &= #i" | "R ^= #i" | "R *= #i"
            | "R += R" | "R -= R" | "R |= R" | "R &= R" | "R ^= R" | "R *= R" => {
                let d = r(self, 0)?;
                let b = if s.ends_with('R') { self.regs[r(self, 1)?] } else { v(self, 1)? };
                let a = self.regs[d];
                self.regs[d] = match &s[2..3] {
                    "+" => a.wrapping_add(b),
                    "-" => a.wrapping_sub(b),
                    "|" => a | b,
                    "&" => a & b,
                    "^" => a ^ b,
                    _ => a.wrapping_mul(b),
                };
            }
            "R = R << #i" | "R = R >> #i" | "R = R >>> #i" | "R = R <<< #i"
            | "R = R << R" | "R = R >> R" | "R = R >>> R" => {
                let d = r(self, 0)?;
                let a = self.regs[r(self, 1)?];
                let n = if s.ends_with('R') { self.regs[r(self, 2)?] & 31 } else { v(self, 2)? };
                // the operator starts at index 6 of "R = R << #i"; index 8 was
                // the space, which made every 4-byte `rX = rY << n` an
                // arithmetic right shift (Felucca's Huffman LUT came out empty)
                let kind = s[6..].split(' ').next().unwrap_or("<<");
                self.regs[d] = sh(a, n, kind);
            }
            "R = -R" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].wrapping_neg(); }
            "R = ~R" => { let d = r(self, 0)?; self.regs[d] = !self.regs[r(self, 1)?]; }
            "R = R.b0 (u)" | "R = R.b0 (s)" | "R = R.l (u)" | "R = R.l (s)" | "R = R.h (u)"
            | "R = R.h (s)" | "R = R.b1 (u)" | "R = R.b2 (u)" | "R = R.b3 (u)" => {
                let d = r(self, 0)?;
                let x = self.regs[r(self, 1)?];
                let signed = s.ends_with("(s)");
                // "R = R.b0 (u)": the part name starts at index 6
                self.regs[d] = match &s[6..8] {
                    "b0" => if signed { x as u8 as i8 as i32 as u32 } else { x & 0xff },
                    "b1" => (x >> 8) & 0xff,
                    "b2" => (x >> 16) & 0xff,
                    "b3" => x >> 24,
                    "l " => if signed { x as u16 as i16 as i32 as u32 } else { x & 0xffff },
                    _ => if signed { ((x >> 16) as u16 as i16 as i32) as u32 } else { x >> 16 },
                };
            }
            "goto #i" => jump = Some((next_pc as i64 + self.slot(insn, 0)?) as u32),
            "goto R" => jump = Some(self.regs[r(self, 0)?]),
            "call #i" => { self.rets = next_pc; jump = Some((next_pc as i64 + self.slot(insn, 0)?) as u32); }
            "call R" => { self.rets = next_pc; jump = Some(self.regs[r(self, 0)?]); }
            "rts" => jump = Some(self.rets),
            "pc = [sp++]" => { jump = Some(bus.read32(self.sp)); self.sp = self.sp.wrapping_add(4); }
            "rets = [sp++]" => { self.rets = bus.read32(self.sp); self.sp = self.sp.wrapping_add(4); }
            _ => return Ok(None),
        }
        Ok(Some(jump))
    }

    /// Address just past `units` instructions starting at `pc`, where a
    /// predicated `if` block counts as one unit including its then/else
    /// parts and a `rep` header includes its block (how the block-size
    /// nibbles of `if (...) {` count, verified on 2057 corpus blocks).
    fn block_end<B: Bus>(&self, bus: &mut B, mut pc: u32, units: u32) -> u32 {
        for _ in 0..units {
            let lo = bus.read32(pc) as u64;
            let hi = bus.read32(pc + 4) as u64;
            let Ok(insn) = fm1_isa::decode_win_cached((hi << 32) | lo, pc) else { return pc };
            pc += insn.entry.len as u32;
            if insn.entry.syntax.trim_end().ends_with('#') {
                // a dual-issue pair (`x #` + the next instruction) is one unit
                // (memset at 0x02042f0e: `{ r2 -= 1 #; b[r3++=1] = r1; goto }` = 2 units)
                let lo = bus.read32(pc) as u64;
                let hi = bus.read32(pc + 4) as u64;
                if let Ok(second) = fm1_isa::decode_win_cached((hi << 32) | lo, pc) {
                    pc += second.entry.len as u32;
                }
                continue;
            }
            let name = insn.entry.name;
            if insn.entry.len == 4 && name.starts_with("if") && !has(name, "goto") {
                if let Some(b) = decode_if_block(insn.raw) {
                    pc = self.block_end(bus, pc, b.then_units);
                    pc = self.block_end(bus, pc, b.else_units);
                }
            } else if name == "rep_i_r" || name == "rep_i_i" {
                pc += 2 * (((insn.raw >> 4) & 0xf) as u32 + 1);
            }
        }
        pc
    }

    fn slot(&self, insn: &Instruction, i: usize) -> Result<i64, CoreError> {
        let slots = insn.entry.slots;
        if i >= slots.len() {
            return Err(CoreError::MissingSlot {
                name: insn.entry.name,
                pc: self.pc,
                slot: i,
            });
        }
        Ok(slots[i].value(insn.raw))
    }

    fn blk(&self, insn: &Instruction, i: usize) -> Result<Vec<u8>, CoreError> {
        let slots = insn.entry.slots;
        if i >= slots.len() || slots[i].kind != SlotKind::Blk {
            return Err(CoreError::MissingSlot {
                name: insn.entry.name,
                pc: self.pc,
                slot: i,
            });
        }
        Ok(slots[i].block_regs(insn.raw))
    }

    fn reg(&self, insn: &Instruction, i: usize) -> Result<usize, CoreError> {
        Ok(self.slot(insn, i)? as usize & 0xf)
    }

    fn load(&self, insn: &Instruction, i: usize) -> Result<u32, CoreError> {
        let n = self.blk(insn, i)?;
        Ok(if n.is_empty() { 0 } else { self.regs[n[0] as usize] })
    }

    fn store_r(&mut self, insn: &Instruction, i: usize, v: u32) -> Result<(), CoreError> {
        let n = self.blk(insn, i)?;
        if !n.is_empty() {
            self.regs[n[0] as usize] = v;
        }
        Ok(())
    }

    fn branch(&self, insn: &Instruction, i: usize) -> Result<Option<u32>, CoreError> {
        let off = self.slot(insn, i)?; // Rel: mult * sext(field)
        Ok(Some((self.pc as i64 + insn.entry.len as i64 + off) as u32))
    }

    fn execute<B: Bus>(
        &mut self,
        bus: &mut B,
        insn: &Instruction,
        pre: &Pre,
        next_pc: u32,
    ) -> Result<(), CoreError> {
        let name = insn.entry.name;
        let mut jumped: Option<u32> = None;
        if trace_on() {
            eprintln!("[{}] c{} pc={:#010x} class={} len={} sp={:#x} r0-11={:x?} ",
                self.insn_count, self.core_id, self.pc, name, insn.entry.len, self.sp, &self.regs[..12]);
        }

        let alu4 = pre.alu4;
        let bittest = pre.bittest;
        #[allow(unused_variables)]
        let (n, other) = (name, name);
        if let Some(f) = pre.fast {
            jumped = self.exec_fast(bus, f, next_pc);
        } else { match pre.route {
            0 => {
                let t = bittest.unwrap();
                let mask = match t.mask {
                    Rhs::Reg(r) => self.regs[r],
                    Rhs::Imm(v) => v,
                    Rhs::Bit(r) => 1u32 << (self.regs[r] & 31),
                };
                if ((self.regs[t.reg] & mask) != 0) == t.ne {
                    jumped = Some((next_pc as i64 + t.off) as u32);
                }
            }
            1 => {
                let a = alu4.unwrap();
                let lhs = self.regs[a.src];
                let rhs = match a.rhs {
                    Rhs::Reg(r) => self.regs[r],
                    Rhs::Imm(v) => v,
                    Rhs::Bit(r) => 1u32 << (self.regs[r] & 31),
                };
                let apply = |x: u32| match a.op {
                    Op::Add => x.wrapping_add(rhs),
                    Op::Sub => x.wrapping_sub(rhs),
                    Op::RSub => rhs.wrapping_sub(x),
                    Op::Or => x | rhs,
                    Op::Xor => x ^ rhs,
                    Op::And => x & rhs,
                    Op::AndNot => x & !rhs,
                    Op::Mul => x.wrapping_mul(rhs),
                    Op::Shl => x.wrapping_shl(rhs & 31),
                    Op::Shr => x.wrapping_shr(rhs & 31),
                    Op::Sar => ((x as i32) >> (rhs & 31)) as u32,
                };
                match a.dst {
                    Dst::Reg(d) => self.regs[d] = apply(lhs),
                    Dst::Mem(off) => {
                        let addr = (self.regs[a.src] as i64 + off as i64) as u32;
                        let cur = bus.read32(addr);
                        bus.write32(addr, apply(cur));
                    }
                }
            }
            2 => {}
            3 => {}

            // ---- moves ------------------------------------------------
            4 => {
                // reg = bits(0,2) | bit7<<3 ; imm = concat((8,12),(3,5))
                let r = ((insn.raw & 7) | ((insn.raw >> 7 & 1) << 3)) as usize;
                let imm = if (insn.raw & 0xc0) == 0xc0
                    && (insn.raw >> 8 & 0xff) == 0x14
                {
                    0 // per-corpus special family ("rN = 0"-like alias)
                } else {
                    let lo = ((insn.raw >> 8) & 0x1f) as u32;
                    let hi = ((insn.raw >> 3) & 7) as u32;
                    lo | (hi << 5)
                };
                self.regs[r] = imm;
            }
            5 => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.sp = v;
            }
            6 => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.ssp = v;
                //每个 core shares one stack in bring-up
                self.sp = v;
            }
            7 => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.usp = v;
            }

            // ---- arithmetic -------------------------------------------
            8 => {
                // R = #h: reg = bits(28,31); value = composed(bits(24,27), bits(16,23))
                let raw = insn.raw;
                let d = ((raw >> 28) & 0xf) as usize;
                self.regs[d] = composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32);
            }
            9 => {
                // [R(base)+off] |=/&= R(src): base = b3>>4; src = b3&0xf;
                // off = b1 (8-bit)
                let raw = insn.raw;
                let b = ((raw >> 28) & 0xf) as usize;
                let s = ((raw >> 24) & 0xf) as usize;
                let off = (raw >> 8) & 0xff;
                let addr = self.regs[b].wrapping_add(off as u32);
                let cur = bus.read32(addr);
                let v = if has(name, "and") {
                    cur & self.regs[s]
                } else {
                    cur | self.regs[s]
                };
                bus.write32(addr, v);
            }
            10 => {
                // 2-byte `R = R <op> #i` (mask e088): dst = (0,2); src = (4,6);
                // sh = (8,12); bits 3/7 select lsl (00) / lsr (bit7) / asr
                // (bit3|bit7). Corpus: `a2 a2` r2 = r2 >> 2, `9a a2` r2 = r1 >>> 2.
                let raw = insn.raw;
                let d = (raw & 7) as usize;
                let s = ((raw >> 4) & 7) as usize;
                // a count field of 0 shifts by 32 (the vendor disassembly prints
                // `r7 = r5 >>> 32`; 73 such in the stock firmware)
                let sh = ((raw >> 8) & 0x1f) as u32;
                let sh = if sh == 0 { 32 } else { sh };
                let v = self.regs[s];
                self.regs[d] = if has(name, "lsr") {
                    if sh >= 32 { 0 } else { v >> sh }
                } else if has(name, "asr") {
                    ((v as i32) >> sh.min(31)) as u32
                } else {
                    if sh >= 32 { 0 } else { v << sh }
                };
            }

            // ---- loads / stores ---------------------------------------

            // ---- control flow -----------------------------------------
            11 =>
            {
                // 4-byte `if[s] (rN <op> #imm) goto #off` — verified on all
                // 5302 corpus samples (tools/fit_if4, 2026-10-09):
                //   reg = bits(0,3); byte1 picks the family, bit7 the op:
                //   f8 ==/!=, f9 >=/< (u), fc >/<= (u), fd >=/< (s), fe >/<= (s)
                //   imm = bits(25,31) | bits(4,6)<<7, 10 bits, sign-extended
                //   for ==/!= and the signed families (`r14 != -1`); the
                //   unsigned families print it zero-extended, so compare the
                //   zero-extended value (hardware-probe item: imm >= 512).
                //   off = 2 * sext9(bits(16,23) | bit24<<8), from pc + 4.
                let raw = insn.raw;
                let r = self.regs[(raw & 0xf) as usize];
                let fam = (raw >> 8) & 0xff;
                let alt = raw & 0x80 != 0;
                let imm10 = (((raw >> 25) & 0x7f) | (((raw >> 4) & 7) << 7)) as u32;
                let imm_s = if imm10 & 0x200 != 0 { imm10 | !0x3ff } else { imm10 };
                let off = {
                    let f = (((raw >> 16) & 0xff) | (((raw >> 24) & 1) << 8)) as i64;
                    2 * if f & 0x100 != 0 { f - 0x200 } else { f }
                };
                let taken = match (fam, alt) {
                    (0xf8, false) => r == imm_s,
                    (0xf8, true) => r != imm_s,
                    (0xf9, false) => r >= imm10,
                    (0xf9, true) => r < imm10,
                    (0xfc, false) => r > imm10,
                    (0xfc, true) => r <= imm10,
                    (0xfd, false) => (r as i32) >= (imm_s as i32),
                    (0xfd, true) => (r as i32) < (imm_s as i32),
                    (0xfe, false) => (r as i32) > (imm_s as i32),
                    _ => (r as i32) <= (imm_s as i32),
                };
                if taken {
                    jumped = Some((self.pc as i64 + 4 + off) as u32);
                }
            }
            12 =>
            {
                // 6-byte `if[s] (rN <op> #imm) goto #off` (`xx ff`, 1323 corpus
                // samples): byte0 bit0 = alt, bits(1,3) = family (as cmp_cond),
                // bit5 = immediate kind: 0 -> sext12(bits(16,27)),
                // 1 -> composed(bits(24,27), bits(16,23)); reg = bits(28,31);
                // off = 2*sext16(bits(32,47)).
                let raw = insn.raw;
                let b0 = raw & 0xff;
                let fam = (b0 >> 1) & 7;
                let imm = if b0 & 0x20 != 0 {
                    composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)
                } else {
                    // sign-extended for ==/!= and the signed families, zero-
                    // extended for the unsigned ones (corpus: `if (r2 < 2111)`)
                    let v = ((raw >> 16) & 0xfff) as u32;
                    if v & 0x800 != 0 && !matches!(fam, 1 | 4) { v | !0xfff } else { v }
                };
                let r = self.regs[((raw >> 28) & 0xf) as usize];
                if cmp_cond(fam, b0 & 1 != 0, r, imm) {
                    let off = 2 * ((raw >> 32) as u16 as i16 as i64);
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            13 =>
            {
                let (fam, alt, a, b, off) = decode_cmp_rr_branch(insn.raw, insn.entry.len).unwrap();
                if cmp_cond(fam, alt, self.regs[a], self.regs[b]) {
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            14 =>
            {
                // predicated block `if (rA <op> x) { then... } [else { ... }]`
                let blk = decode_if_block(insn.raw).unwrap();
                let a = self.regs[blk.reg];
                let b = match blk.rhs {
                    Rhs::Reg(r) => self.regs[r],
                    Rhs::Imm(v) => v,
                    Rhs::Bit(r) => 1u32 << (self.regs[r] & 31),
                };
                let taken = if blk.fam == 2 { ((a & b) != 0) == blk.alt } else { cmp_cond(blk.fam, blk.alt, a, b) };
                let then_end = self.block_end(bus, next_pc, blk.then_units);
                let else_end = self.block_end(bus, then_end, blk.else_units);
                if taken {
                    if blk.else_units > 0 {
                        self.pred_skips.retain(|&(te, _)| te != then_end);
                        self.pred_skips.push((then_end, else_end));
                    }
                } else {
                    jumped = Some(then_end);
                }
            }
            15 => {
                // `R = R.b0|.l (u|s)` (xx 17): d = bits(0,2), s = bits(4,6),
                // bit3 = signed, bit7 = halfword (.l) else byte (.b0)
                let raw = insn.raw;
                let d = (raw & 7) as usize;
                let v = self.regs[((raw >> 4) & 7) as usize];
                let signed = raw & 8 != 0;
                self.regs[d] = match (raw & 0x80 != 0, signed) {
                    (false, false) => v & 0xff,
                    (false, true) => v as u8 as i8 as i32 as u32,
                    (true, false) => v & 0xffff,
                    (true, true) => v as u16 as i16 as i32 as u32,
                };
            }
            16 =>
            {
                // 64-bit register-pair loads/stores `rH_rL = d[...]` /
                // `d[...] = rH_rL` (fitted on all 264 V13 corpus samples):
                //   pair = bits(29,31) -> (r2p+1, r2p); bit16 = store
                //   `5x ec`: base = bits(20,23),
                //            off = 4*(bits(18,19) | bits(24,28)<<2 | bit0<<6 | bit1<<7)
                //   `d0 e9`: sp-relative, off = bits(17,27)<<1 (all 810 corpus
                //            samples; the earlier bits(17,23)<<1 | bit24<<8 fit only
                //            offsets below 512 and sent Felucca's `d[sp+1056] = r11_r10`
                //            to sp+32: its LED arrays kept the last frame's keys lit)
                // The low register sits at the lower address.
                let raw = insn.raw;
                let p = ((raw >> 29) & 7) as usize;
                let (hi, lo) = (2 * p + 1, 2 * p);
                let store = (raw >> 16) & 1 != 0;
                let addr = if (raw >> 8) & 0xff == 0xec {
                    let off = 4 * (((raw >> 18) & 3) | (((raw >> 24) & 0x1f) << 2) | ((raw & 1) << 6) | (((raw >> 1) & 1) << 7));
                    self.regs[((raw >> 20) & 0xf) as usize].wrapping_add(off as u32)
                } else {
                    let off = ((raw >> 17) & 0x7ff) << 1;
                    self.sp.wrapping_add(off as u32)
                };
                if store {
                    bus.write32(addr, self.regs[lo]);
                    bus.write32(addr.wrapping_add(4), self.regs[hi]);
                } else {
                    self.regs[lo] = bus.read32(addr);
                    self.regs[hi] = bus.read32(addr.wrapping_add(4));
                }
            }
            17 =>
            {
                // 4-byte offset loads/stores `R = [rB+#i]` / `[rB+#i] = R` with
                // b/h variants (`50..57 ec/ed/ee`): the post-increment field
                // model (data bits(28,31), base bits(20,23), f = bits(16,19) |
                // bits(24,27)<<4; word/half: store = bit16, off = sext10(f&~1 |
                // bit0<<8 | bit1<<9), bit2 = signed; byte: store = bit1,
                // signed = bit2, off = bit0 ? sext8(f) : f) without a base update.
                let raw = insn.raw;
                let w = match (raw >> 8) & 0xff { 0xec => 4u8, 0xed => 2, _ => 1 };
                let d = ((raw >> 28) & 0xf) as usize;
                let b = ((raw >> 20) & 0xf) as usize;
                let f = (((raw >> 16) & 0xf) | (((raw >> 24) & 0xf) << 4)) as u32;
                let (store, off, signed) = if w == 1 {
                    let off = if raw & 1 != 0 { f as i32 - 256 } else { f as i32 };
                    ((raw >> 1) & 1 != 0, off, (raw >> 2) & 1 != 0)
                } else {
                    let v = (f & !1) | (((raw & 1) as u32) << 8) | ((((raw >> 1) & 1) as u32) << 9);
                    let off = if v & 0x200 != 0 { v as i32 - 0x400 } else { v as i32 };
                    ((raw >> 16) & 1 != 0, off, w == 2 && (raw >> 2) & 1 != 0)
                };
                let addr = self.regs[b].wrapping_add(off as u32);
                if store {
                    match w { 1 => bus.write8(addr, self.regs[d] as u8), 2 => bus.write16(addr, self.regs[d] as u16), _ => bus.write32(addr, self.regs[d]) }
                } else {
                    self.regs[d] = match (w, signed) {
                        (1, false) => bus.read8(addr) as u32,
                        (1, true) => bus.read8(addr) as i8 as i32 as u32,
                        (2, false) => bus.read16(addr) as u32,
                        (2, true) => bus.read16(addr) as i16 as i32 as u32,
                        _ => bus.read32(addr),
                    };
                }
            }
            18 =>
            {
                // 4-byte pre-increment loads/stores `R = [++rB=#i]` /
                // `[++rB=#i] = R` (446 corpus samples, 0 mismatches):
                //   half/byte `58..5f ed/ee`: the post-increment field model
                //   below, the base advanced before the access;
                //   word `d0 ec` (bit17 set): store = bit16,
                //   inc = 4*(bits(18,19) | bits(24,27)<<2 | bit0<<6 | bit1<<7)
                let raw = insn.raw;
                let w = match (raw >> 8) & 0xff { 0xec => 4u8, 0xed => 2, _ => 1 };
                let d = ((raw >> 28) & 0xf) as usize;
                let b = ((raw >> 20) & 0xf) as usize;
                let f = (((raw >> 16) & 0xf) | (((raw >> 24) & 0xf) << 4)) as u32;
                let (store, inc, signed) = if w == 4 {
                    let o = ((raw >> 18) & 3) | (((raw >> 24) & 0xf) << 2) | ((raw & 1) << 6) | (((raw >> 1) & 1) << 7);
                    ((raw >> 16) & 1 != 0, 4 * o as i32, false)
                } else if w == 1 {
                    let inc = if raw & 1 != 0 { f as i32 - 256 } else { f as i32 }; // bit0 = bit 8 of a 9-bit two's complement (b[r4+-163] = 93-256)
                    ((raw >> 1) & 1 != 0, inc, (raw >> 2) & 1 != 0)
                } else {
                    let v = (f & !1) | (((raw & 1) as u32) << 8) | ((((raw >> 1) & 1) as u32) << 9);
                    let inc = if v & 0x200 != 0 { v as i32 - 0x400 } else { v as i32 };
                    ((raw >> 16) & 1 != 0, inc, (raw >> 2) & 1 != 0)
                };
                let addr = self.regs[b].wrapping_add(inc as u32);
                self.regs[b] = addr;
                if store {
                    match w { 1 => bus.write8(addr, self.regs[d] as u8), 2 => bus.write16(addr, self.regs[d] as u16), _ => bus.write32(addr, self.regs[d]) }
                } else {
                    self.regs[d] = match (w, signed) {
                        (1, false) => bus.read8(addr) as u32,
                        (1, true) => bus.read8(addr) as i8 as i32 as u32,
                        (2, false) => bus.read16(addr) as u32,
                        (2, true) => bus.read16(addr) as i16 as i32 as u32,
                        _ => bus.read32(addr),
                    };
                }
            }
            19 =>
            {
                // 4-byte post-increment loads/stores `R = [rB++=#i]` /
                // `[rB++=#i] = R` with b/h variants (`dx ec/ed/ee`; fitted
                // on all 145 V13 corpus samples): data = bits(28,31),
                // base = bits(20,23), f = bits(16,19) | bits(24,27)<<4.
                //   word/half: store = bit16; inc = sext10(f&~1 | bit0<<8 | bit1<<9);
                //              bit2 = signed (half loads)
                //   byte:      store = bit1; bit2 = signed load;
                //              inc = bit0 ? sext8(f) : f
                let raw = insn.raw;
                let w = match (raw >> 8) & 0xff { 0xec => 4u8, 0xed => 2, _ => 1 };
                let d = ((raw >> 28) & 0xf) as usize;
                let b = ((raw >> 20) & 0xf) as usize;
                let f = (((raw >> 16) & 0xf) | (((raw >> 24) & 0xf) << 4)) as u32;
                let (store, inc, signed) = if w == 1 {
                    let inc = if raw & 1 != 0 { f as i32 - 256 } else { f as i32 }; // bit0 = bit 8 of a 9-bit two's complement (b[r4+-163] = 93-256)
                    ((raw >> 1) & 1 != 0, inc, (raw >> 2) & 1 != 0)
                } else {
                    let v = (f & !1) | (((raw & 1) as u32) << 8) | ((((raw >> 1) & 1) as u32) << 9);
                    let inc = if v & 0x200 != 0 { v as i32 - 0x400 } else { v as i32 };
                    ((raw >> 16) & 1 != 0, inc, w == 2 && (raw >> 2) & 1 != 0)
                };
                let addr = self.regs[b];
                if store {
                    match w { 1 => bus.write8(addr, self.regs[d] as u8), 2 => bus.write16(addr, self.regs[d] as u16), _ => bus.write32(addr, self.regs[d]) }
                } else {
                    self.regs[d] = match (w, signed) {
                        (1, false) => bus.read8(addr) as u32,
                        (1, true) => bus.read8(addr) as i8 as i32 as u32,
                        (2, false) => bus.read16(addr) as u32,
                        (2, true) => bus.read16(addr) as i16 as i32 as u32,
                        _ => bus.read32(addr),
                    };
                }
                self.regs[b] = addr.wrapping_add(inc as u32);
            }
            20 =>
            {
                // indexed `[rB + rI << s]` loads/stores (d8 ec/ed/ee, 1535
                // corpus samples): data reg = bits(28,31), base = bits(20,23),
                // index = bits(24,27); sub-op bits(16,19):
                //   ec: 2 ld w, 3 st w, a ld w <<2, b st w <<2
                //   ed: 0 ld h u, 1 st h, 2 ld h s, 8/9/a same with <<1
                //   ee: 0 ld b u, 1 st b, 2 ld b s
                let raw = insn.raw;
                let kind = (raw >> 8) & 0xff;
                let sub = (raw >> 16) & 0xf;
                let d = ((raw >> 28) & 0xf) as usize;
                let base = self.regs[((raw >> 20) & 0xf) as usize];
                let idx = self.regs[((raw >> 24) & 0xf) as usize];
                let shift = if sub & 8 != 0 { if kind == 0xec { 2 } else { 1 } } else { 0 };
                let addr = base.wrapping_add(idx << shift);
                match (kind, sub & 3) {
                    (0xec, 2) => self.regs[d] = bus.read32(addr),
                    (0xec, 3) => bus.write32(addr, self.regs[d]),
                    (0xed, 0) => self.regs[d] = bus.read16(addr) as u32,
                    (0xed, 1) => bus.write16(addr, self.regs[d] as u16),
                    (0xed, 2) => self.regs[d] = bus.read16(addr) as i16 as i32 as u32,
                    (0xee, 0) => self.regs[d] = bus.read8(addr) as u32,
                    (0xee, 1) => bus.write8(addr, self.regs[d] as u8),
                    (0xee, 2) => self.regs[d] = bus.read8(addr) as i8 as i32 as u32,
                    _ => {
                        self.stuck_on = Some(name);
                        return Err(CoreError::Unsupported { name, pc: self.pc, raw });
                    }
                }
            }
            21 =>
            {
                // 64-bit register-pair ops (corpus-fitted 2026-10-09):
                //   `d0 e1`: rP <<=|>>=|>>>= n  — pair = bits(29,31), op = bits(26,27)
                //            (0 <<=, 2 >>= logical, 3 >>>= arithmetic),
                //            n = bits(16,19) | bits(24,25)<<4
                //   `d8 e1`: rP <<=|>>=|>>>= rN — op = bits(16,17), n = r[bits(24,27)] & 63
                //   `f8 e1`: rP = rA * rB (u|s) — a = bits(20,23), b = bits(24,27),
                //            pair = bits(29,31), signed = bit28
                //   `f6 e1`: rP = rQ / rB (u|s) — q = bits(21,23), b = bits(24,27),
                //            pair = bits(29,31), signed = bit28
                let raw = insn.raw;
                let p = ((raw >> 29) & 7) as usize;
                let (hi, lo) = (2 * p + 1, 2 * p);
                let signed = (raw >> 28) & 1 != 0;
                match raw & 0xff {
                    0xd0 | 0xd8 => {
                        let by_reg = raw & 0xff == 0xd8;
                        let n = if by_reg { self.regs[((raw >> 24) & 0xf) as usize] & 63 }
                            else { (((raw >> 16) & 0xf) | (((raw >> 24) & 3) << 4)) as u32 };
                        let op = if by_reg { (raw >> 16) & 3 } else { (raw >> 26) & 3 };
                        let x = (self.regs[hi] as u64) << 32 | self.regs[lo] as u64;
                        let y = match op {
                            0 | 1 => x.wrapping_shl(n),
                            2 => x.wrapping_shr(n),
                            _ => ((x as i64).wrapping_shr(n)) as u64,
                        };
                        self.regs[lo] = y as u32;
                        self.regs[hi] = (y >> 32) as u32;
                    }
                    0xf8 => {
                        let a = self.regs[((raw >> 20) & 0xf) as usize];
                        let b = self.regs[((raw >> 24) & 0xf) as usize];
                        let y = if signed { (a as i32 as i64).wrapping_mul(b as i32 as i64) as u64 } else { (a as u64) * (b as u64) };
                        self.regs[lo] = y as u32;
                        self.regs[hi] = (y >> 32) as u32;
                    }
                    _ => {
                        let q = ((raw >> 21) & 7) as usize;
                        let x = (self.regs[2 * q + 1] as u64) << 32 | self.regs[2 * q] as u64;
                        let b = self.regs[((raw >> 24) & 0xf) as usize];
                        let y = if b == 0 { 0 } else if signed { (x as i64).wrapping_div(b as i32 as i64) as u64 } else { x / b as u64 };
                        self.regs[lo] = y as u32;
                        self.regs[hi] = (y >> 32) as u32;
                    }
                }
            }
            22 => {
                // `R = rev8(R)` (70 e0): d = bits(28,31), src = bits(24,27)
                let raw = insn.raw;
                let d = ((raw >> 28) & 0xf) as usize;
                self.regs[d] = self.regs[((raw >> 24) & 0xf) as usize].swap_bytes();
            }
            23 => {
                // `testset b[rN]` (bx 00): atomic test-and-set of a byte.
                // Assumed: cc = (old != 0) ("locked"), byte |= 0x80 — the
                // SDK spins with `testset; ifeq goto retry`, so "eq" must mean
                // "was already taken". Single-core emulation: always acquired.
                let addr = self.regs[(insn.raw & 0xf) as usize];
                let old = bus.read8(addr);
                self.cc = old != 0;
                bus.write8(addr, old | 0x80);
            }
            24 => {
                // `ifeq/ifne goto #off` (40/41 e8): off = 2*sext16(bits(16,31))
                let raw = insn.raw;
                let off = 2 * ((raw >> 16) as u16 as i16 as i64);
                let want = raw & 1 == 0;
                if self.cc == want {
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            25 => {
                let v = self.slot(insn, 0)? as u32;
                let cond = if has(name, "ne") {
                    self.rets != v
                } else {
                    self.rets == v
                };
                if cond {
                    jumped = self.branch(insn, 1)?;
                }
            }

            // ---- stack frames -----------------------------------------
            26 if insn.entry.len == 4 => {
                // `d9 e8 <mask>`: [--sp] = {rets, registers of mask bits(16,31)}, rets
                // first (highest address), then the registers from the highest down
                // (all 8 corpus samples, e.g. `d9 e8 f0 0d` {rets, r11, r10, r8-r4})
                let mask = ((insn.raw >> 16) & 0xffff) as u32;
                self.sp = self.sp.wrapping_sub(4);
                bus.write32(self.sp, self.rets);
                for r in (0..16).rev() {
                    if mask >> r & 1 != 0 {
                        self.sp = self.sp.wrapping_sub(4);
                        bus.write32(self.sp, self.regs[r]);
                    }
                }
            }
            26 => {
                // [--sp] = {rets, rN..rB}: n = bits(0,3); list = rets,
                // [max(n,3)..min(n,4)] descending; --sp then store each.
                let n = (insn.raw & 0xf) as i32;
                let top = n.max(3);
                let bot = n.min(4);
                for r in std::iter::once(-1i32).chain((bot..=top).rev()) {
                    self.sp = self.sp.wrapping_sub(4);
                    let v = if r < 0 { self.rets } else { self.regs[r as usize] };
                    bus.write32(self.sp, v);
                }
            }
            27 => {
                // `{rets, rN..rB} = [sp++]` (3n 04): like the pc pops but the
                // top slot restores rets instead of jumping
                let n = (insn.raw & 0xf) as i32;
                for r in n.min(4)..=n.max(3) {
                    self.regs[r as usize] = bus.read32(self.sp);
                    self.sp = self.sp.wrapping_add(4);
                }
                self.rets = bus.read32(self.sp);
                self.sp = self.sp.wrapping_add(4);
            }
            28 if insn.entry.len == 4 => {
                // `d5 e8 <mask>`: {pc, registers of mask} = [sp++], the registers from
                // the lowest up, then pc
                let mask = ((insn.raw >> 16) & 0xffff) as u32;
                for r in 0..16 {
                    if mask >> r & 1 != 0 {
                        self.regs[r] = bus.read32(self.sp);
                        self.sp = self.sp.wrapping_add(4);
                    }
                }
                jumped = Some(bus.read32(self.sp));
                self.sp = self.sp.wrapping_add(4);
            }
            28 => {
                // {pc, rN..rB} = [sp++]: pop ascending = [min(n,4)..max(n,3)] (the
                // push's range: `50 04` is {pc, r3-r0}, `5a 04` {pc, r10-r4})
                // then pc last (highest slot = pushed rets).
                let n = (insn.raw & 0xf) as i32;
                let top = n.max(3);
                let bot = n.min(4);
                for r in bot..=top {
                    self.regs[r as usize] = bus.read32(self.sp);
                    self.sp = self.sp.wrapping_add(4);
                }
                jumped = Some(bus.read32(self.sp));
                self.sp = self.sp.wrapping_add(4);
            }

            // ---- misc -------------------------------------------------
            29 => {
                // `rep N rR {` (03 xx): reg = bits(0,3), N = 2*(bits(4,7)+1)
                //   corpus: `02 03` rep 2 r2, `12 03` rep 4 r2, `ff 03` rep 32 r15
                // `rep N #k {` (8x xx): N as above, k = bits(8,12)+1
                //   corpus: `00 90` rep 2 17, `d0 94` rep 28 21, `40 9c` rep 10 29
                // The block is the N bytes after the rep instruction and runs
                // k times (register form: rR times, rR decremented to 0).
                // A zero register count skips the block: the CRT runs
                // `r2 = 0; rep 2 r2 {…}` unguarded for the empty overlay
                // (needs hardware confirmation, Phase 1.3).
                let raw = raw_v(insn);
                let n = 2 * (((raw >> 4) & 0xf) as u32 + 1);
                self.rep_start = next_pc;
                self.rep_end = next_pc + n;
                if name == "rep_i_r" {
                    let r = (raw & 0xf) as usize;
                    self.rep_reg = Some(r);
                    self.rep_count = self.regs[r];
                } else {
                    self.rep_reg = None;
                    self.rep_count = ((raw >> 8) & 0x1f) as u32 + 1;
                }
                if self.rep_count == 0 {
                    jumped = Some(self.rep_end);
                    self.rep_end = 0;
                }
            }

            ROUTE_SYNTAX => match self.exec_syntax(bus, insn, next_pc) {
                Ok(Some(j)) => jumped = j,
                Ok(None) | Err(CoreError::MissingSlot { .. }) => {
                    self.stuck_on = Some(other);
                    return Err(CoreError::Unsupported {
                        name: other,
                        pc: self.pc,
                        raw: insn.raw,
                    });
                }
                Err(e) => return Err(e),
            },
            _ => unreachable!("route out of range"),
        } }

        self.finish(jumped, next_pc);
        Ok(())
    }

    /// Retire an instruction: next pc, predicated-block skips, rep loops.
    #[inline]
    fn finish(&mut self, jumped: Option<u32>, next_pc: u32) {
        self.insn_count += 1;
        self.pc = jumped.unwrap_or(next_pc);
        if !self.pred_skips.is_empty() {
            let pc = self.pc;
            if let Some(i) = self.pred_skips.iter().position(|&(te, _)| te == pc) {
                let (_, ee) = self.pred_skips.remove(i);
                self.pc = ee;
            }
            let pc = self.pc;
            // a branch out of the construct abandons its pending skip
            self.pred_skips.retain(|&(te, _)| pc <= te);
        }
        if self.rep_end != 0 && jumped.is_none() && self.pc == self.rep_end {
            // fell off the end of a rep block: count down, loop or finish
            let remaining = match self.rep_reg {
                Some(r) => {
                    self.regs[r] = self.regs[r].wrapping_sub(1);
                    self.regs[r]
                }
                None => {
                    self.rep_count -= 1;
                    self.rep_count
                }
            };
            if remaining != 0 {
                self.pc = self.rep_start;
            } else {
                self.rep_end = 0;
            }
        }
    }
}

pub use fm1_isa::composed_imm;

/// Table-less class for the 64-bit pair op family (`d0/d8/f8/f6 e1`); the
/// raw decoder in `execute` ignores everything but `len`.
static PAIR_OP_RAW: fm1_isa::IsaEntry = fm1_isa::IsaEntry {
    name: "pair_op_raw",
    syntax: "r1_r0 pair op (raw)",
    len: 4,
    count: 0,
    mask: 0,
    match_: 0,
    group: "misc",
    alt: &[],
    samples: &[],
    slots: &[],
};

fn sreg_get_named(cpu: &Cpu, n: &str) -> u32 {
    match n {
        "rets" => cpu.rets,
        "sp" => cpu.sp,
        "ssp" => cpu.ssp,
        "usp" => cpu.usp,
        _ => cpu.sregs(n),
    }
}

#[derive(Clone, Copy, Debug)]
enum Op { Add, Sub, RSub, Or, Xor, And, AndNot, Mul, Shl, Shr, Sar }
#[derive(Clone, Copy, Debug)]
enum Rhs { Reg(usize), Imm(u32), Bit(usize) }

/// Compare condition shared by every `if` family: `fam` = byte1 & 7 of the
/// 4-byte forms (e8 ==, e9 >= u, ec > u, ed >= s, ee > s), which is also the
/// family code of the 2-byte-immediate (f8/f9/fc/fd/fe) and 6-byte (4x ff)
/// forms; `alt` (bit7 / bit0) flips to !=, <, <=.
fn cmp_cond(fam: u64, alt: bool, a: u32, b: u32) -> bool {
    let base = match fam {
        0 => a == b,
        1 => a >= b,
        4 => a > b,
        5 => (a as i32) >= (b as i32),
        _ => (a as i32) > (b as i32),
    };
    base != alt
}

/// `if[s] (rA <op> rB) goto #off` — 4-byte (byte1 e8/e9/ec/ed/ee, bit7 alt,
/// A = bits(28,31), B = bits(0,3), off = 2*sext9(bits(16,23) | bit24<<8))
/// and 6-byte (`4x ff`: fam = bits(1,3), bit0 alt, A = bits(28,31),
/// B = bits(24,27), off = 2*sext16(bits(32,47))). 2213 corpus samples.
fn decode_cmp_rr_branch(raw: u64, len: u8) -> Option<(u64, bool, usize, usize, i64)> {
    let b0 = raw & 0xff;
    let b1 = (raw >> 8) & 0xff;
    match (len, b1) {
        (4, 0xe8 | 0xe9 | 0xec | 0xed | 0xee) if b0 & 0x70 == 0 => {
            let f = (((raw >> 16) & 0xff) | (((raw >> 24) & 1) << 8)) as i64;
            let off = 2 * if f & 0x100 != 0 { f - 0x200 } else { f };
            Some((b1 & 7, b0 & 0x80 != 0, ((raw >> 28) & 0xf) as usize, (raw & 0xf) as usize, off))
        }
        (6, 0xff) if b0 >> 4 == 4 => Some((
            (b0 >> 1) & 7,
            b0 & 1 != 0,
            ((raw >> 28) & 0xf) as usize,
            ((raw >> 24) & 0xf) as usize,
            2 * ((raw >> 32) as u16 as i16 as i64),
        )),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug)]
struct IfBlock { fam: u64, alt: bool, reg: usize, rhs: Rhs, then_units: u32, else_units: u32 }

/// Predicated block `if[s] (rA <op> x) {` (4-byte, byte1 e8/e9/ea/ec/ed/ee):
/// rA = bits(0,3); byte0 high nibble h: h&3 = 1 reg (rB = bits(24,27)),
/// 2 composed immediate, 3 sext12(bits(16,27)); bit7 flips the op (for the
/// bit-test family ea: h=2 ==0, h=3 !=0, reg form byte2 bit7 = !=0).
/// Block sizes in bits(28,31): then = bits(30,31)+1 instructions, else =
/// bits(28,29) (2057 corpus blocks).
fn decode_if_block(raw: u64) -> Option<IfBlock> {
    let b0 = raw & 0xff;
    let b1 = (raw >> 8) & 0xff;
    if !matches!(b1, 0xe8 | 0xe9 | 0xea | 0xec | 0xed | 0xee) {
        return None;
    }
    let h = b0 >> 4;
    let fam = b1 & 7;
    let (rhs, alt) = match (fam, h & 7) {
        (2, 1) => (Rhs::Reg(((raw >> 24) & 0xf) as usize), (raw >> 23) & 1 != 0),
        (2, 2) | (2, 3) => (
            Rhs::Imm(composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)),
            h & 1 != 0,
        ),
        (_, 1) => (Rhs::Reg(((raw >> 24) & 0xf) as usize), h & 8 != 0),
        (_, 2) => (
            Rhs::Imm(composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)),
            h & 8 != 0,
        ),
        (_, 3) => {
            // sext12, except the unsigned families (e9 >=, ec >) zero-extend
            // (`if (r1 <= 4000) {` must compare against 4000, not -96)
            let v = ((raw >> 16) & 0xfff) as u32;
            let v = if v & 0x800 != 0 && !matches!(fam, 1 | 4) { v | !0xfff } else { v };
            (Rhs::Imm(v), h & 8 != 0)
        }
        _ => return None,
    };
    Some(IfBlock {
        fam,
        alt,
        reg: (raw & 0xf) as usize,
        rhs,
        then_units: ((raw >> 30) & 3) as u32 + 1,
        else_units: ((raw >> 28) & 3) as u32,
    })
}
#[derive(Clone, Copy, Debug)]
enum Dst { Reg(usize), Mem(i32) }
#[derive(Clone, Copy, Debug)]
struct Alu4 { dst: Dst, src: usize, op: Op, rhs: Rhs }

fn sext6x4(v: u64) -> i32 {
    let v = (v & 0x3f) as i32;
    4 * if v & 0x20 != 0 { v - 0x40 } else { v }
}

/// The 4-byte ALU families with byte1 = e0/e1/e8/eb/ef. Every shape below was
/// verified on all its V13 corpus samples (2026-10-09, see docs/isa-notes.md):
///   e0 b4 / e1 90 / e1 f0   R = R op R: d=bits(28,31) a=bits(20,23) b=bits(24,27),
///                           sub-op bits(16,19): b4 {0 +, 2 -}, 90 {0 |, 1 ^, 2 &}, f0 {0 *}
///   e1 op4 0..3             R = R + sext14(bits(16,27) | op4<<12)
///   e1 op4 4/5/6/7, e       R = R |,^,&,&~,* composed;  e0 op4 e/f: R +,- composed;
///   e0 op4 a                R = composed - R          (d=bits(0,3), s=bits(28,31))
///   e8 64 / 68              [R+off] op= R: base=bits(28,31) src=bits(24,27)
///                           off=4*sext6(bits(18,23)) op=bits(16,17): 64 {|,^,&} 68 {+,-}
///   eb / ef                 [R+off] op= imm: base=bits(28,31) off=4*sext6(bits(0,5))
///                           bits(6,7): ef {0 |, 1 ^, 2 &, 3 &~} composed;
///                           eb {2 += composed, 3 += sext12(bits(16,27))}
fn decode_alu4(raw: u64) -> Option<Alu4> {
    let b0 = (raw & 0xff) as u32;
    // f0/f1 are the flag-setting twins of e0/e1 (printed with a trailing `#`)
    let b1 = match ((raw >> 8) & 0xff) as u32 { 0xf0 => 0xe0, 0xf1 => 0xe1, x => x };
    let op4 = b0 >> 4;
    let code = ((raw >> 24) & 0xf) as u32;
    let m = ((raw >> 16) & 0xff) as u32;
    let imm12 = ((raw >> 16) & 0xfff) as u32;
    let comp = composed_imm(code, m);
    let d_lo = (b0 & 0xf) as usize;
    let s_hi = ((raw >> 28) & 0xf) as usize;
    let reg_dst = |op: Op, rhs: Rhs| Some(Alu4 { dst: Dst::Reg(d_lo), src: s_hi, op, rhs });
    match b1 {
        // (`fX e0` is `R = R - #h`, handled below: only `f0 e1` multiplies)
        0xe0 | 0xe1 if matches!(b0, 0xb4 | 0x90 | 0xc8 | 0x94) || (b0 == 0xf0 && b1 == 0xe1) => {
            // three-register forms; c8 = shifts by register, 94 = `R op (1 << R)`
            let sub = ((raw >> 16) & 0xf) as u32;
            let op = match (b0, sub) {
                (0xb4, 0) => Op::Add,
                (0xb4, 2) => Op::Sub,
                (0x90, 0) | (0x94, 0) => Op::Or,
                (0x90, 1) | (0x94, 1) => Op::Xor,
                (0x90, 2) | (0x94, 2) => Op::And,
                (0xf0, 0) => Op::Mul,
                (0xc8, 0) => Op::Shl,
                (0xc8, 2) => Op::Shr,
                (0xc8, 3) => Op::Sar,
                _ => return None,
            };
            let r = ((raw >> 24) & 0xf) as usize;
            Some(Alu4 {
                dst: Dst::Reg(s_hi),
                src: ((raw >> 20) & 0xf) as usize,
                op,
                rhs: if b0 == 0x94 { Rhs::Bit(r) } else { Rhs::Reg(r) },
            })
        }
        0xe0 => match op4 {
            0xe => reg_dst(Op::Add, Rhs::Imm(comp)),
            0xf => reg_dst(Op::Sub, Rhs::Imm(comp)),
            0xa => reg_dst(Op::RSub, Rhs::Imm(comp)),
            _ => None,
        },
        0xe1 => match op4 {
            0..=3 => {
                let v = imm12 | (op4 << 12);
                let v = if v & 0x2000 != 0 { v | !0x3fff } else { v };
                reg_dst(Op::Add, Rhs::Imm(v))
            }
            4 => reg_dst(Op::Or, Rhs::Imm(comp)),
            5 => reg_dst(Op::Xor, Rhs::Imm(comp)),
            6 => reg_dst(Op::And, Rhs::Imm(comp)),
            7 => reg_dst(Op::AndNot, Rhs::Imm(comp)),
            0xe => reg_dst(Op::Mul, Rhs::Imm(comp)),
            _ => None,
        },
        0xe8 if b0 == 0x6c => {
            // `[R+#i] <<= #n` (6c e8): base bits 28-31, word offset bits
            // 18-23, shift bits 24-27, op bits 16-17 like the e1 shifts
            let op = match (raw >> 16) & 3 {
                0 => Op::Shl,
                2 => Op::Shr,
                3 => Op::Sar,
                _ => return None,
            };
            Some(Alu4 {
                dst: Dst::Mem(sext6x4(raw >> 18)),
                src: s_hi,
                op,
                rhs: Rhs::Imm(((raw >> 24) & 0xf) as u32),
            })
        }
        0xe8 if matches!(b0, 0x64 | 0x68) => {
            let op = match (b0, (raw >> 16) & 3) {
                (0x64, 0) => Op::Or,
                (0x64, 1) => Op::Xor,
                (0x64, 2) => Op::And,
                (0x68, 0) => Op::Add,
                (0x68, 2) => Op::Sub,
                _ => return None,
            };
            Some(Alu4 {
                dst: Dst::Mem(sext6x4(raw >> 18)),
                src: s_hi,
                op,
                rhs: Rhs::Reg(((raw >> 24) & 0xf) as usize),
            })
        }
        0xeb | 0xef => {
            let sel = (b0 >> 6) & 3;
            let (op, v) = match (b1, sel) {
                (0xef, 0) => (Op::Or, comp),
                (0xef, 1) => (Op::Xor, comp),
                (0xef, 2) => (Op::And, comp),
                (0xef, 3) => (Op::AndNot, comp),
                (0xeb, 2) => (Op::Add, comp),
                (0xeb, 3) => (Op::Add, if imm12 & 0x800 != 0 { imm12 | !0xfff } else { imm12 }),
                _ => return None,
            };
            Some(Alu4 { dst: Dst::Mem(sext6x4(raw)), src: s_hi, op, rhs: Rhs::Imm(v) })
        }
        _ => None,
    }
}

#[derive(Clone, Copy, Debug)]
struct BitTest { reg: usize, mask: Rhs, ne: bool, off: i64 }

/// `if ((rN & mask) ==/!= 0) goto #off`, three encodings (verified on all
/// 1358 V13 corpus samples, 2026-10-09):
///   6-byte `60/61 ff`: reg = bits(28,31), bit0 = !=, mask = composed
///                      (bits(24,27), bits(16,23)), off = 2*sext16(bits(32,47))
///   4-byte `5x e8`:    reg = bits(0,3), mask = 1 << bits(27,31), bit25 = !=,
///                      off = 2*sext9(bits(16,23) | bit24<<8)
///   4-byte `fa/fb`:    reg = bits(0,3), mask = r[bits(4,7)], byte1 fb = !=,
///                      off = 2*sext16(bits(16,31))
fn decode_bittest(raw: u64, len: u8) -> Option<BitTest> {
    let b0 = (raw & 0xff) as u32;
    let b1 = ((raw >> 8) & 0xff) as u32;
    let sext = |v: u64, bits: u32| -> i64 {
        let v = (v & ((1u64 << bits) - 1)) as i64;
        if v & (1 << (bits - 1)) != 0 { v - (1 << bits) } else { v }
    };
    match (len, b1) {
        (6, 0xff) if b0 >> 1 == 0x30 => Some(BitTest {
            reg: ((raw >> 28) & 0xf) as usize,
            mask: Rhs::Imm(composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)),
            ne: b0 & 1 != 0,
            off: 2 * sext(raw >> 32, 16),
        }),
        (4, 0xe8) if b0 >> 4 == 5 => Some(BitTest {
            reg: (raw & 0xf) as usize,
            mask: Rhs::Imm(1u32 << ((raw >> 27) & 0x1f)),
            ne: (raw >> 25) & 1 != 0,
            off: 2 * sext(((raw >> 16) & 0xff) | (((raw >> 24) & 1) << 8), 9),
        }),
        (4, 0xfa | 0xfb) => Some(BitTest {
            reg: (raw & 0xf) as usize,
            mask: Rhs::Reg(((raw >> 4) & 0xf) as usize),
            ne: b1 & 1 != 0,
            off: 2 * sext(raw >> 16, 16),
        }),
        _ => None,
    }
}

/// Observed `R = #h` composed-constant values, keyed (b3 low nibble, b2),
/// from all five vendor-objdump corpora. Kept as the regression oracle for
/// `composed_imm` (see the `composed_matches_observed_table` test).
pub static MOV_H_TABLE: &[(u8, u8, u32)] = &[
        (0x2_u8, 0x64_u8, 0x64006400_u32),
        (0x3_u8, 0x05_u8, 0x05050505_u32),
        (0x3_u8, 0x30_u8, 0x30303030_u32),
        (0x3_u8, 0x32_u8, 0x32323232_u32),
        (0x3_u8, 0xc1_u8, 0xc1c1c1c1_u32),
        (0x3_u8, 0xcc_u8, 0xcccccccc_u32),
        (0x3_u8, 0xff_u8, 0xffffffff_u32),
        (0x4_u8, 0x00_u8, 0x80000000_u32),
        (0x4_u8, 0x08_u8, 0x88000000_u32),
        (0x4_u8, 0x40_u8, 0xc0000000_u32),
        (0x4_u8, 0x60_u8, 0xe0000000_u32),
        (0x4_u8, 0x70_u8, 0xf0000000_u32),
        (0x4_u8, 0x83_u8, 0x41800000_u32),
        (0x4_u8, 0x86_u8, 0x43000000_u32),
        (0x4_u8, 0x87_u8, 0x43800000_u32),
        (0x4_u8, 0x88_u8, 0x44000000_u32),
        (0x4_u8, 0x9f_u8, 0x4f800000_u32),
        (0x4_u8, 0xf0_u8, 0x78000000_u32),
        (0x5_u8, 0x42_u8, 0x30800000_u32),
        (0x5_u8, 0x50_u8, 0x34000000_u32),
        (0x5_u8, 0x60_u8, 0x38000000_u32),
        (0x5_u8, 0x7a_u8, 0x3e800000_u32),
        (0x5_u8, 0x7c_u8, 0x3f000000_u32),
        (0x5_u8, 0x7e_u8, 0x3f800000_u32),
        (0x5_u8, 0xc0_u8, 0x18000000_u32),
        (0x6_u8, 0x00_u8, 0x08000000_u32),
        (0x6_u8, 0x80_u8, 0x04000000_u32),
        (0x6_u8, 0xb0_u8, 0x05800000_u32),
        (0x6_u8, 0xef_u8, 0x07780000_u32),
        (0x7_u8, 0x00_u8, 0x02000000_u32),
        (0x7_u8, 0x80_u8, 0x01000000_u32),
        (0x7_u8, 0xf8_u8, 0x01f00000_u32),
        (0x8_u8, 0x00_u8, 0x00800000_u32),
        (0x9_u8, 0x00_u8, 0x00200000_u32),
        (0x9_u8, 0x10_u8, 0x00240000_u32),
        (0x9_u8, 0x40_u8, 0x00300000_u32),
        (0x9_u8, 0x80_u8, 0x00100000_u32),
        (0xa_u8, 0x10_u8, 0x00090000_u32),
        (0xa_u8, 0x30_u8, 0x000b0000_u32),
        (0xa_u8, 0x70_u8, 0x000f0000_u32),
        (0xa_u8, 0x80_u8, 0x00040000_u32),
        (0xa_u8, 0xa0_u8, 0x00050000_u32),
        (0xa_u8, 0xa2_u8, 0x00051000_u32),
        (0xb_u8, 0x00_u8, 0x00020000_u32),
        (0xb_u8, 0x20_u8, 0x00028000_u32),
        (0xb_u8, 0x3f_u8, 0x0002fc00_u32),
        (0xb_u8, 0x80_u8, 0x00010000_u32),
        (0xb_u8, 0x81_u8, 0x00010200_u32),
        (0xb_u8, 0x82_u8, 0x00010400_u32),
        (0xb_u8, 0x84_u8, 0x00010800_u32),
        (0xb_u8, 0x8c_u8, 0x00011800_u32),
        (0xb_u8, 0x8e_u8, 0x00011c00_u32),
        (0xb_u8, 0x8f_u8, 0x00011e00_u32),
        (0xb_u8, 0x90_u8, 0x00012000_u32),
        (0xb_u8, 0x97_u8, 0x00012e00_u32),
        (0xb_u8, 0x98_u8, 0x00013000_u32),
        (0xb_u8, 0x9a_u8, 0x00013400_u32),
        (0xb_u8, 0x9b_u8, 0x00013600_u32),
        (0xb_u8, 0x9f_u8, 0x00013e00_u32),
        (0xb_u8, 0xa0_u8, 0x00014000_u32),
        (0xb_u8, 0xa9_u8, 0x00015200_u32),
        (0xb_u8, 0xb0_u8, 0x00016000_u32),
        (0xb_u8, 0xb4_u8, 0x00016800_u32),
        (0xb_u8, 0xb5_u8, 0x00016a00_u32),
        (0xb_u8, 0xf8_u8, 0x0001f000_u32),
        (0xc_u8, 0x00_u8, 0x00008000_u32),
        (0xc_u8, 0x1c_u8, 0x00009c00_u32),
        (0xc_u8, 0x40_u8, 0x0000c000_u32),
        (0xc_u8, 0x7e_u8, 0x0000fe00_u32),
        (0xc_u8, 0x7f_u8, 0x0000ff00_u32),
];


fn raw_v(insn: &Instruction) -> u64 {
    insn.raw
}

/// Parse the `rHI_rLO` register-pair token from a d-access class name.

fn sext(v: u32, bits: u8) -> i64 {
    let v = v & ((1u32 << bits) - 1);
    if bits < 32 && v & (1 << (bits - 1)) != 0 {
        (v as i64) - (1i64 << bits)
    } else {
        v as i64
    }
}

#[derive(Debug)]
pub enum CoreError {
    Decode(DecodeError),
    Unsupported { name: &'static str, pc: u32, raw: u64 },
    MissingSlot { name: &'static str, pc: u32, slot: usize },
}

/// A flat RAM bus for unit tests — no peripherals, no side effects.
#[cfg(test)]
mod tests {
    use super::*;

    struct FlatRam {
        mem: Vec<u8>,
    }

    impl FlatRam {
        fn new(mem: Vec<u8>) -> Self {
            Self { mem }
        }
    }

    impl Bus for FlatRam {
        fn read8(&mut self, addr: u32) -> u8 {
            *self.mem.get(addr as usize).unwrap_or(&0)
        }
        fn read16(&mut self, addr: u32) -> u16 {
            u16::from_le_bytes([self.read8(addr), self.read8(addr + 1)])
        }
        fn read32(&mut self, addr: u32) -> u32 {
            u32::from_le_bytes([
                self.read8(addr),
                self.read8(addr + 1),
                self.read8(addr + 2),
                self.read8(addr + 3),
            ])
        }
        fn write8(&mut self, addr: u32, value: u8) {
            if (addr as usize) < self.mem.len() {
                self.mem[addr as usize] = value;
            }
        }
        fn write16(&mut self, addr: u32, value: u16) {
            for (i, b) in value.to_le_bytes().iter().enumerate() {
                self.write8(addr + i as u32, *b);
            }
        }
        fn write32(&mut self, addr: u32, value: u32) {
            for (i, b) in value.to_le_bytes().iter().enumerate() {
                self.write8(addr + i as u32, *b);
            }
        }
    }

    #[test]
    fn nop_runs_at_entry() {
        let mut ram = FlatRam::new(vec![0u8; 16]);
        let mut cpu = Cpu::new(0);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.insn_count, 1);
        assert_eq!(cpu.pc, 2);
    }

    #[test]
    fn goto_rel_jumps() {
        // `04 81` = goto +2 (from entry 0)
        let mut ram = FlatRam::new(vec![0x04, 0x81, 0, 0, 0u8, 0, 0, 0, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.pc, 4); // 2 + 2
    }

    #[test]
    fn mov_imm_l2_loads_algebra() {
        // `40 2a` = r0 = 10 (per corpus)
        let mut ram = FlatRam::new(vec![0x40, 0x2a, 0, 0, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[0], 10);
        // `45 24` = r5 = 4
        let mut ram = FlatRam::new(vec![0x45, 0x24, 0, 0, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[5], 4);
    }

    #[test]
    fn call_l6_jumps_and_sets_rets() {
        use super::*;
        struct FlatRam { mem: Vec<u8> }
        impl Bus for FlatRam {
            fn read8(&mut self, a: u32) -> u8 { *self.mem.get(a as usize).unwrap_or(&0) }
            fn read16(&mut self, a: u32) -> u16 { u16::from_le_bytes([self.read8(a), self.read8(a+1)]) }
            fn read32(&mut self, a: u32) -> u32 { u32::from_le_bytes([self.read8(a), self.read8(a+1), self.read8(a+2), self.read8(a+3)]) }
            fn write8(&mut self, a: u32, v: u8) { if (a as usize) < self.mem.len() { self.mem[a as usize] = v; } }
            fn write16(&mut self, a: u32, v: u16) { for (i, b) in v.to_le_bytes().iter().enumerate() { self.write8(a + i as u32, *b); } }
            fn write32(&mut self, a: u32, v: u32) { for (i, b) in v.to_le_bytes().iter().enumerate() { self.write8(a + i as u32, *b); } }
        }
        // 80 ff a0 5a c0 ff = call -4171104 (pc 0x1a6): target 0xffc05c52
        let mut ram = FlatRam { mem: vec![0x80, 0xff, 0xa0, 0x5a, 0xc0, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
        let mut cpu = Cpu::new(0);
        cpu.step(&mut ram).unwrap();
        eprintln!("after long call: pc={:#x} rets={:#x}", cpu.pc, cpu.rets);
        assert_eq!(cpu.rets, 6);
        assert_eq!(cpu.pc, (6i64 + (-4171104i64)) as u32);
    }
    #[test]
    fn unsupported_class_halts() {
        // `a0 00` = swi 0 — no semantics yet; must halt, not nop-slide
        let mut ram = FlatRam::new(vec![0xa0, 0x00, 0, 0, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        match cpu.step(&mut ram) {
            Err(CoreError::Unsupported { name, .. }) => {
                assert_eq!(name, "swi_i");
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn composed_matches_observed_table() {
        for (code, m, v) in MOV_H_TABLE {
            assert_eq!(
                composed_imm(*code as u32, *m as u32),
                *v,
                "composed({code:#x}, {m:#04x})"
            );
        }
        // corpus spot checks beyond the table
        assert_eq!(composed_imm(0xe, 0x01), 0x810); // r0 = r0 | 0x810
        assert_eq!(composed_imm(0xf, 0x7f), 0x3fc); // r0 = r0 & 0x3FC
        assert_eq!(composed_imm(0x1, 0x5f), 0x5f005f); // [r13+0] |= 0x5F005F
        assert_eq!(composed_imm(0x3, 0xff), 0xffff_ffff);
    }

    #[test]
    fn alu4_shapes() {
        // `90 e1 20 01` r0 = r2 | r1 ; `36 e1 f0 4f` r6 = r4 + -16 ;
        // `c0 ef 40 0f` [r0+0] &= 0xFFFFFCFF ; `64 e8 0a 02` [r0+8] &= r2
        let mut mem = vec![0u8; 0x100];
        mem[..16].copy_from_slice(&[
            0x90, 0xe1, 0x20, 0x01, 0x36, 0xe1, 0xf0, 0x4f, 0xc0, 0xef, 0x40, 0x0f, 0x64, 0xe8,
            0x0a, 0x02,
        ]);
        mem[0x40..0x44].copy_from_slice(&0xffff_ffffu32.to_le_bytes());
        mem[0x48..0x4c].copy_from_slice(&0x0000_f0f0u32.to_le_bytes());
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[1] = 0x10;
        cpu.regs[2] = 0x0f;
        cpu.regs[4] = 100;
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[0], 0x1f);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[6], 84);
        cpu.regs[0] = 0x40;
        cpu.step(&mut ram).unwrap();
        assert_eq!(ram.read32(0x40), 0xffff_fcff);
        cpu.step(&mut ram).unwrap();
        assert_eq!(ram.read32(0x48), 0x0000_f0f0 & 0x0f);
        assert_eq!(cpu.pc, 16);
    }

    #[test]
    fn pair_store_and_load() {
        // `50 ec 35 40` d[r3+4] = r5_r4 ; `50 ec 00 20` r3_r2 = d[r0+0]
        let mut mem = vec![0u8; 0x100];
        mem[..8].copy_from_slice(&[0x50, 0xec, 0x35, 0x40, 0x50, 0xec, 0x00, 0x20]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[3] = 0x40;
        cpu.regs[4] = 0x1000;
        cpu.regs[5] = 0x2000;
        cpu.step(&mut ram).unwrap();
        assert_eq!(ram.read32(0x44), 0x1000, "low register at the lower address");
        assert_eq!(ram.read32(0x48), 0x2000);
        cpu.regs[0] = 0x44;
        cpu.step(&mut ram).unwrap();
        assert_eq!((cpu.regs[2], cpu.regs[3]), (0x1000, 0x2000));
    }

    #[test]
    fn pair_head_byte_extract() {
        // `00 d7` r0 = r0.b0 (u) #  paired with `c8 4b` b[r4+11] = r0: the
        // store sees the old r0, r0 ends up as the low byte
        let mut mem = vec![0u8; 0x100];
        mem[..4].copy_from_slice(&[0x00, 0xd7, 0xc8, 0x4b]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[0] = 0xDEAD_BEEF;
        cpu.regs[4] = 0x40;
        cpu.step(&mut ram).unwrap();
        cpu.step(&mut ram).unwrap();
        assert_eq!(ram.read8(0x4b), 0xEF);
        assert_eq!(cpu.regs[0], 0xEF);
    }

    #[test]
    fn shift_imm_high_source_register() {
        // `c0 e1 c8 10` r1 = r12 << 8 and `c0 e1 c1 38` r3 = r12 >> 1
        let mut mem = vec![0u8; 0x100];
        mem[..8].copy_from_slice(&[0xc0, 0xe1, 0xc8, 0x10, 0xc0, 0xe1, 0xc1, 0x38]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[12] = 0x3;
        cpu.step(&mut ram).unwrap();
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[1], 0x300);
        assert_eq!(cpu.regs[3], 0x1);
    }

    #[test]
    fn sp_pair_store_large_offset() {
        // `d0 e9 21 a4` d[sp+1056] = r11_r10 (Felucca ui_leds), read back with
        // `d0 e9 c0 01` r1_r0 = d[sp+448] (pair loads in the corpora stop at 448)
        let mut mem = vec![0u8; 0x800];
        mem[..8].copy_from_slice(&[0xd0, 0xe9, 0x21, 0xa4, 0xd0, 0xe9, 0xc0, 0x01]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.sp = 0x100;
        cpu.regs[10] = 0x1122_3344;
        cpu.regs[11] = 0x5566_7788;
        cpu.step(&mut ram).unwrap();
        assert_eq!(ram.read32(0x100 + 1056), 0x1122_3344);
        assert_eq!(ram.read32(0x100 + 1060), 0x5566_7788);
        cpu.sp = 0x100 + 1056 - 448;
        cpu.step(&mut ram).unwrap();
        assert_eq!((cpu.regs[0], cpu.regs[1]), (0x1122_3344, 0x5566_7788));
    }

    #[test]
    fn short_shift_by_32() {
        // `df a0` r7 = r5 >>> 32, `32 a0` r2 = r3 << 32 (count field 0 = 32)
        let mut mem = vec![0u8; 0x100];
        mem[..4].copy_from_slice(&[0xdf, 0xa0, 0x32, 0xa0]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[5] = 0x8000_1234;
        cpu.regs[3] = 0xffff_ffff;
        cpu.step(&mut ram).unwrap();
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[7], 0xffff_ffff);
        assert_eq!(cpu.regs[2], 0);
    }

    #[test]
    fn push_pop_register_mask() {
        // `d9 e8 f0 0d` [--sp] = {rets, r11, r10, r8-r4}, `d5 e8 f0 0d` the matching pop
        let mut mem = vec![0u8; 0x200];
        mem[..8].copy_from_slice(&[0xd9, 0xe8, 0xf0, 0x0d, 0xd5, 0xe8, 0xf0, 0x0d]);
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.sp = 0x200;
        cpu.rets = 0x44;
        for r in 0..16 {
            cpu.regs[r] = 0x100 + r as u32;
        }
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.sp, 0x200 - 4 * 8);
        assert_eq!(ram.read32(0x1fc), 0x44); // rets on top
        assert_eq!(ram.read32(0x1f8), 0x10b); // then r11
        assert_eq!(ram.read32(0x200 - 32), 0x104); // r4 lowest
        for r in 0..16 {
            cpu.regs[r] = 0;
        }
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.pc, 0x44);
        assert_eq!(cpu.sp, 0x200);
        assert_eq!((cpu.regs[4], cpu.regs[8], cpu.regs[9], cpu.regs[10], cpu.regs[11]), (0x104, 0x108, 0, 0x10a, 0x10b));
    }

    #[test]
    fn shift_and_add_fields() {
        // `a2 a2` r2 = r2 >> 2 ; `9a a2` r2 = r1 >>> 2 ; `93 1c` r3 = r1 + r2
        let mut ram = FlatRam::new(vec![0xa2, 0xa2, 0x9a, 0xa2, 0x93, 0x1c, 0, 0, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        cpu.regs[1] = 0xffff_fff0;
        cpu.regs[2] = 0x9e7c;
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[2], 0x9e7c >> 2);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[2], 0xffff_fffc);
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.regs[3], 0xffff_fff0u32.wrapping_add(0xffff_fffc));
    }

    #[test]
    fn rep_block_runs_register_count_times() {
        // CRT .data copy shape: `12 03` rep 4 r2 { `13 05` r3 = [r1++=4];
        // `c3 05` [r4++=4] = r3 } then `80 00` rts
        let mut mem = vec![0u8; 0x100];
        mem[..8].copy_from_slice(&[0x12, 0x03, 0x13, 0x05, 0xc3, 0x05, 0x80, 0x00]);
        for i in 0..3u32 {
            mem[(0x40 + 4 * i) as usize..][..4].copy_from_slice(&(0x1111 * (i + 1)).to_le_bytes());
        }
        let mut ram = FlatRam::new(mem);
        let mut cpu = Cpu::new(0);
        cpu.regs[1] = 0x40;
        cpu.regs[2] = 3;
        cpu.regs[4] = 0x80;
        for _ in 0..7 {
            cpu.step(&mut ram).unwrap();
        }
        assert_eq!(cpu.pc, 6, "block ran 3 times then fell through");
        assert_eq!(cpu.regs[2], 0);
        assert_eq!(cpu.regs[1], 0x4c);
        assert_eq!(cpu.regs[4], 0x8c);
        assert_eq!(ram.read32(0x88), 0x3333);
        // zero count skips the block entirely
        let mut ram = FlatRam::new(vec![0x02, 0x03, 0xb1, 0x05, 0x80, 0x00, 0, 0, 0, 0]);
        let mut cpu = Cpu::new(0);
        cpu.regs[2] = 0;
        cpu.step(&mut ram).unwrap();
        assert_eq!(cpu.pc, 4);
    }
}

/// Substring test for the short syntax/class strings: a plain window scan
/// beats `str::contains`, whose searcher setup dominated the step loop.
#[inline]
fn has(h: &str, n: &str) -> bool {
    let (h, n) = (h.as_bytes(), n.as_bytes());
    n.len() <= h.len() && h.windows(n.len()).any(|w| w == n)
}

fn trace_on() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var("FM1_TRACE").is_ok())
}

thread_local! {
    static CANON: std::cell::RefCell<std::collections::HashMap<usize, &'static str>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

/// The printed syntax with the sign of `-#i` folded into the slot and the
/// dual-issue ` #` stripped, memoised per class.
fn canon_syntax(e: &'static fm1_isa::IsaEntry) -> &'static str {
    let key = e as *const _ as usize;
    if let Some(s) = CANON.with(|c| c.borrow().get(&key).copied()) {
        return s;
    }
    let canon = e.syntax.replace("-#i", "#i").replace("-#h", "#h");
    let s: &'static str = Box::leak(canon.trim_end_matches(" #").trim_end().to_string().into_boxed_str());
    CANON.with(|c| c.borrow_mut().insert(key, s));
    s
}

/// `str::split_once` for short literal patterns without the searcher setup.
#[inline]
fn split2<'a>(h: &'a str, n: &str) -> Option<(&'a str, &'a str)> {
    let (hb, nb) = (h.as_bytes(), n.as_bytes());
    if nb.len() > hb.len() {
        return None;
    }
    let i = hb.windows(nb.len()).position(|w| w == nb)?;
    Some((&h[..i], &h[i + nb.len()..]))
}

/// Everything about an instruction word that does not depend on the
/// machine state, worked out once (`Cpu::fetch`).
#[derive(Clone, Copy, Debug)]
pub struct Pre {
    route: u16,
    /// A micro-op for the commonest generic shapes (see `fast_of`).
    fast: Option<Fast>,
    alu4: Option<Alu4>,
    bittest: Option<BitTest>,
    pair_head: bool,
    syntax: &'static str,
}

/// The hot part of a cached instruction (32 bytes).
#[derive(Clone, Copy, Debug)]
pub struct Line {
    pc: u32,
    len: u8,
    pair_head: bool,
    /// Needs the careful path in `run_fast`: a pair head or a predicated
    /// block (they change the state that holds interrupts back).
    careful: bool,
    fast: Option<Fast>,
}

impl Line {
    const EMPTY: Line = Line { pc: u32::MAX, len: 0, pair_head: false, careful: false, fast: None };
}

/// One micro-op of a block.
#[derive(Clone, Copy, Debug)]
struct BOp {
    fast: Fast,
    len: u8,
    careful: bool,
    pair_head: bool,
}

impl Fast {
    /// May this op change pc to anything but the next instruction?
    fn may_jump(&self) -> bool {
        matches!(
            self,
            Fast::BrI { .. } | Fast::BrR { .. } | Fast::Goto { .. } | Fast::Call { .. } | Fast::Rts
                | Fast::BitBr { .. } | Fast::DecBr { .. } | Fast::PopPc { .. } | Fast::PopRet | Fast::PopMask { .. }
                | Fast::IfBlk { .. } | Fast::BrIEq { .. } | Fast::BrINe { .. }
        )
    }

    /// The same operation in a specialised form where one exists (exactly the
    /// generic arm's semantics with its run-time choices made here).
    fn specialise(self) -> Fast {
        match self {
            Fast::BrI { a, v, cond: Cond::Eq, target } => Fast::BrIEq { a, v, target },
            Fast::BrI { a, v, cond: Cond::Ne, target } => Fast::BrINe { a, v, target },
            Fast::Ld { d, b: Base::Reg(b), off, w: 4, signed: _ } => Fast::LdW { d, b, off },
            Fast::Ld { d, b: Base::Sp, off, w: 4, signed: _ } => Fast::LdWSp { d, off },
            Fast::Ld { d, b: Base::Reg(b), off, w: 1, signed: false } => Fast::LdBu { d, b, off },
            Fast::St { s, b: Base::Reg(b), off, w: 4 } => Fast::StW { s, b, off },
            Fast::St { s, b: Base::Sp, off, w: 4 } => Fast::StWSp { s, off },
            Fast::Alu3I { d, a, v, op: Op::Add } => Fast::AddRI { d, s: a, v },
            Fast::Alu2I { d, v, op: Op::Add } => Fast::AddRI { d, s: d, v },
            Fast::A4 { d, s, op: Op::Add, rk: 1, rv } => Fast::AddRI { d, s, v: rv },
            Fast::A4 { d, s, op: Op::Shl, rk: 1, rv } => Fast::ShlI { d, s, n: (rv & 31) as u8 },
            Fast::A4 { d, s, op: Op::Sar, rk: 1, rv } => Fast::SarI { d, s, n: (rv & 31) as u8 },
            f => f,
        }
    }
}

/// The rest of the decode, used off the hot path.
#[derive(Clone, Copy, Debug)]
pub struct LineX {
    /// The instruction bytes, to validate lines of code outside XIP.
    win: u64,
    entry: &'static fm1_isa::IsaEntry,
    pre: Pre,
}

/// Which arm of `Cpu::execute` handles this instruction: the guards in the
/// same order as there, evaluated once per instruction word and cached.
fn route_of(insn: &Instruction, alu4: &Option<Alu4>, bittest: &Option<BitTest>) -> u16 {
    let name = insn.entry.name;
    match name {
            _ if bittest.is_some() => 0,
            _ if alu4.is_some() => 1,
            "nop" | "csync" | "sti_r" | "cli_r" => 2,
            "lockclr_r" | "lockset_r" => 3,
            "r_mov_i_l2" => 4,
            "sp_mov_i" => 5,
            "ssp_mov_i" => 6,
            "usp_mov_i" => 7,
            "r_mov_h" => 8,
            "r_i_or_r" | "r_i_and_r" => 9,
            "r_mov_r_lsl_i" | "r_mov_r_lsr_i" | "r_mov_r_asr_i" => 10,
            n if insn.entry.len == 4
                && n.starts_with("if_r_")
                && has(n, "_i_goto_i")
                && matches!((insn.raw >> 8) & 0xff, 0xf8 | 0xf9 | 0xfc | 0xfd | 0xfe) => 11,
            n if insn.entry.len == 6 && n.starts_with("if") && has(n, "_i_goto_i")
                && (insn.raw >> 8) & 0xff == 0xff && (insn.raw & 0xc0) == 0 => 12,
            n if n.starts_with("if") && has(n, "_r_goto_i")
                && decode_cmp_rr_branch(insn.raw, insn.entry.len).is_some() => 13,
            n if n.starts_with("if") && !has(n, "goto") && insn.entry.len == 4
                && decode_if_block(insn.raw).is_some() => 14,
            _ if insn.entry.len == 2 && (insn.raw >> 8) & 0xff == 0x17 => 15,
            _ if insn.entry.len == 4 && has(insn.entry.syntax, "d[")
                && ((insn.raw & 0xfff0) == 0xec50 || (insn.raw & 0xffff) == 0xe9d0) => 16,
            _ if insn.entry.len == 4 && (insn.raw & 0xf8) == 0x50
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee)
                && has(insn.entry.syntax, "[R+") && !has(insn.entry.syntax, "[R+R") => 17,
            _ if insn.entry.len == 4 && has(insn.entry.syntax, "[++R=#i]")
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee)
                && ((insn.raw & 0xf8) == 0x58 || (insn.raw & 0xff) == 0xd0) => 18,
            _ if insn.entry.len == 4 && (insn.raw & 0xf0) == 0xd0
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee)
                && has(insn.entry.syntax, "++=") => 19,
            _ if insn.entry.len == 4 && insn.raw & 0xff == 0xd8
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee) => 20,
            _ if insn.entry.len == 4 && matches!((insn.raw >> 8) & 0xff, 0xe1 | 0xf1)
                && matches!(insn.raw & 0xff, 0xd0 | 0xd8 | 0xf8 | 0xf6)
                && insn.entry.syntax.starts_with('r') && has(insn.entry.syntax, "_r") => 21,
            _ if insn.entry.len == 4 && (insn.raw & 0xffff) == 0xe070 || (insn.raw & 0xffff) == 0xf070 => 22,
            "testset_b_r" | "testset_r" => 23,
            "ifeq_goto_i" | "ifne_goto_i" => 24,
            "if_ret_eq_i_goto_i" | "if_ret_ne_i_goto_i" => 25,
            "sp_mov_rets_r_1" | "sp_mov_rets_r_2" | "sp_mov_rets_r_3"
            | "sp_mov_rets_r_4" => 26,
            "rets_r_1_mov_sp" | "rets_r_2_mov_sp" | "rets_r_3_mov_sp" => 27,
            "pc_r_1_mov_sp" | "pc_r_2_mov_sp" | "pc_r_3_mov_sp"
            | "pc_r_4_mov_sp" | "pc_r_mov_sp" => 28,
            "rep_i_r" | "rep_i_i" => 29,
            _ => ROUTE_SYNTAX,
    }
}

#[inline]
fn ld_w<B: Bus>(bus: &mut B, w: u8, signed: bool, a: u32) -> u32 {
    match (w, signed) {
        (1, false) => bus.read8(a) as u32,
        (1, true) => bus.read8(a) as i8 as i32 as u32,
        (2, false) => bus.read16(a) as u32,
        (2, true) => bus.read16(a) as i16 as i32 as u32,
        _ => bus.read32(a),
    }
}

#[inline]
fn st_w<B: Bus>(bus: &mut B, w: u8, a: u32, v: u32) {
    match w {
        1 => bus.write8(a, v as u8),
        2 => bus.write16(a, v as u16),
        _ => bus.write32(a, v),
    }
}

/// The route of the generic, syntax-keyed executor (`exec_syntax`).
const ROUTE_SYNTAX: u16 = 30;

#[derive(Clone, Copy, Debug)]
enum Base { Reg(u8), Sp }

#[derive(Clone, Copy, Debug)]
enum Cond { Eq, Ne, LtU, GtU, LeU, GeU, LtS, GtS, LeS, GeS }

#[derive(Clone, Copy, Debug)]
enum Fast {
    Mov { d: u8, s: u8 },
    MovI { d: u8, v: u32 },
    Alu3 { d: u8, a: u8, b: u8, op: Op },
    Alu3I { d: u8, a: u8, v: u32, op: Op },
    Alu2 { d: u8, b: u8, op: Op },
    Alu2I { d: u8, v: u32, op: Op },
    Ld { d: u8, b: Base, off: u32, w: u8, signed: bool },
    St { s: u8, b: Base, off: u32, w: u8 },
    BrI { a: u8, v: u32, cond: Cond, target: u32 },
    BrR { a: u8, b: u8, cond: Cond, target: u32 },
    Goto { target: u32 },
    Call { target: u32 },
    Rts,
    /// `R = R op x` from the 4-byte ALU decoder: rk 0 = register, 1 =
    /// immediate, 2 = `1 << R`.
    A4 { d: u8, s: u8, op: Op, rk: u8, rv: u32 },
    /// `if ((R & mask) ==/!= 0) goto`: mk as `rk` above.
    BitBr { r: u8, mk: u8, ne: bool, mv: u32, target: u32 },
    /// `[b + (i << sh)]` loads and stores.
    LdIdx { d: u8, b: u8, i: u8, sh: u8, w: u8, signed: bool },
    StIdx { s: u8, b: u8, i: u8, sh: u8, w: u8 },
    /// `w[R+#i] op= #v` (op Mov = plain store of the immediate).
    Rmw { b: u8, w: u8, op: RmwOp, off: u32, v: u32 },
    /// `R = w[B++=#inc]` / `w[B++=#inc] = R`.
    LdPost { d: u8, b: u8, w: u8, signed: bool, inc: u32 },
    StPost { s: u8, b: u8, w: u8, inc: u32 },
    /// `if (--R op #v) goto`.
    DecBr { r: u8, cond: Cond, v: u32, target: u32 },
    /// `R = R.b0|l|h (u|s)`: part 0 = b0, 1 = l, 2 = h.
    Ext { d: u8, s: u8, part: u8, signed: bool },
    /// `[R+off] op= x` from the 4-byte ALU decoder (word RMW).
    MemA4 { b: u8, off: i32, op: Op, rk: u8, rv: u32 },
    Nop,
    /// `[--sp] = {rets, ..}` / `{pc, ..} = [sp++]` (arms 26 / 28, n = raw & 0xf)
    PushRets { n: u8 },
    PopPc { n: u8 },
    /// the 4-byte forms with a register mask (arms 26 / 28)
    PushMask { mask: u16 },
    PopMask { mask: u16 },
    /// `[--sp] = rets` / `pc = [sp++]`
    PushRet,
    PopRet,
    /// `R = smin|smax|umin|umax(R, R)`: kind 0 smin, 1 smax, 2 umin, 3 umax
    MinMax { d: u8, a: u8, b: u8, kind: u8 },
    /// predicated `if (..) {` (arm 14): block ends as offsets from the
    /// instruction's next pc, worked out at decode (XIP code only)
    IfBlk { a: u8, rk: u8, fam: u8, alt: bool, has_else: bool, rv: u32, then_d: u16, else_d: u16 },
    // specialised forms of the hottest generic ops (`Fast::specialise`):
    // no inner dispatch on condition, width or operation
    BrIEq { a: u8, v: u32, target: u32 },
    BrINe { a: u8, v: u32, target: u32 },
    LdW { d: u8, b: u8, off: u32 },
    LdWSp { d: u8, off: u32 },
    LdBu { d: u8, b: u8, off: u32 },
    StW { s: u8, b: u8, off: u32 },
    StWSp { s: u8, off: u32 },
    AddRI { d: u8, s: u8, v: u32 },
    ShlI { d: u8, s: u8, n: u8 },
    SarI { d: u8, s: u8, n: u8 },
}

#[derive(Clone, Copy, Debug)]
enum RmwOp { Mov, Or, And, Xor, Add, Sub }

#[inline]
fn alu(op: Op, a: u32, b: u32) -> u32 {
    match op {
        Op::Add => a.wrapping_add(b),
        Op::Sub => a.wrapping_sub(b),
        Op::RSub => b.wrapping_sub(a),
        Op::And => a & b,
        Op::AndNot => a & !b,
        Op::Or => a | b,
        Op::Xor => a ^ b,
        Op::Mul => a.wrapping_mul(b),
        Op::Shl => a.wrapping_shl(b & 31),
        Op::Shr => a.wrapping_shr(b & 31),
        Op::Sar => ((a as i32) >> (b & 31)) as u32,
    }
}

/// `cmp_cond(fam, alt, ..)` as a `Cond`.
fn cond_of_fam(fam: u64, alt: bool) -> Cond {
    match (fam, alt) {
        (0, false) => Cond::Eq,
        (0, true) => Cond::Ne,
        (1, false) => Cond::GeU,
        (1, true) => Cond::LtU,
        (4, false) => Cond::GtU,
        (4, true) => Cond::LeU,
        (5, false) => Cond::GeS,
        (5, true) => Cond::LtS,
        (_, false) => Cond::GtS,
        (_, true) => Cond::LeS,
    }
}

fn rhs_kind(r: Rhs) -> (u8, u32) {
    match r {
        Rhs::Reg(x) => (0, x as u32),
        Rhs::Imm(v) => (1, v),
        Rhs::Bit(x) => (2, x as u32),
    }
}

/// Micro-ops for the raw-decoded arms of `Cpu::execute`; each mirrors its
/// arm exactly (route numbers as in `route_of`).
fn fast_raw(route: u16, insn: &Instruction, alu4: &Option<Alu4>, bittest: &Option<BitTest>) -> Option<Fast> {
    let raw = insn.raw;
    let next_pc = insn.addr.wrapping_add(insn.entry.len as u32);
    match route {
        0 => {
            let t = (*bittest)?;
            let (mk, mv) = rhs_kind(t.mask);
            Some(Fast::BitBr { r: t.reg as u8, mk, ne: t.ne, mv, target: (next_pc as i64 + t.off) as u32 })
        }
        1 => {
            let a = (*alu4)?;
            match a.dst {
                Dst::Reg(d) => {
                    let (rk, rv) = rhs_kind(a.rhs);
                    Some(Fast::A4 { d: d as u8, s: a.src as u8, op: a.op, rk, rv })
                }
                Dst::Mem(off) => {
                    let (rk, rv) = rhs_kind(a.rhs);
                    Some(Fast::MemA4 { b: a.src as u8, off, op: a.op, rk, rv })
                }
            }
        }
        2 => Some(Fast::Nop),
        26 if insn.entry.len == 4 => Some(Fast::PushMask { mask: ((raw >> 16) & 0xffff) as u16 }),
        28 if insn.entry.len == 4 => Some(Fast::PopMask { mask: ((raw >> 16) & 0xffff) as u16 }),
        26 => Some(Fast::PushRets { n: (raw & 0xf) as u8 }),
        28 => Some(Fast::PopPc { n: (raw & 0xf) as u8 }),
        15 => Some(Fast::Ext {
            d: (raw & 7) as u8,
            s: ((raw >> 4) & 7) as u8,
            part: if raw & 0x80 != 0 { 1 } else { 0 },
            signed: raw & 8 != 0,
        }),
        4 => {
            let r = ((raw & 7) | ((raw >> 7 & 1) << 3)) as u8;
            let imm = if (raw & 0xc0) == 0xc0 && (raw >> 8 & 0xff) == 0x14 {
                0
            } else {
                (((raw >> 8) & 0x1f) | (((raw >> 3) & 7) << 5)) as u32
            };
            Some(Fast::MovI { d: r, v: imm })
        }
        8 => Some(Fast::MovI {
            d: ((raw >> 28) & 0xf) as u8,
            v: composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32),
        }),
        10 => {
            let op = if has(insn.entry.name, "lsr") { Op::Shr } else if has(insn.entry.name, "asr") { Op::Sar } else { Op::Shl };
            let (d, s, n) = ((raw & 7) as u8, ((raw >> 4) & 7) as u8, ((raw >> 8) & 0x1f) as u32);
            Some(match (n, op) {
                // a count of 0 shifts by 32: logical shifts give 0, >>> the sign fill (= >>> 31)
                (0, Op::Sar) => Fast::A4 { d, s, op, rk: 1, rv: 31 },
                (0, _) => Fast::MovI { d, v: 0 },
                _ => Fast::A4 { d, s, op, rk: 1, rv: n },
            })
        }
        11 => {
            let fam = (raw >> 8) & 0xff;
            let alt = raw & 0x80 != 0;
            let imm10 = (((raw >> 25) & 0x7f) | (((raw >> 4) & 7) << 7)) as u32;
            let imm_s = if imm10 & 0x200 != 0 { imm10 | !0x3ff } else { imm10 };
            let f = (((raw >> 16) & 0xff) | (((raw >> 24) & 1) << 8)) as i64;
            let off = 2 * if f & 0x100 != 0 { f - 0x200 } else { f };
            let (cond, v) = match (fam, alt) {
                (0xf8, false) => (Cond::Eq, imm_s),
                (0xf8, true) => (Cond::Ne, imm_s),
                (0xf9, false) => (Cond::GeU, imm10),
                (0xf9, true) => (Cond::LtU, imm10),
                (0xfc, false) => (Cond::GtU, imm10),
                (0xfc, true) => (Cond::LeU, imm10),
                (0xfd, false) => (Cond::GeS, imm_s),
                (0xfd, true) => (Cond::LtS, imm_s),
                (0xfe, false) => (Cond::GtS, imm_s),
                _ => (Cond::LeS, imm_s),
            };
            Some(Fast::BrI { a: (raw & 0xf) as u8, v, cond, target: (insn.addr as i64 + 4 + off) as u32 })
        }
        12 => {
            let b0 = raw & 0xff;
            let fam = (b0 >> 1) & 7;
            let imm = if b0 & 0x20 != 0 {
                composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)
            } else {
                let v = ((raw >> 16) & 0xfff) as u32;
                if v & 0x800 != 0 && !matches!(fam, 1 | 4) { v | !0xfff } else { v }
            };
            let off = 2 * ((raw >> 32) as u16 as i16 as i64);
            Some(Fast::BrI { a: ((raw >> 28) & 0xf) as u8, v: imm, cond: cond_of_fam(fam, b0 & 1 != 0), target: (next_pc as i64 + off) as u32 })
        }
        13 => {
            let (fam, alt, a, b, off) = decode_cmp_rr_branch(raw, insn.entry.len)?;
            Some(Fast::BrR { a: a as u8, b: b as u8, cond: cond_of_fam(fam, alt), target: (next_pc as i64 + off) as u32 })
        }
        17 => {
            let w = match (raw >> 8) & 0xff { 0xec => 4u8, 0xed => 2, _ => 1 };
            let d = ((raw >> 28) & 0xf) as u8;
            let b = ((raw >> 20) & 0xf) as u8;
            let f = (((raw >> 16) & 0xf) | (((raw >> 24) & 0xf) << 4)) as u32;
            let (store, off, signed) = if w == 1 {
                let off = if raw & 1 != 0 { f as i32 - 256 } else { f as i32 };
                ((raw >> 1) & 1 != 0, off, (raw >> 2) & 1 != 0)
            } else {
                let v = (f & !1) | (((raw & 1) as u32) << 8) | ((((raw >> 1) & 1) as u32) << 9);
                let off = if v & 0x200 != 0 { v as i32 - 0x400 } else { v as i32 };
                ((raw >> 16) & 1 != 0, off, w == 2 && (raw >> 2) & 1 != 0)
            };
            Some(if store {
                Fast::St { s: d, b: Base::Reg(b), off: off as u32, w }
            } else {
                Fast::Ld { d, b: Base::Reg(b), off: off as u32, w, signed }
            })
        }
        20 => {
            let kind = (raw >> 8) & 0xff;
            let sub = (raw >> 16) & 0xf;
            let d = ((raw >> 28) & 0xf) as u8;
            let b = ((raw >> 20) & 0xf) as u8;
            let i = ((raw >> 24) & 0xf) as u8;
            let sh = if sub & 8 != 0 { if kind == 0xec { 2 } else { 1 } } else { 0 };
            Some(match (kind, sub & 3) {
                (0xec, 2) => Fast::LdIdx { d, b, i, sh, w: 4, signed: false },
                (0xec, 3) => Fast::StIdx { s: d, b, i, sh, w: 4 },
                (0xed, 0) => Fast::LdIdx { d, b, i, sh, w: 2, signed: false },
                (0xed, 1) => Fast::StIdx { s: d, b, i, sh, w: 2 },
                (0xed, 2) => Fast::LdIdx { d, b, i, sh, w: 2, signed: true },
                (0xee, 0) => Fast::LdIdx { d, b, i, sh, w: 1, signed: false },
                (0xee, 1) => Fast::StIdx { s: d, b, i, sh, w: 1 },
                (0xee, 2) => Fast::LdIdx { d, b, i, sh, w: 1, signed: true },
                _ => return None,
            })
        }
        _ => None,
    }
}

#[inline]
fn cond_true(c: Cond, l: u32, r: u32) -> bool {
    match c {
        Cond::Eq => l == r,
        Cond::Ne => l != r,
        Cond::LtU => l < r,
        Cond::GtU => l > r,
        Cond::LeU => l <= r,
        Cond::GeU => l >= r,
        Cond::LtS => (l as i32) < (r as i32),
        Cond::GtS => (l as i32) > (r as i32),
        Cond::LeS => (l as i32) <= (r as i32),
        Cond::GeS => (l as i32) >= (r as i32),
    }
}

/// A micro-op for an instruction that `exec_syntax` would handle, when its
/// shape is one of the common simple ones; operands come from the same
/// slots in the same order, so the semantics are identical.
fn fast_of(insn: &Instruction, s: &'static str) -> Option<Fast> {
    let slots = insn.entry.slots;
    let val = |i: usize| -> Option<i64> { slots.get(i).map(|sl| sl.value(insn.raw)) };
    let v = |i: usize| -> Option<u32> { val(i).map(|x| x as u32) };
    let r = |i: usize| -> Option<u8> { val(i).map(|x| (x as usize & 0xf) as u8) };
    let next_pc = insn.addr.wrapping_add(insn.entry.len as u32);
    let target = |i: usize| -> Option<u32> { val(i).map(|off| (next_pc as i64 + off) as u32) };
    let op_of = |c: &str| -> Option<Op> {
        Some(match c { "+" => Op::Add, "-" => Op::Sub, "&" => Op::And, "|" => Op::Or, "^" => Op::Xor, "*" => Op::Mul, _ => return None })
    };
    let cond_of = |op: &str, signed: bool| -> Option<Cond> {
        Some(match (op, signed) {
            ("==", _) => Cond::Eq, ("!=", _) => Cond::Ne,
            ("<", false) => Cond::LtU, (">", false) => Cond::GtU, ("<=", false) => Cond::LeU, (">=", false) => Cond::GeU,
            ("<", true) => Cond::LtS, (">", true) => Cond::GtS, ("<=", true) => Cond::LeS, (">=", true) => Cond::GeS,
            _ => return None,
        })
    };
    // `if[s] (--R op #i) goto #i`: decrement, compare, branch (slots r, v, off)
    for (prefix, signed) in [("if (--R ", false), ("ifs (--R ", true)] {
        if let Some(rest) = s.strip_prefix(prefix).and_then(|x| x.strip_suffix(") goto #i")) {
            let (op, rhs) = rest.split_once(' ')?;
            if rhs != "#i" && rhs != "#h" {
                return None;
            }
            return Some(Fast::DecBr { r: r(0)?, cond: cond_of(op, signed)?, v: v(1)?, target: target(2)? });
        }
    }
    // sub-word extracts
    let ext = match s {
        "R = R.b0 (u)" => Some((0, false)),
        "R = R.b0 (s)" => Some((0, true)),
        "R = R.l (u)" => Some((1, false)),
        "R = R.l (s)" => Some((1, true)),
        "R = R.h (u)" => Some((2, false)),
        "R = R.h (s)" => Some((2, true)),
        _ => None,
    };
    if let Some((part, signed)) = ext {
        return Some(Fast::Ext { d: r(0)?, s: r(1)?, part, signed });
    }
    // branches: if[s] (R op #i|R) goto #i
    for (prefix, signed) in [("if (R ", false), ("ifs (R ", true)] {
        if let Some(rest) = s.strip_prefix(prefix).and_then(|x| x.strip_suffix(") goto #i")) {
            let (op, rhs) = rest.split_once(' ')?;
            let cond = cond_of(op, signed)?;
            return match rhs {
                "R" => Some(Fast::BrR { a: r(0)?, b: r(1)?, cond, target: target(2)? }),
                "#i" | "#h" => Some(Fast::BrI { a: r(0)?, v: v(1)?, cond, target: target(2)? }),
                _ => None,
            };
        }
    }
    // loads: R = [b|h][R+#i | sp+#i | sp] [(u)|(s)]
    if let Some(rhs) = s.strip_prefix("R = ") {
        let (rhs, signed) = if let Some(x) = rhs.strip_suffix(" (s)") { (x, true) }
            else if let Some(x) = rhs.strip_suffix(" (u)") { (x, false) } else { (rhs, false) };
        let (w, inner) = if let Some(x) = rhs.strip_prefix("b[") { (1, x) }
            else if let Some(x) = rhs.strip_prefix("h[") { (2, x) }
            else if let Some(x) = rhs.strip_prefix('[') { (4, x) } else { (0, "") };
        if w != 0 {
            return match inner {
                "R++=#i]" => Some(Fast::LdPost { d: r(0)?, b: r(1)?, w, signed, inc: v(2)? }),
                "R+R]" => Some(Fast::LdIdx { d: r(0)?, b: r(1)?, i: r(2)?, sh: 0, w, signed }),
                "R+R<<#i]" => Some(Fast::LdIdx { d: r(0)?, b: r(1)?, i: r(2)?, sh: (v(3)? & 31) as u8, w, signed }),
                "R+#i]" => Some(Fast::Ld { d: r(0)?, b: Base::Reg(r(1)?), off: v(2)?, w, signed }),
                "sp+#i]" => Some(Fast::Ld { d: r(0)?, b: Base::Sp, off: v(1)?, w, signed }),
                "sp]" => Some(Fast::Ld { d: r(0)?, b: Base::Sp, off: 0, w, signed }),
                _ => None,
            };
        }
    }
    // plain stores: [b|h][R+#i | sp+#i | sp] = R
    for (prefix, w) in [("b[", 1u8), ("h[", 2), ("[", 4)] {
        if let Some(rest) = s.strip_prefix(prefix) {
            let rmw = |op: RmwOp| -> Option<Fast> { Some(Fast::Rmw { b: r(0)?, w, op, off: v(1)?, v: v(2)? }) };
            return match rest {
                "R++=#i] = R" => Some(Fast::StPost { b: r(0)?, inc: v(1)?, s: r(2)?, w }),
                "R+R] = R" => Some(Fast::StIdx { b: r(0)?, i: r(1)?, sh: 0, s: r(2)?, w }),
                "R+R<<#i] = R" => Some(Fast::StIdx { b: r(0)?, i: r(1)?, sh: (v(2)? & 31) as u8, s: r(3)?, w }),
                "R+#i] = #i" | "R+#i] = #h" => rmw(RmwOp::Mov),
                "R+#i] |= #i" | "R+#i] |= #h" => rmw(RmwOp::Or),
                "R+#i] &= #i" | "R+#i] &= #h" => rmw(RmwOp::And),
                "R+#i] ^= #i" | "R+#i] ^= #h" => rmw(RmwOp::Xor),
                "R+#i] += #i" | "R+#i] += #h" => rmw(RmwOp::Add),
                "R+#i] -= #i" | "R+#i] -= #h" => rmw(RmwOp::Sub),
                "R+#i] = R" => Some(Fast::St { b: Base::Reg(r(0)?), off: v(1)?, s: r(2)?, w }),
                "sp+#i] = R" => Some(Fast::St { b: Base::Sp, off: v(0)?, s: r(1)?, w }),
                "sp] = R" => Some(Fast::St { b: Base::Sp, off: 0, s: r(0)?, w }),
                _ => None,
            };
        }
    }
    match s {
        "R = R" => Some(Fast::Mov { d: r(0)?, s: r(1)? }),
        "R = #i" | "R = #h" => Some(Fast::MovI { d: r(0)?, v: v(1)? }),
        "R = R + R" | "R = R - R" | "R = R & R" | "R = R | R" | "R = R ^ R" | "R = R * R" => {
            Some(Fast::Alu3 { d: r(0)?, a: r(1)?, b: r(2)?, op: op_of(&s[6..7])? })
        }
        "R = R + #i" | "R = R + #h" | "R = R - #i" | "R = R & #h" | "R = R | #h"
        | "R = R ^ #h" | "R = R * #h" | "R = R & #i" | "R = R | #i" | "R = R ^ #i" => {
            Some(Fast::Alu3I { d: r(0)?, a: r(1)?, v: v(2)?, op: op_of(&s[6..7])? })
        }
        "R += R" | "R -= R" | "R |= R" | "R &= R" | "R ^= R" | "R *= R" => {
            Some(Fast::Alu2 { d: r(0)?, b: r(1)?, op: op_of(&s[2..3])? })
        }
        "R += #i" | "R -= #i" | "R |= #i" | "R &= #i" | "R ^= #i" | "R *= #i" => {
            Some(Fast::Alu2I { d: r(0)?, v: v(1)?, op: op_of(&s[2..3])? })
        }
        "goto #i" => Some(Fast::Goto { target: target(0)? }),
        "[--sp] = rets" => Some(Fast::PushRet),
        "pc = [sp++]" => Some(Fast::PopRet),
        "R = smin(R, R)" | "R = smax(R, R)" | "R = umin(R, R)" | "R = umax(R, R)" => {
            let kind = match &s[4..8] { "smin" => 0, "smax" => 1, "umin" => 2, _ => 3 };
            let raw = insn.raw;
            if insn.entry.len == 4 && matches!((raw >> 8) & 0xff, 0xe4 | 0xf4) {
                Some(Fast::MinMax { d: ((raw >> 28) & 0xf) as u8, a: ((raw >> 20) & 0xf) as u8, b: ((raw >> 24) & 0xf) as u8, kind })
            } else {
                Some(Fast::MinMax { d: r(0)?, a: r(1)?, b: r(2)?, kind })
            }
        }
        "call #i" => Some(Fast::Call { target: target(0)? }),
        "rts" => Some(Fast::Rts),
        _ => None,
    }
}

// the hot cache line must stay small (see `Line`)
const _: () = assert!(std::mem::size_of::<Line>() <= 32);

#[cfg(test)]
mod size_report {
    #[test]
    fn line_sizes() {
        eprintln!("Fast {} Option<Fast> {} Line {}", std::mem::size_of::<super::Fast>(), std::mem::size_of::<Option<super::Fast>>(), std::mem::size_of::<super::Line>());
    }
}

/// The micro-op the emulator decodes an instruction window into, in a canonical text form, for
/// auditing the decoders against the vendor disassembly (`fm1-emu --describe`):
///   `T <target>` a branch / call with a fixed target, `L r<d> <base> <off> w<w> u|s` a load,
///   `S r<s> <base> <off> w<w>` a store, `I r<d> <value>` a constant; None: nothing to compare.
/// The same decode path as `Cpu::fetch_at` (without the predicated-block form, which needs the
/// following instructions).
pub fn describe(win: u64, pc: u32) -> Option<String> {
    let insn = fm1_isa::decode_win_cached(win, pc).ok()?;
    let alu4 = if insn.entry.len == 4 { decode_alu4(insn.raw) } else { None };
    let bittest = if insn.entry.name.starts_with("if") { decode_bittest(insn.raw, insn.entry.len) } else { None };
    let route = route_of(&insn, &alu4, &bittest);
    let syntax = canon_syntax(insn.entry);
    if route == 16 {
        // register-pair load / store (arm 16): `P rH_rL base off ld|st`
        let raw = insn.raw;
        let p = ((raw >> 29) & 7) as u32;
        let store = (raw >> 16) & 1 != 0;
        let (base, off) = if (raw >> 8) & 0xff == 0xec {
            let off = 4 * (((raw >> 18) & 3) | (((raw >> 24) & 0x1f) << 2) | ((raw & 1) << 6) | (((raw >> 1) & 1) << 7));
            (format!("r{}", (raw >> 20) & 0xf), off)
        } else {
            ("sp".to_string(), ((raw >> 17) & 0x7ff) << 1)
        };
        return Some(format!("P r{}_r{} {} {} {}", 2 * p + 1, 2 * p, base, off, if store { "st" } else { "ld" }));
    }
    if route == 14 {
        // predicated block (arm 14): `C [s] rA op rhs then_units else_units`
        let b = decode_if_block(insn.raw)?;
        let rhs = match b.rhs { Rhs::Reg(r) => format!("r{}", r), Rhs::Imm(v) => format!("{}", v), Rhs::Bit(r) => format!("1<<r{}", r) };
        let (sign, op) = if b.fam == 2 {
            ("", if b.alt { "&!=0" } else { "&==0" })
        } else {
            match cond_of_fam(b.fam, b.alt) {
                Cond::Eq => ("", "=="), Cond::Ne => ("", "!="),
                Cond::LtU => ("", "<"), Cond::GtU => ("", ">"), Cond::LeU => ("", "<="), Cond::GeU => ("", ">="),
                Cond::LtS => ("s", "<"), Cond::GtS => ("s", ">"), Cond::LeS => ("s", "<="), Cond::GeS => ("s", ">="),
            }
        };
        return Some(format!("C{} r{} {} {} {} {}", sign, b.reg, op, rhs, b.then_units, b.else_units));
    }
    let fast = if route == ROUTE_SYNTAX { fast_of(&insn, syntax) } else { fast_raw(route, &insn, &alu4, &bittest) }?;
    let base = |b: Base| match b { Base::Reg(r) => format!("r{}", r), Base::Sp => "sp".to_string() };
    let opname = |o: Op| match o {
        Op::Add => "+", Op::Sub => "-", Op::RSub => "rsub", Op::And => "&", Op::AndNot => "&~", Op::Or => "|",
        Op::Xor => "^", Op::Mul => "*", Op::Shl => "<<", Op::Shr => ">>", Op::Sar => ">>>",
    };
    let rhs = |rk: u8, rv: u32| match rk { 0 => format!("r{}", rv), 1 => format!("{}", rv), _ => format!("1<<r{}", rv) };
    let sgn = |s: bool| if s { "s" } else { "u" };
    Some(match fast.specialise() {
        Fast::BrI { target, .. } | Fast::BrR { target, .. } | Fast::BrIEq { target, .. } | Fast::BrINe { target, .. }
        | Fast::BitBr { target, .. } | Fast::DecBr { target, .. } | Fast::Goto { target } | Fast::Call { target } => {
            format!("T {:x}", target)
        }
        Fast::Ld { d, b, off, w, signed } => format!("L r{} {} {} w{} {}", d, base(b), off as i32, w, sgn(signed)),
        Fast::LdW { d, b, off } => format!("L r{} r{} {} w4 u", d, b, off as i32),
        Fast::LdWSp { d, off } => format!("L r{} sp {} w4 u", d, off as i32),
        Fast::LdBu { d, b, off } => format!("L r{} r{} {} w1 u", d, b, off as i32),
        Fast::St { s, b, off, w } => format!("S r{} {} {} w{}", s, base(b), off as i32, w),
        Fast::StW { s, b, off } => format!("S r{} r{} {} w4", s, b, off as i32),
        Fast::StWSp { s, off } => format!("S r{} sp {} w4", s, off as i32),
        Fast::MovI { d, v } => format!("I r{} {}", d, v),
        Fast::Mov { d, s } => format!("A r{} r{} mov", d, s),
        Fast::Alu3 { d, a, b, op } => format!("A r{} r{} {} r{}", d, a, opname(op), b),
        Fast::Alu3I { d, a, v, op } => format!("A r{} r{} {} {}", d, a, opname(op), v),
        Fast::Alu2 { d, b, op } => format!("A r{} r{} {} r{}", d, d, opname(op), b),
        Fast::Alu2I { d, v, op } => format!("A r{} r{} {} {}", d, d, opname(op), v),
        Fast::A4 { d, s, op, rk, rv } => format!("A r{} r{} {} {}", d, s, opname(op), rhs(rk, rv)),
        Fast::AddRI { d, s, v } => format!("A r{} r{} + {}", d, s, v),
        Fast::ShlI { d, s, n } => format!("A r{} r{} << {}", d, s, n),
        Fast::SarI { d, s, n } => format!("A r{} r{} >>> {}", d, s, n),
        Fast::LdIdx { d, b, i, sh, w, signed } => format!("X r{} r{} r{} {} w{} {}", d, b, i, sh, w, sgn(signed)),
        Fast::StIdx { s, b, i, sh, w } => format!("Y r{} r{} r{} {} w{}", s, b, i, sh, w),
        Fast::Rmw { b, w, op, off, v } => {
            let o = match op { RmwOp::Mov => "=", RmwOp::Or => "|=", RmwOp::And => "&=", RmwOp::Xor => "^=", RmwOp::Add => "+=", RmwOp::Sub => "-=" };
            format!("M w{} r{} {} {} {}", w, b, off as i32, o, v)
        }
        Fast::MemA4 { b, off, op, rk, rv } => {
            let o = match op { Op::Or => "|=", Op::And => "&=", Op::Xor => "^=", Op::Add => "+=", Op::Sub => "-=", _ => return None };
            format!("M w4 r{} {} {} {}", b, off, o, rhs(rk, rv))
        }
        Fast::PushRets { n } => {
            let (top, bot) = ((n as i32).max(3), (n as i32).min(4));
            let regs: Vec<String> = (bot..=top).map(|r| format!("r{}", r)).collect();
            format!("U rets {}", regs.join(" "))
        }
        Fast::PopPc { n } => {
            let (top, bot) = ((n as i32).max(3), (n as i32).min(4));
            let regs: Vec<String> = (bot..=top).map(|r| format!("r{}", r)).collect();
            format!("O pc {}", regs.join(" "))
        }
        Fast::PushMask { mask } => {
            let regs: Vec<String> = (0..16).filter(|r| mask >> r & 1 != 0).map(|r| format!("r{}", r)).collect();
            format!("U rets {}", regs.join(" "))
        }
        Fast::PopMask { mask } => {
            let regs: Vec<String> = (0..16).filter(|r| mask >> r & 1 != 0).map(|r| format!("r{}", r)).collect();
            format!("O pc {}", regs.join(" "))
        }
        Fast::PushRet => "U rets".to_string(),
        Fast::PopRet => "O pc".to_string(),
        Fast::Ext { d, s, part, signed } => format!("E r{} r{} {} {}", d, s, ["b0", "l", "h"][part.min(2) as usize], sgn(signed)),
        _ => return None,
    })
}
