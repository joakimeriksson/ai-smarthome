//! AArch64 JIT for the blocks of micro-ops `Cpu::run_fast` interprets (after esp32sim's
//! xtensa-lx7 JIT). A compiled block is the block's plain prefix (up to the first op that needs
//! the careful path) as native code, with the interpreter as the oracle: the two must leave
//! bit-identical machine state.
//!
//! Timing is kept exact the same way the interpreter does it. A block runs as native code only
//! when no tick inside it can be due (`Bus::tick_room`). Before any access that leaves the
//! inline RAM / XIP fast paths, the helper brings the clock to that instruction's tick; after
//! it, if the next tick would be due (a peripheral write, an idle skip), the block exits right
//! after the instruction, where the interpreter would have stopped as well.
//!
//! Blocks chain: an exit to a fixed pc jumps through a slot straight into the next block's
//! compiled body once that block is compiled (Rust fills the slot the first time the exit
//! returns there). Every body first checks that its instructions still fit the call's tick
//! limit, so the chain never runs past a due tick; the helpers sync the clock with the running
//! instruction count, so timing stays exact across the chain.
//!
//! Register plan (AAPCS64 callee-saved, so helpers may be called freely):
//!   x19 = &Cpu, x20 = &Ctx, x21 = RAM host base, x22 = XIP host base,
//!   w23 / w24 = values kept across a helper call within one instruction,
//!   w26 = instructions done in this call before the current block, w27 = the limit
//!   (instructions this call may run). Guest registers, sp and rets stay in the Cpu struct;
//!   pc is stored at exit.

use crate::jit_a64::{Asm, Cond as AC, Label, Reg, SP};
use crate::{Base, Bus, Cond, Cpu, Fast, Op, RmwOp};
use std::ffi::{c_int, c_void};

/// Host view of the guest memory the inline paths read and write directly.
#[derive(Clone, Copy, Debug)]
pub struct JitMem {
    pub ram: *mut u8,
    pub ram_base: u32,
    pub ram_len: u32,
    pub xip: *const u8,
    pub xip_base: u32,
    pub xip_len: u32,
}

/// Per-call context the helpers use (field offsets are used by generated code).
#[repr(C)]
pub struct Ctx {
    cpu: *mut Cpu,
    bus: *mut (),
    /// ticks of instruction `idx` = idx + extra (0: the first one was ticked by the caller)
    extra: u32,
    /// ticks already applied to the bus
    synced: u32,
    /// the next tick is due: leave after this instruction
    brk: u32,
    _pad: u32,
    /// the chain slot of the exit taken back to Rust (null: not a chainable exit)
    slot: *mut u64,
}
const OFF_BRK: u32 = 24;
const OFF_SLOT: u32 = 32;
const _: () = assert!(std::mem::offset_of!(Ctx, brk) == OFF_BRK as usize);
const _: () = assert!(std::mem::offset_of!(Ctx, slot) == OFF_SLOT as usize);

// ------------------------------------------------------------------ executable memory
extern "C" {
    fn mmap(addr: *mut c_void, len: usize, prot: c_int, flags: c_int, fd: c_int, off: i64) -> *mut c_void;
    fn pthread_jit_write_protect_np(enabled: c_int);
    fn sys_icache_invalidate(start: *mut c_void, len: usize);
}

pub struct CodeCache {
    base: *mut u8,
    size: usize,
    used: usize,
}

impl CodeCache {
    pub fn new(size: usize) -> Option<CodeCache> {
        let flags = 0x0002 | 0x1000 | 0x0800; // PRIVATE | ANON | JIT
        // SAFETY: anonymous mapping chosen by the OS; failure is checked.
        let p = unsafe { mmap(std::ptr::null_mut(), size, 7, flags, -1, 0) };
        if p as isize == -1 || p.is_null() {
            return None;
        }
        Some(CodeCache { base: p as *mut u8, size, used: 0 })
    }

    fn write(&mut self, words: &[u32]) -> Option<*const u8> {
        let bytes = words.len() * 4;
        if self.used + bytes > self.size {
            return None;
        }
        // SAFETY: the range is inside the owned mapping; write protection is lifted only around
        // the copy, and the instruction cache is invalidated for exactly that range.
        unsafe {
            let dst = self.base.add(self.used);
            pthread_jit_write_protect_np(0);
            std::ptr::copy_nonoverlapping(words.as_ptr() as *const u8, dst, bytes);
            pthread_jit_write_protect_np(1);
            sys_icache_invalidate(dst as *mut c_void, bytes);
            self.used += bytes;
            Some(dst as *const u8)
        }
    }
}

/// JIT state kept in the Cpu.
pub struct Jit {
    cache: CodeCache,
    /// per block: runs counted until hot, then the compiled entry (or a failure)
    state: Vec<Entry>,
}

#[derive(Clone, Copy)]
enum Entry {
    Cold(u32),
    /// function start, body (chain target), prefix length
    Code(*const u8, *const u8, u32),
    No,
}

// SAFETY: the code cache and the compiled entries are owned by one Cpu and only used by the
// thread that runs it; moving the Cpu (with them) to another thread is fine.
unsafe impl Send for Jit {}

impl std::fmt::Debug for Jit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Jit({} bytes, {} blocks)", self.cache.used, self.state.len())
    }
}

/// Runs of a block before it is compiled.
const HOT: u32 = 32;

impl Jit {
    pub fn new() -> Option<Jit> {
        Some(Jit { cache: CodeCache::new(64 << 20)?, state: Vec::new() })
    }

    /// The compiled code of block `id` (prefix length), compiling it once it is hot.
    pub(crate) fn entry<B: Bus>(&mut self, id: usize, ops: &[crate::BOp], pc0: u32, mem: &JitMem) -> Option<(*const u8, u32)> {
        if self.state.len() <= id {
            self.state.resize(id + 1, Entry::Cold(0));
        }
        match self.state[id] {
            Entry::Code(p, _, n) => Some((p, n)),
            Entry::No => None,
            Entry::Cold(c) if c + 1 < HOT => {
                self.state[id] = Entry::Cold(c + 1);
                None
            }
            Entry::Cold(_) => {
                let plen = ops.iter().take_while(|o| !o.careful).count();
                let e = if plen == 0 {
                    Entry::No
                } else {
                    match compile::<B>(&ops[..plen], pc0, mem) {
                        Some((w, body)) => match self.cache.write(&w) {
                            // SAFETY: body is a word index inside the code just written
                            Some(p) => Entry::Code(p, unsafe { p.add(body * 4) }, plen as u32),
                            None => Entry::No,
                        },
                        None => Entry::No,
                    }
                };
                self.state[id] = e;
                match e {
                    Entry::Code(p, _, n) => Some((p, n)),
                    _ => None,
                }
            }
        }
    }

    /// The chain target of block `id`, if it is compiled.
    pub(crate) fn body(&self, id: usize) -> Option<*const u8> {
        match self.state.get(id) {
            Some(Entry::Code(_, b, _)) => Some(*b),
            _ => None,
        }
    }

    /// Forget every compiled block (the block table was rebuilt).
    pub fn reset(&mut self) {
        self.state.clear();
        self.cache.used = 0;
    }
}

/// Run compiled code: returns the instructions executed; cpu.pc is set.
///
/// # Safety
/// `code` must come from `Jit::entry` for this bus type and the memory `mem` describes.
pub(crate) unsafe fn run<B: Bus>(code: *const u8, cpu: &mut Cpu, bus: &mut B, mem: &JitMem, extra: u32) -> (u32, *mut u64) {
    // instructions this call may run: their ticks ((k - 1) + extra) must all fit tick_room
    let limit = (bus.tick_room() + 1).saturating_sub(extra as u64).min(1 << 30) as u32;
    let mut ctx = Ctx { cpu: cpu as *mut Cpu, bus: bus as *mut B as *mut (), extra, synced: 0, brk: 0, _pad: 0, slot: std::ptr::null_mut() };
    let f: extern "C" fn(*mut Cpu, *mut Ctx, *mut u8, *const u8, u32) -> u32 = unsafe { std::mem::transmute(code) };
    let k = f(cpu as *mut Cpu, &mut ctx, mem.ram, mem.xip, limit);
    if k > 0 {
        // the ticks of the instructions run, less those the helpers applied already
        let need = (k - 1) + extra;
        if need > ctx.synced {
            bus.add_ticks((need - ctx.synced) as u64);
        }
    }
    (k, ctx.slot)
}

// ------------------------------------------------------------------ helpers called from generated code

unsafe fn sync<B: Bus>(ctx: &mut Ctx, bus: &mut B, idx: u32) {
    let need = idx + ctx.extra;
    if need > ctx.synced {
        bus.add_ticks((need - ctx.synced) as u64);
        ctx.synced = need;
    }
}

extern "C" fn h_read<B: Bus>(ctx: *mut Ctx, addr: u32, idx: u32, w: u32) -> u32 {
    // SAFETY: ctx is the live context `run` passed in; the bus pointer is the caller's &mut B.
    let ctx = unsafe { &mut *ctx };
    let bus = unsafe { &mut *(ctx.bus as *mut B) };
    unsafe { sync(ctx, bus, idx) };
    let v = match w {
        1 => bus.read8(addr) as u32,
        2 => bus.read16(addr) as u32,
        _ => bus.read32(addr),
    };
    if bus.next_tick_due() {
        ctx.brk = 1;
    }
    v
}

extern "C" fn h_write<B: Bus>(ctx: *mut Ctx, addr: u32, v: u32, idx: u32, w: u32) {
    // SAFETY: as h_read.
    let ctx = unsafe { &mut *ctx };
    let bus = unsafe { &mut *(ctx.bus as *mut B) };
    unsafe { sync(ctx, bus, idx) };
    match w {
        1 => bus.write8(addr, v as u8),
        2 => bus.write16(addr, v as u16),
        _ => bus.write32(addr, v),
    }
    if bus.next_tick_due() {
        ctx.brk = 1;
    }
}

/// Any op through the interpreter's own executor: bit 32 = jumped (target in the low word).
extern "C" fn h_op<B: Bus>(ctx: *mut Ctx, op: *const Fast, idx: u32, next_pc: u32) -> u64 {
    // SAFETY: as h_read; `op` points at a leaked, immutable Fast.
    let ctx = unsafe { &mut *ctx };
    let bus = unsafe { &mut *(ctx.bus as *mut B) };
    let cpu = unsafe { &mut *ctx.cpu };
    unsafe { sync(ctx, bus, idx) };
    let j = cpu.exec_fast(bus, unsafe { *op }, next_pc);
    if bus.next_tick_due() {
        ctx.brk = 1;
    }
    match j {
        Some(t) => (1u64 << 32) | t as u64,
        None => 0,
    }
}

// ------------------------------------------------------------------ code generation

const CPU: Reg = 19;
const CTX: Reg = 20;
const RAM: Reg = 21;
const XIP: Reg = 22;
const KEEP: Reg = 23;
const KEEP2: Reg = 24;
const DONE: Reg = 26;
const LIMIT: Reg = 27;
const FRAME: i32 = 96;

struct Gen<'a> {
    a: Asm,
    mem: &'a JitMem,
    exit: Label,
    h_read: u64,
    h_write: u64,
    h_op: u64,
}

fn off_reg(r: u8) -> u32 {
    (std::mem::offset_of!(Cpu, regs) + 4 * (r & 15) as usize) as u32
}
fn off_sp() -> u32 {
    std::mem::offset_of!(Cpu, sp) as u32
}
fn off_rets() -> u32 {
    std::mem::offset_of!(Cpu, rets) as u32
}
fn off_pc() -> u32 {
    std::mem::offset_of!(Cpu, pc) as u32
}

fn acond(c: Cond) -> AC {
    match c {
        Cond::Eq => AC::Eq,
        Cond::Ne => AC::Ne,
        Cond::LtU => AC::Lo,
        Cond::GtU => AC::Hi,
        Cond::LeU => AC::Ls,
        Cond::GeU => AC::Hs,
        Cond::LtS => AC::Lt,
        Cond::GtS => AC::Gt,
        Cond::LeS => AC::Le,
        Cond::GeS => AC::Ge,
        // after fcmp: less N, equal ZC, greater C, unordered CV
        Cond::FEq => AC::Eq,
        Cond::FUne => AC::Ne,
        Cond::FLt => AC::Mi,
        Cond::FUge => AC::Pl,
        Cond::FLe => AC::Ls,
        Cond::FUgt => AC::Hi,
        Cond::FGe => AC::Ge,
        Cond::FUlt => AC::Lt,
        Cond::FGt => AC::Gt,
        Cond::FUle => AC::Le,
    }
}

impl Gen<'_> {
    /// flags for a compare of w(x) with w(y): integer, or as two floats
    fn cmp(&mut self, float: bool, x: Reg, y: Reg) {
        if float {
            self.a.fmov_s_w(0, x);
            self.a.fmov_s_w(1, y);
            self.a.fcmp(0, 1);
        } else {
            self.a.cmp(x, y);
        }
    }
    fn ld_reg(&mut self, w: Reg, r: u8) {
        self.a.ldr(w, CPU, off_reg(r));
    }
    fn st_reg(&mut self, w: Reg, r: u8) {
        self.a.str(w, CPU, off_reg(r));
    }
    /// w(dst) = w(src) + imm (any 32-bit immediate)
    fn add_imm(&mut self, dst: Reg, src: Reg, imm: u32) {
        if imm == 0 {
            if dst != src {
                self.a.mov(dst, src);
            }
        } else if imm < 4096 {
            self.a.add_imm(dst, src, imm);
        } else if imm.wrapping_neg() < 4096 {
            self.a.sub_imm(dst, src, imm.wrapping_neg());
        } else {
            self.a.mov32(9, imm);
            self.a.add(dst, src, 9);
        }
    }
    /// w0 = op(w0, w1)
    fn alu(&mut self, op: Op) {
        let a = &mut self.a;
        match op {
            Op::Add => a.add(0, 0, 1),
            Op::Sub => a.sub(0, 0, 1),
            Op::RSub => a.sub(0, 1, 0),
            Op::And => a.and(0, 0, 1),
            Op::AndNot => a.bic(0, 0, 1),
            Op::Or => a.orr(0, 0, 1),
            Op::Xor => a.eor(0, 0, 1),
            Op::Mul => a.mul(0, 0, 1),
            Op::Shl => a.lslv(0, 0, 1),
            Op::Shr => a.lsrv(0, 0, 1),
            Op::Sar => a.asrv(0, 0, 1),
        }
    }
    /// w1 = an A4/BitBr right-hand side: rk 0 register, 1 immediate, 2 `1 << reg`
    fn rhs(&mut self, rk: u8, rv: u32) {
        match rk {
            0 => self.ld_reg(1, rv as u8),
            1 => self.a.mov32(1, rv),
            _ => {
                self.ld_reg(2, rv as u8);
                self.a.movz(1, 1, 0);
                self.a.lslv(1, 1, 2);
            }
        }
    }
    fn call(&mut self, f: u64) {
        self.a.mov64(9, f);
        self.a.blr(9);
    }
    /// Leave with pc = imm, `count` instructions of this block done.
    fn exit_imm(&mut self, pc: u32, count: u32) {
        self.a.mov32(9, pc);
        self.a.str(9, CPU, off_pc());
        self.a.add_imm(0, DONE, count);
        self.a.b(self.exit);
    }
    /// Leave with pc = w(reg).
    fn exit_reg(&mut self, reg: Reg, count: u32) {
        self.a.str(reg, CPU, off_pc());
        self.a.add_imm(0, DONE, count);
        self.a.b(self.exit);
    }
    /// Continue at a fixed pc: straight into its compiled body when the slot holds one,
    /// else back to Rust, which fills the slot once that block is compiled.
    fn chain(&mut self, pc: u32, count: u32) {
        let slot: &'static mut u64 = Box::leak(Box::new(0u64));
        let back = self.a.label();
        self.a.add_imm(DONE, DONE, count);
        self.a.mov64(10, slot as *mut u64 as u64);
        self.a.ldr_x(9, 10, 0);
        self.a.cbz(9, back);
        self.a.br(9);
        self.a.bind(back);
        self.a.mov32(9, pc);
        self.a.str(9, CPU, off_pc());
        self.a.str_x(10, CTX, OFF_SLOT);
        self.a.mov(0, DONE);
        self.a.b(self.exit);
    }
    /// The helpers' instruction index of op `i` of this block: w2 = DONE + i.
    fn idx_w2(&mut self, i: u32) {
        self.a.add_imm(2, DONE, i);
    }

    /// w0 = load(width, signed) at guest address w0. Inline RAM / XIP, else the bus.
    fn load(&mut self, w: u8, signed: bool, idx: u32) {
        let (xip, slow, done) = (self.a.label(), self.a.label(), self.a.label());
        let mem = *self.mem;
        for (base_reg, gbase, len, miss) in [(RAM, mem.ram_base, mem.ram_len, xip), (XIP, mem.xip_base, mem.xip_len, slow)] {
            if base_reg == XIP {
                self.a.bind(xip);
            }
            // off = addr - base; the word holding it must lie inside (as the Soc's fast paths)
            self.a.mov32(2, gbase);
            self.a.sub(3, 0, 2);
            if w == 2 {
                self.a.mov32(2, !1u32);
                self.a.and(3, 3, 2); // a halfword is the one at addr & !1 (Soc read16)
            }
            self.a.mov32(2, len.saturating_sub(w as u32));
            self.a.cmp(3, 2);
            self.a.b_cond(AC::Hi, miss);
            match (w, signed) {
                (4, _) => self.a.ldr_u(0, base_reg, 3),
                (2, false) => self.a.ldrh_u(0, base_reg, 3),
                (2, true) => self.a.ldrsh_u(0, base_reg, 3),
                (1, false) => self.a.ldrb_u(0, base_reg, 3),
                _ => self.a.ldrsb_u(0, base_reg, 3),
            }
            self.a.b(done);
        }
        self.a.bind(slow);
        self.a.mov(1, 0);
        self.a.mov_x(0, CTX);
        self.idx_w2(idx);
        self.a.mov32(3, w as u32);
        self.call(self.h_read);
        match (w, signed) {
            (2, true) => self.a.sxth(0, 0),
            (1, true) => self.a.sbfx(0, 0, 0, 8),
            _ => {}
        }
        self.a.bind(done);
    }

    /// store(width) of w1 at guest address w0. Inline RAM, else the bus.
    fn store(&mut self, w: u8, idx: u32) {
        let (slow, done) = (self.a.label(), self.a.label());
        let mem = *self.mem;
        if w == 2 {
            self.a.tbnz(0, 0, slow); // an odd halfword goes the Soc's merging way
        }
        self.a.mov32(2, mem.ram_base);
        self.a.sub(3, 0, 2);
        self.a.mov32(2, mem.ram_len.saturating_sub(w as u32));
        self.a.cmp(3, 2);
        self.a.b_cond(AC::Hi, slow);
        match w {
            4 => self.a.str_u(1, RAM, 3),
            2 => self.a.strh_u(1, RAM, 3),
            _ => self.a.strb_u(1, RAM, 3),
        }
        self.a.b(done);
        self.a.bind(slow);
        self.a.mov(2, 1);
        self.a.mov(1, 0);
        self.a.mov_x(0, CTX);
        self.a.add_imm(3, DONE, idx);
        self.a.mov32(4, w as u32);
        self.call(self.h_write);
        self.a.bind(done);
    }

    /// After an instruction that may have called the bus: leave if the next tick is due.
    fn check_brk(&mut self, next_pc: u32, count: u32) {
        let go = self.a.label();
        self.a.ldr(9, CTX, OFF_BRK);
        self.a.cbz(9, go);
        self.exit_imm(next_pc, count);
        self.a.bind(go);
    }
}

/// Native code for a block prefix of plain micro-ops (none careful).
fn compile<B: Bus>(ops: &[crate::BOp], pc0: u32, mem: &JitMem) -> Option<(Vec<u32>, usize)> {
    for o in [off_reg(15), off_sp(), off_rets(), off_pc()] {
        if o >= 16384 {
            return None;
        }
    }
    let mut a = Asm::new();
    let exit = a.label();
    let mut g = Gen {
        a,
        mem,
        exit,
        h_read: h_read::<B> as usize as u64,
        h_write: h_write::<B> as usize as u64,
        h_op: h_op::<B> as usize as u64,
    };
    // prologue (entry from Rust); chained blocks enter at the body
    g.a.stp_pre(29, 30, SP, -FRAME);
    g.a.stp(CPU, CTX, SP, 16);
    g.a.stp(RAM, XIP, SP, 32);
    g.a.stp(KEEP, KEEP2, SP, 48);
    g.a.stp(25, DONE, SP, 64);
    g.a.stp(LIMIT, 28, SP, 80);
    g.a.mov_x(CPU, 0);
    g.a.mov_x(CTX, 1);
    g.a.mov_x(RAM, 2);
    g.a.mov_x(XIP, 3);
    g.a.mov(LIMIT, 4);
    g.a.movz(DONE, 0, 0);
    let body = g.a.here();
    // the whole prefix must fit the call's limit, else back to Rust before running any of it
    {
        let fits = g.a.label();
        g.a.add_imm(9, DONE, ops.len() as u32);
        g.a.cmp(9, LIMIT);
        g.a.b_cond(AC::Ls, fits);
        g.exit_imm(pc0, 0);
        g.a.bind(fits);
    }

    let mut pc = pc0;
    for (i, op) in ops.iter().enumerate() {
        let idx = i as u32;
        let next_pc = pc + op.len as u32;
        let count = idx + 1;
        let mut bus_used = false;
        match op.fast {
            Fast::Nop => {}
            Fast::MovI { d, v } => {
                g.a.mov32(0, v);
                g.st_reg(0, d);
            }
            Fast::Mov { d, s } => {
                g.ld_reg(0, s);
                g.st_reg(0, d);
            }
            Fast::AddRI { d, s, v } => {
                g.ld_reg(0, s);
                g.add_imm(0, 0, v);
                g.st_reg(0, d);
            }
            Fast::ShlI { d, s, n } => {
                g.ld_reg(0, s);
                g.a.lsl_imm(0, 0, n as u32 & 31);
                g.st_reg(0, d);
            }
            Fast::SarI { d, s, n } => {
                g.ld_reg(0, s);
                g.a.asr_imm(0, 0, n as u32 & 31);
                g.st_reg(0, d);
            }
            Fast::Alu3 { d, a, b, op } => {
                g.ld_reg(0, a);
                g.ld_reg(1, b);
                g.alu(op);
                g.st_reg(0, d);
            }
            Fast::Alu3I { d, a, v, op } => {
                g.ld_reg(0, a);
                g.a.mov32(1, v);
                g.alu(op);
                g.st_reg(0, d);
            }
            Fast::Alu2 { d, b, op } => {
                g.ld_reg(0, d);
                g.ld_reg(1, b);
                g.alu(op);
                g.st_reg(0, d);
            }
            Fast::Alu2I { d, v, op } => {
                g.ld_reg(0, d);
                g.a.mov32(1, v);
                g.alu(op);
                g.st_reg(0, d);
            }
            Fast::A4 { d, s, op, rk, rv } => {
                g.rhs(rk, rv);
                g.ld_reg(0, s);
                g.alu(op);
                g.st_reg(0, d);
            }
            Fast::Ext { d, s, part, signed } => {
                g.ld_reg(0, s);
                match (part, signed) {
                    (0, false) => g.a.ubfx(0, 0, 0, 8),
                    (0, true) => g.a.sbfx(0, 0, 0, 8),
                    (1, false) => g.a.ubfx(0, 0, 0, 16),
                    (1, true) => g.a.sbfx(0, 0, 0, 16),
                    (_, false) => g.a.ubfx(0, 0, 16, 16),
                    (_, true) => g.a.sbfx(0, 0, 16, 16),
                }
                g.st_reg(0, d);
            }
            Fast::MinMax { d, a, b, kind } => {
                g.ld_reg(0, a);
                g.ld_reg(1, b);
                g.a.cmp(0, 1);
                let c = match kind { 0 => AC::Lt, 1 => AC::Gt, 2 => AC::Lo, _ => AC::Hi };
                g.a.csel(0, 0, 1, c);
                g.st_reg(0, d);
            }
            // ---- branches (always a block's last op)
            Fast::BrI { a, v, cond, target } => {
                let t = g.a.label();
                g.ld_reg(0, a);
                g.a.mov32(1, v);
                g.a.cmp(0, 1);
                g.a.b_cond(acond(cond), t);
                g.chain(next_pc, count);
                g.a.bind(t);
                g.chain(target, count);
            }
            Fast::BrIEq { a, v, target } | Fast::BrINe { a, v, target } => {
                let t = g.a.label();
                g.ld_reg(0, a);
                g.a.mov32(1, v);
                g.a.cmp(0, 1);
                g.a.b_cond(if matches!(op.fast, Fast::BrIEq { .. }) { AC::Eq } else { AC::Ne }, t);
                g.chain(next_pc, count);
                g.a.bind(t);
                g.chain(target, count);
            }
            Fast::BrR { a, b, cond, target } => {
                let t = g.a.label();
                g.ld_reg(0, a);
                g.ld_reg(1, b);
                g.cmp(cond.is_float(), 0, 1);
                g.a.b_cond(acond(cond), t);
                g.chain(next_pc, count);
                g.a.bind(t);
                g.chain(target, count);
            }
            Fast::BitBr { r, mk, ne, mv, target } => {
                let t = g.a.label();
                g.rhs(mk, mv);
                g.ld_reg(0, r);
                g.a.tst(0, 1);
                g.a.b_cond(if ne { AC::Ne } else { AC::Eq }, t);
                g.chain(next_pc, count);
                g.a.bind(t);
                g.chain(target, count);
            }
            Fast::DecBr { r, cond, v, target } => {
                let t = g.a.label();
                g.ld_reg(0, r);
                g.a.sub_imm(0, 0, 1);
                g.st_reg(0, r);
                g.a.mov32(1, v);
                g.a.cmp(0, 1);
                g.a.b_cond(acond(cond), t);
                g.chain(next_pc, count);
                g.a.bind(t);
                g.chain(target, count);
            }
            Fast::Goto { target } => g.chain(target, count),
            Fast::Call { target } => {
                g.a.mov32(0, next_pc);
                g.a.str(0, CPU, off_rets());
                g.chain(target, count);
            }
            Fast::IfBlk { a, rk, fam, alt, has_else: false, rv, then_d, .. } => {
                // without an else part a predicated block is a conditional jump over its then part
                let taken = g.a.label();
                g.rhs(rk, rv);
                g.ld_reg(0, a);
                let c = if fam == 2 {
                    g.a.tst(0, 1);
                    if alt { AC::Ne } else { AC::Eq }
                } else {
                    g.cmp(fam >= 8, 0, 1);
                    acond(crate::cond_of_fam(fam as u64, alt))
                };
                g.a.b_cond(c, taken);
                g.chain(next_pc.wrapping_add(then_d as u32), count);
                g.a.bind(taken);
                g.chain(next_pc, count);
            }
            Fast::FOp { d, a, b, op } => {
                g.ld_reg(0, a);
                match op {
                    0x1f | 0x5f => {
                        g.a.fmov_s_w(0, 0);
                        if op == 0x1f { g.a.fcvtzs(0, 0) } else { g.a.fcvtzu(0, 0) }
                    }
                    0x8f | 0x9f => {
                        if op == 0x8f { g.a.scvtf(0, 0) } else { g.a.ucvtf(0, 0) }
                        g.a.fmov_w_s(0, 0);
                    }
                    _ => {
                        g.ld_reg(1, b);
                        g.a.fmov_s_w(0, 0);
                        g.a.fmov_s_w(1, 1);
                        let opc = match op { 0 => 0x1e20_2800, 1 => 0x1e20_3800, 2 => 0x1e20_0800, 3 => 0x1e20_1800, 5 => 0x1e20_7800, _ => 0x1e20_6800 };
                        g.a.fop(opc, 0, 0, 1);
                        g.a.fmov_w_s(0, 0);
                    }
                }
                g.st_reg(0, d);
            }
            Fast::Rts => {
                g.a.ldr(9, CPU, off_rets());
                g.exit_reg(9, count);
            }
            // ---- memory
            Fast::Ld { d, b, off, w, signed } => {
                match b {
                    Base::Reg(r) => g.ld_reg(0, r),
                    Base::Sp => g.a.ldr(0, CPU, off_sp()),
                }
                g.add_imm(0, 0, off);
                g.load(w, signed, idx);
                g.st_reg(0, d);
                bus_used = true;
            }
            Fast::LdW { d, b, off } => {
                g.ld_reg(0, b);
                g.add_imm(0, 0, off);
                g.load(4, false, idx);
                g.st_reg(0, d);
                bus_used = true;
            }
            Fast::LdWSp { d, off } => {
                g.a.ldr(0, CPU, off_sp());
                g.add_imm(0, 0, off);
                g.load(4, false, idx);
                g.st_reg(0, d);
                bus_used = true;
            }
            Fast::LdBu { d, b, off } => {
                g.ld_reg(0, b);
                g.add_imm(0, 0, off);
                g.load(1, false, idx);
                g.st_reg(0, d);
                bus_used = true;
            }
            Fast::St { s, b, off, w } => {
                match b {
                    Base::Reg(r) => g.ld_reg(0, r),
                    Base::Sp => g.a.ldr(0, CPU, off_sp()),
                }
                g.add_imm(0, 0, off);
                g.ld_reg(1, s);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::StW { s, b, off } => {
                g.ld_reg(0, b);
                g.add_imm(0, 0, off);
                g.ld_reg(1, s);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::StWSp { s, off } => {
                g.a.ldr(0, CPU, off_sp());
                g.add_imm(0, 0, off);
                g.ld_reg(1, s);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::LdIdx { d, b, i, sh, w, signed } => {
                g.ld_reg(0, b);
                g.ld_reg(1, i);
                g.a.add_lsl(0, 0, 1, sh as u32 & 31);
                g.load(w, signed, idx);
                g.st_reg(0, d);
                bus_used = true;
            }
            Fast::StIdx { s, b, i, sh, w } => {
                g.ld_reg(0, b);
                g.ld_reg(1, i);
                g.a.add_lsl(0, 0, 1, sh as u32 & 31);
                g.ld_reg(1, s);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::LdPost { d, b, w, signed, inc } => {
                g.ld_reg(0, b);
                g.load(w, signed, idx);
                g.st_reg(0, d);
                g.ld_reg(0, b); // (after the load wrote d, as the interpreter)
                g.add_imm(0, 0, inc);
                g.st_reg(0, b);
                bus_used = true;
            }
            Fast::StPost { s, b, w, inc } => {
                g.ld_reg(0, b);
                g.ld_reg(1, s);
                g.store(w, idx);
                g.ld_reg(0, b);
                g.add_imm(0, 0, inc);
                g.st_reg(0, b);
                bus_used = true;
            }
            Fast::Rmw { b, w, op: rop, off, v } => {
                g.ld_reg(0, b);
                g.add_imm(KEEP, 0, off);
                if let RmwOp::Mov = rop {
                    g.a.mov32(1, v);
                } else {
                    g.a.mov(0, KEEP);
                    g.load(w, false, idx);
                    g.a.mov32(2, v);
                    match rop {
                        RmwOp::Or => g.a.orr(1, 0, 2),
                        RmwOp::And => g.a.and(1, 0, 2),
                        RmwOp::Xor => g.a.eor(1, 0, 2),
                        RmwOp::Add => g.a.add(1, 0, 2),
                        RmwOp::Sub => g.a.sub(1, 0, 2),
                        RmwOp::Mov => unreachable!(),
                    }
                }
                g.a.mov(0, KEEP);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::MemA4 { b, off, op: aop, rk, rv } => {
                g.rhs(rk, rv);
                g.a.mov(KEEP2, 1);
                g.ld_reg(0, b);
                g.add_imm(KEEP, 0, off as u32);
                g.a.mov(0, KEEP);
                g.load(4, false, idx);
                g.a.mov(1, KEEP2);
                g.alu(aop);
                g.a.mov(1, 0);
                g.a.mov(0, KEEP);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::PushRet => {
                g.a.ldr(0, CPU, off_sp());
                g.a.sub_imm(0, 0, 4);
                g.a.str(0, CPU, off_sp());
                g.a.ldr(1, CPU, off_rets());
                g.store(4, idx);
                bus_used = true;
            }
            Fast::PopRet => {
                g.a.ldr(0, CPU, off_sp());
                g.load(4, false, idx);
                g.a.mov(KEEP, 0);
                g.a.ldr(0, CPU, off_sp());
                g.a.add_imm(0, 0, 4);
                g.a.str(0, CPU, off_sp());
                g.exit_reg(KEEP, count);
            }
            // ---- everything else: the interpreter's executor for this one op
            other => {
                let p: &'static Fast = Box::leak(Box::new(other));
                g.a.mov_x(0, CTX);
                g.a.mov64(1, p as *const Fast as u64);
                g.idx_w2(idx);
                g.a.mov32(3, next_pc);
                g.call(g.h_op);
                let fall = g.a.label();
                g.a.tbz(0, 32, fall); // bit 32: jumped (x0)
                g.exit_reg(0, count);
                g.a.bind(fall);
                bus_used = true;
                if other.may_jump() {
                    // a branch through the interpreter (the float compares) that fell through
                    g.chain(next_pc, count);
                }
            }
        }
        if bus_used && !op.fast.may_jump() {
            g.check_brk(next_pc, count);
        }
        pc = next_pc;
        if op.fast.may_jump() {
            break; // (the block's last op)
        }
    }
    // fell off the end of the prefix
    let n = ops.len() as u32;
    if !ops.last().map_or(false, |o| o.fast.may_jump()) {
        g.chain(pc, n);
    }
    g.a.bind(exit);
    g.a.ldp(LIMIT, 28, SP, 80);
    g.a.ldp(25, DONE, SP, 64);
    g.a.ldp(KEEP, KEEP2, SP, 48);
    g.a.ldp(RAM, XIP, SP, 32);
    g.a.ldp(CPU, CTX, SP, 16);
    g.a.ldp_post(29, 30, SP, FRAME);
    g.a.ret();
    Some((g.a.finish(), body))
}
