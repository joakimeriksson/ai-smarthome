#!/usr/bin/env node
// Generate meta JSON for JS patching from xa label list + PRG
// Usage: node gen_meta_from_xa.js labels.txt gt2_driver.prg > driver.meta.json

const fs = require('fs');

function parseLabels(text) {
  // xa -l output has lines like: 00001000 base
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/\b([0-9A-Fa-f]{8})\s+([A-Za-z0-9_\.\-\+\$]+)/);
    if (!m) continue;
    const addr = parseInt(m[1], 16);
    const label = m[2];
    map.set(label, addr);
  }
  return map;
}

function off(prgBase, addr) {
  // PRG has a 2-byte load-address header; file offset for an address is:
  // (addr - prgBase) + 2
  return (addr - prgBase) + 2;
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
      console.error(`Missing label: ${name}`);
      process.exit(1);
    }
    const offset = off(base, addr);
    tables[name.replace(/^mt_/, '')] = { offset, length };
  }

  add('mt_songtbllo', 3);
  add('mt_songtblhi', 3);
  add('mt_patttbllo', 256);
  add('mt_patttblhi', 256);
  add('mt_wavetbl', 2);
  add('mt_pulsetimetbl', 2);
  add('mt_pulsespdtbl', 2);
  add('mt_filttimetbl', 2);
  add('mt_filtspdtbl', 1);
  add('mt_speedlefttbl', 32);
  add('mt_speedrighttbl', 32);
  add('mt_freqtbllo', 96);
  add('mt_freqtblhi', 96);
  add('mt_notetbl', 256);

  const meta = {
    base,
    init,
    play,
    size: prg.length,
    tables,
  };
  process.stdout.write(JSON.stringify(meta, null, 2));
}

main();

