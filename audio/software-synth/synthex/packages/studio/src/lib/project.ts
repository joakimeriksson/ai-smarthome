// Project persistence — the studio's song file.
//
// Stored in IndexedDB (same choice as synthex; localStorage is where the
// standalone synths keep their own presets and we leave those untouched).
// Also exportable as plain JSON so projects can be shared as files.

import { openDB, type IDBPDatabase } from 'idb'
import { preloadInstruments, type InstrumentKind } from './instruments.ts'
import type { NoteStep } from './track.svelte.ts'
import type { Studio } from './studio.svelte.ts'
import { emptyDrumGrid, emptyNoteSteps } from './track.svelte.ts'
import { loadSynthData } from './synth-data.ts'

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
}

export interface Project {
  version: 1
  name: string
  bpm: number
  swing: number
  masterLevel: number
  tracks: ProjectTrack[]
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
    version: 1,
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
    })),
  }
}

/** Rebuild the desk from a project: tracks are recreated in order. */
export async function restore(studio: Studio, p: Project): Promise<void> {
  for (const t of [...studio.tracks]) studio.removeTrack(t.id)
  studio.setBpm(p.bpm)
  studio.setSwing(p.swing)
  studio.masterLevel = p.masterLevel
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
      if (preset?.params) track.loadPreset(preset.name, preset.params, preset.fx ?? {})
    }
    if (pt.params) {
      track.params = { ...pt.params }
      track.reapply()
    }
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
