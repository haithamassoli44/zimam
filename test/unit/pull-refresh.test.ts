import { flushPromises } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerRef } from 'vue'

import type { Changes } from '@/lib/changes'
import type { GitHub } from '@/lib/github'
import type { Pull } from '@/lib/pull'
import { client, items, repos, status } from '@/stores/data'
import { filesState, pull, refreshPull, runs, shownFiles } from '@/stores/pull'
import { openPull, pullScope } from '@/stores/view'
import type { Item, Repo } from '@/types'

// GitHub as the pull request page reads it: the pull request, what it changed, and its files' texts.
const github = vi.hoisted(() => ({
  pulls: [] as Pull[],
  changes: new Map<string, Changes>(),
  // A read of what changed, held until let go, to look at the page meanwhile: any of them, or one head's.
  hold: null as Promise<void> | null,
  holds: new Map<string, Promise<void>>(),
  // The checks of each head, held the same way.
  runHolds: new Map<string, Promise<void>>(),
  pullReads: 0,
  // How many reads of the pull request fail, from the next one, and a read of it held until let go.
  pullFails: 0,
  pullHold: null as Promise<void> | null,
  changeReads: [] as string[],
  // The reads of what changed that fail, by head, or by the run of commits they're of.
  failing: new Set<string>(),
  // What runs of commits changed, by `base..head`, and the files' texts by `commit:path`, some held until let go.
  ranges: new Map<string, Changes['files']>(),
  texts: new Map<string, string>(),
  textHolds: new Map<string, Promise<void>>(),
}))
vi.mock('@/lib/pull', async (original) => ({
  ...(await original<typeof import('@/lib/pull')>()),
  readPull: async (_gh: unknown, _ref: unknown, onHeads?: (heads: Pull) => void) => {
    if (github.pullFails > 0) {
      github.pullFails--
      github.pullReads++
      throw new Error('network')
    }
    const next = github.pulls[Math.min(github.pullReads++, github.pulls.length - 1)]
    onHeads?.(next)
    await github.pullHold
    return next
  },
}))
vi.mock('@/lib/changes', async (original) => ({
  ...(await original<typeof import('@/lib/changes')>()),
  readChanges: async (_gh: unknown, heads: Pull) => {
    github.changeReads.push(heads.headOid)
    await github.hold
    await github.holds.get(heads.headOid)
    if (github.failing.has(heads.headOid)) throw new Error('network')
    return { changes: github.changes.get(heads.headOid)!, attributes: null }
  },
  readRange: async (_gh: unknown, _repo: string, base: string, head: string) => {
    github.changeReads.push(`${base}..${head}`)
    if (github.failing.has(`${base}..${head}`)) throw new Error('network')
    return { mergeBase: base, files: github.ranges.get(`${base}..${head}`) ?? [file('one.ts')], capped: false }
  },
  readTexts: async (_gh: unknown, _repo: string, at: string[]) => {
    await Promise.all(at.map((each) => github.textHolds.get(each) ?? Promise.resolve()))
    return at.map((each) => ({ content: { text: github.texts.get(each) ?? 'a\n' }, version: 'v' }))
  },
  readVersions: async () => [],
}))
vi.mock('@/lib/checks', async (original) => ({
  ...(await original<typeof import('@/lib/checks')>()),
  readCheckRuns: async (_gh: unknown, read: Pull) => {
    await github.runHolds.get(read.headOid)
    return { total: 1, runs: [{ name: read.headOid, detail: null, state: 'success', url: null }] }
  },
}))

const REF = { repo: 'acme/web', number: 1 }

function pullAt(head: string, extra: Partial<Pull> = {}): Pull {
  return {
    id: 'P1',
    ref: REF,
    url: 'https://github.com/acme/web/pull/1',
    title: 'Add a thing',
    state: 'open',
    post: { id: 'post', url: '', author: null, role: null, createdAt: '', edited: false, html: '', hidden: null },
    mergedBy: null,
    mergedAt: null,
    updatedAt: '2026-11-25T10:00:00Z',
    base: 'main',
    head: 'thing',
    headOwner: 'acme',
    cross: false,
    baseOid: 'base',
    headOid: head,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    review: 'optional',
    merge: 'clean',
    behind: false,
    checks: null,
    labels: [],
    assignees: [],
    requested: [],
    verdicts: [],
    commits: [],
    commitCount: 1,
    files: [],
    entries: [],
    threads: [],
    cut: false,
    ...extra,
  }
}

const file = (path: string) => ({
  path,
  oldPath: null,
  status: 'added' as const,
  additions: 1,
  deletions: 0,
  blob: path,
})

// A file as a commit leaves it, changed, by its blob.
const modified = (blob: string) => ({ ...file('gen.ts'), status: 'modified' as const, blob })

const commit = (oid: string, parent: string) => ({
  oid,
  short: oid,
  headline: oid,
  body: '',
  parent,
  at: '2026-11-25T09:00:00Z',
  author: { name: '', login: null, avatarUrl: '' },
  checks: null,
})

function listItem(updatedAt: string, extra: Partial<Item> = {}): Item {
  return {
    id: 'P1',
    kind: 'pr',
    repoId: 'R1',
    number: 1,
    title: 'Add a thing',
    url: REF.repo,
    state: 'open',
    notPlanned: false,
    author: null,
    assignees: [],
    labels: [],
    comments: 0,
    createdAt: '2026-11-20T10:00:00Z',
    updatedAt,
    review: 'optional',
    checks: null,
    merge: 'clean',
    diff: { additions: 1, deletions: 0 },
    ...extra,
  }
}

async function opened(...pulls: Pull[]) {
  github.pulls = pulls
  github.pullReads = 0
  github.changeReads = []
  openPull.value = { ...REF }
  await flushPromises()
}

beforeEach(() => {
  // The repository the list's copy is in, by which it's found before the page says its id.
  repos.value = new Map([['R1', { id: 'R1', fullName: REF.repo } as Repo]])
  status.value.syncedAt = null
  github.ranges = new Map()
  github.texts = new Map()
  github.textHolds = new Map()
  github.pullFails = 0
  github.pullHold = null
  openPull.value = null
  pullScope.value = null
  github.failing = new Set()
  client.value = {} as GitHub
  items.value = new Map()
  github.hold = null
  github.holds = new Map()
  github.runHolds = new Map()
  github.changes = new Map([
    ['h1', { mergeBase: 'base', files: [file('one.ts')], capped: false }],
    ['h2', { mergeBase: 'base', files: [file('one.ts'), file('two.ts')], capped: false }],
  ])
})
afterAll(() => {
  openPull.value = null
})

// A promise and the way to settle it, for a read held until a test lets it go.
function held() {
  const gate: { open?: () => void; fail?: (error: Error) => void } = {}
  const promise = new Promise<void>((resolve, reject) => {
    gate.open = resolve
    gate.fail = reject
  })
  return { promise, open: () => gate.open?.(), fail: () => gate.fail?.(new Error('network')) }
}

const seenOf = () =>
  JSON.parse(localStorage.getItem('zimam:seen:') ?? '{}')['acme/web#1'] as
    | { head: string; ticked: Record<string, string[]> }
    | undefined

// What a sync brings: the list's copy of the pull request.
function listed(updatedAt: string, extra: Partial<Item> = {}) {
  items.value.set('P1', listItem(updatedAt, extra))
  triggerRef(items)
}

function setSight(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('reading the open pull request again', () => {
  it('takes the new conversation without reading the same changes again', async () => {
    await opened(pullAt('h1'), pullAt('h1', { title: 'Add a better thing' }))
    expect(pull.value?.title).toBe('Add a thing')
    await refreshPull()
    expect(pull.value?.title).toBe('Add a better thing')
    expect(github.changeReads).toEqual(['h1'])
  })

  it('reads what a new head changed before showing it, so files never mix two heads', async () => {
    await opened(pullAt('h1'), pullAt('h2'))
    expect(shownFiles.value.map((shown) => shown.path)).toEqual(['one.ts'])
    const gate: { open?: () => void } = {}
    github.hold = new Promise((resolve) => (gate.open = resolve))
    const refreshing = refreshPull()
    await flushPromises()
    // Still the old head and its files while the new changes are read.
    expect(pull.value?.headOid).toBe('h1')
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([['one.ts', 'h1']])
    gate.open?.()
    await refreshing
    expect(pull.value?.headOid).toBe('h2')
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([
      ['one.ts', 'h2'],
      ['two.ts', 'h2'],
    ])
    expect(github.changeReads).toEqual(['h1', 'h2'])
  })

  it('reads it again when the list says it changed, but not for a change the page already has', async () => {
    await opened(pullAt('h1'), pullAt('h1', { title: 'Commented on', updatedAt: '2026-11-25T10:05:00Z' }))
    items.value.set('P1', listItem('2026-11-25T10:00:00Z'))
    triggerRef(items)
    await flushPromises()
    expect(github.pullReads).toBe(1)

    // A sync finds a new comment.
    items.value.set('P1', listItem('2026-11-25T10:05:00Z'))
    triggerRef(items)
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.title).toBe('Commented on')

    // Its checks finished, which doesn't change its update time.
    github.pulls.push(pullAt('h1', { updatedAt: '2026-11-25T10:05:00Z', checks: 'success' }))
    items.value.set('P1', listItem('2026-11-25T10:05:00Z', { checks: 'success' }))
    triggerRef(items)
    await flushPromises()
    expect(github.pullReads).toBe(3)
    expect(pull.value?.checks).toBe('success')

    // The same again, from another sync: the page has it already.
    items.value.set('P1', listItem('2026-11-25T10:05:00Z', { checks: 'success', comments: 0 }))
    triggerRef(items)
    await flushPromises()
    expect(github.pullReads).toBe(3)
  })

  it('reads once more after a read asked for while one is on its way', async () => {
    await opened(pullAt('h1'), pullAt('h1', { title: 'Second' }), pullAt('h1', { title: 'Third' }))
    const first = refreshPull()
    void refreshPull()
    await first
    expect(github.pullReads).toBe(3)
    expect(pull.value?.title).toBe('Third')
  })

  it("doesn't let a slow first read of the changes undo a refresh after a push", async () => {
    const first = held()
    github.holds.set('h1', first.promise)
    await opened(pullAt('h1'), pullAt('h2'))
    await refreshPull()
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([
      ['one.ts', 'h2'],
      ['two.ts', 'h2'],
    ])
    first.open()
    await flushPromises()
    expect(shownFiles.value.map((shown) => shown.path)).toEqual(['one.ts', 'two.ts'])
  })

  it("doesn't let a slow first read that fails undo a refresh after a push", async () => {
    const first = held()
    github.holds.set('h1', first.promise)
    await opened(pullAt('h1'), pullAt('h2'))
    await refreshPull()
    first.fail()
    await flushPromises()
    expect(shownFiles.value.map((shown) => shown.path)).toEqual(['one.ts', 'two.ts'])
  })

  it('reads again what a new head changed when reading it failed, though the head stays', async () => {
    await opened(pullAt('h1'), pullAt('h2'))
    github.failing.add('h2')
    await refreshPull()
    expect(pull.value?.headOid).toBe('h2')
    expect(filesState.value).toBe('failed')
    github.failing.delete('h2')
    await refreshPull()
    expect(filesState.value).toBe('ready')
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([
      ['one.ts', 'h2'],
      ['two.ts', 'h2'],
    ])
    // Once read, the same head's changes aren't read again.
    await refreshPull()
    expect(github.changeReads).toEqual(['h1', 'h2', 'h2'])
  })

  it('reads again what the commits shown changed when reading it failed', async () => {
    const commits = [commit('c1', 'base'), commit('c2', 'c1')]
    pullScope.value = { before: null, last: 'c2' }
    github.failing.add('c1..c2')
    await opened(pullAt('c2', { commits, commitCount: 2 }))
    expect(filesState.value).toBe('failed')
    github.failing.delete('c1..c2')
    await refreshPull()
    await flushPromises()
    expect(filesState.value).toBe('ready')
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([['one.ts', 'c2']])
  })

  it('shows a file a push takes the generated mark off, though the old text comes after', async () => {
    github.changes.set('h2', { mergeBase: 'base', files: [{ ...file('one.ts'), blob: 'one2' }], capped: false })
    github.texts.set('h1:one.ts', '// @generated\nexport const one = 1\n')
    github.texts.set('h2:one.ts', 'export const one = 2\n')
    await opened(pullAt('h1'), pullAt('h2'), pullAt('h1'), pullAt('h2'))
    expect(shownFiles.value).toEqual([])
    await refreshPull()
    await flushPromises()
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([['one.ts', 'h2']])

    // Back to the first head, its text still on its way as the second head comes again.
    const old = held()
    github.texts.set('h3:one.ts', '// @generated\n')
    github.changes.set('h3', github.changes.get('h1')!)
    github.pulls.splice(2, 1, pullAt('h3'))
    github.textHolds.set('h3:one.ts', old.promise)
    await refreshPull()
    await refreshPull()
    old.open()
    await flushPromises()
    expect(shownFiles.value.map((shown) => [shown.path, shown.at])).toEqual([['one.ts', 'h2']])
  })

  it('keeps a file its text marks generated hidden through a push that leaves it as it was', async () => {
    github.changes.set('h2', { mergeBase: 'base', files: [file('one.ts')], capped: false })
    github.texts.set('h1:one.ts', '// @generated\n')
    github.texts.set('h2:one.ts', '// @generated\n')
    await opened(pullAt('h1'), pullAt('h2'))
    expect(shownFiles.value).toEqual([])
    // The new head's text is slow to come.
    const slow = held()
    github.textHolds.set('h2:one.ts', slow.promise)
    await refreshPull()
    await flushPromises()
    expect(pull.value?.headOid).toBe('h2')
    expect(shownFiles.value).toEqual([])
    slow.open()
    await flushPromises()
    expect(shownFiles.value).toEqual([])
  })

  it("doesn't take a commit's generated mark for all the changes, nor miss it when its text was read already", async () => {
    const commits = [commit('c1', 'base'), commit('c2', 'c1'), commit('c3', 'c2')]
    github.changes.set('c3', { mergeBase: 'base', files: [modified('gen3')], capped: false })
    github.ranges.set('c1..c2', [modified('gen2')])
    github.ranges.set('c2..c3', [modified('gen3')])
    // The second commit marks the file generated; the third takes the mark off.
    github.texts.set('c2:gen.ts', '// @generated\n')
    github.texts.set('c3:gen.ts', 'export {}\n')
    // The third commit first, which reads the second's text as its old side.
    pullScope.value = { before: null, last: 'c3' }
    await opened(pullAt('c3', { commits, commitCount: 3 }))
    expect(shownFiles.value.map((shown) => shown.path)).toEqual(['gen.ts'])
    pullScope.value = { before: null, last: 'c2' }
    await flushPromises()
    expect(shownFiles.value).toEqual([])
    pullScope.value = null
    await flushPromises()
    expect(shownFiles.value.map((shown) => shown.path)).toEqual(['gen.ts'])
  })

  it("shows the newer head's checks when the older head's answer comes after", async () => {
    const first = held()
    github.runHolds.set('h1', first.promise)
    await opened(pullAt('h1', { checks: 'pending' }), pullAt('h2', { checks: 'success' }))
    await refreshPull()
    await flushPromises()
    expect(runs.value?.runs[0].name).toBe('h2')
    first.open()
    await flushPromises()
    expect(runs.value?.runs[0].name).toBe('h2')
  })

  it("keeps another tab's ticks when it records a visit before hearing of them", async () => {
    await opened(pullAt('h1'), pullAt('h2'))
    // Another tab ticks a file; this one isn't told yet.
    const all = JSON.parse(localStorage.getItem('zimam:seen:') ?? '{}')
    all['acme/web#1'].ticked = { 'one.ts': ['elsewhere'] }
    localStorage.setItem('zimam:seen:', JSON.stringify(all))
    await refreshPull()
    await flushPromises()
    expect(seenOf()).toMatchObject({ head: 'h2', ticked: { 'one.ts': ['elsewhere'] } })
  })

  it('waits for a tab out of sight to be back before reading again, and counts no visit meanwhile', async () => {
    await opened(
      pullAt('h1'),
      pullAt('h2', { updatedAt: '2026-11-25T10:05:00Z' }),
      pullAt('h3', { updatedAt: '2026-11-25T10:10:00Z' }),
    )
    listed('2026-11-25T10:00:00Z')
    await flushPromises()
    setSight('hidden')
    try {
      listed('2026-11-25T10:05:00Z')
      await flushPromises()
      expect(github.pullReads).toBe(1)
      // Read again while out of sight, as a refresh can be, it isn't a visit.
      await refreshPull()
      expect(pull.value?.headOid).toBe('h2')
      expect(seenOf()?.head).toBe('h1')
      listed('2026-11-25T10:10:00Z')
      await flushPromises()
      expect(github.pullReads).toBe(2)
    } finally {
      setSight('visible')
    }
    await flushPromises()
    expect(github.pullReads).toBe(3)
    expect(seenOf()?.head).toBe('h3')
  })

  it('reads it again when the first copy the list has is newer than the page', async () => {
    await opened(pullAt('h1'), pullAt('h1', { updatedAt: '2026-11-25T10:05:00Z' }))
    // The workspace's first sync brings the pull request after the page has it.
    listed('2026-11-25T10:05:00Z')
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.updatedAt).toBe('2026-11-25T10:05:00Z')
  })

  it('reads it again when the list has a newer copy by the time the page comes', async () => {
    const page = held()
    github.pullHold = page.promise
    await opened(pullAt('h1'), pullAt('h1', { updatedAt: '2026-11-25T10:05:00Z' }))
    expect(pull.value).toBeNull()
    listed('2026-11-25T10:05:00Z')
    await flushPromises()
    github.pullHold = null
    page.open()
    await flushPromises()
    expect(github.pullReads).toBe(2)
  })

  it("doesn't read it again on opening when only the list's copy is behind it", async () => {
    // The page comes with its checks done and its conflicts unknown for now; the list's copy, from a sync a few minutes
    // ago, still has the checks running, and keeps the last conflicts it knew.
    listed('2026-11-25T10:00:00Z', { checks: 'pending', merge: 'clean' })
    await opened(pullAt('h1', { checks: 'success', merge: null }))
    expect(github.pullReads).toBe(1)
    // The list catches up with the page: nothing to read.
    listed('2026-11-25T10:00:00Z', { checks: 'success', merge: 'clean' })
    await flushPromises()
    expect(github.pullReads).toBe(1)
    // The list has news the page doesn't: the checks run again.
    listed('2026-11-25T10:00:00Z', { checks: 'pending', merge: 'clean' })
    await flushPromises()
    expect(github.pullReads).toBe(2)
  })

  it('reads it again when the checks finish in the list while the page is being read', async () => {
    listed('2026-11-25T10:00:00Z', { checks: 'pending' })
    const page = held()
    github.pullHold = page.promise
    // GitHub answered "pending" when the read started; the read is slow (many pages).
    await opened(pullAt('h1', { checks: 'pending' }), pullAt('h1', { checks: 'success' }))
    // A sync lands meanwhile: the checks finished.
    listed('2026-11-25T10:00:00Z', { checks: 'success' })
    status.value.syncedAt = Date.now()
    await flushPromises()
    github.pullHold = null
    page.open()
    await flushPromises()
    // Page says pending, the list says success: it should read again.
    status.value.syncedAt = Date.now() + 60_000
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.checks).toBe('success')
  })

  it('reads it again when the checks finish in the list while a refresh is being read', async () => {
    listed('2026-11-25T10:00:00Z', { checks: 'success' })
    await opened(
      pullAt('h1', { checks: 'success' }),
      pullAt('h1', { checks: 'pending' }),
      pullAt('h1', { checks: 'success' }),
    )
    expect(github.pullReads).toBe(1)
    const page = held()
    github.pullHold = page.promise
    // The checks run again: the list says so, and the page is read again (GitHub answers pending).
    listed('2026-11-25T10:00:00Z', { checks: 'pending' })
    await flushPromises()
    expect(github.pullReads).toBe(2)
    // They finish before that read comes back, and a sync says so.
    listed('2026-11-25T10:00:00Z', { checks: 'success' })
    status.value.syncedAt = Date.now() + 1000
    await flushPromises()
    github.pullHold = null
    page.open()
    await flushPromises()
    status.value.syncedAt = Date.now() + 61_000
    await flushPromises()
    expect(github.pullReads).toBe(3)
    expect(pull.value?.checks).toBe('success')
  })

  it("reads it again when the list's first copy, coming after the page, has the checks finished", async () => {
    // A fresh workspace: the page is read before the first sync brings the pull request.
    await opened(pullAt('h1', { checks: 'pending' }), pullAt('h1', { checks: 'success' }))
    expect(github.pullReads).toBe(1)
    // The first sync, minutes later, brings it with its checks done (a finished run doesn't change updatedAt).
    listed('2026-11-25T10:00:00Z', { checks: 'success' })
    status.value.syncedAt = Date.now() + 120_000
    await flushPromises()
    status.value.syncedAt = Date.now() + 180_000
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.checks).toBe('success')
  })

  it('tries again after the next sync when reading it again failed, but only then', async () => {
    await opened(pullAt('h1'), pullAt('h1', { updatedAt: '2026-11-25T10:05:00Z' }))
    listed('2026-11-25T10:00:00Z')
    await flushPromises()
    github.pullFails = 1
    listed('2026-11-25T10:05:00Z')
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.updatedAt).toBe('2026-11-25T10:00:00Z')
    // The next sync brings the same copy.
    status.value.syncedAt = Date.now()
    await flushPromises()
    expect(github.pullReads).toBe(3)
    expect(pull.value?.updatedAt).toBe('2026-11-25T10:05:00Z')
    status.value.syncedAt = Date.now() + 60_000
    await flushPromises()
    expect(github.pullReads).toBe(3)
  })

  it("doesn't read it again after each sync when GitHub's pull request lags behind its list", async () => {
    await opened(pullAt('h1'))
    listed('2026-11-25T10:05:00Z')
    await flushPromises()
    expect(github.pullReads).toBe(2)
    expect(pull.value?.updatedAt).toBe('2026-11-25T10:00:00Z')
    status.value.syncedAt = Date.now() + 120_000
    await flushPromises()
    expect(github.pullReads).toBe(2)
  })
})
