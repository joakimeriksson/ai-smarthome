// Each synth's presets and editable controls, as extracted from the standalone
// pages at build time by scripts/sync-synth-data.mjs.
//
// The standalone synths stay the single source of truth: add a preset or a
// slider there and it appears in the studio's editor on the next start. Nothing
// here is hand-maintained, which is why there is no fallback list — if a bank
// is missing the editor says so rather than quietly offering a stale copy.

import { PRESETS as SYNTHEX_PRESETS, MEMORIES, type Patch } from '@synthex/engine'
import type { InstrumentKind } from './instruments.ts'

export interface ParamOption { value: string; label: string }

export interface ParamSpec {
  /** Engine parameter name, e.g. `filterCutoff`. */
  param: string
  label: string
  /** Panel the control lives in on the standalone page. */
  group: string
  type: 'range' | 'select' | 'toggle'
  min?: number
  max?: number
  step?: number
  default?: number
  options?: ParamOption[]
  /**
   * The engine value for every position the slider can reach, precomputed at
   * build time from the standalone page's own transform. A slider position is
   * usually not the engine value — VA's cutoff runs 0..1 on screen but
   * 20..20000 Hz in the filter — so this is what actually gets sent.
   * Absent means the mapping is the identity.
   */
  values?: number[]
  suffix?: string
  decimals?: number
  /**
   * Drum voices are addressed per channel (`ch.<n>.<param>`), so the editor
   * shows a channel picker and prefixes the name before sending.
   */
  perChannel?: boolean
}

export interface PresetEntry {
  name: string
  params?: Record<string, unknown>
  fx?: Record<string, unknown>
  /** Drum banks are rhythms rather than sounds... */
  pattern?: number[][]
  /** ...except that a rhythm may bring its kit: sparse per-channel overrides. */
  kit?: Record<string, number>[]
  /** SID: GT2 tables (wave/pulse/filter) + start pointers — the animated part. */
  tables?: {
    wavePtr?: number; pulsePtr?: number; filterPtr?: number
    wtbl?: { lt: number[]; rt: number[] } | null
    ptbl?: { lt: number[]; rt: number[] } | null
    ftbl?: { lt: number[]; rt: number[] } | null
  }
}

export interface SynthData {
  kind: InstrumentKind
  presets: PresetEntry[]
  params: ParamSpec[]
}

const cache = new Map<InstrumentKind, Promise<SynthData>>()

/** Synthex is a TypeScript package, so its bank comes straight from the engine. */
function synthexData(): SynthData {
  return {
    kind: 'synthex',
    // Names live on the cassette MEMORIES, the patches on the ROM PRESETS;
    // they share an address, so pair them up and keep only the slots that
    // actually have a reconstructed patch.
    presets: MEMORIES.flatMap(m => {
      const patch = m.patch ?? SYNTHEX_PRESETS.find(f => f.address === m.address)?.patch
      if (!patch) return []
      return [{
        name: `${m.address}. ${m.name}`,
        params: patch as unknown as Record<string, unknown>,
      }]
    }),
    // Synthex patches are nested objects, not a flat parameter list; its own
    // panel is the editor for those. The studio offers the bank only.
    params: [],
  }
}

export function loadSynthData(kind: InstrumentKind): Promise<SynthData> {
  let hit = cache.get(kind)
  if (hit) return hit

  hit = kind === 'synthex'
    ? Promise.resolve(synthexData())
    : fetch(`synths/${kind}.json`)
        .then(r => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
          return r.json() as Promise<SynthData>
        })
        .catch((err: unknown) => {
          // Missing bank is a build-step problem, not a reason to break the
          // studio — the editor renders an explanation instead of controls.
          const reason = err instanceof Error ? err.message : String(err)
          console.warn(`[synth-data] ${kind}: ${reason}`)
          return { kind, presets: [], params: [] }
        })

  cache.set(kind, hit)
  return hit
}

/** Synthex patches travel whole; the worklet synths take a flat param bag. */
export function isSynthexPatch(kind: InstrumentKind, p: PresetEntry): p is PresetEntry & { params: Patch } {
  return kind === 'synthex' && !!p.params
}


/** Slider position → the value the engine receives. */
export function engineValue(spec: ParamSpec, position: number): number {
  if (!spec.values) return position
  const i = Math.round((position - (spec.min ?? 0)) / (spec.step || 1))
  return spec.values[Math.max(0, Math.min(spec.values.length - 1, i))] ?? position
}

/**
 * Engine value → slider position, for showing a stored or preset value.
 * The tables are monotonic, so the nearest entry is the right one; a binary
 * search would be premature for a few thousand entries touched on render.
 */
export function sliderPosition(spec: ParamSpec, value: number): number {
  if (!spec.values) return value
  let best = 0
  let bestErr = Infinity
  for (let i = 0; i < spec.values.length; i++) {
    const err = Math.abs(spec.values[i]! - value)
    if (err < bestErr) { bestErr = err; best = i }
  }
  return (spec.min ?? 0) + best * (spec.step || 1)
}

/** Read-out text, matching what the standalone page shows. */
export function formatValue(spec: ParamSpec, engine: number): string {
  const decimals = spec.decimals ?? ((spec.step ?? 0.01) >= 1 ? 0 : 2)
  return engine.toFixed(decimals) + (spec.suffix ?? '')
}
