import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GitHubError, type GitHub } from '@/lib/github'
import { ORG_REPOS, REVIEW_REQUESTED, SEARCH, type RawItem, type RawRepo } from '@/lib/queries'
import { idleStatus, Syncer, type SyncStore } from '@/lib/sync'
import type { Workspace } from '@/types'

// Two tabs of one workspace share what the browser keeps: IndexedDB, which jsdom lacks, and localStorage.
Object.assign(globalThis, { indexedDB, IDBKeyRange })

// A read of the cache can be held once it has read, as a big cache takes a while to come back.
const reads = vi.hoisted(() => ({ hold: null as Promise<void> | null, reached: null as (() => void) | null }))
vi.mock('@/lib/cache', async (original) => {
  const cache = await original<typeof import('@/lib/cache')>()
  return {
    ...cache,
    readCache: async (...args: Parameters<typeof cache.readCache>) => {
      const read = await cache.readCache(...args)
      const hold = reads.hold
      if (hold && args[1] !== false) {
        reads.hold = null
        reads.reached?.()
        await hold
      }
      return read
    },
  }
})

const ws: Workspace = {
  id: 'tabs',
  name: 'acme',
  token: 't',
  sources: [{ kind: 'org', name: 'acme' }],
  views: [],
  pinned: [],
}

const issue = (id: string, state: RawItem['state']): RawItem => ({
  kind: 'Issue',
  id,
  number: Number(id.slice(1)),
  title: id,
  url: '',
  state,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-02T00:00:00Z',
  author: null,
  assignees: { nodes: [] },
  labels: { nodes: [] },
  comments: { totalCount: 0 },
  repository: { id: 'R1' },
})

const repo: RawRepo = {
  id: 'R1',
  name: 'web',
  nameWithOwner: 'acme/web',
  description: null,
  isPrivate: false,
  isArchived: false,
  pushedAt: null,
  owner: { login: 'acme', avatarUrl: '' },
  primaryLanguage: null,
  openIssues: { totalCount: 2 },
  openPrs: { totalCount: 0 },
  allIssues: { totalCount: 4 },
  allPrs: { totalCount: 0 },
}

const page = (nodes: unknown[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes })

/** A GitHub with two open and two closed issues, whose closed ones wait for `closed` to let them through. */
function gitHub(closed: Promise<void>, asked: () => void): GitHub {
  const query = async <T>(text: string, variables: Record<string, unknown> = {}): Promise<T> => {
    if (text === ORG_REPOS) return { organization: { repositories: page([repo]) } } as T
    if (text === REVIEW_REQUESTED) return { viewer: { login: 'ali' }, search: page([]) } as T
    const states = variables.states as string[]
    if (states.includes('OPEN'))
      return { repository: { issues: page([issue('I1', 'OPEN'), issue('I2', 'OPEN')]) } } as T
    asked()
    await closed
    return { repository: { issues: page([issue('I3', 'CLOSED'), issue('I4', 'CLOSED')]) } } as T
  }
  return {
    query,
    request: async (text, variables) => ({ data: await query(text, variables), errors: [] }),
    probe: async () => 'same',
    rest: () => Promise.reject(new Error('unused')),
    scopes: () => ['repo'],
    rate: () => null,
  }
}

// A tab that can't reach GitHub just now: all it has is what the other tab saves.
const waiting: GitHub = {
  query: () => Promise.reject(new GitHubError('Rate limited', 'rate', Date.now() + 60_000)),
  request: () => Promise.reject(new GitHubError('Rate limited', 'rate', Date.now() + 60_000)),
  probe: async () => 'failed',
  rest: () => Promise.reject(new Error('unused')),
  scopes: () => null,
  rate: () => null,
}

const storeOf = (): SyncStore => ({
  repos: new Map(),
  items: new Map(),
  me: { login: null, requested: new Set() },
  changed: () => {},
})

// The tab comes in or out of sight.
function sight(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

// A tab's GitHub, for the race below: the open and closed issues, and what its next search finds.
const world = (found: RawItem[]): GitHub => {
  const query = async <T>(text: string, variables: Record<string, unknown> = {}): Promise<T> => {
    if (text === ORG_REPOS) return { organization: { repositories: page([repo]) } } as T
    if (text === REVIEW_REQUESTED) return { viewer: { login: 'ali' }, search: page([]) } as T
    if (text === SEARCH) return { search: { issueCount: found.length, ...page(found) } } as T
    const states = variables.states as string[] | undefined
    if (!states) return { nodes: [] } as T
    const open = [issue('I1', 'OPEN'), issue('I2', 'OPEN')]
    return {
      repository: { issues: page(states.includes('OPEN') ? open : [issue('I3', 'CLOSED'), issue('I4', 'CLOSED')]) },
    } as T
  }
  return {
    query,
    request: async (text, variables) => ({ data: await query(text, variables), errors: [] }),
    probe: async () => 'same',
    rest: () => Promise.reject(new Error('unused')),
    scopes: () => ['repo'],
    rate: () => null,
  }
}
const changedNow = (id: string) => ({ ...issue(id, 'OPEN'), updatedAt: new Date().toISOString() })

const syncers: Syncer[] = []
afterEach(() => {
  for (const syncer of syncers.splice(0)) syncer.stop()
  vi.restoreAllMocks()
})

describe('two tabs of a workspace', () => {
  it('shows in one tab the closed history another loads after its sync', async () => {
    const gates: { letThrough?: () => void; reached?: () => void } = {}
    const closed = new Promise<void>((resolve) => (gates.letThrough = resolve))
    const historyAsked = new Promise<void>((resolve) => (gates.reached = resolve))

    // The first tab syncs: it saves the open items, then starts on the closed ones.
    const first = await Syncer.open(
      ws,
      gitHub(closed, () => gates.reached?.()),
      storeOf(),
      idleStatus(),
    )
    syncers.push(first)
    const firstSynced = first.start()
    await historyAsked

    // The second tab opens meanwhile, and shows what the first saved.
    const store = storeOf()
    const second = await Syncer.open(ws, waiting, store, idleStatus())
    syncers.push(second)
    await second.start()
    expect([...store.items.keys()].toSorted()).toEqual(['I1', 'I2'])

    // The first tab's history comes in and is saved after its sync.
    gates.letThrough?.()
    await firstSynced
    await vi.waitFor(() => expect([...store.items.keys()].toSorted()).toEqual(['I1', 'I2', 'I3', 'I4']))
  })

  it('waits for a tab out of sight to be back before taking in what another tab saved', async () => {
    const other = { ...ws, id: 'tabs-unseen' }
    const gates: { letThrough?: () => void; reached?: () => void } = {}
    const closed = new Promise<void>((resolve) => (gates.letThrough = resolve))
    const historyAsked = new Promise<void>((resolve) => (gates.reached = resolve))
    const first = await Syncer.open(
      other,
      gitHub(closed, () => gates.reached?.()),
      storeOf(),
      idleStatus(),
    )
    syncers.push(first)
    const firstSynced = first.start()
    await historyAsked
    const store = storeOf()
    const second = await Syncer.open(other, waiting, store, idleStatus())
    syncers.push(second)
    await second.start()

    sight('hidden')
    try {
      gates.letThrough?.()
      await firstSynced
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(store.items.size).toBe(2)
    } finally {
      sight('visible')
    }
    await vi.waitFor(() => expect(store.items.size).toBe(4))
  })

  it('takes in what another tab saved in the same millisecond as its own save', async () => {
    const other = { ...ws, id: 'tabs-same-time' }
    // Every save, in either tab, happens at the same time.
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-25T12:00:00Z'))
    const gates: { letThrough?: () => void; reached?: () => void } = {}
    const closed = new Promise<void>((resolve) => (gates.letThrough = resolve))
    const historyAsked = new Promise<void>((resolve) => (gates.reached = resolve))
    const first = await Syncer.open(
      other,
      gitHub(closed, () => gates.reached?.()),
      storeOf(),
      idleStatus(),
    )
    syncers.push(first)
    const firstSynced = first.start()
    await historyAsked
    const store = storeOf()
    const second = await Syncer.open(other, waiting, store, idleStatus())
    syncers.push(second)
    await second.start()
    gates.letThrough?.()
    await firstSynced
    await vi.waitFor(() => expect(store.items.size).toBe(4))
  })

  it("doesn't let what another tab saved undo what this tab synced while it was read", async () => {
    const other = { ...ws, id: 'tabs-race' }
    const firstFinds: RawItem[] = []
    const secondFinds: RawItem[] = []
    const first = await Syncer.open(other, world(firstFinds), storeOf(), idleStatus())
    syncers.push(first)
    await first.start()
    const store = storeOf()
    const second = await Syncer.open(other, world(secondFinds), store, idleStatus())
    syncers.push(second)
    await second.start()

    // The first tab finds I8 and tells the second, whose read of it is slow to come back.
    const reached = new Promise<void>((resolve) => (reads.reached = resolve))
    const gate: { open?: () => void } = {}
    reads.hold = new Promise<void>((resolve) => (gate.open = resolve))
    firstFinds.push(changedNow('I8'))
    await first.sync(true)
    await reached
    // Meanwhile the second tab syncs and finds I9.
    secondFinds.push(changedNow('I9'))
    const synced = second.sync(true)
    await new Promise((resolve) => setTimeout(resolve, 50))
    gate.open?.()
    await synced
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect([...store.items.keys()].toSorted()).toEqual(['I1', 'I2', 'I3', 'I4', 'I8', 'I9'])
  })
})
