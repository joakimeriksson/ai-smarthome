// rip-roundtrip.mjs - Full SID-rip round trip, headless:
//   sid-ripper.html: load .sid -> capture -> convert -> localStorage
//   index.html?import=sidrip: import -> writeSng -> .sng bytes to disk
// Usage: node rip-roundtrip.mjs <sidfile-url-path> <out.sng> [seconds]
import { webkit } from 'playwright';
import { writeFileSync } from 'node:fs';

const [sidPath, outSng, secondsArg, subtuneArg] = process.argv.slice(2);
// 90 s default: most SID tunes run past a minute and a short capture silently
// truncates the song - no downstream comparison can detect that, because it
// measures the captured window against the SAME window of the original.
const seconds = parseInt(secondsArg || '90', 10);
const subtune = parseInt(subtuneArg || '0', 10);
if (!sidPath || !outSng) { console.error('usage: rip-roundtrip.mjs <sid-url-path> <out.sng> [seconds]'); process.exit(2); }

// Preflight: without the dev server playwright fails with an opaque
// "Could not connect" stack trace that looks like a browser problem.
try {
  await fetch('http://localhost:8471/sid-ripper.html', { signal: AbortSignal.timeout(3000) });
} catch {
  console.error('rip-roundtrip: dev server not responding on :8471 - run `make serve` first');
  process.exit(1);
}

const browser = await webkit.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('[pageerror]', e.message));

await page.goto('http://localhost:8471/sid-ripper.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

const ripInfo = await page.evaluate(async ({ sidPath, seconds, subtune }) => {
  const buf = new Uint8Array(await (await fetch(sidPath)).arrayBuffer());
  SIDRipper.loadSIDData(buf);
  await new Promise(r => setTimeout(r, 200));
  document.getElementById('subsongSelect').value = String(subtune);
  SIDRipper.autoCapture(seconds);
  // autoCapture runs in a setTimeout; poll for completion
  for (let i = 0; i < 100; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (SIDRipper.registerLog.length > 0 && !document.getElementById('autoCapBtn').disabled) break;
  }
  SIDRipper.convertToGT2();
  SIDRipper.openInTracker();   // stores localStorage (also opens a tab we ignore)
  const d = SIDRipper.gt2Data;
  return { writes: SIDRipper.registerLog.length, patterns: d.patterns.length,
           instruments: d.instruments.length, speed: d.speed };
}, { sidPath, seconds, subtune });
console.error('rip:', JSON.stringify(ripInfo));

await page.goto('http://localhost:8471/index.html?import=sidrip', { waitUntil: 'load' });
await page.waitForTimeout(800);

const sngBytes = await page.evaluate(async () => {
  const { gt2PatternManager } = await import('./pattern-manager-gt2.js');
  const { gt2TableManager } = await import('./table-manager-gt2.js');
  const { instruments } = await import('./synth.js');
  const { writeSng } = await import('./gt2-sng-writer.js');
  const song = gt2PatternManager.song;
  const bytes = writeSng({
    name: song.title || 'Rip', author: song.author || '', copyright: '',
    subtunes: song.subtunes,
    patterns: gt2PatternManager.patterns,
    instruments,
    tables: { ltable: gt2TableManager.ltable, rtable: gt2TableManager.rtable },
  });
  return Array.from(bytes);
});

writeFileSync(outSng, Buffer.from(sngBytes));
console.error(`wrote ${outSng} (${sngBytes.length} bytes)`);
await browser.close();
