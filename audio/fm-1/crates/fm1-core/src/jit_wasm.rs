//! WebAssembly JIT for the blocks of micro-ops `Cpu::run_fast` interprets: the wasm32 build's
//! counterpart of jit.rs, with the same rules and the interpreter as the oracle (the two must
//! leave the same machine state; like the AArch64 JIT it leaves the add / subtract flags alone:
//! a producer right before a consumer stays on the careful path).
//!
//! A hot block becomes a region: the block and the blocks reachable from it over fixed edges
//! (fall-through, branch, goto and call targets), compiled together as one function in a small
//! wasm module of its own (blocks average three or four instructions: one call per block cost
//! as much as the interpreter saved). The module imports the emulator's memory and function
//! table, and exports `run(cpu, ctx, limit, start) -> instructions`; any block of the region
//! can be the start, and inside it a `loop` + `br_table` dispatches from block to block. The host (JavaScript)
//! compiles it synchronously and puts `run` into the emulator's exported function table
//! (`fm1_jit_compile`, see web/jit.js); Rust then calls it through that table index, so running
//! compiled code involves no JavaScript at all. The generated code reaches back into Rust the
//! same way: the helpers' table indices are `call_indirect` targets.
//!
//! Timing is kept exact as in jit.rs: a block runs only when all its ticks fit before anything
//! is due; RAM / XIP accesses are inline, anything else goes through a helper that first brings
//! the clock to that instruction's tick, and when the next tick is due after it (a peripheral
//! write, an idle skip) the code leaves right after the instruction. Within a region every block
//! first checks that its instructions still fit the call's limit (as jit.rs's chained bodies
//! do); edges out of the region, computed jumps and returns go back to `run_fast`.

use crate::{Base, Bus, Cond, Cpu, Fast, JitMem, Op, RmwOp};
use std::mem::offset_of;
use std::sync::atomic::{AtomicU32, Ordering};

#[link(wasm_import_module = "env")]
extern "C" {
    /// Compile a module and install its `run` in the function table: the table index, 0 on failure.
    fn fm1_jit_compile(bytes: *const u8, len: usize) -> u32;
}

/// Compiles still allowed (the host refills it: compiling in the audio thread must not hold up a
/// quantum for long; a block that finds none left stays interpreted and tries again later).
pub static COMPILE_BUDGET: AtomicU32 = AtomicU32::new(u32::MAX);

/// Runs of a block before it is compiled.
const HOT: u32 = 32;

/// Most blocks / instructions in one region (Safari's top tier skips very large functions).
pub(crate) const REGION_BLOCKS: usize = 32;
pub(crate) const REGION_OPS: usize = 384;

#[derive(Clone, Copy)]
enum Entry {
    Cold(u32),
    /// table index of the region's function, this block's index in it
    In(u32, u32),
    No,
}

/// JIT state kept in the Cpu (per block id).
pub struct Jit {
    state: Vec<Entry>,
    pub regions: u32,
    pub bytes: usize,
}

impl std::fmt::Debug for Jit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Jit(wasm, {} regions, {} bytes)", self.regions, self.bytes)
    }
}

impl Jit {
    pub fn new() -> Option<Jit> {
        Some(Jit { state: Vec::new(), regions: 0, bytes: 0 })
    }

    fn at(&mut self, id: usize) -> &mut Entry {
        if self.state.len() <= id {
            self.state.resize(id + 1, Entry::Cold(0));
        }
        &mut self.state[id]
    }

    /// Block `id`'s compiled code (function, start index); else counts the run, and true says the
    /// block just became hot (form its region and `install` it, or `refuse`).
    pub(crate) fn lookup(&mut self, id: usize) -> (Option<(u32, u32)>, bool) {
        match *self.at(id) {
            Entry::In(f, k) => (Some((f, k)), false),
            Entry::No => (None, false),
            Entry::Cold(c) if c + 1 < HOT => {
                *self.at(id) = Entry::Cold(c + 1);
                (None, false)
            }
            Entry::Cold(_) => (None, COMPILE_BUDGET.load(Ordering::Relaxed) > 0),
        }
    }

    /// Compile a region (blocks with their ids; the first is the hot one) and install it: every
    /// block not yet in a region gets this one. False: it could not be compiled.
    pub(crate) fn install<B: Bus>(&mut self, blocks: &[(usize, u32, Vec<crate::BOp>)], mem: &JitMem) -> bool {
        COMPILE_BUDGET.fetch_sub(1, Ordering::Relaxed);
        let m = compile::<B>(blocks, mem);
        // SAFETY: a plain byte slice; the host copies it before returning
        let f = unsafe { fm1_jit_compile(m.as_ptr(), m.len()) };
        if f == 0 {
            return false;
        }
        self.regions += 1;
        self.bytes += m.len();
        for (k, (id, ..)) in blocks.iter().enumerate() {
            if !matches!(*self.at(*id), Entry::In(..)) {
                *self.at(*id) = Entry::In(f, k as u32);
            }
        }
        true
    }

    /// Block `id` stays interpreted.
    pub(crate) fn refuse(&mut self, id: usize) {
        *self.at(id) = Entry::No;
    }

    /// Forget every compiled block (the block table was rebuilt; the table slots stay in use).
    pub fn reset(&mut self) {
        self.state.clear();
    }
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
}

/// Run compiled code: returns the instructions executed; cpu.pc is set.
///
/// # Safety
/// `f` must come from `Jit::entry` for this bus type and memory map.
pub(crate) unsafe fn run<B: Bus>(f: u32, start: u32, cpu: &mut Cpu, bus: &mut B, extra: u32) -> u32 {
    // instructions this call may run: their ticks ((k - 1) + extra) must all fit tick_room
    let limit = (bus.tick_room() + 1).saturating_sub(extra as u64).min(1 << 30) as u32;
    let mut ctx = Ctx { cpu: cpu as *mut Cpu, bus: bus as *mut B as *mut (), extra, synced: 0, brk: 0 };
    // SAFETY: on wasm32 a function pointer is its index in the function table, where the host
    // installed this block's `run` with exactly this signature
    let code: extern "C" fn(*mut Cpu, *mut Ctx, u32, u32) -> u32 = unsafe { std::mem::transmute(f as usize) };
    let k = code(cpu as *mut Cpu, &mut ctx, limit, start);
    if k > 0 {
        // the ticks of the instructions run, less those the helpers applied already
        let need = (k - 1) + extra;
        if need > ctx.synced {
            bus.add_ticks((need - ctx.synced) as u64);
        }
    }
    k
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

// ------------------------------------------------------------------ wasm encoding

fn uleb(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

fn sleb(out: &mut Vec<u8>, mut v: i64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if (v == 0 && b & 0x40 == 0) || (v == -1 && b & 0x40 != 0) {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

// opcodes
const BLOCK: u8 = 0x02;
const LOOP: u8 = 0x03;
const IF: u8 = 0x04;
const ELSE: u8 = 0x05;
const END: u8 = 0x0b;
const BR: u8 = 0x0c;
const BR_TABLE: u8 = 0x0e;
const RETURN: u8 = 0x0f;
const CALL_INDIRECT: u8 = 0x11;
const LOCAL_GET: u8 = 0x20;
const LOCAL_SET: u8 = 0x21;
const LOCAL_TEE: u8 = 0x22;
const I32_LOAD: u8 = 0x28;
const I32_LOAD8_S: u8 = 0x2c;
const I32_LOAD8_U: u8 = 0x2d;
const I32_LOAD16_S: u8 = 0x2e;
const I32_LOAD16_U: u8 = 0x2f;
const I32_STORE: u8 = 0x36;
const I32_STORE8: u8 = 0x3a;
const I32_STORE16: u8 = 0x3b;
const I32_CONST: u8 = 0x41;
const I32_EQZ: u8 = 0x45;
const I32_EQ: u8 = 0x46;
const I32_NE: u8 = 0x47;
const I32_LT_S: u8 = 0x48;
const I32_LT_U: u8 = 0x49;
const I32_GT_S: u8 = 0x4a;
const I32_GT_U: u8 = 0x4b;
const I32_LE_S: u8 = 0x4c;
const I32_LE_U: u8 = 0x4d;
const I32_GE_S: u8 = 0x4e;
const I32_GE_U: u8 = 0x4f;
const F32_EQ: u8 = 0x5b;
const F32_NE: u8 = 0x5c;
const F32_LT: u8 = 0x5d;
const F32_GT: u8 = 0x5e;
const F32_LE: u8 = 0x5f;
const F32_GE: u8 = 0x60;
const I32_ADD: u8 = 0x6a;
const I32_SUB: u8 = 0x6b;
const I32_MUL: u8 = 0x6c;
const I32_AND: u8 = 0x71;
const I32_OR: u8 = 0x72;
const I32_XOR: u8 = 0x73;
const I32_SHL: u8 = 0x74;
const I32_SHR_S: u8 = 0x75;
const I32_SHR_U: u8 = 0x76;
const I32_WRAP_I64: u8 = 0xa7;
const I64_SHR_U: u8 = 0x88;
const I64_CONST: u8 = 0x42;
const I64_EQZ: u8 = 0x50;
const F32_REINTERPRET_I32: u8 = 0xbe;
const I32_EXTEND8_S: u8 = 0xc0;
const I32_EXTEND16_S: u8 = 0xc1;
const VOID: u8 = 0x40;
const T_I32: u8 = 0x7f;
const T_I64: u8 = 0x7e;

// function types of the module: run, and the helpers as Rust exports them
const TY_RUN: u32 = 0;
const TY_READ: u32 = 1;
const TY_WRITE: u32 = 2;
const TY_OP: u32 = 3;

// locals: params cpu, ctx, limit, start; then i32 temporaries, the instructions done in this call
// before the current block, the block to run next, and one i64
const L_CPU: u32 = 0;
const L_CTX: u32 = 1;
const L_LIMIT: u32 = 2;
const L_START: u32 = 3;
const L_A: u32 = 4;
const L_B: u32 = 5;
const L_ADDR: u32 = 6;
const L_VAL: u32 = 7;
const L_OFF: u32 = 8;
const L_DONE: u32 = 9;
const L_CUR: u32 = 10;
const L_OPRES: u32 = 11;

fn off_reg(r: u8) -> u32 {
    (offset_of!(Cpu, regs) + 4 * (r & 15) as usize) as u32
}
fn off_sp() -> u32 {
    offset_of!(Cpu, sp) as u32
}
fn off_rets() -> u32 {
    offset_of!(Cpu, rets) as u32
}
fn off_pc() -> u32 {
    offset_of!(Cpu, pc) as u32
}
fn off_hold() -> u32 {
    offset_of!(Cpu, hold_irq) as u32
}
const OFF_BRK: u32 = offset_of!(Ctx, brk) as u32;

struct Gen<'a> {
    c: Vec<u8>,
    mem: &'a JitMem,
    h_read: u32,
    h_write: u32,
    h_op: u32,
    /// the region's blocks by start pc -> index
    index: std::collections::HashMap<u32, u32>,
    /// the block being emitted, the region's size, and the `if`s open inside the block's code
    cur: u32,
    n: u32,
    nest: u32,
}

impl Gen<'_> {
    fn op(&mut self, b: u8) {
        self.c.push(b);
    }
    fn get(&mut self, l: u32) {
        self.c.push(LOCAL_GET);
        uleb(&mut self.c, l as u64);
    }
    fn set(&mut self, l: u32) {
        self.c.push(LOCAL_SET);
        uleb(&mut self.c, l as u64);
    }
    fn tee(&mut self, l: u32) {
        self.c.push(LOCAL_TEE);
        uleb(&mut self.c, l as u64);
    }
    fn i32c(&mut self, v: u32) {
        self.c.push(I32_CONST);
        sleb(&mut self.c, v as i32 as i64);
    }
    fn mem_op(&mut self, op: u8, align: u32, off: u32) {
        self.c.push(op);
        uleb(&mut self.c, align as u64);
        uleb(&mut self.c, off as u64);
    }
    /// push the guest register r
    fn ld_reg(&mut self, r: u8) {
        self.get(L_CPU);
        self.mem_op(I32_LOAD, 2, off_reg(r));
    }
    /// guest register d = local l
    fn st_reg_from(&mut self, d: u8, l: u32) {
        self.get(L_CPU);
        self.get(l);
        self.mem_op(I32_STORE, 2, off_reg(d));
    }
    fn ld_field(&mut self, off: u32) {
        self.get(L_CPU);
        self.mem_op(I32_LOAD, 2, off);
    }
    fn st_field_from(&mut self, off: u32, l: u32) {
        self.get(L_CPU);
        self.get(l);
        self.mem_op(I32_STORE, 2, off);
    }
    /// push done + count
    fn done_plus(&mut self, count: u32) {
        self.get(L_DONE);
        if count != 0 {
            self.i32c(count);
            self.op(I32_ADD);
        }
    }
    /// leave with pc = imm, `count` instructions of this block done
    fn exit_imm(&mut self, pc: u32, count: u32) {
        self.get(L_CPU);
        self.i32c(pc);
        self.mem_op(I32_STORE, 2, off_pc());
        self.done_plus(count);
        self.op(RETURN);
    }
    /// leave with pc = local l
    fn exit_local(&mut self, l: u32, count: u32) {
        self.st_field_from(off_pc(), l);
        self.done_plus(count);
        self.op(RETURN);
    }
    /// continue at a fixed pc, `count` instructions of this block done: the region's block there,
    /// else back to Rust. `last`: at the very end of the block's code (the next block's code
    /// follows, so going there is falling through)
    fn goto(&mut self, pc: u32, count: u32, last: bool) {
        let Some(&k) = self.index.get(&pc) else {
            self.exit_imm(pc, count);
            return;
        };
        self.done_plus(count);
        self.set(L_DONE);
        if last && self.nest == 0 && k == self.cur + 1 {
            return;
        }
        self.i32c(k);
        self.set(L_CUR);
        // to the dispatch loop: past the blocks still open after this one's code, and the ifs
        self.op(BR);
        uleb(&mut self.c, (self.n - 1 - self.cur + self.nest) as u64);
    }
    fn if_(&mut self) {
        self.op(IF);
        self.op(VOID);
        self.nest += 1;
    }
    fn end(&mut self) {
        self.op(END);
        self.nest -= 1;
    }
    /// push the helpers' instruction index of op i of this block
    fn idx(&mut self, i: u32) {
        self.done_plus(i);
    }
    fn call_ind(&mut self, ty: u32, f: u32) {
        self.i32c(f);
        self.op(CALL_INDIRECT);
        uleb(&mut self.c, ty as u64);
        self.op(0); // table 0
    }
    /// After an op that may have called the bus: leave if the next tick is due (and, between a
    /// glued pair's two instructions, keep interrupts back until the second has run).
    fn check_brk(&mut self, next_pc: u32, count: u32, hold: bool) {
        self.get(L_CTX);
        self.mem_op(I32_LOAD, 2, OFF_BRK);
        self.if_();
        if hold {
            self.get(L_CPU);
            self.i32c(1);
            self.mem_op(I32_STORE, 2, off_hold());
        }
        self.exit_imm(next_pc, count);
        self.end();
    }

    /// push alu(op, local a, local b) (wasm shifts take the count mod 32, as `alu`)
    fn alu(&mut self, op: Op) {
        match op {
            Op::RSub => {
                self.get(L_B);
                self.get(L_A);
                self.op(I32_SUB);
                return;
            }
            Op::AndNot => {
                self.get(L_A);
                self.get(L_B);
                self.i32c(u32::MAX);
                self.op(I32_XOR);
                self.op(I32_AND);
                return;
            }
            _ => {}
        }
        self.get(L_A);
        self.get(L_B);
        self.op(match op {
            Op::Add => I32_ADD,
            Op::Sub => I32_SUB,
            Op::And => I32_AND,
            Op::Or => I32_OR,
            Op::Xor => I32_XOR,
            Op::Mul => I32_MUL,
            Op::Shl => I32_SHL,
            Op::Shr => I32_SHR_U,
            Op::Sar => I32_SHR_S,
            Op::RSub | Op::AndNot => unreachable!(),
        });
    }
    /// local b = an A4 / BitBr right-hand side: rk 0 register, 1 immediate, 2 `1 << reg`
    fn rhs(&mut self, rk: u8, rv: u32) {
        match rk {
            0 => self.ld_reg(rv as u8),
            1 => self.i32c(rv),
            _ => {
                self.i32c(1);
                self.ld_reg(rv as u8);
                self.op(I32_SHL);
            }
        }
        self.set(L_B);
    }
    /// push the compare of locals a and b
    fn cmp(&mut self, c: Cond) {
        let float = c.is_float();
        self.get(L_A);
        if float {
            self.op(F32_REINTERPRET_I32);
        }
        self.get(L_B);
        if float {
            self.op(F32_REINTERPRET_I32);
        }
        let (op, negate) = match c {
            Cond::Eq => (I32_EQ, false),
            Cond::Ne => (I32_NE, false),
            Cond::LtU => (I32_LT_U, false),
            Cond::GtU => (I32_GT_U, false),
            Cond::LeU => (I32_LE_U, false),
            Cond::GeU => (I32_GE_U, false),
            Cond::LtS => (I32_LT_S, false),
            Cond::GtS => (I32_GT_S, false),
            Cond::LeS => (I32_LE_S, false),
            Cond::GeS => (I32_GE_S, false),
            // as `fcond`: the unordered forms are the negations
            Cond::FEq => (F32_EQ, false),
            Cond::FUne => (F32_NE, false),
            Cond::FLt => (F32_LT, false),
            Cond::FUge => (F32_LT, true),
            Cond::FLe => (F32_LE, false),
            Cond::FUgt => (F32_LE, true),
            Cond::FGe => (F32_GE, false),
            Cond::FUlt => (F32_GE, true),
            Cond::FGt => (F32_GT, false),
            Cond::FUle => (F32_GT, true),
        };
        self.op(op);
        if negate {
            self.op(I32_EQZ);
        }
    }

    /// local val = load(w, signed) at guest address local addr: inline RAM / XIP (the Soc's fast
    /// paths: the word or halfword must lie inside), else the bus.
    fn load(&mut self, w: u8, signed: bool, idx: u32) {
        let mem = *self.mem;
        let ld = match (w, signed) {
            (4, _) => I32_LOAD,
            (2, false) => I32_LOAD16_U,
            (2, true) => I32_LOAD16_S,
            (1, false) => I32_LOAD8_U,
            _ => I32_LOAD8_S,
        };
        let align = match w { 4 => 2, 2 => 1, _ => 0 };
        for (gbase, len, host) in [(mem.ram_base, mem.ram_len, mem.ram as u32), (mem.xip_base, mem.xip_len, mem.xip as u32)] {
            self.get(L_ADDR);
            self.i32c(gbase);
            self.op(I32_SUB);
            if w == 2 {
                self.i32c(!1u32); // a halfword is the one at addr & !1 (Soc read16)
                self.op(I32_AND);
            }
            self.tee(L_OFF);
            self.i32c(len.saturating_sub(w as u32));
            self.op(I32_LE_U);
            self.if_();
            self.get(L_OFF);
            self.mem_op(ld, align, host);
            self.set(L_VAL);
            self.op(ELSE);
        }
        self.get(L_CTX);
        self.get(L_ADDR);
        self.idx(idx);
        self.i32c(w as u32);
        self.call_ind(TY_READ, self.h_read);
        match (w, signed) {
            (2, true) => self.op(I32_EXTEND16_S),
            (1, true) => self.op(I32_EXTEND8_S),
            _ => {}
        }
        self.set(L_VAL);
        self.end();
        self.end();
    }

    /// store(w) of local val at guest address local addr: inline RAM, else the bus.
    fn store(&mut self, w: u8, idx: u32) {
        let mem = *self.mem;
        self.get(L_ADDR);
        self.i32c(mem.ram_base);
        self.op(I32_SUB);
        self.tee(L_OFF);
        self.i32c(mem.ram_len.saturating_sub(w as u32));
        self.op(I32_LE_U);
        if w == 2 {
            // an odd halfword goes the Soc's merging way
            self.get(L_ADDR);
            self.i32c(1);
            self.op(I32_AND);
            self.op(I32_EQZ);
            self.op(I32_AND);
        }
        self.if_();
        self.get(L_OFF);
        self.get(L_VAL);
        match w {
            4 => self.mem_op(I32_STORE, 2, mem.ram as u32),
            2 => self.mem_op(I32_STORE16, 1, mem.ram as u32),
            _ => self.mem_op(I32_STORE8, 0, mem.ram as u32),
        }
        self.op(ELSE);
        self.get(L_CTX);
        self.get(L_ADDR);
        self.get(L_VAL);
        self.idx(idx);
        self.i32c(w as u32);
        self.call_ind(TY_WRITE, self.h_write);
        self.end();
    }

    /// local addr = base + off
    fn addr(&mut self, b: Base, off: u32) {
        match b {
            Base::Reg(r) => self.ld_reg(r),
            Base::Sp => self.ld_field(off_sp()),
        }
        if off != 0 {
            self.i32c(off);
            self.op(I32_ADD);
        }
        self.set(L_ADDR);
    }
}

/// The module for a region: blocks (id, start pc, plain micro-ops: none careful), the hot one
/// first.
fn compile<B: Bus>(blocks: &[(usize, u32, Vec<crate::BOp>)], mem: &JitMem) -> Vec<u8> {
    let n = blocks.len() as u32;
    let mut g = Gen {
        c: Vec::with_capacity(64 * blocks.iter().map(|b| b.2.len()).sum::<usize>()),
        mem,
        h_read: h_read::<B> as usize as u32,
        h_write: h_write::<B> as usize as u32,
        h_op: h_op::<B> as usize as u32,
        index: blocks.iter().enumerate().map(|(k, b)| (b.1, k as u32)).collect(),
        cur: 0,
        n,
        nest: 0,
    };
    // loop { block_{n-1} { .. block_0 { br_table cur } code_0 } code_1 .. } code_{n-1} }: a br
    // to depth k from the innermost block lands on code_k; code_k reaches the loop through the
    // n - 1 - k blocks still open
    g.get(L_START);
    g.set(L_CUR);
    g.op(LOOP);
    g.op(VOID);
    for _ in 0..n {
        g.op(BLOCK);
        g.op(VOID);
    }
    g.get(L_CUR);
    g.op(BR_TABLE);
    uleb(&mut g.c, n as u64);
    for k in 0..n {
        uleb(&mut g.c, k as u64);
    }
    uleb(&mut g.c, (n - 1) as u64);
    for (k, (_, pc0, ops)) in blocks.iter().enumerate() {
        g.op(END);
        g.cur = k as u32;
        g.nest = 0;
        block::<B>(&mut g, *pc0, ops);
    }
    g.op(END); // loop
    g.op(0x00); // unreachable: every block's code leaves or branches
    g.op(END);
    module(&g.c)
}

/// The code of one block of a region.
fn block<B: Bus>(g: &mut Gen<'_>, pc0: u32, ops: &[crate::BOp]) {
    // the whole block must fit the call's limit, else back to Rust before running any of it
    g.done_plus(ops.len() as u32);
    g.get(L_LIMIT);
    g.op(I32_GT_U);
    g.if_();
    g.exit_imm(pc0, 0);
    g.end();

    let mut pc = pc0;
    let mut ended = false;
    for (i, op) in ops.iter().enumerate() {
        let idx = i as u32;
        let next_pc = pc + op.len as u32;
        let count = idx + 1;
        let mut bus_used = false;
        match op.fast {
            Fast::Nop => {}
            Fast::MovI { d, v } => {
                g.get(L_CPU);
                g.i32c(v);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Mov { d, s } => {
                g.get(L_CPU);
                g.ld_reg(s);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::AddRI { d, s, v } => {
                g.get(L_CPU);
                g.ld_reg(s);
                g.i32c(v);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::ShlI { d, s, n } | Fast::SarI { d, s, n } => {
                g.get(L_CPU);
                g.ld_reg(s);
                g.i32c(n as u32 & 31);
                g.op(if matches!(op.fast, Fast::ShlI { .. }) { I32_SHL } else { I32_SHR_S });
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Alu3 { d, a, b, op } => {
                g.ld_reg(a);
                g.set(L_A);
                g.ld_reg(b);
                g.set(L_B);
                g.get(L_CPU);
                g.alu(op);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Alu3I { d, a, v, op } => {
                g.ld_reg(a);
                g.set(L_A);
                g.i32c(v);
                g.set(L_B);
                g.get(L_CPU);
                g.alu(op);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Alu2 { d, b, op } => {
                g.ld_reg(d);
                g.set(L_A);
                g.ld_reg(b);
                g.set(L_B);
                g.get(L_CPU);
                g.alu(op);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Alu2I { d, v, op } => {
                g.ld_reg(d);
                g.set(L_A);
                g.i32c(v);
                g.set(L_B);
                g.get(L_CPU);
                g.alu(op);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::A4 { d, s, op, rk, rv } => {
                g.rhs(rk, rv);
                g.ld_reg(s);
                g.set(L_A);
                g.get(L_CPU);
                g.alu(op);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Ext { d, s, part, signed } => {
                g.get(L_CPU);
                g.ld_reg(s);
                match (part, signed) {
                    (0, false) => {
                        g.i32c(0xff);
                        g.op(I32_AND);
                    }
                    (0, true) => g.op(I32_EXTEND8_S),
                    (1, false) => {
                        g.i32c(0xffff);
                        g.op(I32_AND);
                    }
                    (1, true) => g.op(I32_EXTEND16_S),
                    (_, false) => {
                        g.i32c(16);
                        g.op(I32_SHR_U);
                    }
                    (_, true) => {
                        g.i32c(16);
                        g.op(I32_SHR_S);
                    }
                }
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::MinMax { d, a, b, kind } => {
                g.ld_reg(a);
                g.set(L_A);
                g.ld_reg(b);
                g.set(L_B);
                g.get(L_CPU);
                g.get(L_A);
                g.get(L_B);
                g.get(L_A);
                g.get(L_B);
                // select(a, b, a OP b): smin a <s b, smax a >s b, umin a <u b, umax a >u b
                g.op(match kind { 0 => I32_LT_S, 1 => I32_GT_S, 2 => I32_LT_U, _ => I32_GT_U });
                g.op(0x1b); // select
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::SpAdd { v } => {
                g.get(L_CPU);
                g.ld_field(off_sp());
                g.i32c(v);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_sp());
            }
            Fast::SpFromR { s } => {
                g.get(L_CPU);
                g.ld_reg(s);
                g.mem_op(I32_STORE, 2, off_sp());
            }
            Fast::RFromSp { d, v } => {
                g.get(L_CPU);
                g.ld_field(off_sp());
                g.i32c(v);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_reg(d));
            }
            Fast::Ld { d, b, off, w, signed } => {
                g.addr(b, off);
                g.load(w, signed, idx);
                g.st_reg_from(d, L_VAL);
                bus_used = true;
            }
            Fast::LdW { d, b, off } => {
                g.addr(Base::Reg(b), off);
                g.load(4, false, idx);
                g.st_reg_from(d, L_VAL);
                bus_used = true;
            }
            Fast::LdWSp { d, off } => {
                g.addr(Base::Sp, off);
                g.load(4, false, idx);
                g.st_reg_from(d, L_VAL);
                bus_used = true;
            }
            Fast::LdBu { d, b, off } => {
                g.addr(Base::Reg(b), off);
                g.load(1, false, idx);
                g.st_reg_from(d, L_VAL);
                bus_used = true;
            }
            Fast::St { s, b, off, w } => {
                g.addr(b, off);
                g.ld_reg(s);
                g.set(L_VAL);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::StW { s, b, off } => {
                g.addr(Base::Reg(b), off);
                g.ld_reg(s);
                g.set(L_VAL);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::StWSp { s, off } => {
                g.addr(Base::Sp, off);
                g.ld_reg(s);
                g.set(L_VAL);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::LdIdx { d, b, i, sh, w, signed } => {
                g.ld_reg(b);
                g.ld_reg(i);
                if sh != 0 {
                    g.i32c(sh as u32);
                    g.op(I32_SHL);
                }
                g.op(I32_ADD);
                g.set(L_ADDR);
                g.load(w, signed, idx);
                g.st_reg_from(d, L_VAL);
                bus_used = true;
            }
            Fast::StIdx { s, b, i, sh, w } => {
                g.ld_reg(b);
                g.ld_reg(i);
                if sh != 0 {
                    g.i32c(sh as u32);
                    g.op(I32_SHL);
                }
                g.op(I32_ADD);
                g.set(L_ADDR);
                g.ld_reg(s);
                g.set(L_VAL);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::LdPost { d, b, w, signed, inc } => {
                // d = [b]; then b = b + inc (b read after the load, as exec_fast)
                g.ld_reg(b);
                g.set(L_ADDR);
                g.load(w, signed, idx);
                g.st_reg_from(d, L_VAL);
                g.get(L_CPU);
                g.ld_reg(b);
                g.i32c(inc);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_reg(b));
                bus_used = true;
            }
            Fast::StPost { s, b, w, inc } => {
                g.ld_reg(b);
                g.set(L_ADDR);
                g.ld_reg(s);
                g.set(L_VAL);
                g.store(w, idx);
                g.get(L_CPU);
                g.ld_reg(b);
                g.i32c(inc);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_reg(b));
                bus_used = true;
            }
            Fast::Rmw { b, w, op: rop, off, v } => {
                g.addr(Base::Reg(b), off);
                if !matches!(rop, RmwOp::Mov) {
                    g.load(w, false, idx);
                    g.get(L_VAL);
                    g.i32c(v);
                    g.op(match rop {
                        RmwOp::Or => I32_OR,
                        RmwOp::And => I32_AND,
                        RmwOp::Xor => I32_XOR,
                        RmwOp::Add => I32_ADD,
                        RmwOp::Sub => I32_SUB,
                        RmwOp::Mov => unreachable!(),
                    });
                } else {
                    g.i32c(v);
                }
                g.set(L_VAL);
                g.store(w, idx);
                bus_used = true;
            }
            Fast::PushRet => {
                // sp -= 4; [sp] = rets
                g.ld_field(off_sp());
                g.i32c(4);
                g.op(I32_SUB);
                g.set(L_ADDR);
                g.st_field_from(off_sp(), L_ADDR);
                g.ld_field(off_rets());
                g.set(L_VAL);
                g.store(4, idx);
                bus_used = true;
            }
            Fast::PopRet => {
                // pc = [sp]; sp += 4
                g.ld_field(off_sp());
                g.set(L_ADDR);
                g.load(4, false, idx);
                g.get(L_CPU);
                g.get(L_ADDR);
                g.i32c(4);
                g.op(I32_ADD);
                g.mem_op(I32_STORE, 2, off_sp());
                g.exit_local(L_VAL, count);
                ended = true;
            }
            Fast::BrI { a, v, cond, target } => {
                g.ld_reg(a);
                g.set(L_A);
                g.i32c(v);
                g.set(L_B);
                g.cmp(cond);
                g.if_();
                g.goto(target, count, false);
                g.end();
            }
            Fast::BrIEq { a, v, target } | Fast::BrINe { a, v, target } => {
                g.ld_reg(a);
                g.i32c(v);
                g.op(if matches!(op.fast, Fast::BrIEq { .. }) { I32_EQ } else { I32_NE });
                g.if_();
                g.goto(target, count, false);
                g.end();
            }
            Fast::BrR { a, b, cond, target } => {
                g.ld_reg(a);
                g.set(L_A);
                g.ld_reg(b);
                g.set(L_B);
                g.cmp(cond);
                g.if_();
                g.goto(target, count, false);
                g.end();
            }
            Fast::BitBr { r, mk, ne, mv, target } => {
                g.rhs(mk, mv);
                g.ld_reg(r);
                g.get(L_B);
                g.op(I32_AND);
                if !ne {
                    g.op(I32_EQZ);
                }
                g.if_();
                g.goto(target, count, false);
                g.end();
            }
            Fast::DecBr { r, cond, v, target } => {
                g.ld_reg(r);
                g.i32c(1);
                g.op(I32_SUB);
                g.set(L_A);
                g.st_reg_from(r, L_A);
                g.i32c(v);
                g.set(L_B);
                g.cmp(cond);
                g.if_();
                g.goto(target, count, false);
                g.end();
            }
            Fast::IfBlk { a, rk, fam, alt, has_else: false, rv, then_d, .. } if fam < 8 => {
                // taken: the then-part follows; not taken: skip it
                g.rhs(rk, rv);
                g.ld_reg(a);
                g.set(L_A);
                if fam == 2 {
                    g.get(L_A);
                    g.get(L_B);
                    g.op(I32_AND);
                    g.i32c(0);
                    g.op(I32_NE);
                    g.i32c(alt as u32);
                    g.op(I32_EQ);
                } else {
                    g.get(L_A);
                    g.get(L_B);
                    g.op(match fam { 0 => I32_EQ, 1 => I32_GE_U, 4 => I32_GT_U, 5 => I32_GE_S, _ => I32_GT_S });
                    if alt {
                        g.op(I32_EQZ);
                    }
                }
                g.op(I32_EQZ);
                g.if_();
                g.goto(next_pc.wrapping_add(then_d as u32), count, false);
                g.end();
            }
            Fast::Goto { target } => {
                g.goto(target, count, true);
                ended = true;
            }
            Fast::Call { target } => {
                g.get(L_CPU);
                g.i32c(next_pc);
                g.mem_op(I32_STORE, 2, off_rets());
                g.goto(target, count, true);
                ended = true;
            }
            Fast::Rts => {
                g.ld_field(off_rets());
                g.set(L_VAL);
                g.exit_local(L_VAL, count);
                ended = true;
            }
            // ---- everything else: the interpreter's executor for this one op
            other => {
                let p: &'static Fast = Box::leak(Box::new(other));
                g.get(L_CTX);
                g.i32c(p as *const Fast as u32);
                g.idx(idx);
                g.i32c(next_pc);
                g.call_ind(TY_OP, g.h_op);
                g.c.push(LOCAL_TEE);
                uleb(&mut g.c, L_OPRES as u64);
                g.c.push(I64_CONST);
                sleb(&mut g.c, 32);
                g.op(I64_SHR_U);
                g.op(I64_EQZ);
                g.op(I32_EQZ);
                g.if_();
                g.get(L_OPRES);
                g.op(I32_WRAP_I64);
                g.set(L_VAL);
                g.exit_local(L_VAL, count);
                g.end();
                bus_used = true;
            }
        }
        if ended {
            break;
        }
        if bus_used && !op.fast.may_jump() {
            g.check_brk(next_pc, count, op.glue);
        }
        pc = next_pc;
        if op.fast.may_jump() {
            // (the block's last op): it fell through
            g.goto(next_pc, count, true);
            ended = true;
            break;
        }
    }
    if !ended {
        // fell off the end of the prefix
        g.goto(pc, ops.len() as u32, true);
    }
}

/// The whole module around one function body.
fn module(body: &[u8]) -> Vec<u8> {
    let mut m = vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    let section = |m: &mut Vec<u8>, id: u8, content: &[u8]| {
        m.push(id);
        uleb(m, content.len() as u64);
        m.extend_from_slice(content);
    };
    let name = |v: &mut Vec<u8>, s: &str| {
        uleb(v, s.len() as u64);
        v.extend_from_slice(s.as_bytes());
    };
    // types: run(i32 x4) -> i32; read(i32 x4) -> i32; write(i32 x5); op(i32 x4) -> i64
    let types: [(&[u8], &[u8]); 4] = [(&[T_I32; 4], &[T_I32]), (&[T_I32; 4], &[T_I32]), (&[T_I32; 5], &[]), (&[T_I32; 4], &[T_I64])];
    let mut t = Vec::new();
    uleb(&mut t, types.len() as u64);
    for (p, r) in types {
        t.push(0x60);
        uleb(&mut t, p.len() as u64);
        t.extend_from_slice(p);
        uleb(&mut t, r.len() as u64);
        t.extend_from_slice(r);
    }
    section(&mut m, 1, &t);
    // imports: env.memory, env.table
    let mut im = Vec::new();
    uleb(&mut im, 2);
    name(&mut im, "env");
    name(&mut im, "memory");
    im.extend_from_slice(&[0x02, 0x00, 0x00]);
    name(&mut im, "env");
    name(&mut im, "table");
    im.extend_from_slice(&[0x01, 0x70, 0x00, 0x00]);
    section(&mut m, 2, &im);
    section(&mut m, 3, &[1, TY_RUN as u8]);
    let mut ex = Vec::new();
    uleb(&mut ex, 1);
    name(&mut ex, "run");
    ex.extend_from_slice(&[0x00, 0x00]);
    section(&mut m, 7, &ex);
    // code: locals a, b, addr, val, off, done, cur (i32) and the op result (i64)
    let mut f = Vec::new();
    f.extend_from_slice(&[2, 7, T_I32, 1, T_I64]);
    f.extend_from_slice(body);
    let mut code = Vec::new();
    uleb(&mut code, 1);
    uleb(&mut code, f.len() as u64);
    code.extend_from_slice(&f);
    section(&mut m, 10, &code);
    m
}
