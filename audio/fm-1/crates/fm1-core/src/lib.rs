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
pub trait Bus {
    fn read8(&mut self, addr: u32) -> u8;
    fn read16(&mut self, addr: u32) -> u16;
    fn read32(&mut self, addr: u32) -> u32;
    fn write8(&mut self, addr: u32, value: u8);
    fn write16(&mut self, addr: u32, value: u16);
    fn write32(&mut self, addr: u32, value: u32);
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
}

impl Cpu {
    pub fn new(entry: u32) -> Self {
        Self {
            pc: entry,
            ..Default::default()
        }
    }

    /// Fetch/decode/execute one instruction. Fetches a 6-byte window (the
    /// longest pi32v2 instruction); short instructions zero-extend.
    pub fn step<B: Bus>(&mut self, bus: &mut B) -> Result<(), CoreError> {
        let lo = bus.read32(self.pc) as u64;
        let hi = bus.read32(self.pc + 4) as u64;
        let win = (hi << 32) | lo;
        let insn =
            fm1_isa::decode_win(win, self.pc).map_err(|e| CoreError::Decode(e))?;
        let next_pc = self.pc + insn.entry.len as u32;
        let is_pair_head = insn.entry.syntax.trim_end().ends_with('#');
        let before = self.regs;
        let pending = self.pair_pending.take();
        let res = self.execute(bus, &insn, next_pc);
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
        if n == "cnum" { self.core_id } else { self.sreg_store[Self::sreg_index(n)] }
    }
    fn set_sreg(&mut self, n: &str, v: u32) {
        self.sreg_store[Self::sreg_index(n)] = v;
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
        let canon = insn.entry.syntax.replace("-#i", "#i").replace("-#h", "#h");
        let s = canon.trim_end_matches(" #").trim_end();
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
                    let (mask, op_rhs) = rest.split_once(") ").ok_or(CoreError::MissingSlot { name: insn.entry.name, pc: self.pc, slot: 9 })?;
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
            if let Some((addr_txt, rest)) = inner.split_once("] ") {
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
            let (h, l) = t.strip_prefix('r')?.split_once("_r")?;
            Some((h.parse().ok()?, l.parse().ok()?))
        };
        if let Some((lhs, rhs)) = s.split_once(" = ") {
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
        if let Some((lhs, rhs)) = s.split_once(" = ") {
            if let Some((dh, dl)) = pair_of(lhs) {
                if let Some((sh_, sl)) = pair_of(rhs) {
                    let (a, b) = (self.regs[sh_], self.regs[sl]);
                    self.regs[dh] = a;
                    self.regs[dl] = b;
                    return Ok(Some(None));
                }
                if rhs == "#i" {
                    let imm = self.slot(insn, 0)?;
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
        if let Some((lhs, rhs)) = s.split_once(" += ") {
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
            && ((s.starts_with("{") && s.contains("} = [R+")) || (s.starts_with("[R+") && s.contains("] = {")))
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
            if s.contains("[R++]") {
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
            for n in &list {
                let val = sreg_get_named(self, n);
                self.sp = self.sp.wrapping_sub(4);
                bus.write32(self.sp, val);
            }
            return Ok(Some(None));
        }
        if let Some(list) = s.strip_suffix(" = [sp++]").and_then(named_list) {
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
            "rti" => return Ok(Some(Some(self.sregs("reti")))),
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
                bus.write32(addr, if s.contains("&=") { cur & !m } else { cur | m });
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
        if let Some((lhs, rhs)) = s.split_once(" = ") {
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
                let d = r(self, 0)?;
                let a = self.regs[r(self, 1)?];
                let b = self.regs[r(self, 2)?];
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
            "nop" | "csync" | "sti" | "cli" | "idle" | "lockclr" | "lockset" | "pfetch [R]"
            | "sti R" | "cli R" => {}
            "R = R" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?]; }
            "R = #i" | "R = #h" => { let d = r(self, 0)?; self.regs[d] = v(self, 1)?; }
            "R = cnum" => { let d = r(self, 0)?; self.regs[d] = self.core_id; }
            "R = sp" => { let d = r(self, 0)?; self.regs[d] = self.sp; }
            "R = sp + #i" => { let d = r(self, 0)?; self.regs[d] = self.sp.wrapping_add(v(self, 1)?); }
            "sp += #i" => self.sp = self.sp.wrapping_add(v(self, 0)?),
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
                let kind = s[8..].split(' ').next().unwrap_or("<<");
                self.regs[d] = sh(a, n, kind);
            }
            "R = -R" => { let d = r(self, 0)?; self.regs[d] = self.regs[r(self, 1)?].wrapping_neg(); }
            "R = ~R" => { let d = r(self, 0)?; self.regs[d] = !self.regs[r(self, 1)?]; }
            "R = R.b0 (u)" | "R = R.b0 (s)" | "R = R.l (u)" | "R = R.l (s)" | "R = R.h (u)"
            | "R = R.h (s)" | "R = R.b1 (u)" | "R = R.b2 (u)" | "R = R.b3 (u)" => {
                let d = r(self, 0)?;
                let x = self.regs[r(self, 1)?];
                let signed = s.ends_with("(s)");
                self.regs[d] = match &s[8..10] {
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
            let Ok(insn) = fm1_isa::decode_win((hi << 32) | lo, pc) else { return pc };
            pc += insn.entry.len as u32;
            if insn.entry.syntax.trim_end().ends_with('#') {
                // a dual-issue pair (`x #` + the next instruction) is one unit
                // (memset at 0x02042f0e: `{ r2 -= 1 #; b[r3++=1] = r1; goto }` = 2 units)
                let lo = bus.read32(pc) as u64;
                let hi = bus.read32(pc + 4) as u64;
                if let Ok(second) = fm1_isa::decode_win((hi << 32) | lo, pc) {
                    pc += second.entry.len as u32;
                }
                continue;
            }
            let name = insn.entry.name;
            if insn.entry.len == 4 && name.starts_with("if") && !name.contains("goto") {
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
        next_pc: u32,
    ) -> Result<(), CoreError> {
        let name = insn.entry.name;
        let mut jumped: Option<u32> = None;
        if std::env::var("FM1_TRACE").is_ok() {
            eprintln!("[{}] c{} pc={:#010x} class={} len={} sp={:#x} r0-7={:x?} ",
                self.insn_count, self.core_id, self.pc, name, insn.entry.len, self.sp, &self.regs[..8]);
        }

        let alu4 = if insn.entry.len == 4 { decode_alu4(insn.raw) } else { None };
        let bittest = if name.starts_with("if") { decode_bittest(insn.raw, insn.entry.len) } else { None };

        match name {
            _ if bittest.is_some() => {
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
            _ if alu4.is_some() => {
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
            "nop" | "csync" | "sti_r" | "cli_r" => {}
            "lockclr_r" | "lockset_r" => {}

            // ---- moves ------------------------------------------------
            "r_mov_i_l2" => {
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
            "sp_mov_i" => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.sp = v;
            }
            "ssp_mov_i" => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.ssp = v;
                //每个 core shares one stack in bring-up
                self.sp = v;
            }
            "usp_mov_i" => {
                let v = ((insn.raw >> 16) & 0xffffffff) as u32;
                self.usp = v;
            }

            // ---- arithmetic -------------------------------------------
            "r_mov_h" => {
                // R = #h: reg = bits(28,31); value = composed(bits(24,27), bits(16,23))
                let raw = insn.raw;
                let d = ((raw >> 28) & 0xf) as usize;
                self.regs[d] = composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32);
            }
            "r_i_or_r" | "r_i_and_r" => {
                // [R(base)+off] |=/&= R(src): base = b3>>4; src = b3&0xf;
                // off = b1 (8-bit)
                let raw = insn.raw;
                let b = ((raw >> 28) & 0xf) as usize;
                let s = ((raw >> 24) & 0xf) as usize;
                let off = (raw >> 8) & 0xff;
                let addr = self.regs[b].wrapping_add(off as u32);
                let cur = bus.read32(addr);
                let v = if name.contains("and") {
                    cur & self.regs[s]
                } else {
                    cur | self.regs[s]
                };
                bus.write32(addr, v);
            }
            "r_mov_r_lsl_i" | "r_mov_r_lsr_i" | "r_mov_r_asr_i" => {
                // 2-byte `R = R <op> #i` (mask e088): dst = (0,2); src = (4,6);
                // sh = (8,12); bits 3/7 select lsl (00) / lsr (bit7) / asr
                // (bit3|bit7). Corpus: `a2 a2` r2 = r2 >> 2, `9a a2` r2 = r1 >>> 2.
                let raw = insn.raw;
                let d = (raw & 7) as usize;
                let s = ((raw >> 4) & 7) as usize;
                let sh = ((raw >> 8) & 0x1f) as u32;
                let v = self.regs[s];
                self.regs[d] = if name.contains("lsr") {
                    v.wrapping_shr(sh % 32)
                } else if name.contains("asr") {
                    ((v as i32) >> (sh % 32)) as u32
                } else {
                    v.wrapping_shl(sh % 32)
                };
            }

            // ---- loads / stores ---------------------------------------

            // ---- control flow -----------------------------------------
            n if insn.entry.len == 4
                && n.starts_with("if_r_")
                && n.contains("_i_goto_i")
                && matches!((insn.raw >> 8) & 0xff, 0xf8 | 0xf9 | 0xfc | 0xfd | 0xfe) =>
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
            n if insn.entry.len == 6 && n.starts_with("if") && n.contains("_i_goto_i")
                && (insn.raw >> 8) & 0xff == 0xff && (insn.raw & 0xc0) == 0 =>
            {
                // 6-byte `if[s] (rN <op> #imm) goto #off` (`xx ff`, 1323 corpus
                // samples): byte0 bit0 = alt, bits(1,3) = family (as cmp_cond),
                // bit5 = immediate kind: 0 -> sext12(bits(16,27)),
                // 1 -> composed(bits(24,27), bits(16,23)); reg = bits(28,31);
                // off = 2*sext16(bits(32,47)).
                let raw = insn.raw;
                let b0 = raw & 0xff;
                let imm = if b0 & 0x20 != 0 {
                    composed_imm(((raw >> 24) & 0xf) as u32, ((raw >> 16) & 0xff) as u32)
                } else {
                    let v = ((raw >> 16) & 0xfff) as u32;
                    if v & 0x800 != 0 { v | !0xfff } else { v }
                };
                let r = self.regs[((raw >> 28) & 0xf) as usize];
                if cmp_cond((b0 >> 1) & 7, b0 & 1 != 0, r, imm) {
                    let off = 2 * ((raw >> 32) as u16 as i16 as i64);
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            n if n.starts_with("if") && n.contains("_r_goto_i")
                && decode_cmp_rr_branch(insn.raw, insn.entry.len).is_some() =>
            {
                let (fam, alt, a, b, off) = decode_cmp_rr_branch(insn.raw, insn.entry.len).unwrap();
                if cmp_cond(fam, alt, self.regs[a], self.regs[b]) {
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            n if n.starts_with("if") && !n.contains("goto") && insn.entry.len == 4
                && decode_if_block(insn.raw).is_some() =>
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
            _ if insn.entry.len == 2 && (insn.raw >> 8) & 0xff == 0x17 => {
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
            _ if insn.entry.len == 4 && insn.entry.syntax.contains("d[")
                && ((insn.raw & 0xfff0) == 0xec50 || (insn.raw & 0xffff) == 0xe9d0) =>
            {
                // 64-bit register-pair loads/stores `rH_rL = d[...]` /
                // `d[...] = rH_rL` (fitted on all 264 V13 corpus samples):
                //   pair = bits(29,31) -> (r2p+1, r2p); bit16 = store
                //   `5x ec`: base = bits(20,23),
                //            off = 4*(bits(18,19) | bits(24,28)<<2 | bit0<<6 | bit1<<7)
                //   `d0 e9`: sp-relative, off = bits(17,23)<<1 | bit24<<8
                // The low register sits at the lower address.
                let raw = insn.raw;
                let p = ((raw >> 29) & 7) as usize;
                let (hi, lo) = (2 * p + 1, 2 * p);
                let store = (raw >> 16) & 1 != 0;
                let addr = if (raw >> 8) & 0xff == 0xec {
                    let off = 4 * (((raw >> 18) & 3) | (((raw >> 24) & 0x1f) << 2) | ((raw & 1) << 6) | (((raw >> 1) & 1) << 7));
                    self.regs[((raw >> 20) & 0xf) as usize].wrapping_add(off as u32)
                } else {
                    let off = (((raw >> 17) & 0x7f) << 1) | (((raw >> 24) & 1) << 8);
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
            _ if insn.entry.len == 4 && (insn.raw & 0xf0) == 0xd0
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee)
                && insn.entry.syntax.contains("++=") =>
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
                    let inc = if raw & 1 != 0 { f as u8 as i8 as i32 } else { f as i32 };
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
            _ if insn.entry.len == 4 && insn.raw & 0xff == 0xd8
                && matches!((insn.raw >> 8) & 0xff, 0xec | 0xed | 0xee) =>
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
            "testset_b_r" | "testset_r" => {
                // `testset b[rN]` (bx 00): atomic test-and-set of a byte.
                // Assumed: cc = (old != 0) ("locked"), byte |= 0x80 — the
                // SDK spins with `testset; ifeq goto retry`, so "eq" must mean
                // "was already taken". Single-core emulation: always acquired.
                let addr = self.regs[(insn.raw & 0xf) as usize];
                let old = bus.read8(addr);
                self.cc = old != 0;
                bus.write8(addr, old | 0x80);
            }
            "ifeq_goto_i" | "ifne_goto_i" => {
                // `ifeq/ifne goto #off` (40/41 e8): off = 2*sext16(bits(16,31))
                let raw = insn.raw;
                let off = 2 * ((raw >> 16) as u16 as i16 as i64);
                let want = raw & 1 == 0;
                if self.cc == want {
                    jumped = Some((next_pc as i64 + off) as u32);
                }
            }
            "if_ret_eq_i_goto_i" | "if_ret_ne_i_goto_i" => {
                let v = self.slot(insn, 0)? as u32;
                let cond = if name.contains("ne") {
                    self.rets != v
                } else {
                    self.rets == v
                };
                if cond {
                    jumped = self.branch(insn, 1)?;
                }
            }

            // ---- stack frames -----------------------------------------
            "sp_mov_rets_r_1" | "sp_mov_rets_r_2" | "sp_mov_rets_r_3"
            | "sp_mov_rets_r_4" => {
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
            "pc_r_1_mov_sp" | "pc_r_2_mov_sp" | "pc_r_3_mov_sp"
            | "pc_r_4_mov_sp" | "pc_r_mov_sp" => {
                // {pc, rN..rB} = [sp++]: pop ascending = [min(n,4)..max(n,0)]
                // then pc last (highest slot = pushed rets).
                let n = (insn.raw & 0xf) as i32;
                let top = n.max(0);
                let bot = n.min(4);
                for r in bot..=top {
                    self.regs[r as usize] = bus.read32(self.sp);
                    self.sp = self.sp.wrapping_add(4);
                }
                jumped = Some(bus.read32(self.sp));
                self.sp = self.sp.wrapping_add(4);
            }

            // ---- misc -------------------------------------------------
            "rep_i_r" | "rep_i_i" => {
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

            other => match self.exec_syntax(bus, insn, next_pc) {
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
        }

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
        Ok(())
    }
}

pub use fm1_isa::composed_imm;

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
            let v = ((raw >> 16) & 0xfff) as u32;
            (Rhs::Imm(if v & 0x800 != 0 { v | !0xfff } else { v }), h & 8 != 0)
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
        0xe0 | 0xe1 if matches!(b0, 0xb4 | 0x90 | 0xf0 | 0xc8 | 0x94) => {
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
