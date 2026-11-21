import { describe, expect, it } from 'vitest'

import { applyFilters, defaultFilters, fromQuery, NONE, toQuery, type Context } from '@/lib/filters'
import type { Item, Repo } from '@/types'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const DAY = 86_400_000

function repo(id: string, isArchived = false): Repo {
  return {
    id,
    owner: id === 'mine' ? 'ali' : 'acme',
    ownerAvatar: '',
    name: id,
    fullName: `acme/${id}`,
    isArchived,
    openIssues: 0,
    openPrs: 0,
    issues: 0,
    prs: 0,
  }
}

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
    author: { login: 'ali', avatarUrl: '' },
    assignees: [],
    labels: [],
    comments: 0,
    createdAt: new Date(NOW - DAY).toISOString(),
    updatedAt: new Date(NOW - DAY).toISOString(),
    review: null,
    checks: null,
    ...overrides,
  }
}

const ctx: Context = {
  repos: new Map([
    ['web', repo('web')],
    ['old', repo('old', true)],
  ]),
  now: NOW,
}

describe('toQuery and fromQuery', () => {
  it('leaves defaults out of the URL', () => {
    expect(toQuery(defaultFilters())).toBe('')
  })

  it('writes an emptied list as an empty value, so it differs from the default', () => {
    const filters = { ...defaultFilters(), state: [] }
    expect(toQuery(filters)).toBe('state=')
    expect(fromQuery('state=').state).toEqual([])
  })

  it('round-trips every filter', () => {
    const filters = {
      ...defaultFilters(),
      kind: ['pr' as const],
      label: [NONE, 'bug'],
      updated: ['week' as const],
      q: 'release',
      sort: 'comments' as const,
    }
    expect(fromQuery(toQuery(filters))).toEqual(filters)
  })

  it('drops a list that picks every value only where every item has one', () => {
    const all = { ...defaultFilters(), state: ['open' as const, 'closed' as const, 'merged' as const] }
    expect(toQuery(all)).toBe('state=')
    const reviews = {
      ...defaultFilters(),
      review: ['draft' as const, 'pending' as const, 'approved' as const, 'changes' as const],
    }
    expect(fromQuery(toQuery(reviews)).review).toHaveLength(4)
  })

  it('writes the same query whatever order values were picked in', () => {
    const a = toQuery({ ...defaultFilters(), label: ['a', 'b'] })
    const b = toQuery({ ...defaultFilters(), label: ['b', 'a'] })
    expect(a).toBe(b)
  })

  it('ignores values a facet never takes, and unknown sorts', () => {
    const filters = fromQuery('sort=nope&updated=never&kind=epic&kind=pr')
    expect(filters.sort).toBe('updated')
    expect(filters.updated).toEqual([])
    expect(filters.kind).toEqual(['pr'])
  })

  it('reads the views saved before every filter became a list', () => {
    expect(fromQuery('updated=stale&sort=quiet')).toMatchObject({ updated: ['stale'], sort: 'quiet' })
    expect(toQuery(fromQuery('updated=stale&sort=quiet'))).toBe('updated=stale&sort=quiet')
  })
})

describe('applyFilters', () => {
  const items = [
    item('issue', { labels: [{ name: 'bug', color: 'ff0000' }] }),
    item('pr', { kind: 'pr', review: 'pending' }),
    item('closed', { state: 'closed' }),
    item('archived', { repoId: 'old' }),
  ]

  it('shows open items in active repositories by default', () => {
    expect(applyFilters(items, defaultFilters(), ctx).items.map((i) => i.id)).toEqual(['issue', 'pr'])
  })

  it('counts each value as if it were picked, ignoring its own facet', () => {
    const { items: shown, counts } = applyFilters(items, { ...defaultFilters(), kind: ['issue'] }, ctx)
    expect(shown.map((i) => i.id)).toEqual(['issue'])
    expect(counts.kind.get('pr')).toBe(1)
    expect(counts.state.get('closed')).toBe(1)
    expect(counts.status.get('archived')).toBe(1)
  })

  it('matches items without labels with the "no label" value', () => {
    const { items: shown } = applyFilters(items, { ...defaultFilters(), label: [NONE] }, ctx)
    expect(shown.map((i) => i.id)).toEqual(['pr'])
  })

  it('leaves issues out when a pull-request-only filter is set', () => {
    const { items: shown } = applyFilters(items, { ...defaultFilters(), review: ['pending'] }, ctx)
    expect(shown.map((i) => i.id)).toEqual(['pr'])
  })

  it('counts each time range an item falls in', () => {
    const { counts } = applyFilters(items, defaultFilters(), ctx)
    expect(counts.updated.get('week')).toBe(2)
    expect(counts.updated.has('stale')).toBe(false)
  })

  it('keeps the items of the picked accounts', () => {
    const repos = new Map([...ctx.repos, ['mine', repo('mine')]])
    const mine = item('mine', { repoId: 'mine' })
    const { items: shown, counts } = applyFilters(
      [...items, mine],
      { ...defaultFilters(), owner: ['ali'] },
      { ...ctx, repos },
    )
    expect(shown.map((i) => i.id)).toEqual(['mine'])
    expect(counts.owner.get('acme')).toBe(2)
  })

  it('finds items that have been quiet for months', () => {
    const quiet = item('quiet', { updatedAt: new Date(NOW - 120 * DAY).toISOString() })
    const { items: shown } = applyFilters([...items, quiet], { ...defaultFilters(), updated: ['stale'] }, ctx)
    expect(shown.map((i) => i.id)).toEqual(['quiet'])
  })

  it('searches titles, numbers and repositories', () => {
    const found = applyFilters(
      [item('a', { title: 'Fix login', number: 42 })],
      { ...defaultFilters(), q: '#42 acme/web' },
      ctx,
    )
    expect(found.items).toHaveLength(1)
  })
})
