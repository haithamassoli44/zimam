import type { Item, Repo } from '@/types'

// Bump when Item, Repo or this shape changes: an older cache is then dropped and fetched again.
const VERSION = 3

/** What a workspace has fetched so far, and how far each step got. */
export interface Cache {
  version: number
  ws: string
  sources: string
  repos: Repo[]
  items: Item[]
  /** Changes since this time haven't been fetched yet. */
  watermark: number | null
  reposAt: number | null
  checksAt: number | null
  reconciledAt: number | null
  syncedAt: number | null
  /** Repositories whose open items are loaded. */
  openDone: string[]
  /** Each repository's closed history: a cursor to resume from, or `true` once complete. */
  history: Record<string, { issues?: string | true; prs?: string | true }>
}

export function emptyCache(ws: string, sources: string): Cache {
  return {
    version: VERSION,
    ws,
    sources,
    repos: [],
    items: [],
    watermark: null,
    reposAt: null,
    checksAt: null,
    reconciledAt: null,
    syncedAt: null,
    openDone: [],
    history: {},
  }
}

const markerKey = (ws: string) => `zimam:synced:${ws}`

export function syncedMarker(ws: string): number {
  try {
    return Number(localStorage.getItem(markerKey(ws))) || 0
  } catch {
    return 0
  }
}

export function setMarker(ws: string, at: number | null) {
  try {
    if (at) localStorage.setItem(markerKey(ws), String(at))
    else localStorage.removeItem(markerKey(ws))
  } catch {
    // Without storage, tabs just sync on their own.
  }
}

let database: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  database ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open('zimam', 1)
      request.addEventListener('upgradeneeded', () => request.result.createObjectStore('cache', { keyPath: 'ws' }))
      request.addEventListener('success', () => resolve(request.result))
      request.addEventListener('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
  return database
}

async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('cache', mode)
      const request = action(transaction.objectStore('cache'))
      transaction.addEventListener('complete', () => resolve(request.result))
      transaction.addEventListener('abort', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

export async function readCache(ws: string): Promise<Cache | null> {
  const cache = await run<Cache | undefined>('readonly', (store) => store.get(ws))
  return cache?.version === VERSION ? cache : null
}

/** Returns whether the cache was saved. */
export async function writeCache(cache: Cache): Promise<boolean> {
  return (await run('readwrite', (store) => store.put(cache))) !== null
}

export async function deleteCache(ws: string) {
  setMarker(ws, null)
  await run('readwrite', (store) => store.delete(ws))
}
