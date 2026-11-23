import { describe, expect, it } from 'vitest'

import { repoItems, SEARCH, stateOf, toItem, toStatus, type RawItem } from '@/lib/queries'

const rawPr = (overrides: Partial<RawItem>): RawItem => ({
  kind: 'PullRequest',
  id: 'P1',
  number: 1,
  title: '',
  url: '',
  state: 'OPEN',
  isDraft: false,
  reviewDecision: null,
  mergeable: 'CONFLICTING',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
  createdAt: '',
  updatedAt: '',
  author: null,
  assignees: { nodes: [] },
  labels: { nodes: [] },
  comments: { totalCount: 0 },
  repository: { id: 'R1' },
  ...overrides,
})

const review = (raw: Partial<RawItem>) => toStatus({ isDraft: false, reviewDecision: null, ...raw }, true).review
const merge = (mergeable?: RawItem['mergeable']) => toStatus({ mergeable }, true).merge

describe('reading a pull request', () => {
  it("tells a review GitHub requires from one it doesn't", () => {
    expect(review({ isDraft: true, reviewDecision: 'REVIEW_REQUIRED' })).toBe('draft')
    expect(review({ reviewDecision: 'REVIEW_REQUIRED' })).toBe('required')
    expect(review({ reviewDecision: null })).toBe('optional')
    expect(review({ reviewDecision: 'APPROVED' })).toBe('approved')
    expect(review({ reviewDecision: 'CHANGES_REQUESTED' })).toBe('changes')
  })

  it('knows whether it conflicts only once GitHub does', () => {
    expect(merge('CONFLICTING')).toBe('conflicts')
    expect(merge('MERGEABLE')).toBe('clean')
    expect(merge('UNKNOWN')).toBeNull()
    expect(merge()).toBeNull()
  })

  it('shows checks and conflicts only while it is open', () => {
    expect(toItem(rawPr({}))).toMatchObject({ checks: 'failure', merge: 'conflicts' })
    expect(toItem(rawPr({ state: 'MERGED' }))).toMatchObject({ checks: null, merge: null, review: 'optional' })
  })
})

const closedIssue = (stateReason: string | null) =>
  toItem({ ...rawPr({}), kind: 'Issue', state: 'CLOSED', stateReason }).notPlanned

describe('reading an issue', () => {
  it('counts one closed as not planned or as a duplicate as not done', () => {
    expect(closedIssue('NOT_PLANNED')).toBe(true)
    expect(closedIssue('DUPLICATE')).toBe(true)
    expect(closedIssue('COMPLETED')).toBe(false)
    expect(closedIssue(null)).toBe(false)
  })
})

describe('stateOf', () => {
  it("tells an issue's state from the list's copy, which counts a duplicate as not planned", () => {
    expect(stateOf({ state: 'open', notPlanned: false })).toBe('open')
    expect(stateOf({ state: 'closed', notPlanned: false })).toBe('completed')
    expect(stateOf({ state: 'closed', notPlanned: true })).toBe('notPlanned')
  })
})

describe('page sizes', () => {
  // Measured with GitHub's dry run and real charges on 2026-11-22: the largest pages that cost one point each. A change
  // to what a page asks for needs measuring again.
  it('ask for the most items that still cost one point', () => {
    expect(repoItems('issues', true).size).toBe(74)
    expect(repoItems('issues', false).size).toBe(74)
    expect(repoItems('pullRequests', true).size).toBe(49)
    expect(repoItems('pullRequests', false).size).toBe(74)
    expect(SEARCH).toContain('first: 49,')
  })
})
