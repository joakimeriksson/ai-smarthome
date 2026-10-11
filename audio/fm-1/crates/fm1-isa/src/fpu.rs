//! The single-precision FPU of the AC791N (`-mcpu=r3`), which JieLi's objdump cannot print.
//! Encodings from the vendor assembler (work/probe/fpu_ops.S, fcmp_*.S, 2026-10-10); the FPU
//! works on the ordinary registers.
//!
//!   `3f e5 b2 b3`  binary  R = R op R: op = b2 & 15 (0 +, 1 -, 2 *, 3 /, 5 fmin, 6 fmax),
//!                  a = b2 >> 4, d = b3 >> 4, b = b3 & 15
//!                  unary   R = fn(R): b2 = 1f ftoi (trunc), 5f ftou (trunc), 8f itof, 9f utof;
//!                  d = b3 >> 4, s = b3 & 15
//!   `3f f5 b2 b3`  the same ops as the head of a dual-issue pair (bit 12, as e0/e1 -> f0/f1)
//!   compares       the integer `if (R op R) goto` (4-byte: bit 27; 6-byte `4x ff`: bit 23) and
//!                  `if (R op R) {` (bit 23) forms with a float flag; families e8 ==, e9 u>=,
//!                  ec u>, ed >=, ee > (6-byte: fam = bits(1,3)), bit7 (6-byte: bit0) negates.
use super::IsaEntry;

macro_rules! e {
    ($name:expr, $syn:expr, $mask:expr, $match_:expr) => {
        e!($name, $syn, $mask, $match_, 4)
    };
    ($name:expr, $syn:expr, $mask:expr, $match_:expr, $len:expr) => {
        IsaEntry {
            name: $name,
            syntax: $syn,
            len: $len,
            count: 0,
            mask: $mask,
            match_: $match_,
            group: "fpu",
            alt: &[],
            samples: &[],
            slots: &[],
        }
    };
}

pub static FPU: &[IsaEntry] = &[
    e!("fpu_add", "R = R + R (f)", 0x000f_ffff, 0x0000_e53f),
    e!("fpu_sub", "R = R - R (f)", 0x000f_ffff, 0x0001_e53f),
    e!("fpu_mul", "R = R * R (f)", 0x000f_ffff, 0x0002_e53f),
    e!("fpu_div", "R = R / R (f)", 0x000f_ffff, 0x0003_e53f),
    e!("fpu_min", "R = fmin(R, R)", 0x000f_ffff, 0x0005_e53f),
    e!("fpu_max", "R = fmax(R, R)", 0x000f_ffff, 0x0006_e53f),
    e!("fpu_ftoi", "R = ftoi(R) (trunc)", 0x00ff_ffff, 0x001f_e53f),
    e!("fpu_ftou", "R = ftou(R) (trunc)", 0x00ff_ffff, 0x005f_e53f),
    e!("fpu_itof", "R = itof(R)", 0x00ff_ffff, 0x008f_e53f),
    e!("fpu_utof", "R = utof(R)", 0x00ff_ffff, 0x009f_e53f),
    e!("iff_r_eq_r_goto_i", "iff (R == R) goto #i", 0x0800_ff70, 0x0800_e800),
    e!("iff_r_uge_r_goto_i", "iff (R u>= R) goto #i", 0x0800_ff70, 0x0800_e900),
    e!("iff_r_ugt_r_goto_i", "iff (R u> R) goto #i", 0x0800_ff70, 0x0800_ec00),
    e!("iff_r_ge_r_goto_i", "iff (R >= R) goto #i", 0x0800_ff70, 0x0800_ed00),
    e!("iff_r_gt_r_goto_i", "iff (R > R) goto #i", 0x0800_ff70, 0x0800_ee00),
    e!("iff_r_eq_r_blk", "iff (R == R) {", 0x0080_ff70, 0x0080_e810),
    e!("iff_r_uge_r_blk", "iff (R u>= R) {", 0x0080_ff70, 0x0080_e910),
    e!("iff_r_ugt_r_blk", "iff (R u> R) {", 0x0080_ff70, 0x0080_ec10),
    e!("iff_r_ge_r_blk", "iff (R >= R) {", 0x0080_ff70, 0x0080_ed10),
    e!("iff_r_gt_r_blk", "iff (R > R) {", 0x0080_ff70, 0x0080_ee10),
    e!("fpu_add_p", "R = R + R (f) #", 0x000f_ffff, 0x0000_f53f),
    e!("fpu_sub_p", "R = R - R (f) #", 0x000f_ffff, 0x0001_f53f),
    e!("fpu_mul_p", "R = R * R (f) #", 0x000f_ffff, 0x0002_f53f),
    e!("fpu_div_p", "R = R / R (f) #", 0x000f_ffff, 0x0003_f53f),
    e!("fpu_min_p", "R = fmin(R, R) #", 0x000f_ffff, 0x0005_f53f),
    e!("fpu_max_p", "R = fmax(R, R) #", 0x000f_ffff, 0x0006_f53f),
    e!("fpu_ftoi_p", "R = ftoi(R) (trunc) #", 0x00ff_ffff, 0x001f_f53f),
    e!("fpu_ftou_p", "R = ftou(R) (trunc) #", 0x00ff_ffff, 0x005f_f53f),
    e!("fpu_itof_p", "R = itof(R) #", 0x00ff_ffff, 0x008f_f53f),
    e!("fpu_utof_p", "R = utof(R) #", 0x00ff_ffff, 0x009f_f53f),
    e!("iff_r_eq_r_goto_i_l6", "iff (R == R) goto #i", 0x0080_fffe, 0x0080_ff40, 6),
    e!("iff_r_uge_r_goto_i_l6", "iff (R u>= R) goto #i", 0x0080_fffe, 0x0080_ff42, 6),
    e!("iff_r_ugt_r_goto_i_l6", "iff (R u> R) goto #i", 0x0080_fffe, 0x0080_ff48, 6),
    e!("iff_r_ge_r_goto_i_l6", "iff (R >= R) goto #i", 0x0080_fffe, 0x0080_ff4a, 6),
    e!("iff_r_gt_r_goto_i_l6", "iff (R > R) goto #i", 0x0080_fffe, 0x0080_ff4c, 6),
];

/// Decoded only when no mined class matches: families whose layout is known in full but whose
/// corpus samples do not cover every bit pattern. `5x ec` is the 64-bit register-pair access in
/// all its modes (fm1-core `decode_pair_mem`); the mined classes have few `58..5f` samples, and
/// Melodee 1.0.1 / ChoralRoot 0.15 use `d[r3+r4] = r1_r0` and `d[r1++=8] = r9_r8` beyond them.
pub static FALLBACK: &[IsaEntry] = &[
    e!("pair_mem_any", "d[R] (pair) = R", 0x0000_fff0, 0x0000_ec50),
];
