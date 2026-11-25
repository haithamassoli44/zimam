import { describe, expect, it } from 'vitest'

import type { GitHub } from '@/lib/github'
import { CONTRIBUTED, type RawRepo } from '@/lib/queries'
import { defaultContributionFilters, pickContributions } from '@/lib/repos'
import { contributionsOf, OPENED_PAGES, type Contribution } from '@/lib/sources'
import type { Repo } from '@/types'

function raw(fullName: string, overrides: Partial<RawRepo> = {}): RawRepo {
  const [owner, name] = fullName.split('/')
  return {
    id: fullName,
    name,
    nameWithOwner: fullName,
    description: null,
    isPrivate: false,
    isArchived: false,
    pushedAt: null,
    owner: { login: owner, avatarUrl: '' },
    primaryLanguage: null,
    openIssues: { totalCount: 0 },
    openPrs: { totalCount: 0 },
    allIssues: { totalCount: 0 },
    allPrs: { totalCount: 0 },
    ...overrides,
  }
}

const nodes = (list: (RawRepo | null)[]) => ({ totalCount: list.length, nodes: list })

/** A GitHub that lists `recent` contributions by kind, and pages of what was opened, each page given in full. */
function github(
  recent: Record<string, (RawRepo | null)[]>,
  opened: Record<'pullRequests' | 'issues', { createdAt: string; repository: RawRepo | null }[][]>,
): GitHub & { asked: string[] } {
  const asked: string[] = []
  const gh = {
    asked,
    async query(text: string, variables: Record<string, unknown> = {}) {
      if (text === CONTRIBUTED) {
        asked.push('recent')
        return {
          user: Object.fromEntries(
            ['commit', 'pr', 'issue', 'review'].map((kind) => [kind, nodes(recent[kind] ?? [])]),
          ),
        }
      }
      const list = text.includes('list: pullRequests') ? 'pullRequests' : 'issues'
      const index = Number(variables.after ?? 0)
      asked.push(`${list}:${index}`)
      const pages = opened[list]
      const hasNextPage = index + 1 < pages.length
      return {
        user: {
          list: {
            pageInfo: { hasNextPage, endCursor: hasNextPage ? String(index + 1) : null },
            nodes: pages[index] ?? [],
          },
        },
      }
    },
  }
  return gh as unknown as GitHub & { asked: string[] }
}

describe('contributionsOf', () => {
  it('merges the recent contributions by kind with what was opened, by repository', async () => {
    const web = raw('acme/web')
    const api = raw('nuxt/api')
    const old = raw('old/tool')
    const gh = github(
      { commit: [web, null], pr: [web, api], review: [api] },
      {
        pullRequests: [
          [
            { createdAt: '2026-03-01T00:00:00Z', repository: api },
            { createdAt: '2026-05-01T00:00:00Z', repository: api },
            { createdAt: '2020-01-01T00:00:00Z', repository: old },
            { createdAt: '2026-01-01T00:00:00Z', repository: null },
          ],
        ],
        issues: [[{ createdAt: '2026-04-01T00:00:00Z', repository: web }]],
      },
    )
    const { contributions, partial } = await contributionsOf(gh, 'ali')
    expect(partial).toEqual([])
    const byName = Object.fromEntries(contributions.map((found) => [found.repo.fullName, found]))
    expect(Object.keys(byName).toSorted()).toEqual(['acme/web', 'nuxt/api', 'old/tool'])
    expect(byName['acme/web']).toMatchObject({
      kinds: ['commit', 'pr', 'issue'],
      prs: 0,
      issues: 1,
      lastAt: '2026-04-01T00:00:00Z',
    })
    expect(byName['nuxt/api']).toMatchObject({ kinds: ['pr', 'review'], prs: 2, lastAt: '2026-05-01T00:00:00Z' })
    expect(byName['old/tool']).toMatchObject({ kinds: ['pr'], prs: 1 })
  })

  it('stops after its pages of what was opened, and says the counts are partial', async () => {
    const web = raw('acme/web')
    const page = [{ createdAt: '2026-01-01T00:00:00Z', repository: web }]
    const gh = github({}, { pullRequests: Array.from({ length: OPENED_PAGES + 2 }, () => page), issues: [[]] })
    const { contributions, partial } = await contributionsOf(gh, 'ali')
    expect(partial).toEqual(['pr'])
    expect(contributions[0].prs).toBe(OPENED_PAGES)
    expect(gh.asked.filter((call) => call.startsWith('pullRequests'))).toHaveLength(OPENED_PAGES)
  })

  it('says which kinds GitHub listed more of than it read', async () => {
    const recent = { commit: [raw('acme/web')] }
    const gh = github(recent, { pullRequests: [[]], issues: [[]] })
    const query = gh.query.bind(gh)
    gh.query = (async (text: string, variables?: Record<string, unknown>) => {
      const data = (await query(text, variables)) as { user: Record<string, { totalCount: number }> }
      if (text === CONTRIBUTED) data.user.commit.totalCount = 120
      return data
    }) as GitHub['query']
    expect((await contributionsOf(gh, 'ali')).partial).toEqual(['commit'])
  })
})

function entry(fullName: string, overrides: Partial<Contribution> = {}, repo: Partial<Repo> = {}): Contribution {
  const [owner, name] = fullName.split('/')
  return {
    repo: {
      id: fullName,
      owner,
      ownerAvatar: '',
      name,
      fullName,
      description: null,
      language: null,
      isPrivate: false,
      isArchived: false,
      pushedAt: null,
      openIssues: 0,
      openPrs: 0,
      issues: 0,
      prs: 0,
      ...repo,
    },
    kinds: ['pr'],
    prs: 1,
    issues: 0,
    lastAt: null,
    ...overrides,
  }
}

const names = (shown: Contribution[]) => shown.map((each) => each.repo.fullName)

describe('pickContributions', () => {
  const list = [
    entry('acme/web', { kinds: ['commit'], prs: 0, lastAt: null }, { pushedAt: '2026-06-01T00:00:00Z' }),
    entry('acme/api', { kinds: ['pr', 'issue'], prs: 5, issues: 2, lastAt: '2026-02-01T00:00:00Z' }),
    entry('nuxt/nuxt', { kinds: ['pr', 'review'], prs: 1, lastAt: '2026-09-01T00:00:00Z' }, { description: 'Vue' }),
    entry('old/tool', { kinds: ['issue'], prs: 0, issues: 1, lastAt: '2026-10-01T00:00:00Z' }, { isArchived: true }),
  ]
  const pick = (filters: Partial<ReturnType<typeof defaultContributionFilters>>) =>
    pickContributions(list, { ...defaultContributionFilters(), ...filters })

  it('shows the active ones, the last opened first, and those without a date after them', () => {
    expect(names(pick({}).shown)).toEqual(['nuxt/nuxt', 'acme/api', 'acme/web'])
  })

  it('sorts by what was opened most, or by name', () => {
    expect(names(pick({ sort: 'most', status: [] }).shown)).toEqual(['acme/api', 'nuxt/nuxt', 'old/tool', 'acme/web'])
    expect(names(pick({ sort: 'name', status: [] }).shown)).toEqual(['acme/api', 'acme/web', 'nuxt/nuxt', 'old/tool'])
  })

  it('searches full names and descriptions', () => {
    expect(names(pick({ q: 'vue' }).shown)).toEqual(['nuxt/nuxt'])
    expect(names(pick({ q: 'acme/' }).shown)).toEqual(['acme/api', 'acme/web'])
  })

  it('keeps any of the kinds picked, and counts each facet with the others applied', () => {
    const { shown, kinds, owners, statuses } = pick({ kinds: ['review', 'commit'], owners: ['acme'] })
    expect(names(shown)).toEqual(['acme/web'])
    expect(kinds).toEqual({ commit: 1, pr: 1, issue: 1, review: 0 })
    expect(Object.fromEntries([...owners].map(([owner, { count }]) => [owner, count]))).toEqual({ acme: 1, nuxt: 1 })
    expect(statuses).toEqual({ active: 1, archived: 0 })
    expect(pick({ owners: ['old'] }).statuses).toEqual({ active: 0, archived: 1 })
  })
})
