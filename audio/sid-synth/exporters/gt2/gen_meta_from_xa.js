#!/usr/bin/env node
// Generate meta JSON for JS patching from xa label list + PRG
// Usage: node gen_meta_from_xa.js labels.txt gt2_driver.prg > driver.meta.json

const fs = require('fs');

function parseLabels(text) {
  // xa -l output has lines like: mt_init, 0x10fc, 0, 0x0000
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*,\s*0x([0-9A-Fa-f]+)/);
    if (!m) continue;
    const label = m[1];
    const addr = parseInt(m[2], 16);
    map.set(label, addr);
  }
  return map;
}

function off(prgBase, addr) {
  // xa outputs raw binary (no 2-byte PRG header), so offset = addr - base
  return addr - prgBase;
}

function main() {
  const [labelsPath, prgPath] = process.argv.slice(2);
  if (!labelsPath || !prgPath) {
    console.error('Usage: node gen_meta_from_xa.js <labels.txt> <driver.prg>');
    process.exit(1);
  }
  const labelsTxt = fs.readFileSync(labelsPath, 'utf8');
  const prg = fs.readFileSync(prgPath);
  const labels = parseLabels(labelsTxt);

  const base = labels.get('base');
  const init = labels.get('mt_init');
  const play = labels.get('mt_play');
  if (base == null || init == null || play == null) {
    console.error('Required symbols not found in labels: base, mt_init, mt_play');
    process.exit(1);
  }

  const tables = {};
  function add(name, length) {
    const addr = labels.get(name);
    if (addr == null) {
      console.error(`Warning: Missing label: ${name}, skipping`);
      return;
    }
    const offset = off(base, addr);
    tables[name.replace(/^mt_/, '')] = { offset, length, addr };
  }

  // Song structure
  add('mt_songtbllo', 96);
  add('mt_songtblhi', 96);
  add('mt_patttbllo', 256);
  add('mt_patttblhi', 256);

  // Instrument arrays (64 entries each)
  add('mt_insad', 64);
  add('mt_inssr', 64);
  add('mt_inswaveptr', 64);
  add('mt_inspulseptr', 64);
  add('mt_insfiltptr', 64);
  add('mt_insvibparam', 64);
  add('mt_insvibdelay', 64);
  add('mt_insgatetimer', 64);
  add('mt_insfirstwave', 64);

  // Modulation tables (255 entries each)
  add('mt_wavetbl', 255);
  add('mt_pulsetimetbl', 255);
  add('mt_pulsespdtbl', 255);
  add('mt_filttimetbl', 255);
  add('mt_filtspdtbl', 255);

  // Speed tables (255 entries each)
  add('mt_speedlefttbl', 255);
  add('mt_speedrighttbl', 255);

  // Frequency tables (96 entries each)
  add('mt_freqtbllo', 96);
  add('mt_freqtblhi', 96);

  // Note table (256 entries)
  add('mt_notetbl', 256);

  // Playback defaults patched per-song at export time:
  // mt_defaulttempo is `lda #DEFAULTTEMPO` — operand byte is at +1
  {
    const addr = labels.get('mt_defaulttempo');
    if (addr == null) {
      console.error('Warning: Missing label: mt_defaulttempo, skipping');
    } else {
      tables['defaulttempo'] = { offset: off(base, addr) + 1, length: 1, addr: addr + 1 };
    }
  }
  add('mt_funktempotbl', 2);

  // Hard-restart ADSR operands (ADPARAM/SRPARAM immediates) have no labels;
  // locate them by instruction pattern in mt_normalnote:
  //   lda #SRPARAM / sta SIDBASE+$06,x  ->  A9 xx 9D 06 D4
  //   lda #ADPARAM / sta SIDBASE+$05,x  ->  A9 xx 9D 05 D4
  function findOperand(name, staLo) {
    const matches = [];
    for (let i = 0; i + 4 < prg.length; i++) {
      if (prg[i] === 0xA9 && prg[i + 2] === 0x9D && prg[i + 3] === staLo && prg[i + 4] === 0xD4) {
        matches.push(i + 1);
      }
    }
    if (matches.length !== 1) {
      console.error(`Warning: ${name}: expected 1 match for lda #imm/sta $D4${staLo.toString(16).padStart(2, '0')},x — found ${matches.length}, skipping`);
      return;
    }
    tables[name] = { offset: matches[0], length: 1, addr: base + matches[0] };
  }
  findOperand('hrsrparam', 0x06);
  findOperand('hradparam', 0x05);

  const meta = {
    base,
    init,
    play,
    size: prg.length,
    tables,
  };
  process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
}

main();
