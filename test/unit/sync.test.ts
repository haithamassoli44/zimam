import { beforeEach, describe, expect, it } from 'vitest'

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
  }

  const gh: GitHub = {
    scopes: () => ['repo'],
    rate: () => null,
    async query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
      const call =
        { [ORG_REPOS]: 'repos', [SEARCH]: 'search', [NODES]: 'nodes', [PR_STATUS]: 'checks' }[text] ?? 'items'
      state.calls.push(call)
      if (state.rateLimited) throw new GitHubError('Rate limited', 'rate', Date.now() + 60_000)
      if (call === 'repos') {
        const repo: RawRepo = {
          id: 'R1',
          name: 'web',
          nameWithOwner: 'acme/web',
          isArchived: false,
          owner: { login: 'acme', avatarUrl: '' },
          openIssues: { totalCount: 1 },
          openPrs: { totalCount: 1 },
          allIssues: { totalCount: 2 },
          allPrs: { totalCount: 2 },
        }
        return { organization: { repositories: page([repo]) } } as T
      }
      if (call === 'search')
        return { search: { issueCount: state.searchResults.length, ...page(state.searchResults) } } as T
      if (call === 'nodes') return { nodes: [] } as T
      if (call === 'checks') {
        const ids = variables.ids as string[]
        const rollup = (id: string) => ({ commit: { statusCheckRollup: { state: state.checks[id] ?? 'SUCCESS' } } })
        return {
          nodes: ids.map((id) => ({ id, isDraft: false, reviewDecision: null, commits: { nodes: [rollup(id)] } })),
        } as T
      }
      const states = variables.states as string[]
      const list = text.includes('issues(') ? state.issues : state.prs
      const kind = text.includes('issues(') ? 'issues' : 'pullRequests'
      return { repository: { [kind]: page(list.filter((node) => states.includes(node.state))) } } as T
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

  it("reads checks on open pull requests, since a finished run doesn't change their update time", async () => {
    const { store, state, syncer } = await setup()
    state.checks.P2 = 'FAILURE'
    await syncer.sync()
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
