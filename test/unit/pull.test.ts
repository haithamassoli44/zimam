import { describe, expect, it } from 'vitest'

import { readChanges } from '@/lib/changes'
import type { GitHub } from '@/lib/github'
import { readPull } from '@/lib/pull'

const REF = { repo: 'acme/web', number: 1 }
const pageOf = (nodes: unknown[], more: boolean) => ({
  pageInfo: { hasNextPage: more, endCursor: more ? 'next' : null },
  nodes,
})

// A comment on a pull request's timeline, the `n`th minute of 2026.
const comment = (n: number) => ({
  kind: 'IssueComment',
  id: `c${n}`,
  url: '',
  author: null,
  authorAssociation: 'NONE',
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString(),
  lastEditedAt: null,
  bodyHTML: '<p>hi</p>',
  isMinimized: false,
  minimizedReason: null,
})

// A pull request whose timeline holds `pages` pages of 100 comments, each page asked for in turn.
function pullWith(pages: number) {
  let timelineAsked = 1
  const timelinePage = () => {
    const from = (timelineAsked - 1) * 100
    return pageOf(
      Array.from({ length: 100 }, (_, index) => comment(from + index)),
      timelineAsked < pages,
    )
  }
  const raw = {
    id: 'P1',
    url: 'https://github.com/acme/web/pull/1',
    title: 'Long talk',
    state: 'OPEN',
    isDraft: false,
    author: null,
    authorAssociation: 'NONE',
    createdAt: '2026-01-01T00:00:00Z',
    lastEditedAt: null,
    bodyHTML: '',
    mergedBy: null,
    mergedAt: null,
    updatedAt: '2026-01-02T00:00:00Z',
    baseRefName: 'main',
    headRefName: 'talk',
    baseRefOid: 'base',
    headRefOid: 'head',
    headRepositoryOwner: { login: 'acme' },
    isCrossRepository: false,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    reviewDecision: null,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    labels: { nodes: [] },
    assignees: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    commits: { totalCount: 0, nodes: [] },
    lastCommit: { nodes: [] },
    files: pageOf([], false),
    timelineItems: timelinePage(),
    reviewThreads: pageOf([], false),
  }
  const gh = {
    request: async () => ({ data: { repository: { pullRequest: raw } }, errors: [] }),
    query: async (query: string) => {
      if (!query.includes('timelineItems')) throw new Error(`unexpected: ${query}`)
      timelineAsked++
      return { node: { timelineItems: timelinePage() } }
    },
  } as unknown as GitHub
  return gh
}

describe('reading a pull request', () => {
  it('says when its conversation goes on past what it reads', async () => {
    const short = await readPull(pullWith(3), REF)
    expect(short.entries).toHaveLength(300)
    expect(short.cut).toBe(false)

    // As many pages as it reads, and one more.
    const long = await readPull(pullWith(10), REF)
    expect(long.entries).toHaveLength(900)
    expect(long.cut).toBe(true)
    // Exactly as many pages as it reads is all of it.
    expect((await readPull(pullWith(9), REF)).cut).toBe(false)
  })
})

const changedFile = (n: number) => ({ filename: `f${n}.ts`, status: 'added', additions: 1, deletions: 0, sha: `s${n}` })

// A pull request changing `total` files, which GitHub lists up to 3,000 of, as a comparison does up to 300.
function changing(total: number, listed = Math.min(total, 3000)) {
  const gh = {
    rest: async (path: string) => {
      if (path.includes('/compare/'))
        return {
          merge_base_commit: { sha: 'base' },
          files: Array.from({ length: Math.min(total, 300) }, (_, n) => changedFile(n)),
        }
      const page = Number(/[?&]page=(\d+)/.exec(path)![1])
      const from = (page - 1) * 100
      return Array.from({ length: Math.max(0, Math.min(100, listed - from)) }, (_, n) => changedFile(from + n))
    },
    request: async () => ({ data: { repository: { f0: null } }, errors: [] }),
  } as unknown as GitHub
  return readChanges(gh, { ref: REF, baseOid: 'base', headOid: 'head', changedFiles: total })
}

describe('reading what a pull request changed', () => {
  it('says GitHub left files out only when it did', async () => {
    expect((await changing(250)).changes.capped).toBe(false)
    expect((await changing(3000)).changes).toMatchObject({ capped: false })
    const many = await changing(3412)
    expect(many.changes.files).toHaveLength(3000)
    expect(many.changes.capped).toBe(true)
    // A push between GitHub's count and its list took files out: the list is short, but not cut.
    expect((await changing(400, 350)).changes.capped).toBe(false)
  })
})
