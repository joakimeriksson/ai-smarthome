// Vendored from esp32sim (emu-core/src/jit_a64.rs, MIT, (c) 2026 Joakim Eriksson
// and Alice); its encodings are checked against clang there. Added here: ldrsb_u.
//! A tiny AArch64 encoder: only the instructions the block compiler emits. Every encoding is
//! checked against clang's assembler in `tests::encodings_match_clang`.
#![allow(dead_code)]

pub type Reg = u32;
pub const ZR: Reg = 31;
pub const SP: Reg = 31;

/// Condition codes (the `cond` field).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Cond { Eq = 0, Ne = 1, Hs = 2, Lo = 3, Mi = 4, Pl = 5, Vs = 6, Vc = 7, Hi = 8, Ls = 9, Ge = 10, Lt = 11, Gt = 12, Le = 13, Al = 14 }
impl Cond {
    pub fn invert(self) -> Cond {
        use Cond::*;
        match self { Eq => Ne, Ne => Eq, Hs => Lo, Lo => Hs, Mi => Pl, Pl => Mi, Vs => Vc, Vc => Vs, Hi => Ls, Ls => Hi, Ge => Lt, Lt => Ge, Gt => Le, Le => Gt, Al => Al }
    }
}

#[derive(Clone, Copy)]
pub struct Label(pub usize);

enum Fix { B26, B19, B14, Adr21 }

pub struct Asm {
    pub code: Vec<u32>,
    labels: Vec<Option<usize>>,
    fixups: Vec<(usize, usize, Fix)>,
}

#[allow(clippy::new_without_default, reason = "assembler construction reserves its expected code capacity")]
impl Asm {
    pub fn new() -> Self { Asm { code: Vec::with_capacity(256), labels: Vec::new(), fixups: Vec::new() } }
    #[allow(clippy::len_without_is_empty, reason = "the length is exposed as a code offset, not as a collection API")]
    pub fn len(&self) -> usize { self.code.len() }
    pub fn here(&self) -> usize { self.code.len() }
    fn e(&mut self, w: u32) { self.code.push(w); }

    pub fn label(&mut self) -> Label { self.labels.push(None); Label(self.labels.len() - 1) }
    pub fn bind(&mut self, l: Label) { self.labels[l.0] = Some(self.code.len()); }
    pub fn is_bound(&self, l: Label) -> bool { self.labels[l.0].is_some() }

    /// Resolve every branch to its label; every label must be bound.
    pub fn finish(mut self) -> Vec<u32> {
        for (at, l, kind) in std::mem::take(&mut self.fixups) {
            let target = self.labels[l].expect("unbound label");
            let off = target as i64 - at as i64;
            match kind {
                Fix::B26 => { assert!((-(1 << 25)..(1 << 25)).contains(&off)); self.code[at] |= (off as u32) & 0x03ff_ffff; }
                Fix::B19 => { assert!((-(1 << 18)..(1 << 18)).contains(&off)); self.code[at] |= ((off as u32) & 0x7ffff) << 5; }
                Fix::B14 => { assert!((-(1 << 13)..(1 << 13)).contains(&off)); self.code[at] |= ((off as u32) & 0x3fff) << 5; }
                Fix::Adr21 => { let b = off * 4; assert!((-(1 << 20)..(1 << 20)).contains(&b)); let b = b as u32; self.code[at] |= (b & 3) << 29 | ((b >> 2) & 0x7ffff) << 5; }
            }
        }
        self.code
    }

    // ---------------------------------------------------------------- moves and immediates
    pub fn movz(&mut self, rd: Reg, imm16: u32, shift: u32) { self.e(0x5280_0000 | (shift / 16) << 21 | (imm16 & 0xffff) << 5 | rd); }
    pub fn movk(&mut self, rd: Reg, imm16: u32, shift: u32) { self.e(0x7280_0000 | (shift / 16) << 21 | (imm16 & 0xffff) << 5 | rd); }
    pub fn movn(&mut self, rd: Reg, imm16: u32, shift: u32) { self.e(0x1280_0000 | (shift / 16) << 21 | (imm16 & 0xffff) << 5 | rd); }
    pub fn movz_x(&mut self, rd: Reg, imm16: u32, shift: u32) { self.e(0xd280_0000 | (shift / 16) << 21 | (imm16 & 0xffff) << 5 | rd); }
    pub fn movk_x(&mut self, rd: Reg, imm16: u32, shift: u32) { self.e(0xf280_0000 | (shift / 16) << 21 | (imm16 & 0xffff) << 5 | rd); }
    /// 32-bit immediate in one or two instructions.
    pub fn mov32(&mut self, rd: Reg, imm: u32) {
        if imm & 0xffff_0000 == 0 { self.movz(rd, imm, 0); }
        else if imm & 0xffff == 0 { self.movz(rd, imm >> 16, 16); }
        else if imm & 0xffff_0000 == 0xffff_0000 { self.movn(rd, !imm & 0xffff, 0); }
        else { self.movz(rd, imm & 0xffff, 0); self.movk(rd, imm >> 16, 16); }
    }
    /// 64-bit immediate (addresses).
    pub fn mov64(&mut self, rd: Reg, imm: u64) {
        self.movz_x(rd, (imm & 0xffff) as u32, 0);
        for sh in [16u32, 32, 48] { let part = ((imm >> sh) & 0xffff) as u32; if part != 0 { self.movk_x(rd, part, sh); } }
    }
    pub fn mov(&mut self, rd: Reg, rm: Reg) { self.e(0x2a00_03e0 | rm << 16 | rd); }
    pub fn mov_x(&mut self, rd: Reg, rm: Reg) { self.e(0xaa00_03e0 | rm << 16 | rd); }

    // ---------------------------------------------------------------- arithmetic
    pub fn add_imm(&mut self, rd: Reg, rn: Reg, imm: u32) { debug_assert!(imm < 4096); self.e(0x1100_0000 | imm << 10 | rn << 5 | rd); }
    pub fn sub_imm(&mut self, rd: Reg, rn: Reg, imm: u32) { debug_assert!(imm < 4096); self.e(0x5100_0000 | imm << 10 | rn << 5 | rd); }
    pub fn subs_imm(&mut self, rd: Reg, rn: Reg, imm: u32) { debug_assert!(imm < 4096); self.e(0x7100_0000 | imm << 10 | rn << 5 | rd); }
    pub fn add_imm_x(&mut self, rd: Reg, rn: Reg, imm: u32) { debug_assert!(imm < 4096); self.e(0x9100_0000 | imm << 10 | rn << 5 | rd); }
    pub fn cmp_imm(&mut self, rn: Reg, imm: u32) { self.subs_imm(ZR, rn, imm); }
    /// add/sub with a 32-bit immediate of any size (may use a scratch register).
    pub fn add_imm32(&mut self, rd: Reg, rn: Reg, imm: u32, scratch: Reg) {
        if imm < 4096 { self.add_imm(rd, rn, imm); }
        else if imm.wrapping_neg() < 4096 { self.sub_imm(rd, rn, imm.wrapping_neg()); }
        else { self.mov32(scratch, imm); self.add(rd, rn, scratch); }
    }
    pub fn add(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x0b00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn add_x(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x8b00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn add_lsl(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x0b00_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn add_lsr(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x0b40_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn add_x_lsl(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x8b00_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn eor_lsr(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x4a40_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn sub(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x4b00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn sub_lsl(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x4b00_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn subs(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x6b00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn cmp(&mut self, rn: Reg, rm: Reg) { self.subs(ZR, rn, rm); }
    pub fn neg(&mut self, rd: Reg, rm: Reg) { self.sub(rd, ZR, rm); }
    pub fn and(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x0a00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn orr(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x2a00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn orr_lsl(&mut self, rd: Reg, rn: Reg, rm: Reg, sh: u32) { self.e(0x2a00_0000 | rm << 16 | sh << 10 | rn << 5 | rd); }
    pub fn orr_x(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0xaa00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn eor(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x4a00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn bic(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x0a20_0000 | rm << 16 | rn << 5 | rd); }
    pub fn ands(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x6a00_0000 | rm << 16 | rn << 5 | rd); }
    pub fn tst(&mut self, rn: Reg, rm: Reg) { self.ands(ZR, rn, rm); }
    /// `and` with a contiguous mask `((1 << ones) - 1) << shift` (32-bit).
    pub fn and_mask(&mut self, rd: Reg, rn: Reg, ones: u32, shift: u32) {
        debug_assert!((1..=31).contains(&ones) && ones + shift <= 32);
        self.e(0x1200_0000 | ((32 - shift) & 31) << 16 | (ones - 1) << 10 | rn << 5 | rd);
    }
    pub fn tst_mask(&mut self, rn: Reg, ones: u32, shift: u32) {
        debug_assert!((1..=31).contains(&ones) && ones + shift <= 32);
        self.e(0x7200_0000 | ((32 - shift) & 31) << 16 | (ones - 1) << 10 | rn << 5 | ZR);
    }
    pub fn lsl_imm(&mut self, rd: Reg, rn: Reg, sh: u32) { let sh = sh & 31; self.e(0x5300_0000 | ((32 - sh) & 31) << 16 | (31 - sh) << 10 | rn << 5 | rd); }
    pub fn lsr_imm(&mut self, rd: Reg, rn: Reg, sh: u32) { let sh = sh & 31; self.e(0x5300_0000 | sh << 16 | 31 << 10 | rn << 5 | rd); }
    pub fn asr_imm(&mut self, rd: Reg, rn: Reg, sh: u32) { let sh = sh & 31; self.e(0x1300_0000 | sh << 16 | 31 << 10 | rn << 5 | rd); }
    pub fn lsr_imm_x(&mut self, rd: Reg, rn: Reg, sh: u32) { self.e(0xd340_0000 | sh << 16 | 63 << 10 | rn << 5 | rd); }
    pub fn asr_imm_x(&mut self, rd: Reg, rn: Reg, sh: u32) { self.e(0x9340_0000 | sh << 16 | 63 << 10 | rn << 5 | rd); }
    pub fn lsl_imm_x(&mut self, rd: Reg, rn: Reg, sh: u32) { self.e(0xd340_0000 | ((64 - sh) & 63) << 16 | (63 - sh) << 10 | rn << 5 | rd); }
    pub fn ubfx(&mut self, rd: Reg, rn: Reg, lsb: u32, width: u32) { self.e(0x5300_0000 | lsb << 16 | (lsb + width - 1) << 10 | rn << 5 | rd); }
    pub fn sbfx(&mut self, rd: Reg, rn: Reg, lsb: u32, width: u32) { self.e(0x1300_0000 | lsb << 16 | (lsb + width - 1) << 10 | rn << 5 | rd); }
    pub fn sxth(&mut self, rd: Reg, rn: Reg) { self.sbfx(rd, rn, 0, 16); }
    pub fn uxth(&mut self, rd: Reg, rn: Reg) { self.ubfx(rd, rn, 0, 16); }
    pub fn lslv(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x1ac0_2000 | rm << 16 | rn << 5 | rd); }
    pub fn lsrv(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x1ac0_2400 | rm << 16 | rn << 5 | rd); }
    pub fn asrv(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x1ac0_2800 | rm << 16 | rn << 5 | rd); }
    pub fn lsrv_x(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x9ac0_2400 | rm << 16 | rn << 5 | rd); }
    pub fn mul(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x1b00_7c00 | rm << 16 | rn << 5 | rd); }
    pub fn umull(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x9ba0_7c00 | rm << 16 | rn << 5 | rd); }
    pub fn smull(&mut self, rd: Reg, rn: Reg, rm: Reg) { self.e(0x9b20_7c00 | rm << 16 | rn << 5 | rd); }
    pub fn clz(&mut self, rd: Reg, rn: Reg) { self.e(0x5ac0_1000 | rn << 5 | rd); }
    pub fn csel(&mut self, rd: Reg, rn: Reg, rm: Reg, c: Cond) { self.e(0x1a80_0000 | rm << 16 | (c as u32) << 12 | rn << 5 | rd); }
    pub fn csinc(&mut self, rd: Reg, rn: Reg, rm: Reg, c: Cond) { self.e(0x1a80_0400 | rm << 16 | (c as u32) << 12 | rn << 5 | rd); }
    pub fn csneg(&mut self, rd: Reg, rn: Reg, rm: Reg, c: Cond) { self.e(0x5a80_0400 | rm << 16 | (c as u32) << 12 | rn << 5 | rd); }
    pub fn cset(&mut self, rd: Reg, c: Cond) { self.csinc(rd, ZR, ZR, c.invert()); }
    pub fn cneg(&mut self, rd: Reg, rn: Reg, c: Cond) { self.csneg(rd, rn, rn, c.invert()); }

    // ---------------------------------------------------------------- memory
    pub fn ldr(&mut self, rt: Reg, rn: Reg, off: u32) { debug_assert!(off.is_multiple_of(4) && off < 16384); self.e(0xb940_0000 | (off / 4) << 10 | rn << 5 | rt); }
    pub fn str(&mut self, rt: Reg, rn: Reg, off: u32) { debug_assert!(off.is_multiple_of(4) && off < 16384); self.e(0xb900_0000 | (off / 4) << 10 | rn << 5 | rt); }
    pub fn ldrh(&mut self, rt: Reg, rn: Reg, off: u32) { debug_assert!(off.is_multiple_of(2) && off < 8192); self.e(0x7940_0000 | (off / 2) << 10 | rn << 5 | rt); }
    pub fn ldr_x(&mut self, rt: Reg, rn: Reg, off: u32) { debug_assert!(off.is_multiple_of(8) && off < 32768); self.e(0xf940_0000 | (off / 8) << 10 | rn << 5 | rt); }
    pub fn str_x(&mut self, rt: Reg, rn: Reg, off: u32) { debug_assert!(off.is_multiple_of(8) && off < 32768); self.e(0xf900_0000 | (off / 8) << 10 | rn << 5 | rt); }
    /// `ldr wt, [xn, wm, uxtw #2]`
    pub fn ldr_idx(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0xb860_0800 | wm << 16 | 0b010 << 13 | 1 << 12 | rn << 5 | rt); }
    /// `str wt, [xn, wm, uxtw #2]`
    pub fn str_idx(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0xb820_0800 | wm << 16 | 0b010 << 13 | 1 << 12 | rn << 5 | rt); }
    /// Byte-offset register forms `[xn, wm, uxtw]` (no scaling): loads zero-extend, `ldrsh`/`ldrsb` sign-extend to 32 bits.
    pub fn ldr_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0xb860_4800 | wm << 16 | rn << 5 | rt); }
    pub fn ldrh_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x7860_4800 | wm << 16 | rn << 5 | rt); }
    pub fn ldrb_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x3860_4800 | wm << 16 | rn << 5 | rt); }
    /// LDRSB Wt, [Xn, Wm, UXTW] (signed byte, 32-bit result)
    pub fn ldrsb_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x38e0_4800 | wm << 16 | rn << 5 | rt); }
    pub fn ldrsh_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x78e0_4800 | wm << 16 | rn << 5 | rt); }
    pub fn str_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0xb820_4800 | wm << 16 | rn << 5 | rt); }
    pub fn strh_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x7820_4800 | wm << 16 | rn << 5 | rt); }
    pub fn strb_u(&mut self, rt: Reg, rn: Reg, wm: Reg) { self.e(0x3820_4800 | wm << 16 | rn << 5 | rt); }
    /// `stp xt1, xt2, [sp, #-imm]!`
    pub fn stp_pre(&mut self, rt1: Reg, rt2: Reg, rn: Reg, off: i32) { self.e(0xa980_0000 | (((off / 8) as u32) & 0x7f) << 15 | rt2 << 10 | rn << 5 | rt1); }
    pub fn stp(&mut self, rt1: Reg, rt2: Reg, rn: Reg, off: i32) { self.e(0xa900_0000 | (((off / 8) as u32) & 0x7f) << 15 | rt2 << 10 | rn << 5 | rt1); }
    pub fn ldp(&mut self, rt1: Reg, rt2: Reg, rn: Reg, off: i32) { self.e(0xa940_0000 | (((off / 8) as u32) & 0x7f) << 15 | rt2 << 10 | rn << 5 | rt1); }
    /// `ldp xt1, xt2, [sp], #imm`
    pub fn ldp_post(&mut self, rt1: Reg, rt2: Reg, rn: Reg, off: i32) { self.e(0xa8c0_0000 | (((off / 8) as u32) & 0x7f) << 15 | rt2 << 10 | rn << 5 | rt1); }

    // ---------------------------------------------------------------- control
    pub fn b(&mut self, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::B26)); self.e(0x1400_0000); }
    pub fn b_cond(&mut self, c: Cond, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::B19)); self.e(0x5400_0000 | c as u32); }
    pub fn cbz(&mut self, rt: Reg, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::B19)); self.e(0x3400_0000 | rt); }
    pub fn cbnz(&mut self, rt: Reg, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::B19)); self.e(0x3500_0000 | rt); }
    pub fn cbnz_x(&mut self, rt: Reg, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::B19)); self.e(0xb500_0000 | rt); }
    /// `tbz xt, #bit, label` (bit may be up to 63 — the test is on the 64-bit register)
    pub fn tbz(&mut self, rt: Reg, bit: u32, l: Label) { let at = self.code.len(); self.e(0x3600_0000 | (bit >> 5) << 31 | (bit & 31) << 19 | rt); self.tb_fix(at, l); }
    pub fn tbnz(&mut self, rt: Reg, bit: u32, l: Label) { let at = self.code.len(); self.e(0x3700_0000 | (bit >> 5) << 31 | (bit & 31) << 19 | rt); self.tb_fix(at, l); }
    fn tb_fix(&mut self, at: usize, l: Label) { self.fixups.push((at, l.0, Fix::B14)); }
    pub fn blr(&mut self, rn: Reg) { self.e(0xd63f_0000 | rn << 5); }
    pub fn br(&mut self, rn: Reg) { self.e(0xd61f_0000 | rn << 5); }
    pub fn ret(&mut self) { self.e(0xd65f_03c0); }
    /// `adr xd, label`
    pub fn adr(&mut self, rd: Reg, l: Label) { self.fixups.push((self.code.len(), l.0, Fix::Adr21)); self.e(0x1000_0000 | rd); }
}
