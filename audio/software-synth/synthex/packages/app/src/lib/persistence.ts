// IndexedDB-backed user patch storage. Tiny custom wrapper — pulls in the
// `idb` package would be overkill for one object store with three operations.

import type { Patch } from '@synthex/engine'

const DB_NAME = 'synthex-web'
const DB_VERSION = 1
const STORE = 'patches'
const META = 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' })
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(stores: string[], mode: IDBTransactionMode, op: (t: IDBTransaction) => Promise<T>): Promise<T> {
  return open().then(db => {
    const t = db.transaction(stores, mode)
    return op(t).finally(() => {})
  })
}

export interface SavedPatch { name: string; patch: Patch; updatedAt: number }

export async function savePatch(name: string, patch: Patch): Promise<void> {
  const entry: SavedPatch = { name, patch: { ...patch, name }, updatedAt: Date.now() }
  return tx(['patches'], 'readwrite', t => new Promise<void>((resolve, reject) => {
    const req = t.objectStore('patches').put(entry)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

export async function listPatches(): Promise<SavedPatch[]> {
  return tx(['patches'], 'readonly', t => new Promise<SavedPatch[]>((resolve, reject) => {
    const req = t.objectStore('patches').getAll()
    req.onsuccess = () => resolve((req.result as SavedPatch[]).sort((a, b) => b.updatedAt - a.updatedAt))
    req.onerror = () => reject(req.error)
  }))
}

export async function deletePatch(name: string): Promise<void> {
  return tx(['patches'], 'readwrite', t => new Promise<void>((resolve, reject) => {
    const req = t.objectStore('patches').delete(name)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

export async function setLastLoaded(slotKey: string): Promise<void> {
  return tx(['meta'], 'readwrite', t => new Promise<void>((resolve, reject) => {
    const req = t.objectStore('meta').put(slotKey, 'lastLoaded')
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

export async function getLastLoaded(): Promise<string | null> {
  return tx(['meta'], 'readonly', t => new Promise<string | null>((resolve, reject) => {
    const req = t.objectStore('meta').get('lastLoaded')
    req.onsuccess = () => resolve((req.result as string) ?? null)
    req.onerror = () => reject(req.error)
  }))
}
