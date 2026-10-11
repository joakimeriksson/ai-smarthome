// Project persistence — the studio's song file.
//
// Stored in IndexedDB (same choice as synthex; localStorage is where the
// standalone synths keep their own presets and we leave those untouched).
// Also exportable as plain JSON so projects can be shared as files.
//
// Version 2 added the mixer: per-track insert effects and sends, return
// buses, and master inserts. A version 1 file has none of them and loads
// with the default returns and every send at zero, so it sounds as it did.

import { openDB, type IDBPDatabase } from 'idb'
import { preloadInstruments, type InstrumentKind } from './instruments.ts'
import type { NoteStep } from './track.svelte.ts'
import type { Studio } from './studio.svelte.ts'
import { emptyDrumGrid, emptyNoteSteps } from './track.svelte.ts'
import { loadSynthData, applyPresetEntry } from './synth-data.ts'
import { defaultReturns, sendOf, type FxSlotSpec, type ProjectBus, type SendSpec } from './fx.ts'

export interface ProjectTrack {
  kind: InstrumentKind
  name: string
  level: number
  pan: number
  muted: boolean
  soloed: boolean
  gate: number
  transpose: number
  steps: NoteStep[]
  drumGrid: number[][]
  /** Sound: the preset the track was loaded with, plus edits on top of it. */
  presetName?: string | null
  params?: Record<string, number | string | boolean>
  /** Insert effects, in order (v2). */
  inserts?: FxSlotSpec[]
  /** Sends by return-bus id (v2); a bare number is a post-fader level. */
  sends?: Record<string, SendSpec | number>
}

export interface Project {
  version: 1 | 2
  name: string
  bpm: number
  swing: number
  masterLevel: number
  tracks: ProjectTrack[]
  /** Return buses (v2). Missing: the default returns. */
  buses?: ProjectBus[]
  /** The master bus's insert effects (v2). */
  masterInserts?: FxSlotSpec[]
}

const DB_NAME = 'synthex-studio'
const STORE = 'projects'

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    },
  })
}

// Plain deep clone — strips Svelte proxies so the data is structured-cloneable
// for IndexedDB and JSON export.
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export function snapshot(studio: Studio, name: string): Project {
  return {
    version: 2,
    name,
    bpm: studio.bpm,
    swing: studio.swing,
    masterLevel: studio.masterLevel,
    tracks: studio.tracks.map(t => ({
      kind: t.kind,
      name: t.name,
      level: t.level,
      pan: t.pan,
      muted: t.muted,
      soloed: t.soloed,
      gate: t.gate,
      transpose: t.transpose,
      steps: clone(t.steps),
      drumGrid: clone(t.drumGrid),
      presetName: t.presetName,
      params: clone(t.params),
      inserts: clone(t.chain.specs()),
      sends: clone(t.sends),
    })),
    buses: clone(studio.buses.map(b => b.spec())),
    masterInserts: clone(studio.master?.chain.specs() ?? []),
  }
}

/** Rebuild the desk from a project: tracks are recreated in order. */
export async function restore(studio: Studio, p: Project): Promise<void> {
  for (const t of [...studio.tracks]) studio.removeTrack(t.id)
  studio.setBpm(p.bpm)
  studio.setSwing(p.swing)
  studio.masterLevel = p.masterLevel
  studio.setReturns(p.buses ?? defaultReturns())
  studio.master?.chain.load(p.masterInserts ?? [])
  // Fetch every processor up front so the tracks below appear together
  // instead of trickling in one module-load at a time.
  if (studio.ctx) await preloadInstruments(studio.ctx, p.tracks.map(t => t.kind))
  for (const pt of p.tracks) {
    const track = await studio.addTrack(pt.kind)
    if (!track) continue
    track.name = pt.name
    track.level = pt.level
    track.pan = pt.pan
    track.muted = pt.muted
    track.soloed = pt.soloed
    track.gate = pt.gate
    track.transpose = pt.transpose
    track.steps = pt.steps?.length ? pt.steps : emptyNoteSteps(16)
    track.drumGrid = pt.drumGrid?.length ? pt.drumGrid : emptyDrumGrid(16)

    // Restore the sound. The preset goes in first so the saved edits land on
    // top of it in the same order they were made.
    if (pt.presetName) {
      const data = await loadSynthData(pt.kind)
      const preset = data.presets.find(x => x.name === pt.presetName)
      if (preset) applyPresetEntry(track, preset)
    }
    if (pt.params) {
      track.params = { ...pt.params }
      track.reapply()
    }
    track.chain.load(pt.inserts)
    track.sends = Object.fromEntries(Object.entries(pt.sends ?? {}).map(([id, v]) => [id, sendOf(v)]))
    track.connectSends(studio.buses)
  }
  studio.applyMix()
}

export async function saveProject(p: Project): Promise<void> {
  const d = await db()
  await d.put(STORE, p, p.name)
}

export async function listProjects(): Promise<string[]> {
  const d = await db()
  return (await d.getAllKeys(STORE)).map(String)
}

export async function loadProject(name: string): Promise<Project | undefined> {
  const d = await db()
  return d.get(STORE, name) as Promise<Project | undefined>
}

export async function deleteProject(name: string): Promise<void> {
  const d = await db()
  await d.delete(STORE, name)
}

export function exportJson(p: Project): void {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${p.name.replace(/[^\w-]+/g, '_')}.studio.json`
  a.click()
  URL.revokeObjectURL(url)
}
