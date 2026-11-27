import type { Item, Repo } from '@/types'

// Bump when Item, Repo or this shape changes: an older cache is then dropped and fetched again.
const VERSION = 5
// The same shape, with the items kept beside the rest rather than in buckets: moved to buckets once read.
const UNBUCKETED = 4

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
  /** When each open pull request's checks, review and conflicts were last read. */
  checkedAt: Record<string, number>
  reconciledAt: number | null
  syncedAt: number | null
  /**
   * Which save this is, made anew by each save of any tab: a tab whose copy isn't the one saved last takes it. A sync's
   * slices of the history save after its time, so that can't tell, and two tabs can save within one millisecond, so a
   * time of saving can't either.
   */
  revision: string | null
  /** Repositories whose open items are loaded. */
  openDone: string[]
  /**
   * The kinds of open items GitHub didn't show of a repository, by its id, at their last read: they're as many as GitHub
   * says, not as many as loaded.
   */
  openHidden: Record<string, Item['kind'][]>
  /**
   * The searches of a second of one part of a source that held more changes than a search lists, by query: the second,
   * and the repositories that held its changes when it was searched repository by repository, or null when even one
   * did, so its changes were read again from it. Without either in one saved by a version that kept how many changes
   * the second held: such an entry tells nothing.
   */
  crowded: Record<string, { second: number; repos: string[] | null }>
  /** Each repository's closed history: a cursor to resume from, or `true` once complete. */
  history: Record<string, { issues?: string | true; prs?: string | true }>
  /** Whose token reads the workspace, and the open pull requests that ask them for a review. */
  login: string | null
  requested: string[]
  requestedAt: number | null
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
    checkedAt: {},
    reconciledAt: null,
    syncedAt: null,
    revision: null,
    openDone: [],
    openHidden: {},
    crowded: {},
    history: {},
    login: null,
    requested: [],
    requestedAt: null,
  }
}

const markerKey = (ws: string) => `zimam:synced:${ws}`
const savedKey = (ws: string) => `zimam:saved:${ws}`
/** What the reader saw of each pull request in a workspace: visits and viewed files. Reloading keeps it. */
export const seenKey = (ws: string) => `zimam:seen:${ws}`

/** When a tab of the workspace last finished a sync, and the revision it saved with what it found then. */
export const syncedMarker = (ws: string) => Number(readMarker(markerKey(ws))) || 0
export const savedMarker = (ws: string) => readMarker(savedKey(ws))

export function setMarker(ws: string, synced: number | null, revision: string | null = null) {
  writeMarker(markerKey(ws), synced ? String(synced) : null)
  writeMarker(savedKey(ws), revision)
}

/** A revision no other save has: see Cache.revision. */
export const newRevision = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function readMarker(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeMarker(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Without storage, tabs just sync on their own.
  }
}

// The items are kept apart from the rest, in buckets: each repository's open items, and its closed ones by the month
// they last changed in. A save writes only the buckets that changed: writing all the items of a big workspace took the
// page half a second each time, and a sync saves every minute. The buckets share the store, under the workspace's key
// and the bucket's, so a tab still on the version before has nothing to wait for.

interface Bucket {
  /** The store's key: the workspace, then the bucket. See bucketOf. */
  ws: string
  items: Item[]
}

/**
 * Where an item is kept: open items by repository, closed ones by repository and month, apart, so the open ones can be
 * read first. A change can move an item, as closing it does: then it leaves one bucket for another.
 */
export const bucketOf = (item: Item) =>
  item.state === 'open' ? `open/${item.repoId}` : `closed/${item.repoId}/${item.updatedAt.slice(0, 7)}`

const bucketKey = (ws: string, bucket: string) => `${ws}/${bucket}`
/** A workspace's buckets, or those whose keys start with `part`, like `open/`. */
const bucketsOf = (ws: string, part = '') => IDBKeyRange.bound(`${ws}/${part}`, `${ws}/${part}\uffff`)

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

/** Runs `action` in a transaction. Resolves with what its answer reads once it's done, or null. */
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => () => T): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction('cache', mode)
      const answer = action(transaction.objectStore('cache'))
      transaction.addEventListener('complete', () => resolve(answer()))
      transaction.addEventListener('abort', () => resolve(null))
    } catch (error) {
      console.error('Zimam could not use what this browser saved', error)
      resolve(null)
    }
  })
}

/** A workspace's cache, with its open items alone when `closed` is false: a long history takes a while to read. */
export async function readCache(ws: string, closed = true): Promise<Cache | null> {
  const read = await run('readonly', (store) => {
    const cache = store.get(ws) as IDBRequest<Cache | undefined>
    const buckets = store.getAll(bucketsOf(ws, closed ? '' : 'open/')) as IDBRequest<Bucket[]>
    return () => ({ cache: cache.result, buckets: buckets.result })
  })
  const cache = read?.cache
  if (cache?.version === UNBUCKETED) {
    cache.version = VERSION
    await writeCache(cache, null)
    return kept(cache)
  }
  if (cache?.version !== VERSION) return null
  cache.items = read!.buckets.flatMap((bucket) => bucket.items)
  return kept(cache)
}

// What a cache saved before the revision, the hidden kinds and the crowded seconds were kept starts without them.
function kept(cache: Cache): Cache {
  cache.revision ??= null
  cache.openHidden ??= {}
  cache.crowded ??= {}
  return cache
}

/**
 * Saves the workspace, with the items of the buckets named, or of every bucket (null), which drops the others too.
 * Returns whether it was saved.
 */
export async function writeCache(cache: Cache, changed: ReadonlySet<string> | null): Promise<boolean> {
  const filled = new Map<string, Item[]>()
  for (const bucket of changed ?? []) filled.set(bucket, [])
  for (const item of cache.items) {
    const bucket = bucketOf(item)
    let held = filled.get(bucket)
    if (!held && !changed) filled.set(bucket, (held = []))
    held?.push(item)
  }
  const saved = await run('readwrite', (store) => {
    if (!changed) store.delete(bucketsOf(cache.ws))
    store.put({ ...cache, items: [] })
    for (const [bucket, held] of filled) {
      const key = bucketKey(cache.ws, bucket)
      if (held.length) store.put({ ws: key, items: held } satisfies Bucket)
      else store.delete(key)
    }
    return () => true
  })
  return saved === true
}

export async function deleteCache(ws: string) {
  setMarker(ws, null)
  await run('readwrite', (store) => {
    store.delete(ws)
    store.delete(bucketsOf(ws))
    return () => true
  })
}
