import { describe, expect, it } from 'vitest'

import { defaultRepoFilters, pickRows, repoRows, toggleStatus, WEEKS } from '@/lib/repos'
import type { Item, Repo } from '@/types'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const DAY = 86_400_000
const at = (days: number) => new Date(NOW - days * DAY).toISOString()

function repo(name: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id: name,
    owner: 'acme',
    ownerAvatar: '',
    name,
    fullName: `acme/${name}`,
    description: null,
    language: null,
    isPrivate: false,
    isArchived: false,
    pushedAt: null,
    openIssues: 0,
    openPrs: 0,
    issues: 0,
    prs: 0,
    ...overrides,
  }
}

function item(id: string, repoId: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'issue',
    repoId,
    number: 1,
    title: id,
    url: '',
    state: 'open',
    notPlanned: false,
    author: null,
    assignees: [],
    labels: [],
    comments: 0,
    createdAt: at(1),
    updatedAt: at(1),
    review: null,
    checks: null,
    ...overrides,
  }
}

const pr = (id: string, repoId: string, overrides: Partial<Item> = {}) =>
  item(id, repoId, { kind: 'pr', review: 'pending', checks: 'success', ...overrides })

describe('repoRows', () => {
  const [web] = repoRows(
    [repo('web', { pushedAt: at(3) })],
    [
      pr('waiting', 'web', { createdAt: at(2), updatedAt: at(2) }),
      pr('failing', 'web', { review: 'approved', checks: 'failure', createdAt: at(9), updatedAt: at(9) }),
      pr('draft', 'web', { review: 'draft', createdAt: at(400), updatedAt: at(400) }),
      pr('merged', 'web', { state: 'merged', checks: 'failure', createdAt: at(30), updatedAt: at(0.5) }),
      item('issue', 'web', { createdAt: at(8), updatedAt: at(5) }),
      item('elsewhere', 'other'),
    ],
    NOW,
  )

  it('counts open pull requests waiting for a review or failing their checks', () => {
    expect(web.awaiting).toBe(1)
    expect(web.failing).toBe(1)
  })

  it('takes the last push or the last change, whichever is later', () => {
    expect(web.activeAt).toBe(NOW - 0.5 * DAY)
    expect(repoRows([repo('quiet', { pushedAt: at(3) })], [], NOW)[0].activeAt).toBe(NOW - 3 * DAY)
  })

  it('counts what was opened each week, oldest first, leaving out anything older', () => {
    expect(web.weeks).toHaveLength(WEEKS)
    expect(web.weeks.at(-1)).toBe(1)
    expect(web.weeks.at(-2)).toBe(2)
    expect(web.weeks.at(-5)).toBe(1)
    expect(web.weeks.reduce((sum, n) => sum + n, 0)).toBe(4)
  })
})

const closed = (id: string, repoId: string, kind: Item['kind'], days: number) =>
  item(id, repoId, { kind, state: kind === 'pr' ? 'merged' : 'closed', createdAt: at(days), updatedAt: at(days) })

describe('repoRows while loading', () => {
  const rows = repoRows(
    [
      repo('web', { openIssues: 1, openPrs: 1 }),
      repo('quiet', { openIssues: 0, openPrs: 0 }),
      repo('issues', { openIssues: 2, openPrs: 0 }),
      repo('deep', { openPrs: 1 }),
      repo('recent', { openPrs: 1 }),
      repo('shallow', { openPrs: 1 }),
      repo('done', { openPrs: 1 }),
    ],
    [
      closed('c1', 'deep', 'issue', 10),
      closed('c2', 'deep', 'issue', 200),
      closed('c3', 'shallow', 'pr', 10),
      closed('c4', 'recent', 'issue', 10),
    ],
    NOW,
    {
      web: ['open', 'issues'],
      quiet: ['open'],
      issues: ['open'],
      deep: ['issues'],
      recent: ['issues'],
      shallow: ['pullRequests'],
    },
  )
  const row = (name: string) => rows.find((each) => each.repo.name === name)!

  it("doesn't know the counts of a repository whose open pull requests haven't loaded", () => {
    expect(row('web').countsLoading).toBe(true)
    expect(row('quiet').countsLoading).toBe(false)
    expect(row('issues').countsLoading).toBe(false)
    expect(row('deep').countsLoading).toBe(false)
  })

  it('fills the weeks once the open items are in and the closed history goes back past them', () => {
    expect(row('web').weeksLoading).toBe(true)
    expect(row('quiet').weeksLoading).toBe(false)
    expect(row('issues').weeksLoading).toBe(true)
    expect(row('deep').weeksLoading).toBe(false)
    expect(row('recent').weeksLoading).toBe(true)
    expect(row('shallow').weeksLoading).toBe(true)
    expect(row('done').weeksLoading).toBe(false)
  })
})

describe('pickRows', () => {
  const rows = repoRows(
    [
      repo('web', { description: 'الموقع العام', openIssues: 5, pushedAt: at(1) }),
      repo('api', { openIssues: 9, pushedAt: at(2) }),
      repo('old', { isArchived: true, pushedAt: at(300) }),
    ],
    [],
    NOW,
  )
  const names = (filters: Partial<ReturnType<typeof defaultRepoFilters>>) =>
    pickRows(rows, { ...defaultRepoFilters(), ...filters }).rows.map((row) => row.repo.name)

  it('shows active repositories by default, the most recently active first', () => {
    expect(names({})).toEqual(['web', 'api'])
    expect(names({ status: [] })).toEqual(['web', 'api', 'old'])
    expect(names({ status: ['archived'] })).toEqual(['old'])
  })

  it('sorts by name or by a count', () => {
    expect(names({ sort: 'name' })).toEqual(['api', 'web'])
    expect(names({ sort: 'issues' })).toEqual(['api', 'web'])
  })

  it('finds a repository by its name or its description, in any Arabic spelling', () => {
    expect(names({ q: 'API' })).toEqual(['api'])
    expect(names({ q: 'الموقع العام' })).toEqual(['web'])
    expect(names({ q: 'الموقع العامة' })).toEqual([])
    expect(names({ q: 'اَلْمَوْقِع' })).toEqual(['web'])
  })

  it('counts what the search finds in each status, whichever is picked', () => {
    expect(pickRows(rows, { ...defaultRepoFilters(), q: 'o' }).counts).toEqual({ active: 0, archived: 1 })
    expect(pickRows(rows, defaultRepoFilters()).counts).toEqual({ active: 2, archived: 1 })
  })
})

describe('toggleStatus', () => {
  it('treats both statuses picked as none picked', () => {
    const filters = defaultRepoFilters()
    toggleStatus(filters, 'archived')
    expect(filters.status).toEqual([])
    toggleStatus(filters, 'archived')
    expect(filters.status).toEqual(['archived'])
    toggleStatus(filters, 'archived')
    expect(filters.status).toEqual([])
  })
})
