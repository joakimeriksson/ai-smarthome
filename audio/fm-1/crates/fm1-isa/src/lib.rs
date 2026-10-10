//! FM-1 instruction set: decoder and disassembler tables generated from
//! `isa/fm1.yaml` (see `generated_isa.rs`, `docs/isa-notes.md`).
//!
//! Bit numbering: the instruction's bytes b0..bn form a little-endian
//! integer (b0 = bits 0..7, ...). Decode reads up to 6 bytes of window,
//! then walks entries in priority order (longest, mask popcount, corpus
//! count); an entry whose recorded corpus samples contain the observed
//! bytes wins ties against sibling masks.

mod generated_isa;
pub use generated_isa::ISA;

/// One instruction class in the mask/decode table (mirrors a YAML entry).
#[derive(Debug, PartialEq, Eq)]
pub struct IsaEntry {
    pub name: &'static str,
    /// Primary normalized syntax, e.g. `[--sp] = {rets, R*2}`.
    pub syntax: &'static str,
    /// Instruction length in bytes.
    pub len: u8,
    /// Corpus occurrences (all five objdump corpora) — a weight for coverage reports.
    pub count: u32,
    /// Constant bits mask over the little-endian word value.
    pub mask: u64,
    /// Required value under `mask`.
    pub match_: u64,
    /// Coarse class: alu / imm / load / store / stack / branch / control /
    /// system / rep / alu_imm / misc.
    pub group: &'static str,
    /// Aliased normalized spellings of the same encoding family.
    pub alt: &'static [&'static str],
    /// Observed byte-strings (little-endian u64s) from the ISA corpora;
    /// used only as a decode tiebreak between sibling masks.
    pub samples: &'static [u64],
    /// Solver-verified operand slots (empty until solve_hot.py solved them
    /// corpus-wide; regeneration requires none missing).
    pub slots: &'static [SlotSpec],
}

/// Operand-slot kinds resolved by tools/solve_slots.py against all corpora.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotKind {
    /// Plain little-endian concat of pieces == printed value.
    Imm,
    /// printed == mult * sext(concat) (branches: byte offset from pc_next).
    Rel,
    /// printed == concat - adj (adj stored positive, e.g. N-1 encoded).
    Adj,
    /// Register block: regs = max(n,hi)..min(n,lo) descending.
    Blk,
    /// printed == mult * concat - adj (unsigned scaled offsets; `rep` N = 2*(f+1)).
    Scaled,
    /// printed is a constant (`adj` holds it); no bits consumed.
    Const,
    /// Shift counts: a zero field means 32.
    Zero32,
    /// printed == 1 << concat (bit set/test masks).
    Bit,
    /// printed == !(1 << concat) as u32 (bit clear masks).
    NBit,
    /// The 12-bit composed immediate at bits 16-27 (see [`composed_imm`]).
    Composed,
    /// Inverted composed immediate (`&= ~x` forms print the inverted value).
    NComposed,
}

/// The 12-bit "composed" immediate used by `R = #h`, the 4-byte
/// register-immediate ALU forms and `[R+#i] op= #h`: a 4-bit `code` and an
/// 8-bit `m`. Fitted on every 4-byte ALU/mov-immediate in the V13 corpus
/// (6878 + 129 samples, 0 mismatches, 2026-10-09):
///   code 0        literal m
///   code 1        m replicated per halfword      (0x5f -> 0x005f005f)
///   code 2        m<<8 replicated per halfword   (0x64 -> 0x64006400)
///   code 3        m replicated per byte          (0xcc -> 0xcccccccc)
///   code 4..15    float-like: exponent E = code<<1 | m>>7 (8..31),
///                 mantissa 0x80 | (m & 0x7f), value = mantissa << (32 - E)
///                 (0x4,0x7f -> 0xff000000; 0xf,0xff -> 0x1fe)
pub fn composed_imm(code: u32, m: u32) -> u32 {
    match code {
        0 => m,
        1 => m.wrapping_mul(0x0001_0001),
        2 => (m << 8).wrapping_mul(0x0001_0001),
        3 => m.wrapping_mul(0x0101_0101),
        _ => {
            let e = (code << 1) | (m >> 7);
            (0x80 | (m & 0x7f)) << (32 - e)
        }
    }
}

/// One operand slot's encoding.
#[derive(Debug, PartialEq, Eq)]
pub struct SlotSpec {
    pub kind: SlotKind,
    /// Contiguous bit-ranges (lsb, msb), concatenated low-piece-first.
    pub pieces: &'static [(u8, u8)],
    pub mult: i32,
    pub adj: i32,
    pub hi: u8,
    pub lo: u8,
}

impl SlotSpec {
    /// Little-endian bit-concat of the pieces from `raw`.
    pub fn concat(&self, raw: u64) -> u32 {
        let mut r = 0u32;
        let mut bits = 0u8;
        for &(lsb, msb) in self.pieces {
            let w = msb - lsb + 1;
            r |= (((raw >> lsb) & ((1u64 << w) - 1)) as u32) << bits;
            bits += w;
        }
        r
    }

    pub fn bits(&self) -> u8 {
        self.pieces.iter().map(|p| p.1 - p.0 + 1).sum()
    }

    /// The slot's numeric value (registers: reg number; blocks: field n).
    pub fn value(&self, raw: u64) -> i64 {
        let c = self.concat(raw);
        match self.kind {
            SlotKind::Imm | SlotKind::Blk => c as i64,
            SlotKind::Adj => c as i64 - self.adj as i64,
            SlotKind::Scaled => self.mult as i64 * c as i64 - self.adj as i64,
            SlotKind::Const => self.adj as i64,
            SlotKind::Zero32 => if c == 0 { 32 } else { c as i64 },
            SlotKind::Bit => 1i64 << (c & 31),
            SlotKind::Composed => composed_imm((raw >> 24) as u32 & 0xf, (raw >> 16) as u32 & 0xff) as i64,
            SlotKind::NComposed => (!composed_imm((raw >> 24) as u32 & 0xf, (raw >> 16) as u32 & 0xff)) as i64,
            SlotKind::NBit => (!(1u32 << (c & 31))) as i64,
            SlotKind::Rel => {
                let w = self.bits();
                let m = 1u32.checked_shl((w.min(31)) as u32).unwrap_or(0).wrapping_sub(1);
                let s = sext(c & m, w);
                self.mult as i64 * s
            }
        }
    }

    /// Register-block register list: [max(n,hi) .. min(n,lo)] descending.
    pub fn block_regs(&self, raw: u64) -> Vec<u8> {
        let n = self.concat(raw);
        let top = n.max(self.hi as u32) as u8;
        let bottom = n.min(self.lo as u32) as u8;
        if top < bottom {
            return Vec::new();
        }
        (bottom..=top).rev().collect()
    }
}

fn sext(v: u32, bits: u8) -> i64 {
    let v = v & ((1u32 << bits) - 1);
    if bits < 32 && v & (1 << (bits - 1)) != 0 {
        (v as i64) - (1i64 << bits)
    } else {
        v as i64
    }
}

/// A successfully decoded instruction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instruction {
    pub addr: u32,
    /// Raw instruction bytes as a little-endian integer (zero-extended).
    pub raw: u64,
    /// Class resolved from the table.
    pub entry: &'static IsaEntry,
}

impl Instruction {
    /// Number of bytes this instruction occupies.
    pub fn len(&self) -> u8 {
        self.entry.len
    }

    /// Whether the instruction takes zero bytes (never true; present for
    /// clippy's len/is_empty convention).
    pub fn is_empty(&self) -> bool {
        self.entry.len == 0
    }

    /// Primary syntax (normalized form).
    pub fn syntax(&self) -> &'static str {
        self.entry.syntax
    }

    /// True if `form` equals the primary or any aliased spelling.
    pub fn has_syntax(&self, form: &str) -> bool {
        self.entry.syntax == form || self.entry.alt.contains(&form)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    /// No table entry matched the window.
    UnknownInstruction { raw: u64, addr: u32 },
}

/// Decode from a zero-extended little-endian window of up to 6 bytes.
pub fn decode_win(win: u64, addr: u32) -> Result<Instruction, DecodeError> {
    let mut best: Option<&'static IsaEntry> = None;
    for e in generated_isa::ISA {
        if (win & e.mask) == e.match_ {
            // Sample tiebreak compares only the entries own length bytes
            // (samples are stored as len-byte little-endian integers, the
            // window is always a 6-byte fetch).
            let len_mask = (1u64 << (e.len as u32 * 8)) - 1;
            let obs = win & len_mask;
            if e.samples.contains(&obs) {
                best = Some(e);
                break;
            }
            if best.is_none() {
                best = Some(e);
            }
        }
    }
    match best {
        Some(e) => Ok(Instruction {
            addr,
            raw: win,
            entry: e,
        }),
        None => Err(DecodeError::UnknownInstruction { raw: win, addr }),
    }
}

thread_local! {
    static DECODE_CACHE: std::cell::RefCell<std::collections::HashMap<u64, Option<&'static IsaEntry>>> =
        std::cell::RefCell::new(std::collections::HashMap::new());
}

/// `decode_win` memoised on the 6-byte window: the class only depends on the
/// bytes, and the scan over every class is the emulator's hot spot.
pub fn decode_win_cached(win: u64, addr: u32) -> Result<Instruction, DecodeError> {
    let hit = DECODE_CACHE.with(|c| c.borrow().get(&win).copied());
    let entry = match hit {
        Some(e) => e,
        None => {
            let e = decode_win(win, addr).ok().map(|i| i.entry);
            DECODE_CACHE.with(|c| c.borrow_mut().insert(win, e));
            e
        }
    };
    match entry {
        Some(entry) => Ok(Instruction { addr, raw: win, entry }),
        None => Err(DecodeError::UnknownInstruction { raw: win, addr }),
    }
}

/// Decode from raw instruction bytes (up to 6).
pub fn decode_bytes(bytes: &[u8], addr: u32) -> Result<Instruction, DecodeError> {
    let mut win = 0u64;
    for (i, b) in bytes.iter().take(6).enumerate() {
        win |= (*b as u64) << (8 * i);
    }
    decode_win(win, addr)
}

/// How many classes the table holds (for tests / traps).
pub fn entry_count() -> usize {
    generated_isa::ISA.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn le(hex: &str) -> Result<Instruction, DecodeError> {
        decode_bytes(&hex::bytes(hex), 0)
    }

    // tiny local hex helper so tests need no external crate
    mod hex {
        pub fn bytes(hex: &str) -> Vec<u8> {
            (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect()
        }
    }

    #[test]
    fn table_has_everything() {
        // 1067 classes as of the five-corpus build
        assert!(entry_count() > 1000);
    }

    #[test]
    fn nop_is_0000() {
        let i = le("0000").unwrap();
        assert_eq!(i.syntax(), "nop");
        assert_eq!(i.len(), 2);
    }

    #[test]
    fn register_block_pushes_decode_with_sample_priority() {
        // `74 04` = {rets, r4}; `75 04` = {rets, r5, r4} — sibling masks.
        assert_eq!(le("7404").unwrap().syntax(), "[--sp] = {rets, R*1}");
        assert_eq!(le("7504").unwrap().syntax(), "[--sp] = {rets, R*2}");
    }

    #[test]
    fn alias_spellings_are_matched() {
        // merged family: primary keeps the most common spelling
        let i = le("0000").unwrap();
        assert!(i.has_syntax("nop"));
        assert!(!i.has_syntax("totally not nop"));
    }

    #[test]
    fn unknown_bytes_are_rejected() {
        assert!(matches!(
            decode_win(0xffff_ffff_ffff, 0),
            Err(DecodeError::UnknownInstruction { .. })
        ));
    }

    #[test]
    fn six_byte_loads_decode() {
        // from corpus: `if (R == #i) goto #i` is a 6-byte form
        let i = le("05ffd941f200"); // 43fa8: if (r4 ?? 473) goto 484
        assert_eq!(i.unwrap().len(), 6);
    }
}
