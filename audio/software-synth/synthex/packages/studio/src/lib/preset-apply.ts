// Applying a preset entry to a track — shared by the preset picker, project
// restore and tools/render-song.ts. Deliberately free of runtime imports
// (synth-data.ts pulls in the Synthex engine), so it also runs in plain Node.

import type { InstrumentKind } from './instruments.ts'
import type { PresetEntry, WaveSequence } from './synth-data.ts'

/**
 * Fields beyond {params, fx} that ride on a preset's `preset` message, in
 * the shape the standalone page sends. WaveSynth always sends both sequences
 * (empty ones clear a previous preset's), exactly as js/ws-main.js does.
 */
export function presetExtras(kind: InstrumentKind, preset: PresetEntry): Record<string, unknown> {
  if (kind !== 'ws') return {}
  const empty: WaveSequence = { steps: [], loopMode: 0, speed: 1.0 }
  return { seqA: preset.seqA ?? empty, seqB: preset.seqB ?? empty }
}

/** What applyPresetEntry needs from a track (kept structural: no import cycle). */
interface PresetTarget {
  kind: InstrumentKind
  instrument: unknown
  loadPreset(name: string, params: Record<string, unknown>, fx?: Record<string, unknown>,
    extras?: Record<string, unknown>): void
}

/**
 * Load a melodic preset into a track the way the standalone page would: the
 * params/fx message (with WaveSynth's sequences riding on it), then SID's GT2
 * tables — the animated half of those sounds (PWM sweeps, arps, filter runs),
 * sent after the params, or cleared so a previous preset's tables stop.
 * Shared by the preset picker and project restore; restore used to skip the
 * tables, so a saved SID track came back as a static tone.
 */
export function applyPresetEntry(track: PresetTarget, preset: PresetEntry): void {
  if (!preset.params) return
  track.loadPreset(preset.name, preset.params, preset.fx ?? {}, presetExtras(track.kind, preset))
  const inst = track.instrument as { post?: (m: Record<string, unknown>) => void }
  if (!inst.post || track.kind !== 'sid') return
  const t = preset.tables
  if (!t) { inst.post({ type: 'tableEnabled', value: false }); return }
  const empty = () => new Array<number>(255).fill(0)
  ;[t.wtbl, t.ptbl, t.ftbl].forEach((tbl, i) => inst.post!({
    type: 'tableData', tableType: i,
    ltable: tbl ? tbl.lt : empty(), rtable: tbl ? tbl.rt : empty(),
  }))
  inst.post({ type: 'tableStartPtrs', ptrs: {
    wave: t.wavePtr ?? 0, pulse: t.pulsePtr ?? 0, filter: t.filterPtr ?? 0 } })
  inst.post({ type: 'tableEnabled', value: true })
}
