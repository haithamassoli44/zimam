import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'

import { bucketOf, deleteCache, emptyCache, readCache, writeCache, type Cache } from '@/lib/cache'
import type { Item } from '@/types'

// jsdom has no IndexedDB.
Object.assign(globalThis, { indexedDB, IDBKeyRange })

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'issue',
    repoId: 'web',
    number: 1,
    title: id,
    url: '',
    state: 'open',
    notPlanned: false,
    author: null,
    assignees: [],
    labels: [],
    comments: 0,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-03-04T00:00:00Z',
    review: null,
    checks: null,
    merge: null,
    diff: null,
    ...overrides,
  }
}

const cacheOf = (ws: string, items: Item[]): Cache => ({ ...emptyCache(ws, 'org:acme'), items, syncedAt: 1 })
const ids = (cache: Cache | null) => cache?.items.map((each) => each.id).toSorted()

// What a database looks like to raw IndexedDB: every record, by key.
async function records(): Promise<Map<string, { items: Item[] }>> {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open('zimam', 1)
    request.onsuccess = () => resolve(request.result)
  })
  const all = await new Promise<{ ws: string; items: Item[] }[]>((resolve) => {
    const request = db.transaction('cache').objectStore('cache').getAll()
    request.onsuccess = () => resolve(request.result)
  })
  db.close()
  return new Map(all.map((record) => [record.ws, record]))
}

describe('the cache', () => {
  it('keeps open items by repository, and closed ones by the month they last changed', () => {
    expect(bucketOf(item('a'))).toBe('open/web')
    expect(bucketOf(item('b', { state: 'closed' }))).toBe('closed/web/2026-03')
  })

  it('reads back what it wrote, its items in buckets apart from the rest', async () => {
    await writeCache(cacheOf('w1', [item('a'), item('b', { state: 'closed' })]), null)
    expect(ids(await readCache('w1'))).toEqual(['a', 'b'])
    const kept = await records()
    expect(kept.get('w1')?.items).toEqual([])
    expect([...kept.keys()].filter((key) => key.startsWith('w1/')).toSorted()).toEqual([
      'w1/closed/web/2026-03',
      'w1/open/web',
    ])
  })

  it('reads the open items alone, for a first look while the closed ones are read', async () => {
    await writeCache(cacheOf('w5', [item('a'), item('b', { state: 'closed' }), item('c', { repoId: 'api' })]), null)
    expect(ids(await readCache('w5', false))).toEqual(['a', 'c'])
    expect(ids(await readCache('w5'))).toEqual(['a', 'b', 'c'])
  })

  it('writes only the buckets named, so an item that moved leaves the one it was in', async () => {
    const before = cacheOf('w2', [item('a'), item('b')])
    await writeCache(before, null)
    const closed = item('a', { state: 'closed' })
    // What a sync wrote for its change: both buckets. The untouched one keeps what it had.
    await writeCache(
      cacheOf('w2', [closed, item('b', { title: 'not saved' })]),
      new Set(['open/web', 'closed/web/2026-03']),
    )
    const after = await readCache('w2')
    expect(after?.items.find((each) => each.id === 'a')?.state).toBe('closed')
    expect(after?.items.filter((each) => each.id === 'b')).toHaveLength(1)
    await writeCache(cacheOf('w2', [item('c')]), new Set(['open/web']))
    expect(ids(await readCache('w2'))).toEqual(['a', 'c'])
  })

  it('drops buckets left empty, and every bucket with the workspace', async () => {
    await writeCache(cacheOf('w3', [item('a'), item('b', { state: 'closed' })]), null)
    await writeCache(cacheOf('w3', [item('a')]), null)
    expect([...(await records()).keys()].filter((key) => key.startsWith('w3/'))).toEqual(['w3/open/web'])
    await deleteCache('w3')
    expect(await readCache('w3')).toBeNull()
    expect([...(await records()).keys()].filter((key) => key.startsWith('w3'))).toEqual([])
  })

  it('moves the items of a cache from before buckets into buckets', async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('zimam', 1)
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise((resolve) => {
      const transaction = db.transaction('cache', 'readwrite')
      transaction.objectStore('cache').put({ ...cacheOf('w4', [item('a'), item('b')]), version: 4 })
      transaction.oncomplete = resolve
    })
    db.close()
    expect(ids(await readCache('w4'))).toEqual(['a', 'b'])
    const kept = await records()
    expect(kept.get('w4')?.items).toEqual([])
    expect(kept.get('w4/open/web')?.items.map((each) => each.id)).toEqual(['a', 'b'])
    expect(ids(await readCache('w4'))).toEqual(['a', 'b'])
  })
})
