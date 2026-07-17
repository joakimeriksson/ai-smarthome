// psid-capture.js - PSID loading + headless register capture on the
// verified Cpu6502 core (tools/lib/cpu6502.js).
//
// Runs under both Node and the browser (no Buffer, no fs): this is the
// single implementation behind tools/sid-dump.js (verified against native
// GT2 by make verify) AND the sid-ripper.html capture engine.
//
// parsePsid(u8)                -> header object (throws on non-SID data)
// new PsidRunner(psid, opts)   -> initialized machine for one subtune
//   .runFrame()                -> one play call, returns 25-byte reg shadow
//   .ciaTimerA                 -> CIA1 timer A value the tune wrote (or 0)
//   .callsPerVisualFrame       -> play calls per 50Hz frame (1 for VBI
//                                 tunes, >1 for CIA multispeed tunes)

import { Cpu6502 } from './cpu6502.js';

const INIT_BUDGET = 1_000_000;   // instruction budget for init call
const PLAY_BUDGET = 100_000;     // instruction budget per play call
const PAL_CYCLES_PER_FRAME = 19656; // 312 rasterlines x 63 cycles

function latin1(u8, from, to) {
    let s = '';
    for (let i = from; i < to; i++) {
        if (u8[i] === 0) break;
        s += String.fromCharCode(u8[i]);
    }
    return s;
}

function u16be(u8, off) { return (u8[off] << 8) | u8[off + 1]; }
function u32be(u8, off) { return (u8[off] * 0x1000000) + (u8[off + 1] << 16) + (u8[off + 2] << 8) + u8[off + 3]; }

/**
 * Parse a PSID/RSID file. Throws Error with a descriptive message when the
 * file cannot be captured (RSID, MUS data, playAddress 0, bad sizes).
 * Pass {lenient: true} to get the header back without capturability checks.
 */
export function parsePsid(u8, { lenient = false } = {}) {
    if (u8.length < 0x76) throw new Error('file too short to be a .sid');
    const magic = latin1(u8, 0, 4);
    if (magic !== 'PSID' && magic !== 'RSID') {
        throw new Error(`not a SID file (magic "${magic}")`);
    }

    const version     = u16be(u8, 0x04);
    const dataOffset  = u16be(u8, 0x06);
    let   loadAddress = u16be(u8, 0x08);
    let   initAddress = u16be(u8, 0x0A);
    const playAddress = u16be(u8, 0x0C);
    const songs       = u16be(u8, 0x0E);
    const startSong   = u16be(u8, 0x10);
    const speedBits   = u32be(u8, 0x12);
    const name        = latin1(u8, 0x16, 0x36);
    const author      = latin1(u8, 0x36, 0x56);
    const released    = latin1(u8, 0x56, 0x76);
    const flags       = version >= 2 && u8.length >= 0x78 ? u16be(u8, 0x76) : 0;

    if (!lenient) {
        if (magic === 'RSID') {
            throw new Error('RSID files require a full C64 environment (Kernal, CIA/VIC IRQs) - not supported');
        }
        if (flags & 0x01) {
            throw new Error('MUS/Compute! Sidplayer data format not supported');
        }
        if (playAddress === 0) {
            throw new Error('playAddress == 0 (tune installs its own IRQ handler) - not supported');
        }
    }

    let data = u8.subarray(dataOffset);
    if (loadAddress === 0) {
        if (data.length < 2) throw new Error('missing embedded load address');
        loadAddress = data[0] | (data[1] << 8);
        data = data.subarray(2);
    }
    if (initAddress === 0) initAddress = loadAddress; // per PSID spec
    if (loadAddress + data.length > 0x10000) {
        throw new Error(`data does not fit in 64KB (load $${loadAddress.toString(16)}, len ${data.length})`);
    }

    return {
        magic, version, loadAddress, initAddress, playAddress,
        songs, startSong, speedBits, name, author, released, flags, data,
    };
}

/**
 * A 64KB machine with the SID register shadow, initialized for one subtune.
 * onWrite(reg, val, call) fires for every $D400-$D418 write (reg 0-24),
 * where `call` is the 0-based play-call index (-1 during init).
 */
export class PsidRunner {
    constructor(psid, { subtune, onWrite = null, warn = () => {} } = {}) {
        const st = subtune !== undefined && subtune !== null
            ? subtune : Math.max(0, psid.startSong - 1);
        if (st >= psid.songs) {
            throw new Error(`subtune ${st} out of range (file has ${psid.songs} song(s))`);
        }
        this.psid = psid;
        this.subtune = st;
        this.onWrite = onWrite;
        this.call = -1;                     // -1 = init phase
        this.frames = 0;

        this.ram = new Uint8Array(0x10000);
        this.shadow = new Uint8Array(0x20); // $D400-$D41F
        this.ram.set(psid.data, psid.loadAddress);
        this.ram[0x0000] = 0x2F; // 6510 data direction register
        this.ram[0x0001] = 0x37; // default bank configuration

        const ram = this.ram;
        const shadow = this.shadow;
        const self = this;
        this.cpu = new Cpu6502({
            read(addr) {
                addr &= 0xFFFF;
                if (addr === 0xD41B || addr === 0xD41C) return 0; // SID osc3/env3 readback
                if (addr === 0xD011 || addr === 0xD012) return 0; // VIC raster
                if (addr >= 0xDC04 && addr <= 0xDC07) return 0;   // CIA1 timer A/B
                return ram[addr];
            },
            write(addr, val) {
                addr &= 0xFFFF;
                val &= 0xFF;
                ram[addr] = val;
                if (addr >= 0xD400 && addr <= 0xD41F) {
                    shadow[addr - 0xD400] = val;
                    if (self.onWrite && addr <= 0xD418) {
                        self.onWrite(addr - 0xD400, val, self.call);
                    }
                }
            },
            warn,
        });
        this.warn = warn;

        this.initClean = this.callRoutine(psid.initAddress, st, INIT_BUDGET,
            `init($${psid.initAddress.toString(16)})`);
        this.call = 0;
    }

    // Call a routine like JSR: fake return address on the stack, run until
    // the CPU returns to the sentinel or the instruction budget is spent.
    callRoutine(addr, aVal, budget, label) {
        const cpu = this.cpu;
        const SENTINEL = 0xFFFF;
        cpu.a = aVal & 0xFF;
        cpu.x = 0;
        cpu.y = 0;
        cpu.p = 0x24;   // I set, U set
        cpu.s = 0xFF;
        cpu.halted = false;
        const ret = (SENTINEL - 1) & 0xFFFF;  // RTS pops this and adds 1 -> SENTINEL
        cpu.push(ret >> 8);
        cpu.push(ret & 0xFF);
        cpu.pc = addr;

        let n = 0;
        while (cpu.pc !== SENTINEL && !cpu.halted) {
            cpu.step();
            if (++n >= budget) {
                this.warn(`${label}: instruction budget ${budget} exceeded (pc=$${cpu.pc.toString(16)}) - continuing anyway`);
                return false;
            }
        }
        return true;
    }

    // CIA1 timer A value the tune programmed during init (0 if untouched)
    get ciaTimerA() {
        return this.ram[0xDC04] | (this.ram[0xDC05] << 8);
    }

    // Play calls per 50Hz visual frame: 1 for VBI tunes; for CIA-timed
    // tunes (PSID speed bit set) derived from the programmed timer.
    get callsPerVisualFrame() {
        const bit = Math.min(this.subtune, 31);
        const cia = (this.psid.speedBits >>> bit) & 1;
        if (!cia) return 1;
        const timer = this.ciaTimerA;
        if (!timer) return 1;
        return Math.max(1, Math.round(PAL_CYCLES_PER_FRAME / timer));
    }

    // One play call; returns the 25-byte register shadow (live view)
    runFrame() {
        this.callRoutine(this.psid.playAddress, 0, PLAY_BUDGET,
            `play($${this.psid.playAddress.toString(16)}) call ${this.call}`);
        this.call++;
        return this.shadow.subarray(0, 25);
    }
}

/**
 * One-shot capture: parse, init, run N play calls collecting every
 * $D400-$D418 write. Returns { psid, runner, writes, frames } where writes
 * is [{call, reg, val}, ...] (init-phase writes have call === -1) and
 * frames is [[25 regs], ...] snapshotted after each call.
 */
export function captureSid(u8, { subtune, calls = 1500, warn = () => {} } = {}) {
    const psid = parsePsid(u8);
    const writes = [];
    const runner = new PsidRunner(psid, {
        subtune, warn,
        onWrite: (reg, val, call) => writes.push({ call, reg, val }),
    });
    const frames = [];
    for (let c = 0; c < calls; c++) {
        frames.push(Array.from(runner.runFrame()));
    }
    return { psid, runner, writes, frames };
}
