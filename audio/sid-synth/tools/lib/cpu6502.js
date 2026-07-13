// cpu6502.js - self-contained MOS 6502 CPU core (documented opcodes).
//
// Written for tools/sid-dump.js. The jsSID library's MOS6510 core was
// considered for reuse but has correctness issues (V flag in ADC/SBC is
// approximated as C^N, no decimal mode, BRK references an undeclared
// variable, undocumented opcodes don't consume operand bytes), so this
// clean implementation is used instead.
//
// - All documented opcodes with correct N/V/Z/C flag semantics
//   (including binary-mode overflow and NMOS decimal-mode ADC/SBC).
// - JMP ($xxFF) page-wrap bug reproduced.
// - Undocumented opcodes are executed as NOPs that consume the correct
//   number of operand bytes for their addressing mode, with a one-time
//   warning per opcode via the `warn` callback. JAM opcodes are treated
//   as 1-byte NOPs (also warned).
// - RTI is treated like RTS+status-less return is NOT correct in general;
//   here RTI behaves like RTS (pop addr, +1) so that play routines that
//   end in RTI still return through the fake JSR frame pushed by the
//   caller. PSID play routines are called as subroutines, not real IRQs.
// - No cycle counting; the caller enforces an instruction budget.

const FLAG_C = 0x01;
const FLAG_Z = 0x02;
const FLAG_I = 0x04;
const FLAG_D = 0x08;
const FLAG_B = 0x10;
const FLAG_U = 0x20;
const FLAG_V = 0x40;
const FLAG_N = 0x80;

// ---------------------------------------------------------------------------
// Opcode table: 256 entries of [name, mode]. Undocumented opcodes get their
// canonical NMOS addressing mode (so operand bytes are skipped) and name
// 'undoc'; JAM opcodes get name 'jam'.
// ---------------------------------------------------------------------------
const OPS = new Array(256);
function def(opc, name, mode) { OPS[opc] = [name, mode]; }

// Documented instruction set
def(0x69, 'adc', 'imm'); def(0x65, 'adc', 'zp');  def(0x75, 'adc', 'zpx');
def(0x6D, 'adc', 'abs'); def(0x7D, 'adc', 'abx'); def(0x79, 'adc', 'aby');
def(0x61, 'adc', 'izx'); def(0x71, 'adc', 'izy');
def(0x29, 'and', 'imm'); def(0x25, 'and', 'zp');  def(0x35, 'and', 'zpx');
def(0x2D, 'and', 'abs'); def(0x3D, 'and', 'abx'); def(0x39, 'and', 'aby');
def(0x21, 'and', 'izx'); def(0x31, 'and', 'izy');
def(0x0A, 'asl', 'acc'); def(0x06, 'asl', 'zp');  def(0x16, 'asl', 'zpx');
def(0x0E, 'asl', 'abs'); def(0x1E, 'asl', 'abx');
def(0x90, 'bcc', 'rel'); def(0xB0, 'bcs', 'rel'); def(0xF0, 'beq', 'rel');
def(0x30, 'bmi', 'rel'); def(0xD0, 'bne', 'rel'); def(0x10, 'bpl', 'rel');
def(0x50, 'bvc', 'rel'); def(0x70, 'bvs', 'rel');
def(0x24, 'bit', 'zp');  def(0x2C, 'bit', 'abs');
def(0x00, 'brk', 'imp');
def(0x18, 'clc', 'imp'); def(0xD8, 'cld', 'imp'); def(0x58, 'cli', 'imp');
def(0xB8, 'clv', 'imp');
def(0xC9, 'cmp', 'imm'); def(0xC5, 'cmp', 'zp');  def(0xD5, 'cmp', 'zpx');
def(0xCD, 'cmp', 'abs'); def(0xDD, 'cmp', 'abx'); def(0xD9, 'cmp', 'aby');
def(0xC1, 'cmp', 'izx'); def(0xD1, 'cmp', 'izy');
def(0xE0, 'cpx', 'imm'); def(0xE4, 'cpx', 'zp');  def(0xEC, 'cpx', 'abs');
def(0xC0, 'cpy', 'imm'); def(0xC4, 'cpy', 'zp');  def(0xCC, 'cpy', 'abs');
def(0xC6, 'dec', 'zp');  def(0xD6, 'dec', 'zpx'); def(0xCE, 'dec', 'abs');
def(0xDE, 'dec', 'abx');
def(0xCA, 'dex', 'imp'); def(0x88, 'dey', 'imp');
def(0x49, 'eor', 'imm'); def(0x45, 'eor', 'zp');  def(0x55, 'eor', 'zpx');
def(0x4D, 'eor', 'abs'); def(0x5D, 'eor', 'abx'); def(0x59, 'eor', 'aby');
def(0x41, 'eor', 'izx'); def(0x51, 'eor', 'izy');
def(0xE6, 'inc', 'zp');  def(0xF6, 'inc', 'zpx'); def(0xEE, 'inc', 'abs');
def(0xFE, 'inc', 'abx');
def(0xE8, 'inx', 'imp'); def(0xC8, 'iny', 'imp');
def(0x4C, 'jmp', 'abs'); def(0x6C, 'jmp', 'ind');
def(0x20, 'jsr', 'abs');
def(0xA9, 'lda', 'imm'); def(0xA5, 'lda', 'zp');  def(0xB5, 'lda', 'zpx');
def(0xAD, 'lda', 'abs'); def(0xBD, 'lda', 'abx'); def(0xB9, 'lda', 'aby');
def(0xA1, 'lda', 'izx'); def(0xB1, 'lda', 'izy');
def(0xA2, 'ldx', 'imm'); def(0xA6, 'ldx', 'zp');  def(0xB6, 'ldx', 'zpy');
def(0xAE, 'ldx', 'abs'); def(0xBE, 'ldx', 'aby');
def(0xA0, 'ldy', 'imm'); def(0xA4, 'ldy', 'zp');  def(0xB4, 'ldy', 'zpx');
def(0xAC, 'ldy', 'abs'); def(0xBC, 'ldy', 'abx');
def(0x4A, 'lsr', 'acc'); def(0x46, 'lsr', 'zp');  def(0x56, 'lsr', 'zpx');
def(0x4E, 'lsr', 'abs'); def(0x5E, 'lsr', 'abx');
def(0xEA, 'nop', 'imp');
def(0x09, 'ora', 'imm'); def(0x05, 'ora', 'zp');  def(0x15, 'ora', 'zpx');
def(0x0D, 'ora', 'abs'); def(0x1D, 'ora', 'abx'); def(0x19, 'ora', 'aby');
def(0x01, 'ora', 'izx'); def(0x11, 'ora', 'izy');
def(0x48, 'pha', 'imp'); def(0x08, 'php', 'imp');
def(0x68, 'pla', 'imp'); def(0x28, 'plp', 'imp');
def(0x2A, 'rol', 'acc'); def(0x26, 'rol', 'zp');  def(0x36, 'rol', 'zpx');
def(0x2E, 'rol', 'abs'); def(0x3E, 'rol', 'abx');
def(0x6A, 'ror', 'acc'); def(0x66, 'ror', 'zp');  def(0x76, 'ror', 'zpx');
def(0x6E, 'ror', 'abs'); def(0x7E, 'ror', 'abx');
def(0x40, 'rti', 'imp'); def(0x60, 'rts', 'imp');
def(0xE9, 'sbc', 'imm'); def(0xE5, 'sbc', 'zp');  def(0xF5, 'sbc', 'zpx');
def(0xED, 'sbc', 'abs'); def(0xFD, 'sbc', 'abx'); def(0xF9, 'sbc', 'aby');
def(0xE1, 'sbc', 'izx'); def(0xF1, 'sbc', 'izy');
def(0x38, 'sec', 'imp'); def(0xF8, 'sed', 'imp'); def(0x78, 'sei', 'imp');
def(0x85, 'sta', 'zp');  def(0x95, 'sta', 'zpx'); def(0x8D, 'sta', 'abs');
def(0x9D, 'sta', 'abx'); def(0x99, 'sta', 'aby'); def(0x81, 'sta', 'izx');
def(0x91, 'sta', 'izy');
def(0x86, 'stx', 'zp');  def(0x96, 'stx', 'zpy'); def(0x8E, 'stx', 'abs');
def(0x84, 'sty', 'zp');  def(0x94, 'sty', 'zpx'); def(0x8C, 'sty', 'abs');
def(0xAA, 'tax', 'imp'); def(0xA8, 'tay', 'imp'); def(0xBA, 'tsx', 'imp');
def(0x8A, 'txa', 'imp'); def(0x9A, 'txs', 'imp'); def(0x98, 'tya', 'imp');

// Fill the rest: undocumented opcodes as mode-correct NOPs, JAMs as 1-byte.
function undocMode(opc) {
  const lo = opc & 0x0F;
  const oddRow = (opc & 0x10) !== 0;
  switch (lo) {
    case 0x2: return null; // JAM (0xA2 is documented LDX, already defined)
    case 0x3: return oddRow ? 'izy' : 'izx';         // SLO/RLA/SRE/RRA/SAX/LAX/DCP/ISB
    case 0x4: return oddRow ? 'zpx' : 'zp';          // NOP zp / NOP zp,x
    case 0x7: {
      if (opc === 0x97 || opc === 0xB7) return 'zpy'; // SAX/LAX zp,y
      return oddRow ? 'zpx' : 'zp';
    }
    case 0xA: return 'imp';                          // NOP (1A/3A/5A/7A/DA/FA)
    case 0xB: return oddRow ? 'aby' : 'imm';         // ANC/ALR/ARR/SBX/etc.
    case 0xC: return oddRow ? 'abx' : 'abs';         // NOP abs / NOP abs,x (9C=SHY abs,x)
    case 0xF: {
      if (opc === 0x9F || opc === 0xBF) return 'aby'; // SHA/LAX abs,y
      return oddRow ? 'abx' : 'abs';
    }
    case 0x0: return 'imm';                          // 0x80 NOP #imm
    case 0x9: return 'imm';                          // 0x89 NOP #imm
    case 0xE: return 'aby';                          // 0x9E SHX abs,y
    default:  return 'imp';
  }
}
for (let opc = 0; opc < 256; opc++) {
  if (OPS[opc]) continue;
  const mode = undocMode(opc);
  OPS[opc] = mode === null ? ['jam', 'imp'] : ['undoc', mode];
}

// ---------------------------------------------------------------------------
export class Cpu6502 {
  /**
   * @param {object} opts
   * @param {(addr:number)=>number} opts.read   memory read hook
   * @param {(addr:number,val:number)=>void} opts.write  memory write hook
   * @param {(msg:string)=>void} [opts.warn]    diagnostic sink (stderr)
   */
  constructor({ read, write, warn } = {}) {
    this.readMem = read;
    this.writeMem = write;
    this.warn = warn || (() => {});
    this.a = 0; this.x = 0; this.y = 0;
    this.s = 0xFD;
    this.p = FLAG_U | FLAG_I;
    this.pc = 0;
    this.halted = false;       // set by BRK (treated as routine abort)
    this._warnedOpcodes = new Set();
  }

  fetch() {
    const v = this.readMem(this.pc) & 0xFF;
    this.pc = (this.pc + 1) & 0xFFFF;
    return v;
  }

  fetch16() {
    const lo = this.fetch();
    return lo | (this.fetch() << 8);
  }

  push(v) {
    this.writeMem(0x100 | this.s, v & 0xFF);
    this.s = (this.s - 1) & 0xFF;
  }

  pop() {
    this.s = (this.s + 1) & 0xFF;
    return this.readMem(0x100 | this.s) & 0xFF;
  }

  setNZ(v) {
    this.p = (this.p & ~(FLAG_N | FLAG_Z)) | (v & 0x80) | ((v & 0xFF) === 0 ? FLAG_Z : 0);
    return v & 0xFF;
  }

  setFlag(flag, cond) {
    if (cond) this.p |= flag; else this.p &= ~flag;
  }

  // Resolve effective address for a mode (consumes operand bytes).
  // 'imm' returns the address of the operand byte itself.
  ea(mode) {
    switch (mode) {
      case 'imm': { const a = this.pc; this.pc = (this.pc + 1) & 0xFFFF; return a; }
      case 'zp':  return this.fetch();
      case 'zpx': return (this.fetch() + this.x) & 0xFF;
      case 'zpy': return (this.fetch() + this.y) & 0xFF;
      case 'abs': return this.fetch16();
      case 'abx': return (this.fetch16() + this.x) & 0xFFFF;
      case 'aby': return (this.fetch16() + this.y) & 0xFFFF;
      case 'izx': {
        const z = (this.fetch() + this.x) & 0xFF;
        return (this.readMem(z) | (this.readMem((z + 1) & 0xFF) << 8)) & 0xFFFF;
      }
      case 'izy': {
        const z = this.fetch();
        const base = (this.readMem(z) | (this.readMem((z + 1) & 0xFF) << 8)) & 0xFFFF;
        return (base + this.y) & 0xFFFF;
      }
      case 'ind': {
        const p = this.fetch16();
        // 6502 JMP indirect page-wrap bug
        const lo = this.readMem(p);
        const hi = this.readMem((p & 0xFF00) | ((p + 1) & 0xFF));
        return (lo | (hi << 8)) & 0xFFFF;
      }
      default: return 0; // imp / acc
    }
  }

  branch(cond) {
    const off = this.fetch();
    if (cond) {
      const dist = off < 0x80 ? off : off - 256;
      this.pc = (this.pc + dist) & 0xFFFF;
    }
  }

  adc(v) {
    const c = (this.p & FLAG_C) ? 1 : 0;
    const bin = this.a + v + c;
    if (this.p & FLAG_D) {
      let lo = (this.a & 0x0F) + (v & 0x0F) + c;
      let hi = (this.a >> 4) + (v >> 4) + (lo > 0x0F ? 1 : 0);
      if (lo > 9) lo += 6;
      // NMOS: Z from binary result, N/V from intermediate high nibble
      this.setFlag(FLAG_Z, (bin & 0xFF) === 0);
      this.setFlag(FLAG_N, (hi & 0x08) !== 0);
      this.setFlag(FLAG_V, (~(this.a ^ v) & (this.a ^ (hi << 4)) & 0x80) !== 0);
      if (hi > 9) hi += 6;
      this.setFlag(FLAG_C, hi > 0x0F);
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    } else {
      const r = bin & 0xFF;
      this.setFlag(FLAG_C, bin > 0xFF);
      this.setFlag(FLAG_V, (~(this.a ^ v) & (this.a ^ r) & 0x80) !== 0);
      this.a = this.setNZ(r);
    }
  }

  sbc(v) {
    const c = (this.p & FLAG_C) ? 1 : 0;
    const bin = this.a - v - (1 - c);
    const r = bin & 0xFF;
    // Flags are always computed from the binary result (NMOS behavior)
    this.setFlag(FLAG_C, bin >= 0);
    this.setFlag(FLAG_V, ((this.a ^ v) & (this.a ^ r) & 0x80) !== 0);
    if (this.p & FLAG_D) {
      let lo = (this.a & 0x0F) - (v & 0x0F) - (1 - c);
      let hi = (this.a >> 4) - (v >> 4);
      if (lo & 0x10) { lo -= 6; hi--; }
      if (hi & 0x10) hi -= 6;
      this.setNZ(r);
      this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
    } else {
      this.a = this.setNZ(r);
    }
  }

  compare(reg, v) {
    const r = (reg - v) & 0xFF;
    this.setFlag(FLAG_C, reg >= v);
    this.setNZ(r);
  }

  // Read-modify-write helper: fn maps old byte -> new byte
  rmw(mode, fn) {
    if (mode === 'acc') {
      this.a = fn.call(this, this.a) & 0xFF;
      this.setNZ(this.a);
    } else {
      const addr = this.ea(mode);
      const v = fn.call(this, this.readMem(addr) & 0xFF) & 0xFF;
      this.writeMem(addr, v);
      this.setNZ(v);
    }
  }

  /** Execute one instruction. Returns the opcode executed. */
  step() {
    const opPC = this.pc;
    const opc = this.fetch();
    const [name, mode] = OPS[opc];

    switch (name) {
      case 'adc': this.adc(this.readMem(this.ea(mode)) & 0xFF); break;
      case 'sbc': this.sbc(this.readMem(this.ea(mode)) & 0xFF); break;
      case 'and': this.a = this.setNZ(this.a & this.readMem(this.ea(mode))); break;
      case 'ora': this.a = this.setNZ(this.a | this.readMem(this.ea(mode))); break;
      case 'eor': this.a = this.setNZ(this.a ^ this.readMem(this.ea(mode))); break;
      case 'asl': this.rmw(mode, (v) => { this.setFlag(FLAG_C, v & 0x80); return v << 1; }); break;
      case 'lsr': this.rmw(mode, (v) => { this.setFlag(FLAG_C, v & 0x01); return v >> 1; }); break;
      case 'rol': this.rmw(mode, (v) => {
        const c = (this.p & FLAG_C) ? 1 : 0;
        this.setFlag(FLAG_C, v & 0x80);
        return (v << 1) | c;
      }); break;
      case 'ror': this.rmw(mode, (v) => {
        const c = (this.p & FLAG_C) ? 0x80 : 0;
        this.setFlag(FLAG_C, v & 0x01);
        return (v >> 1) | c;
      }); break;
      case 'bcc': this.branch(!(this.p & FLAG_C)); break;
      case 'bcs': this.branch(this.p & FLAG_C); break;
      case 'beq': this.branch(this.p & FLAG_Z); break;
      case 'bne': this.branch(!(this.p & FLAG_Z)); break;
      case 'bmi': this.branch(this.p & FLAG_N); break;
      case 'bpl': this.branch(!(this.p & FLAG_N)); break;
      case 'bvs': this.branch(this.p & FLAG_V); break;
      case 'bvc': this.branch(!(this.p & FLAG_V)); break;
      case 'bit': {
        const v = this.readMem(this.ea(mode)) & 0xFF;
        this.setFlag(FLAG_Z, (this.a & v) === 0);
        this.setFlag(FLAG_N, v & 0x80);
        this.setFlag(FLAG_V, v & 0x40);
        break;
      }
      case 'brk':
        // In this sandbox BRK aborts the current routine (no IRQ vector set up).
        this.halted = true;
        this.warn(`BRK at $${opPC.toString(16)} - aborting routine`);
        break;
      case 'clc': this.setFlag(FLAG_C, 0); break;
      case 'cld': this.setFlag(FLAG_D, 0); break;
      case 'cli': this.setFlag(FLAG_I, 0); break;
      case 'clv': this.setFlag(FLAG_V, 0); break;
      case 'sec': this.setFlag(FLAG_C, 1); break;
      case 'sed': this.setFlag(FLAG_D, 1); break;
      case 'sei': this.setFlag(FLAG_I, 1); break;
      case 'cmp': this.compare(this.a, this.readMem(this.ea(mode)) & 0xFF); break;
      case 'cpx': this.compare(this.x, this.readMem(this.ea(mode)) & 0xFF); break;
      case 'cpy': this.compare(this.y, this.readMem(this.ea(mode)) & 0xFF); break;
      case 'dec': this.rmw(mode, (v) => v - 1); break;
      case 'inc': this.rmw(mode, (v) => v + 1); break;
      case 'dex': this.x = this.setNZ((this.x - 1) & 0xFF); break;
      case 'dey': this.y = this.setNZ((this.y - 1) & 0xFF); break;
      case 'inx': this.x = this.setNZ((this.x + 1) & 0xFF); break;
      case 'iny': this.y = this.setNZ((this.y + 1) & 0xFF); break;
      case 'jmp': this.pc = this.ea(mode === 'abs' ? 'abs' : 'ind'); break;
      case 'jsr': {
        const target = this.fetch16();
        const ret = (this.pc - 1) & 0xFFFF;
        this.push(ret >> 8);
        this.push(ret & 0xFF);
        this.pc = target;
        break;
      }
      case 'lda': this.a = this.setNZ(this.readMem(this.ea(mode)) & 0xFF); break;
      case 'ldx': this.x = this.setNZ(this.readMem(this.ea(mode)) & 0xFF); break;
      case 'ldy': this.y = this.setNZ(this.readMem(this.ea(mode)) & 0xFF); break;
      case 'nop': break;
      case 'pha': this.push(this.a); break;
      case 'php': this.push(this.p | FLAG_B | FLAG_U); break;
      case 'pla': this.a = this.setNZ(this.pop()); break;
      case 'plp': this.p = (this.pop() & ~FLAG_B) | FLAG_U; break;
      case 'rti':
        // Treated like RTS (see file header): PSID play/init routines are
        // called as subroutines with a fake return address on the stack.
        // Falls through.
      case 'rts': {
        const lo = this.pop();
        const hi = this.pop();
        this.pc = ((lo | (hi << 8)) + 1) & 0xFFFF;
        break;
      }
      case 'sta': this.writeMem(this.ea(mode), this.a); break;
      case 'stx': this.writeMem(this.ea(mode), this.x); break;
      case 'sty': this.writeMem(this.ea(mode), this.y); break;
      case 'tax': this.x = this.setNZ(this.a); break;
      case 'tay': this.y = this.setNZ(this.a); break;
      case 'tsx': this.x = this.setNZ(this.s); break;
      case 'txa': this.a = this.setNZ(this.x); break;
      case 'txs': this.s = this.x & 0xFF; break;
      case 'tya': this.a = this.setNZ(this.y); break;
      case 'undoc':
      case 'jam': {
        // Consume operand bytes per addressing mode, act as NOP, warn once.
        if (mode !== 'imp' && mode !== 'acc') this.ea(mode);
        if (!this._warnedOpcodes.has(opc)) {
          this._warnedOpcodes.add(opc);
          const kind = name === 'jam' ? 'JAM' : 'undocumented';
          this.warn(`${kind} opcode $${opc.toString(16).padStart(2, '0')} at $${opPC.toString(16)} treated as NOP (results may be wrong)`);
        }
        break;
      }
      default:
        throw new Error(`cpu6502: unhandled op ${name}`);
    }
    return opc;
  }
}
