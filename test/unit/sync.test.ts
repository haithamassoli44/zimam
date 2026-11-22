import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitHubError, type GitHub } from '@/lib/github'
import { NODES, ORG_REPOS, PR_STATUS, SEARCH, type RawItem, type RawRepo } from '@/lib/queries'
import { idleStatus, Syncer, type SyncStore } from '@/lib/sync'
import type { Item, Repo, Workspace } from '@/types'

const HOUR = 3_600_000
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString()

function raw(id: string, state: RawItem['state'], updatedAt: string, pr = false): RawItem {
  return {
    kind: pr ? 'PullRequest' : 'Issue',
    id,
    number: Number(id.slice(1)),
    title: id,
    url: '',
    state,
    ...(pr ? { isDraft: false, reviewDecision: null } : {}),
    createdAt: ago(24 * 30),
    updatedAt,
    author: null,
    assignees: { nodes: [] },
    labels: { nodes: [] },
    comments: { totalCount: 0 },
    repository: { id: 'R1' },
  }
}

const page = <T>(nodes: T[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes })
const count = (nodes: RawItem[], state: RawItem['state']) => nodes.filter((node) => node.state === state).length

// A GitHub with one repository: one open and one closed issue, one open and one merged pull request.
function fakeGitHub() {
  const issues = [raw('I1', 'OPEN', ago(24)), raw('I3', 'CLOSED', ago(240))]
  const prs = [raw('P2', 'OPEN', ago(24), true), raw('P4', 'MERGED', ago(240), true)]
  const state = {
    issues,
    prs,
    searchResults: [] as RawItem[],
    checks: {} as Record<string, string>,
    rateLimited: false,
    calls: [] as string[],
    pageSize: Infinity,
    onQuery: () => {},
  }

  const rollup = (id: string) => ({ commit: { statusCheckRollup: { state: state.checks[id] ?? 'SUCCESS' } } })

  const gh: GitHub = {
    scopes: () => ['repo'],
    rate: () => null,
    async query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
      const call =
        { [ORG_REPOS]: 'repos', [SEARCH]: 'search', [NODES]: 'nodes', [PR_STATUS]: 'checks' }[text] ?? 'items'
      state.calls.push(call)
      state.onQuery()
      if (state.rateLimited) throw new GitHubError('Rate limited', 'rate', Date.now() + 60_000)
      if (call === 'repos') {
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
          openIssues: { totalCount: count(state.issues, 'OPEN') },
          openPrs: { totalCount: count(state.prs, 'OPEN') },
          allIssues: { totalCount: state.issues.length },
          allPrs: { totalCount: state.prs.length },
        }
        return { organization: { repositories: page([repo]) } } as T
      }
      if (call === 'search')
        return { search: { issueCount: state.searchResults.length, ...page(state.searchResults) } } as T
      if (call === 'nodes') return { nodes: [] } as T
      if (call === 'checks') {
        const ids = variables.ids as string[]
        return {
          nodes: ids.map((id) => ({ id, isDraft: false, reviewDecision: null, commits: { nodes: [rollup(id)] } })),
        } as T
      }
      const states = variables.states as string[]
      const list = text.includes('issues(') ? state.issues : state.prs
      const kind = text.includes('issues(') ? 'issues' : 'pullRequests'
      const matching = list.filter((node) => states.includes(node.state))
      const start = Number(variables.after ?? 0)
      const withChecks = text.includes('statusCheckRollup')
      const nodes = matching
        .slice(start, start + state.pageSize)
        .map((node) => (withChecks ? { ...node, commits: { nodes: [rollup(node.id)] } } : node))
      const end = start + nodes.length
      const pageInfo = { hasNextPage: end < matching.length, endCursor: String(end) }
      return { repository: { [kind]: { pageInfo, nodes } } } as T
    },
  }
  return { gh, state }
}

const ws: Workspace = { id: 'ws', name: 'acme', token: 't', sources: [{ kind: 'org', name: 'acme' }], views: [] }

async function setup() {
  const fake = fakeGitHub()
  const fresh: string[] = []
  const store: SyncStore = {
    repos: new Map<string, Repo>(),
    items: new Map<string, Item>(),
    changed: (ids) => fresh.push(...ids),
  }
  const status = idleStatus()
  const syncer = await Syncer.open(ws, fake.gh, store, status)
  return { ...fake, store, status, syncer, fresh }
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Syncer', () => {
  it('loads open items, then the closed history, without marking any of it as news', async () => {
    const { store, status, syncer, fresh } = await setup()
    await syncer.sync()
    expect([...store.items.keys()].toSorted()).toEqual(['I1', 'I3', 'P2', 'P4'])
    expect(store.items.get('P4')?.state).toBe('merged')
    expect(status.historyDone).toBe(true)
    expect(status.syncedAt).not.toBeNull()
    expect(fresh).toEqual([])
  })

  it('loads a long history in slices, and checks for changes before each one', async () => {
    const { store, state, status, syncer } = await setup()
    state.issues.push(...[10, 11, 12, 13, 14, 15].map((n) => raw(`I${n}`, 'CLOSED', ago(240))))
    state.pageSize = 1
    // Each request takes 20 seconds, so a slice of the history holds only a few pages.
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    state.onQuery = () => (now += 20_000)

    await syncer.sync()
    expect(status.historyDone).toBe(false)
    expect(status.history).toEqual({ done: 0, total: 1 })
    await vi.waitFor(() => expect(status.historyDone).toBe(true))
    syncer.stop()

    expect(store.items.size).toBe(10)
    expect(status.history).toEqual({ done: 1, total: 1 })
    const pages = state.calls.flatMap((call, index) => (call === 'items' ? [index] : []))
    const searches = state.calls.flatMap((call, index) => (call === 'search' ? [index] : []))
    expect(searches.filter((index) => index < pages.at(-1)!).length).toBeGreaterThanOrEqual(2)
  })

  it('tells what each repository has left to load, but not open items it reads again', async () => {
    const { state, status, syncer } = await setup()
    const left: string[] = []
    state.onQuery = () => left.push(JSON.stringify(status.left))
    await syncer.sync()
    expect(left[1]).toBe('{"R1":["open","issues","pullRequests"]}')
    expect(left).toContain('{"R1":["issues","pullRequests"]}')
    expect(status.left).toEqual({})

    // A refresh some time later reads the open items again, which are still shown meanwhile.
    const later = Date.now() + 11 * 60_000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    left.length = 0
    state.calls = []
    await syncer.sync(true)
    expect(state.calls).toContain('items')
    expect(new Set(left)).toEqual(new Set(['{}']))
  })

  it('loads the history of active repositories first, the latest pushed first', async () => {
    const repos = [
      ['old', true, ago(1)],
      ['quiet', false, ago(24 * 300)],
      ['busy', false, ago(1)],
      ['mid', false, ago(24 * 10)],
      ['unknown', false, null],
    ] as const
    const started: string[] = []
    const gh: GitHub = {
      scopes: () => ['repo'],
      rate: () => null,
      async query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
        if (text === ORG_REPOS) {
          const nodes: RawRepo[] = repos.map(([name, isArchived, pushedAt]) => ({
            id: name,
            name,
            nameWithOwner: `acme/${name}`,
            description: null,
            isPrivate: false,
            isArchived,
            pushedAt,
            owner: { login: 'acme', avatarUrl: '' },
            primaryLanguage: null,
            openIssues: { totalCount: 0 },
            openPrs: { totalCount: 0 },
            allIssues: { totalCount: 1 },
            allPrs: { totalCount: 0 },
          }))
          return { organization: { repositories: page(nodes) } } as T
        }
        started.push(variables.name as string)
        return { repository: { issues: page([]) } } as T
      },
    }
    const store: SyncStore = { repos: new Map(), items: new Map(), changed: () => {} }
    const syncer = await Syncer.open(ws, gh, store, idleStatus())
    await syncer.sync()
    expect(started).toEqual(['busy', 'mid', 'quiet', 'unknown', 'old'])
  })

  it('picks up a change with one search, and marks it as news', async () => {
    const { store, state, syncer, fresh } = await setup()
    await syncer.sync()
    state.searchResults = [raw('I1', 'CLOSED', new Date().toISOString())]
    state.calls = []
    await syncer.sync()
    expect(state.calls).toEqual(['search'])
    expect(store.items.get('I1')?.state).toBe('closed')
    expect(fresh).toEqual(['I1'])
  })

  it('keeps the newer copy when an older one arrives later', async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.searchResults = [raw('I1', 'OPEN', ago(48))]
    await syncer.sync()
    expect(store.items.get('I1')?.updatedAt).toBe(state.issues[0].updatedAt)
  })

  it('gets the checks with the open pull requests, and asks again only for a refresh', async () => {
    const { store, state, syncer } = await setup()
    state.checks.P2 = 'FAILURE'
    await syncer.sync()
    expect(store.items.get('P2')?.checks).toBe('failure')
    expect(state.calls).not.toContain('checks')
    await syncer.sync(true)
    expect(state.calls.filter((call) => call === 'checks')).toHaveLength(1)
  })

  it("reads checks on open pull requests every few minutes, since a finished run doesn't change their update time", async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.checks.P2 = 'FAILURE'
    const later = Date.now() + 6 * 60_000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    state.calls = []
    await syncer.sync()
    expect(state.calls).toEqual(['search', 'checks'])
    expect(store.items.get('P2')?.checks).toBe('failure')
    expect(store.items.get('P2')?.updatedAt).toBe(state.prs[0].updatedAt)
  })

  it('pauses until GitHub says to come back, without retrying in between', async () => {
    const { state, status, syncer } = await setup()
    await syncer.sync()
    state.rateLimited = true
    await syncer.sync()
    expect(status.pausedUntil).toBeGreaterThan(Date.now())
    state.calls = []
    await syncer.sync()
    expect(state.calls).toEqual([])
  })
})
