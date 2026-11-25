import { describe, expect, it } from 'vitest'

import { arrange, defaultRepoFilters, findRepos, pickRows, repoRows, toggleStatus, WEEKS } from '@/lib/repos'
import type { Left } from '@/lib/sync'
import { noOne, type Item, type Repo } from '@/types'

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
    merge: null,
    diff: null,
    ...overrides,
  }
}

const pr = (id: string, repoId: string, overrides: Partial<Item> = {}) =>
  item(id, repoId, { kind: 'pr', review: 'required', checks: 'success', merge: 'clean', ...overrides })

// The repositories as a workspace holds them, counted at NOW unless said otherwise.
const rowsOf = (repos: Repo[], items: Item[], now = NOW, left: Record<string, Left[]> = {}) =>
  repoRows(items, { repos: new Map(repos.map((each) => [each.id, each])), now, me: noOne() }, left)

describe('repoRows', () => {
  const [web] = rowsOf(
    [repo('web', { pushedAt: at(3) })],
    [
      pr('waiting', 'web', { createdAt: at(2), updatedAt: at(2) }),
      pr('failing', 'web', { review: 'approved', checks: 'failure', createdAt: at(9), updatedAt: at(9) }),
      pr('draft', 'web', { review: 'draft', merge: 'conflicts', createdAt: at(400), updatedAt: at(400) }),
      pr('optional', 'web', { review: 'optional', merge: null, createdAt: at(400), updatedAt: at(400) }),
      pr('merged', 'web', {
        state: 'merged',
        checks: 'failure',
        merge: 'conflicts',
        createdAt: at(30),
        updatedAt: at(0.5),
      }),
      item('issue', 'web', { createdAt: at(8), updatedAt: at(5) }),
      item('elsewhere', 'other'),
    ],
    NOW,
  )

  it('counts open pull requests waiting for a review, failing their checks or conflicting', () => {
    expect(web.counts).toMatchObject({ awaiting: 1, failing: 1, conflicts: 1 })
  })

  it("takes open issues and pull requests from GitHub's totals while they load, and counts archived repositories too", () => {
    const repos = [repo('old', { isArchived: true, openIssues: 7, openPrs: 3 })]
    const found = [pr('waiting', 'old'), pr('closed', 'old', { state: 'closed' })]
    const [loading] = rowsOf(repos, found, NOW, { old: ['open'] })
    expect(loading.counts).toEqual({ issues: 7, prs: 3, awaiting: 1, failing: 0, conflicts: 0 })
    const [loaded] = rowsOf(repos, found, NOW)
    expect(loaded.counts).toEqual({ issues: 0, prs: 1, awaiting: 1, failing: 0, conflicts: 0 })
  })

  it('counts an issue opened since GitHub last gave its totals', () => {
    // GitHub's totals are read every 15 minutes or so; the issue came with the last search.
    const [quiet] = rowsOf([repo('quiet', { openIssues: 0 })], [item('new', 'quiet')], NOW)
    expect(quiet.counts.issues).toBe(1)
  })

  it('takes the last push or the last change, whichever is later', () => {
    expect(web.activeAt).toBe(NOW - 0.5 * DAY)
    expect(rowsOf([repo('quiet', { pushedAt: at(3) })], [], NOW)[0].activeAt).toBe(NOW - 3 * DAY)
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
  const rows = rowsOf(
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
  const rows = rowsOf(
    [
      repo('web', { description: 'الموقع العام', openIssues: 5, pushedAt: at(1) }),
      repo('api', { openIssues: 9, pushedAt: at(2) }),
      repo('old', { isArchived: true, pushedAt: at(300) }),
    ],
    [
      item('w1', 'web', { createdAt: at(400), updatedAt: at(400) }),
      item('a1', 'api', { createdAt: at(400), updatedAt: at(400) }),
      item('a2', 'api', { createdAt: at(400), updatedAt: at(400) }),
    ],
    NOW,
  )
  const names = (filters: Partial<ReturnType<typeof defaultRepoFilters>>, pinned: string[] = []) => {
    const picked = pickRows(rows, { ...defaultRepoFilters(), ...filters }, pinned)
    return [...picked.pinned, ...picked.rest].map((row) => row.repo.name)
  }

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

  it('puts pinned repositories first in their own order, whatever the sort', () => {
    expect(names({}, ['api', 'web'])).toEqual(['api', 'web'])
    expect(names({ sort: 'name' }, ['web'])).toEqual(['web', 'api'])
    const picked = pickRows(rows, { ...defaultRepoFilters(), status: [] }, ['old', 'gone', 'web'])
    expect(picked.pinned.map((row) => row.repo.name)).toEqual(['old', 'web'])
    expect(picked.rest.map((row) => row.repo.name)).toEqual(['api'])
  })

  it('keeps pinned repositories to what the search and statuses show', () => {
    expect(names({ q: 'api' }, ['web', 'api'])).toEqual(['api'])
    expect(pickRows(rows, defaultRepoFilters(), ['old']).pinned).toEqual([])
  })

  it('counts what the search finds in each status, whichever is picked', () => {
    expect(pickRows(rows, { ...defaultRepoFilters(), q: 'o' }).counts).toEqual({ active: 0, archived: 1 })
    expect(pickRows(rows, defaultRepoFilters()).counts).toEqual({ active: 2, archived: 1 })
  })
})

describe('findRepos', () => {
  it('searches what the list shows of each repository, and counts what it finds by status', () => {
    const all = [
      repo('web', { description: 'The site' }),
      repo('site-old', { isArchived: true }),
      repo('api', { description: 'Serves the site' }),
    ]
    const byName = findRepos(
      all,
      (each) => each,
      { q: 'site', status: ['active'] },
      (each) => each.name,
    )
    expect(byName.kept).toEqual([])
    expect(byName.counts).toEqual({ active: 0, archived: 1 })
    const byAll = findRepos(
      all,
      (each) => each,
      { q: 'site', status: [] },
      (each) => `${each.name} ${each.description}`,
    )
    expect(byAll.kept.map((each) => each.name)).toEqual(['web', 'site-old', 'api'])
  })
})

describe('arrange', () => {
  it('puts the pinned repositories shown in the new order', () => {
    expect(arrange(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b'])
  })

  it('keeps the places of those a search hides', () => {
    expect(arrange(['a', 'b', 'c', 'd'], ['d', 'a', 'c'])).toEqual(['d', 'b', 'a', 'c'])
  })
})

describe('toggleStatus', () => {
  it('switches between the two statuses, and unpicks the one picked', () => {
    const filters = defaultRepoFilters()
    toggleStatus(filters, 'archived')
    expect(filters.status).toEqual(['archived'])
    toggleStatus(filters, 'active')
    expect(filters.status).toEqual(['active'])
    toggleStatus(filters, 'active')
    expect(filters.status).toEqual([])
    toggleStatus(filters, 'archived')
    expect(filters.status).toEqual(['archived'])
  })
})
