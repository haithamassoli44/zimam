import { describe, expect, it, vi } from 'vitest'

import type { GitHub, QueryError } from '@/lib/github'
import { expiring, IssueMissing, nextPage, readIssue, readMoreComments } from '@/lib/issue'

const person = (login: string, kind = 'User') => ({
  kind,
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}`,
})

const comment = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  url: `https://github.com/acme/web/issues/12#issuecomment-${id}`,
  createdAt: '2026-11-20T10:00:00Z',
  lastEditedAt: null,
  isMinimized: false,
  minimizedReason: null,
  authorAssociation: 'NONE',
  bodyHTML: `<p>${id}</p>`,
  author: person('octocat'),
  ...overrides,
})

const page = (nodes: unknown[], total = nodes.length, endCursor: string | null = null) => ({
  totalCount: total,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
})

const issue = (overrides: Record<string, unknown> = {}) => ({
  id: 'I_1',
  url: 'https://github.com/acme/web/issues/12',
  title: 'Search ignores hamza',
  state: 'OPEN',
  stateReason: null,
  createdAt: '2026-11-01T10:00:00Z',
  lastEditedAt: '2026-11-02T10:00:00Z',
  authorAssociation: 'MEMBER',
  bodyHTML: '<p>Body</p>',
  author: person('layla'),
  labels: { nodes: [{ name: 'bug', color: 'd73a4a' }, null] },
  assignees: { nodes: [{ login: 'omar', avatarUrl: 'https://avatars.githubusercontent.com/omar' }] },
  comments: page([comment('1')]),
  ...overrides,
})

const found = (raw: unknown) => ({ data: { repository: { issue: raw } }, errors: [] as QueryError[] })

// A GitHub that gives these answers in turn.
function github(...answers: unknown[]) {
  const request = vi.fn()
  for (const each of answers) request.mockResolvedValueOnce(each)
  return { gh: { request } as unknown as GitHub, request }
}

const WEB = { repo: 'acme/web', number: 12 }

const closed = async (stateReason: string | null) =>
  (await readIssue(github(found(issue({ state: 'CLOSED', stateReason }))).gh, WEB)).state

describe('readIssue', () => {
  it('reads the issue, its description and its first comments, by repository and number', async () => {
    const { gh, request } = github(found(issue()))
    const thread = await readIssue(gh, WEB)
    expect(request.mock.calls[0][1]).toEqual({ owner: 'acme', name: 'web', number: 12 })
    expect(thread).toMatchObject({
      id: 'I_1',
      ref: WEB,
      title: 'Search ignores hamza',
      state: 'open',
      labels: [{ name: 'bug', color: 'd73a4a' }],
      assignees: [{ login: 'omar' }],
      total: 1,
      after: null,
    })
    expect(thread.post).toMatchObject({
      url: 'https://github.com/acme/web/issues/12',
      author: { login: 'layla', bot: false },
      role: 'member',
      edited: true,
      html: '<p>Body</p>',
      hidden: null,
    })
    expect(thread.comments).toMatchObject([{ id: '1', role: null, edited: false, html: '<p>1</p>' }])
  })

  it('says why a closed issue was closed', async () => {
    expect(await closed('COMPLETED')).toBe('completed')
    expect(await closed('NOT_PLANNED')).toBe('notPlanned')
    expect(await closed('DUPLICATE')).toBe('duplicate')
    expect(await closed(null)).toBe('completed')
  })

  it('marks bots, roles, deleted accounts and why a comment was hidden', async () => {
    const comments = page([
      comment('bot', { author: person('github-actions', 'Bot'), authorAssociation: 'CONTRIBUTOR' }),
      comment('owner', { authorAssociation: 'OWNER' }),
      comment('ghost', { author: null }),
      comment('topic', { isMinimized: true, minimizedReason: 'off-topic' }),
      comment('upper', { isMinimized: true, minimizedReason: 'OFF_TOPIC' }),
      comment('spam', { isMinimized: true, minimizedReason: 'spam' }),
      comment('new', { isMinimized: true, minimizedReason: 'some-new-reason' }),
      null,
    ])
    const thread = await readIssue(github(found(issue({ comments }))).gh, WEB)
    expect(thread.comments.map((each) => [each.author?.bot ?? null, each.role, each.hidden])).toEqual([
      [true, 'contributor', null],
      [false, 'owner', null],
      [null, null, null],
      [false, null, 'offTopic'],
      [false, null, 'offTopic'],
      [false, null, 'spam'],
      [false, null, 'other'],
    ])
  })

  it('says when GitHub finds no such issue or repository', async () => {
    const missing = { type: 'NOT_FOUND', message: 'Could not resolve to an Issue with the number of 12.' }
    await expect(
      readIssue(github({ data: { repository: { issue: null } }, errors: [missing] }).gh, WEB),
    ).rejects.toThrow(IssueMissing)
    await expect(readIssue(github({ data: { repository: null }, errors: [missing] }).gh, WEB)).rejects.toThrow(
      IssueMissing,
    )
    const forbidden = { type: 'FORBIDDEN', message: 'Resource not accessible' }
    const other = readIssue(github({ data: { repository: { issue: null } }, errors: [forbidden] }).gh, WEB)
    await expect(other).rejects.toThrow('Resource not accessible')
    await expect(other).rejects.not.toThrow(IssueMissing)
  })

  it('reuses an answer for a minute, unless the list saw the issue change since', async () => {
    vi.useFakeTimers()
    try {
      const { gh, request } = github(found(issue()), found(issue()), found(issue()))
      await readIssue(gh, WEB, 'v1')
      await readIssue(gh, { repo: 'Acme/Web', number: 12 }, 'v1')
      expect(request).toHaveBeenCalledTimes(1)
      await readIssue(gh, WEB, 'v2')
      expect(request).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(60_001)
      await readIssue(gh, WEB, 'v2')
      expect(request).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts the life of its signed links from when GitHub was asked, also for an answer reused', async () => {
    vi.useFakeTimers()
    try {
      const { gh } = github(found(issue()))
      const thread = await readIssue(gh, { repo: 'acme/links', number: 1 })
      vi.advanceTimersByTime(59_000)
      expect(await readIssue(gh, { repo: 'acme/links', number: 1 })).toBe(thread)
      vi.advanceTimersByTime(4 * 60_000 - 59_000)
      expect(expiring(thread)).toBe(false)
      vi.advanceTimersByTime(1)
      expect(expiring(thread)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("doesn't keep a failed answer", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(found(issue()))
    const gh = { request } as unknown as GitHub
    await expect(readIssue(gh, WEB)).rejects.toThrow('network')
    await expect(readIssue(gh, WEB)).resolves.toMatchObject({ id: 'I_1' })
  })
})

describe('readMoreComments', () => {
  it('adds the next comments from where the last ones ended', async () => {
    const first = page([comment('1')], 3, 'c1')
    const { gh, request } = github(
      found(issue({ comments: first })),
      { data: { node: { comments: page([comment('2')], 3, 'c2') } }, errors: [] },
      { data: { node: { comments: page([comment('3')], 3) } }, errors: [] },
    )
    let thread = await readIssue(gh, { repo: 'acme/more', number: 1 })
    expect(thread.after).toBe('c1')
    thread = await readMoreComments(gh, thread)
    expect(request.mock.calls[1][1]).toEqual({ id: 'I_1', after: 'c1' })
    thread = await readMoreComments(gh, thread)
    expect(request.mock.calls[2][1]).toEqual({ id: 'I_1', after: 'c2' })
    expect(thread.comments.map((each) => each.id)).toEqual(['1', '2', '3'])
    expect(thread.after).toBeNull()
    expect(await readMoreComments(gh, thread)).toBe(thread)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('says how many comments the next page brings', async () => {
    const { gh } = github(
      found(issue({ comments: page([comment('1')], 250, 'c1') })),
      found(issue({ comments: page([comment('1')], 30, 'c1') })),
      found(issue({ comments: page([comment('1')], 1) })),
    )
    expect(nextPage(await readIssue(gh, { repo: 'acme/many', number: 1 }))).toBe(100)
    expect(nextPage(await readIssue(gh, { repo: 'acme/some', number: 1 }))).toBe(29)
    expect(nextPage(await readIssue(gh, { repo: 'acme/one', number: 1 }))).toBe(0)
  })

  it('says when the issue is gone', async () => {
    const { gh } = github(found(issue({ comments: page([comment('1')], 2, 'c1') })), {
      data: { node: null },
      errors: [],
    })
    const thread = await readIssue(gh, { repo: 'acme/gone', number: 1 })
    await expect(readMoreComments(gh, thread)).rejects.toThrow(IssueMissing)
  })
})
