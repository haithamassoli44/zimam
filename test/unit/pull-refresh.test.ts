import { flushPromises } from '@vue/test-utils'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerRef } from 'vue'

import type { Changes } from '@/lib/changes'
import type { GitHub } from '@/lib/github'
import type { Pull } from '@/lib/pull'
import { client, items } from '@/stores/data'
import { pull, refreshPull, runs, shownFiles } from '@/stores/pull'
import { openPull } from '@/stores/view'
import type { Item } from '@/types'

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
  changeReads: [] as string[],
}))
vi.mock('@/lib/pull', async (original) => ({
  ...(await original<typeof import('@/lib/pull')>()),
  readPull: async (_gh: unknown, _ref: unknown, onHeads?: (heads: Pull) => void) => {
    const next = github.pulls[Math.min(github.pullReads++, github.pulls.length - 1)]
    onHeads?.(next)
    return next
  },
}))
vi.mock('@/lib/changes', async (original) => ({
  ...(await original<typeof import('@/lib/changes')>()),
  readChanges: async (_gh: unknown, heads: Pull) => {
    github.changeReads.push(heads.headOid)
    await github.hold
    await github.holds.get(heads.headOid)
    return { changes: github.changes.get(heads.headOid)!, attributes: null }
  },
  readTexts: async (_gh: unknown, _repo: string, at: string[]) =>
    at.map(() => ({ content: { text: 'a\n' }, version: 'v' })),
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
  openPull.value = null
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
  JSON.parse(localStorage.getItem('zimam:seen:') ?? '{}')['acme/web#1'] as { head: string } | undefined

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

  it('waits for a tab out of sight to be back before reading again, and counts no visit meanwhile', async () => {
    await opened(pullAt('h1'), pullAt('h2', { updatedAt: '2026-11-25T10:05:00Z' }))
    items.value.set('P1', listItem('2026-11-25T10:00:00Z'))
    triggerRef(items)
    await flushPromises()
    setSight('hidden')
    try {
      items.value.set('P1', listItem('2026-11-25T10:05:00Z'))
      triggerRef(items)
      await flushPromises()
      expect(github.pullReads).toBe(1)
      // Read again while out of sight, as a refresh can be, it isn't a visit.
      await refreshPull()
      expect(pull.value?.headOid).toBe('h2')
      expect(seenOf()?.head).toBe('h1')
    } finally {
      setSight('visible')
    }
    await flushPromises()
    expect(github.pullReads).toBe(3)
  })
})
