// Reactive patch store using Svelte 5 runes.
//
// Wraps the engine's Synth instance: updates to the store push parameter
// changes to the worklet, and patch loads broadcast a full patch.

import { Synth, type Patch } from '@synthex/engine'

export class PatchStore {
  patch: Patch = $state(null!)
  synth: Synth | null = null
  ready = $state(false)

  constructor(initial: Patch) {
    this.patch = initial
  }

  attach(synth: Synth): void {
    this.synth = synth
    this.ready = true
    synth.setPatch(this.patch)
  }

  // Replace the entire patch (e.g. user clicked a preset).
  load(p: Patch): void {
    this.patch = structuredClone(p)
    this.synth?.setPatch(this.patch)
  }

  // Live-edit a single parameter. Path is dot-separated, e.g. "filter.cutoff".
  // Accepts arrays too (used by chord-memory.notes).
  set(path: string, value: number | string | boolean | number[]): void {
    const segs = path.split('.')
    let target: Record<string, unknown> = this.patch as unknown as Record<string, unknown>
    for (let i = 0; i < segs.length - 1; i++) {
      const next = target[segs[i]!]
      if (next && typeof next === 'object') target = next as Record<string, unknown>
      else return
    }
    target[segs[segs.length - 1]!] = value
    this.patch = this.patch
    // Engine-side setParam only takes scalar values; arrays/objects propagate
    // implicitly via the next setPatch call (which will deep-clone).
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      this.synth?.setParam(path, value)
    }
  }

  // Convenience for nested writes from binding-style code.
  get<T = unknown>(path: string): T {
    const segs = path.split('.')
    let target: unknown = this.patch
    for (const seg of segs) {
      if (target && typeof target === 'object') {
        target = (target as Record<string, unknown>)[seg]
      }
    }
    return target as T
  }
}
