import { describe, expect, it } from 'vitest'

import { applyFilters, defaultFilters, fromQuery, NONE, parseSearch, toQuery, type Context } from '@/lib/filters'
import { noOne, type Item, type Repo } from '@/types'

const NOW = Date.parse('2026-11-21T12:00:00Z')
const DAY = 86_400_000

function repo(id: string, isArchived = false): Repo {
  return {
    id,
    owner: id === 'mine' ? 'ali' : 'acme',
    ownerAvatar: '',
    name: id,
    fullName: `acme/${id}`,
    description: null,
    language: null,
    isPrivate: false,
    isArchived,
    pushedAt: null,
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
    merge: null,
    diff: null,
    ...overrides,
  }
}

const ctx: Context = {
  repos: new Map([
    ['web', repo('web')],
    ['old', repo('old', true)],
  ]),
  now: NOW,
  me: noOne(),
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
      review: ['draft' as const, 'required' as const, 'optional' as const, 'approved' as const, 'changes' as const],
    }
    expect(fromQuery(toQuery(reviews)).review).toHaveLength(5)
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
    item('pr', { kind: 'pr', review: 'required' }),
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
    const { items: shown } = applyFilters(items, { ...defaultFilters(), review: ['required'] }, ctx)
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

describe('typed filters', () => {
  const me = { login: 'Ali', requested: new Set(['asks']) }
  const context: Context = { ...ctx, me }
  const items = [
    item('bug', { author: { login: 'renovate', avatarUrl: '' }, labels: [{ name: 'bug', color: '' }] }),
    item('docs', {
      labels: [
        { name: 'Good first issue', color: '' },
        { name: 'docs', color: '' },
      ],
    }),
    item('mine', { assignees: [{ login: 'ali', avatarUrl: '' }] }),
    item('asks', { kind: 'pr', review: 'required', author: { login: 'omar', avatarUrl: '' } }),
    item('draft', { kind: 'pr', review: 'draft', merge: 'conflicts', author: { login: 'omar', avatarUrl: '' } }),
    item('old', { repoId: 'old', state: 'closed' }),
  ]
  const ids = (q: string, filters = { ...defaultFilters(), state: [], status: [] }) =>
    applyFilters(items, { ...filters, q }, context).items.map((each) => each.id)

  it('keeps items with any of the values, and leaves out those with a minus', () => {
    expect(ids('label:bug,docs')).toEqual(['bug', 'docs'])
    expect(ids('-author:renovate -author:omar')).toEqual(['docs', 'mine', 'old'])
    expect(ids('-label:bug -label:docs').toSorted()).toEqual(['asks', 'draft', 'mine', 'old'])
  })

  it('reads quoted values, any case, and words beside qualifiers', () => {
    expect(ids('label:"good first issue"')).toEqual(['docs'])
    expect(ids('LABEL:BUG')).toEqual(['bug'])
    expect(ids('docs is:issue')).toEqual(['docs'])
    expect(parseSearch('fix "two words" label:a').terms).toEqual(['fix', 'two words'])
  })

  it('matches a repository by its full name or its name alone, and accounts by org, user or owner', () => {
    expect(ids('repo:old')).toEqual(['old'])
    expect(ids('-repo:acme/web')).toEqual(['old'])
    expect(ids('org:acme').length).toBe(6)
    expect(ids('user:someone')).toEqual([])
  })

  it('understands is:, no: and @me', () => {
    expect(ids('is:closed')).toEqual(['old'])
    expect(ids('is:draft')).toEqual(['draft'])
    expect(ids('is:conflicting')).toEqual(['draft'])
    expect(ids('is:pr -is:draft')).toEqual(['asks'])
    expect(ids('is:archived')).toEqual(['old'])
    expect(ids('is:nonsense')).toEqual([])
    expect(ids('no:assignee is:pr')).toEqual(['asks', 'draft'])
    expect(ids('no:label').toSorted()).toEqual(['asks', 'draft', 'mine', 'old'])
    expect(ids('assignee:@me')).toEqual(['mine'])
  })

  it('takes unknown keys, links and numbers as words', () => {
    expect(parseSearch('http://x.y nope:value #42')).toEqual({
      terms: ['http://x.y', 'nope:value', '#42'],
      qualifiers: [],
    })
  })

  it("doesn't trip on words every object has, typed or in an address", () => {
    for (const q of ['constructor:x', 'is:constructor', 'no:constructor', 'review:constructor', '-toString:a'])
      expect(() => ids(q)).not.toThrow()
    expect(ids('is:constructor')).toEqual([])
    expect(fromQuery('review=constructor&review=hasOwnProperty').review).toEqual([])
  })

  it('takes involves:@me as anything that involves the person', () => {
    // Items opened by Ali by default, the one assigned to them and the one asking them for a review.
    expect(ids('involves:@me')).toEqual(['docs', 'mine', 'asks', 'old'])
    expect(ids('-involves:@me')).toEqual(['bug', 'draft'])
  })

  it('reads the old name of a review value', () => {
    expect(ids('review:pending')).toEqual(['asks'])
    expect(fromQuery('review=pending').review).toEqual(['required'])
  })

  it('narrows the counts as a search does', () => {
    const { counts } = applyFilters(items, { ...defaultFilters(), q: '-author:omar' }, context)
    expect(counts.kind.get('pr')).toBeUndefined()
    expect(counts.kind.get('issue')).toBe(3)
  })
})

describe('what involves me', () => {
  const me = { login: 'ali', requested: new Set(['asks', 'closed-ask']) }
  const items = [
    item('asks', { kind: 'pr', author: null }),
    item('closed-ask', { kind: 'pr', state: 'closed', author: null }),
    item('assigned', { assignees: [{ login: 'ALI', avatarUrl: '' }], author: null }),
    item('authored', { author: { login: 'ali', avatarUrl: '' } }),
    item('other', { author: { login: 'omar', avatarUrl: '' } }),
  ]
  const run = (picked: ('review' | 'assigned' | 'authored')[], login: string | null = 'ali') =>
    applyFilters(items, { ...defaultFilters(), state: [], me: picked }, { ...ctx, me: { ...me, login } })

  it('finds review requests, assignments and what the person opened', () => {
    expect(run(['review']).items.map((each) => each.id)).toEqual(['asks'])
    expect(run(['assigned']).items.map((each) => each.id)).toEqual(['assigned'])
    expect(run(['review', 'assigned', 'authored']).items.map((each) => each.id)).toEqual([
      'asks',
      'assigned',
      'authored',
    ])
  })

  it('finds nothing before the login is known', () => {
    expect(run(['authored'], null).items).toEqual([])
  })
})

const pr = (id: string, overrides: Partial<Item> = {}) =>
  item(id, { kind: 'pr', review: 'optional', checks: 'success', merge: 'clean', ...overrides })

describe('the ready to merge order', () => {
  it('puts approved and passing first, drafts and other items last', () => {
    const items = [
      item('issue'),
      pr('draft', { review: 'draft' }),
      pr('failing', { review: 'approved', checks: 'failure' }),
      pr('conflicts', { review: 'approved', merge: 'conflicts' }),
      pr('changes', { review: 'changes' }),
      pr('required', { review: 'required' }),
      pr('running', { review: 'approved', checks: 'pending' }),
      pr('waiting', { review: 'required', checks: 'pending' }),
      pr('optional', { checks: null }),
      pr('approved', { review: 'approved', merge: null }),
      pr('merged', { state: 'merged', review: 'approved' }),
    ]
    const sorted = applyFilters(items, { ...defaultFilters(), state: [], sort: 'ready' }, ctx).items
    expect(sorted.slice(0, 5).map((each) => each.id)).toEqual([
      'approved',
      'optional',
      'running',
      'waiting',
      'required',
    ])
    expect(sorted.at(-3)?.id).toBe('draft')
  })

  it('keeps the latest updated first among equals', () => {
    const items = [pr('older', { updatedAt: new Date(NOW - 2 * DAY).toISOString() }), pr('newer')]
    const sorted = applyFilters(items, { ...defaultFilters(), sort: 'ready' }, ctx).items
    expect(sorted.map((each) => each.id)).toEqual(['newer', 'older'])
  })
})
