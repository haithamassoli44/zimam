import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyCache, type Cache } from '@/lib/cache'
import { GitHubError, type Answer, type GitHub, type Probe, type QueryError } from '@/lib/github'
import {
  NODES,
  ORG_REPOS,
  PR_STATUS,
  repoItems,
  REVIEW_REQUESTED,
  SEARCH,
  type RawItem,
  type RawRepo,
} from '@/lib/queries'
import { sourcesKey } from '@/lib/sources'
import { idleStatus, Syncer, type SyncStore } from '@/lib/sync'
import { noOne, type Item, type Repo, type Workspace } from '@/types'

// What IndexedDB would keep for the workspace between syncers. jsdom has no IndexedDB, so by default nothing.
const saved = vi.hoisted(() => ({ cache: null as Cache | null }))
vi.mock('@/lib/cache', async (original) => ({
  ...(await original<typeof import('@/lib/cache')>()),
  readCache: async () => saved.cache,
}))

const MINUTE = 60_000
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

const size = (kind: 'issues' | 'pullRequests', open: boolean) => repoItems(kind, open).size

const done = (data: unknown) => ({ data, errors: [] as QueryError[] })

// A GitHub with one repository: one open and one closed issue, one open and one merged pull request.
function fakeGitHub() {
  const issues = [raw('I1', 'OPEN', ago(24)), raw('I3', 'CLOSED', ago(240))]
  const prs = [raw('P2', 'OPEN', ago(24), true), raw('P4', 'MERGED', ago(240), true)]
  const state = {
    issues,
    prs,
    searchResults: [] as RawItem[],
    checks: {} as Record<string, string>,
    mergeable: {} as Record<string, RawItem['mergeable']>,
    requested: [] as string[],
    // What GitHub says of each item asked for again that it doesn't return.
    missing: {} as Record<string, string>,
    // What GitHub won't show: a repository's lists of one kind or both, and pull requests asked for by id.
    hidden: [] as string[],
    archived: false,
    hiddenStatus: [] as string[],
    // More repositories in the organization, by name, each with the same items as the first, and the repositories
    // whose items were asked for.
    more: [] as string[],
    itemsOf: [] as string[],
    probes: {} as Record<string, Probe>,
    probed: [] as string[],
    seen: new Set<string>(),
    firsts: [] as number[],
    serverErrors: 0,
    rateLimited: false,
    calls: [] as string[],
    pageSize: Infinity,
    onQuery: () => {},
  }

  const rollup = (id: string) => ({ commit: { statusCheckRollup: { state: state.checks[id] ?? 'SUCCESS' } } })
  const status = (id: string) => ({ mergeable: state.mergeable[id] ?? 'MERGEABLE', commits: { nodes: [rollup(id)] } })

  const gh: GitHub = {
    scopes: () => ['repo'],
    rate: () => null,
    rest: () => Promise.reject(new Error('unused')),
    async probe(path: string) {
      state.calls.push('probe')
      state.probed.push(path)
      // Like GitHub, the first answer has nothing to compare with.
      const first = !state.seen.has(path)
      state.seen.add(path)
      return state.probes[path] ?? (first ? 'new' : 'same')
    },
    async query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
      return (await gh.request<T>(text, variables)).data
    },
    async request<T>(text: string, variables: Record<string, unknown> = {}): Promise<Answer<T>> {
      const { data, errors } = await answer(text, variables)
      return { data: data as T, errors }
    },
  }

  async function answer(
    text: string,
    variables: Record<string, unknown>,
  ): Promise<{ data: unknown; errors: QueryError[] }> {
    const call =
      {
        [ORG_REPOS]: 'repos',
        [SEARCH]: 'search',
        [NODES]: 'nodes',
        [PR_STATUS]: 'checks',
        [REVIEW_REQUESTED]: 'requested',
      }[text] ?? 'items'
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
        isArchived: state.archived,
        pushedAt: null,
        owner: { login: 'acme', avatarUrl: '' },
        primaryLanguage: null,
        openIssues: { totalCount: count(state.issues, 'OPEN') },
        openPrs: { totalCount: count(state.prs, 'OPEN') },
        allIssues: { totalCount: state.issues.length },
        allPrs: { totalCount: state.prs.length },
      }
      const more = state.more.map((name) => ({ ...repo, id: name, name, nameWithOwner: `acme/${name}` }))
      return done({ organization: { repositories: page([repo, ...more]) } })
    }
    if (call === 'search')
      return done({ search: { issueCount: state.searchResults.length, ...page(state.searchResults) } })
    if (call === 'requested')
      return done({ viewer: { login: 'ali' }, search: page(state.requested.map((id) => ({ id }))) })
    if (call === 'nodes') {
      const ids = variables.ids as string[]
      return {
        data: { nodes: ids.map(() => null) },
        errors: ids.flatMap((id, index) =>
          state.missing[id] ? [{ type: state.missing[id], path: ['nodes', index], message: id }] : [],
        ),
      }
    }
    if (call === 'checks') {
      const ids = variables.ids as string[]
      return done({
        nodes: ids.map((id) =>
          state.hiddenStatus.includes(id) ? null : { id, isDraft: false, reviewDecision: null, ...status(id) },
        ),
      })
    }
    state.firsts.push(variables.first as number)
    const name = variables.name as string
    state.itemsOf.push(name)
    if (state.serverErrors > 0) {
      state.serverErrors--
      throw new GitHubError('GitHub answered 502', 'server')
    }
    const states = variables.states as string[]
    const list = text.includes('issues(') ? state.issues : state.prs
    const kind = text.includes('issues(') ? 'issues' : 'pullRequests'
    if (state.hidden.includes(kind))
      return done(kind === 'issues' ? { repository: null } : { repository: { [kind]: null } })
    const matching = list.filter((node) => states.includes(node.state))
    const start = Number(variables.after ?? 0)
    const withChecks = text.includes('statusCheckRollup')
    const nodes = matching
      .slice(start, start + state.pageSize)
      .map((node) => (withChecks ? { ...node, ...status(node.id) } : node))
      .map((node) => (name === 'web' ? node : { ...node, id: `${name}-${node.id}`, repository: { id: name } }))
    const end = start + nodes.length
    const pageInfo = { hasNextPage: end < matching.length, endCursor: String(end) }
    return done({ repository: { [kind]: { pageInfo, nodes } } })
  }
  return { gh, state }
}

const ws: Workspace = {
  id: 'ws',
  name: 'acme',
  token: 't',
  sources: [{ kind: 'org', name: 'acme' }],
  views: [],
  pinned: [],
}

async function setup(workspace = ws) {
  const fake = fakeGitHub()
  const fresh: string[] = []
  const store: SyncStore = {
    repos: new Map<string, Repo>(),
    items: new Map<string, Item>(),
    me: { login: null, requested: new Set() },
    changed: (ids) => fresh.push(...ids),
  }
  const status = idleStatus()
  const syncer = await Syncer.open(workspace, fake.gh, store, status)
  return { ...fake, store, status, syncer, fresh }
}

beforeEach(() => {
  localStorage.clear()
  saved.cache = null
})
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
    // Each check is a search, or a free question to GitHub that tells whether one is needed.
    const pages = state.calls.flatMap((call, index) => (call === 'items' ? [index] : []))
    const checks = state.calls.flatMap((call, index) => (call === 'search' || call === 'probe' ? [index] : []))
    expect(checks.filter((index) => index < pages.at(-1)!).length).toBeGreaterThanOrEqual(2)
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
      rest: () => Promise.reject(new Error('unused')),
      probe: async () => 'same',
      request: async () => ({ data: null as never, errors: [] }),
      async query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
        if (text === REVIEW_REQUESTED) return { viewer: { login: 'ali' }, search: page([]) } as T
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
    const store: SyncStore = {
      repos: new Map(),
      items: new Map(),
      me: { login: null, requested: new Set() },
      changed: () => {},
    }
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

  it('reads the open items again instead when the search finds too many changes', async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.issues.push(raw('I7', 'OPEN', new Date().toISOString()))
    // A long absence: search can't list all that changed, and GitHub's count says so.
    state.searchResults = Array.from({ length: 1001 }, (_, index) => raw(`I${100 + index}`, 'OPEN', ago(1)))
    state.calls = []
    await syncer.sync()
    expect(state.calls.filter((call) => call === 'search')).toHaveLength(1)
    expect(state.calls).toContain('items')
    expect(store.items.has('I7')).toBe(true)
    expect(store.items.has('I100')).toBe(false)
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
    const later = Date.now() + 1000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    await syncer.sync(true)
    expect(state.calls.filter((call) => call === 'checks')).toHaveLength(1)
  })

  it("reads checks again as often as they are likely to change, since that doesn't change the update time", async () => {
    const { store, state, syncer } = await setup()
    state.checks.P2 = 'PENDING'
    await syncer.sync()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const checkCalls = async (minutes: number) => {
      now += minutes * MINUTE
      state.calls = []
      await syncer.sync()
      return state.calls.filter((call) => call === 'checks').length
    }

    // Running checks are read every minute.
    expect(await checkCalls(1)).toBe(1)
    state.checks.P2 = 'FAILURE'
    expect(await checkCalls(1)).toBe(1)
    expect(store.items.get('P2')?.checks).toBe('failure')
    expect(store.items.get('P2')?.updatedAt).toBe(state.prs[0].updatedAt)
    // Failing ones every five minutes.
    expect(await checkCalls(4)).toBe(0)
    state.checks.P2 = 'SUCCESS'
    expect(await checkCalls(1)).toBe(1)
    // Passing ones every fifteen.
    expect(await checkCalls(14)).toBe(0)
    expect(await checkCalls(1)).toBe(1)
  })

  it('asks a few times in a row while GitHub works out whether a pull request conflicts', async () => {
    const { store, state, syncer } = await setup()
    state.mergeable.P2 = 'UNKNOWN'
    await syncer.sync()
    expect(store.items.get('P2')?.merge).toBeNull()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const checkCalls = async () => {
      now += MINUTE
      state.calls = []
      await syncer.sync()
      return state.calls.filter((call) => call === 'checks').length
    }
    expect([await checkCalls(), await checkCalls(), await checkCalls(), await checkCalls()]).toEqual([1, 1, 1, 0])

    state.mergeable.P2 = 'CONFLICTING'
    await syncer.sync(true)
    expect(store.items.get('P2')?.merge).toBe('conflicts')
    // Its base branch moved: GitHub doesn't know again for a moment, and the last answer stands meanwhile.
    state.mergeable.P2 = 'UNKNOWN'
    now += MINUTE
    await syncer.sync(true)
    expect(store.items.get('P2')?.merge).toBe('conflicts')
    // The same holds when the pull request itself changes and arrives through the search.
    now += MINUTE
    state.searchResults = [raw('P2', 'OPEN', new Date(now).toISOString(), true)]
    state.probes = Object.fromEntries(state.probed.map((path) => [path, 'changed']))
    await syncer.sync()
    expect(store.items.get('P2')?.updatedAt).toBe(new Date(now).toISOString())
    expect(store.items.get('P2')?.merge).toBe('conflicts')
  })

  it('asks again soon when a pull request known to be clean comes back unknown', async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const checkCalls = async (minutes: number) => {
      now += minutes * MINUTE
      state.calls = []
      await syncer.sync()
      return state.calls.filter((call) => call === 'checks').length
    }
    // Its base branch moved by its fifteen-minute turn, and GitHub is working out whether it still merges.
    state.mergeable.P2 = 'UNKNOWN'
    expect(await checkCalls(15)).toBe(1)
    expect(store.items.get('P2')?.merge).toBe('clean')
    state.mergeable.P2 = 'CONFLICTING'
    expect(await checkCalls(1)).toBe(1)
    expect(store.items.get('P2')?.merge).toBe('conflicts')
    expect(await checkCalls(1)).toBe(0)
  })

  it('drops the checks and conflicts of a pull request once it merges', async () => {
    const { store, state, syncer } = await setup()
    state.mergeable.P2 = 'CONFLICTING'
    state.checks.P2 = 'FAILURE'
    await syncer.sync()
    expect(store.items.get('P2')).toMatchObject({ merge: 'conflicts', checks: 'failure' })
    state.searchResults = [raw('P2', 'MERGED', new Date().toISOString(), true)]
    await syncer.sync()
    expect(store.items.get('P2')).toMatchObject({ state: 'merged', merge: null, checks: null })
  })

  it("doesn't read checks in an archived repository again", async () => {
    const { state, syncer } = await setup()
    state.archived = true
    await syncer.sync()
    const later = Date.now() + 5000
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    state.calls = []
    await syncer.sync(true)
    expect(state.calls).not.toContain('checks')
  })

  it("doesn't read checks again on a refresh that has just read them with the open items", async () => {
    const { state, syncer } = await setup()
    await syncer.sync()
    // Long enough since the open items were last read that a refresh reads them all again.
    const later = Date.now() + HOUR
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    state.calls = []
    await syncer.sync(true)
    expect(state.calls).toContain('items')
    expect(state.calls).not.toContain('checks')
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

  it('asks for pages of the largest size that costs one point, and halves a page GitHub times out on', async () => {
    const { state, syncer } = await setup()
    state.serverErrors = 1
    await syncer.sync()
    // Open issues, at half the size after the timeout, then open pull requests, then the closed history.
    expect(state.firsts).toEqual([
      size('issues', true),
      Math.floor(size('issues', true) / 2),
      size('pullRequests', true),
      size('issues', false),
      size('pullRequests', false),
    ])
  })

  it('removes an item only when GitHub says it is gone, not when it is hidden from the token', async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    // Both open items drop out of the open lists, and GitHub won't show them when asked for by id.
    state.issues = state.issues.filter((node) => node.id !== 'I1')
    state.prs = state.prs.filter((node) => node.id !== 'P2')
    state.missing = { I1: 'FORBIDDEN', P2: 'NOT_FOUND' }
    const later = Date.now() + HOUR
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    await syncer.sync(true)
    expect(store.items.has('I1')).toBe(true)
    expect(store.items.has('P2')).toBe(false)
  })

  it("keeps a repository's open items while GitHub won't show the repository", async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.hidden = ['issues', 'pullRequests']
    const later = Date.now() + HOUR
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    state.calls = []
    await syncer.sync(true)
    expect(state.calls).toContain('items')
    expect(state.calls).not.toContain('nodes')
    expect(store.items.has('I1')).toBe(true)
  })

  it('finds the pull requests that ask the viewer for a review every five minutes', async () => {
    const { store, state, syncer } = await setup()
    state.requested = ['P2']
    await syncer.sync()
    expect(store.me.login).toBe('ali')
    expect([...store.me.requested]).toEqual(['P2'])

    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    state.requested = []
    state.calls = []
    now += 4 * MINUTE
    await syncer.sync()
    expect(state.calls).not.toContain('requested')
    now += MINUTE
    await syncer.sync()
    expect(state.calls).toContain('requested')
    expect(store.me.requested.size).toBe(0)
  })
})

describe('Syncer after review', () => {
  it("waits its turn for a pull request GitHub doesn't return, instead of asking every minute", async () => {
    const { state, syncer } = await setup()
    await syncer.sync()
    state.hiddenStatus = ['P2']
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const checks: number[] = []
    for (let minute = 0; minute < 20; minute++) {
      now += MINUTE
      state.calls = []
      await syncer.sync()
      checks.push(state.calls.filter((call) => call === 'checks').length)
    }
    // Only the fifteen-minute turn of a passing pull request.
    expect(checks.reduce((sum, n) => sum + n, 0)).toBe(1)
  })

  it("prunes one kind's open items while GitHub hides the other kind's list", async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.issues = state.issues.filter((node) => node.id !== 'I1')
    state.issues.push(raw('I5', 'OPEN', ago(1)))
    state.missing = { I1: 'NOT_FOUND', P2: 'NOT_FOUND' }
    state.hidden = ['pullRequests']
    const later = Date.now() + HOUR
    vi.spyOn(Date, 'now').mockImplementation(() => later)
    await syncer.sync(true)
    expect(store.items.has('I1')).toBe(false)
    expect(store.items.has('P2')).toBe(true)
  })

  it('asks who the viewer is again when a workspace opens, since its token may have changed', async () => {
    // What another account's token saved a moment ago.
    const cache = {
      ...emptyCache(ws.id, sourcesKey(ws.sources)),
      login: 'someone-else',
      requested: ['P9'],
      requestedAt: Date.now(),
    }
    const { gh, state } = fakeGitHub()
    const store: SyncStore = {
      repos: new Map(),
      items: new Map(),
      me: { login: null, requested: new Set() },
      changed: () => {},
    }
    saved.cache = cache
    const syncer = await Syncer.open(ws, gh, store, idleStatus())
    await syncer.start()
    expect(state.calls).toContain('requested')
    expect(store.me).toEqual({ login: 'ali', requested: new Set() })
  })
})

// The workspace with only these repositories of the organization picked, and an item changed just now in one.
const picking = (...only: string[]): Workspace => ({ ...ws, sources: [{ kind: 'org', name: 'acme', only }] })
const change = (id: string, repo: string) => ({
  ...raw(id, 'OPEN', new Date().toISOString()),
  repository: { id: repo },
})

describe('Syncer with only some repositories picked', () => {
  it('reads only the repositories picked', async () => {
    const { store, state, syncer } = await setup(picking('R1'))
    state.more = ['api']
    await syncer.sync()
    expect([...store.repos.keys()]).toEqual(['R1'])
    expect(new Set(state.itemsOf)).toEqual(new Set(['web']))
  })

  it('drops changes in repositories left out, and reads the repositories again for them only once', async () => {
    const { store, state, syncer, fresh } = await setup(picking('R1'))
    state.more = ['api']
    await syncer.sync()
    state.searchResults = [change('I9', 'api')]
    state.calls = []
    await syncer.sync()
    expect(state.calls).toEqual(['search', 'repos'])
    state.calls = []
    await syncer.sync()
    expect(state.calls).not.toContain('repos')
    expect(store.items.has('I9')).toBe(false)
    expect(fresh).toEqual([])
  })

  it('still adds a new repository of an account that brings all of them', async () => {
    const { store, state, syncer } = await setup()
    await syncer.sync()
    state.more = ['api']
    state.searchResults = [change('I9', 'api')]
    await syncer.sync()
    expect(store.repos.has('api')).toBe(true)
    expect(store.items.has('I9')).toBe(true)
  })

  it('drops what the sources no longer bring as soon as the workspace opens, and reloads it all when picked again', async () => {
    const { gh, state } = fakeGitHub()
    state.more = ['api']
    saved.cache = emptyCache(ws.id, '')
    const open = async (...only: string[]) => {
      const store: SyncStore = { repos: new Map(), items: new Map(), me: noOne(), changed: () => {} }
      const status = idleStatus()
      const syncer = await Syncer.open(picking(...only), gh, store, status)
      let shown: string[] | null = null
      state.onQuery = () => (shown ??= [...store.repos.keys()])
      await syncer.start()
      syncer.stop()
      expect(status.historyDone).toBe(true)
      return { store, shown }
    }
    expect([...(await open('R1')).store.items.keys()].toSorted()).toEqual(['I1', 'I3', 'P2', 'P4'])
    const other = await open('api')
    expect(other.shown).toEqual([])
    expect([...other.store.items.keys()].toSorted()).toEqual(['api-I1', 'api-I3', 'api-P2', 'api-P4'])
    // Its closed history too, which it had loaded before it was left out.
    expect([...(await open('R1')).store.items.keys()].toSorted()).toEqual(['I1', 'I3', 'P2', 'P4'])
  })
})

// A workspace past its first sync, and a minute passing in it: which searches and free checks each minute made.
async function settled() {
  const test = await setup()
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const minute = async (manual = false) => {
    now += MINUTE
    test.state.calls = []
    await test.syncer.sync(manual)
    return test.state.calls.filter((call) => call === 'search' || call === 'probe')
  }
  await test.syncer.sync()
  return { ...test, minute }
}
describe('Syncer in a quiet workspace', () => {
  const ORG = '/orgs/acme/issues?state=all&sort=updated&direction=desc&per_page=1&filter=all'
  const REPO = '/repos/acme/web/issues?state=all&sort=updated&direction=desc&per_page=1'

  it('skips the search while GitHub says nothing changed, and searches at least every five minutes', async () => {
    const { minute } = await settled()
    expect(await minute()).toEqual(['search'])
    // The first question has nothing to compare with yet.
    expect(await minute()).toEqual(['probe', 'search'])
    expect(await minute()).toEqual(['probe'])
    expect(await minute()).toEqual(['probe'])
    expect(await minute()).toEqual(['probe'])
    expect(await minute()).toEqual(['probe'])
    expect(await minute()).toEqual(['search'])
    // A refresh always searches.
    expect(await minute(true)).toEqual(['search'])
  })

  it('searches when GitHub says something changed, and keeps searching while search catches up', async () => {
    const { state, minute } = await settled()
    await minute()
    await minute()
    expect(await minute()).toEqual(['probe'])
    state.probes[ORG] = 'changed'
    expect(await minute()).toEqual(['probe', 'search'])
    state.probes[ORG] = 'same'
    expect(await minute()).toEqual(['search'])
    expect(await minute()).toEqual(['search'])
    expect(await minute()).toEqual(['probe'])
  })

  it("doesn't ask while searches keep finding changes", async () => {
    const { state, minute } = await settled()
    await minute()
    state.searchResults = [raw('I1', 'OPEN', new Date(Date.now() + MINUTE).toISOString())]
    expect(await minute()).toEqual(['probe', 'search'])
    expect(await minute()).toEqual(['search'])
    // That search found nothing new, so the next minute asks first.
    expect(await minute()).toEqual(['probe'])
  })

  it("asks about each repository when the token can't read the organization's list", async () => {
    const { state, minute } = await settled()
    await minute()
    state.probes[ORG] = 'unsupported'
    expect(await minute()).toEqual(['probe', 'search'])
    state.probed = []
    expect(await minute()).toEqual(['probe', 'search'])
    expect(await minute()).toEqual(['probe'])
    expect(state.probed).toEqual([REPO, REPO])
  })

  it("only searches once a repository can't be asked either", async () => {
    const { state, minute } = await settled()
    await minute()
    state.probes[ORG] = 'unsupported'
    state.probes[REPO] = 'unsupported'
    expect(await minute()).toEqual(['probe', 'search'])
    expect(await minute()).toEqual(['probe', 'search'])
    expect(await minute()).toEqual(['search'])
    expect(await minute()).toEqual(['search'])
  })
})
