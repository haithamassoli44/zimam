// PROTOTYPE: the pull request page's reads. Not reviewed for production.
import type { Checks, Label, Merge, Person, Review } from '@/types'

import type { GitHub } from './github'
import { AUTHOR_FIELDS, POST_FIELDS, toAuthor, toPost, type Author, type Post } from './issue'
import { ASSIGNEES, LABELS, toChecks, toMerge, toReview } from './queries'
import type { IssueRef } from './refs'

const AUTHOR = `author { ${AUTHOR_FIELDS} }`
const REVIEWER = `requestedReviewer { kind: __typename ... on User { login avatarUrl(size: 64) } ... on Team { name slug avatarUrl(size: 64) } ... on Bot { login avatarUrl(size: 64) } ... on Mannequin { login avatarUrl(size: 64) } }`
const COMMIT =
  'oid abbreviatedOid messageHeadline committedDate author { name avatarUrl(size: 64) user { login } } statusCheckRollup { state }'

const TIMELINE_TYPES = [
  'ISSUE_COMMENT',
  'PULL_REQUEST_REVIEW',
  'PULL_REQUEST_COMMIT',
  'HEAD_REF_FORCE_PUSHED_EVENT',
  'READY_FOR_REVIEW_EVENT',
  'CONVERT_TO_DRAFT_EVENT',
  'REVIEW_REQUESTED_EVENT',
  'REVIEW_REQUEST_REMOVED_EVENT',
  'REVIEW_DISMISSED_EVENT',
  'RENAMED_TITLE_EVENT',
  'BASE_REF_CHANGED_EVENT',
  'MERGED_EVENT',
  'CLOSED_EVENT',
  'REOPENED_EVENT',
  'AUTO_MERGE_ENABLED_EVENT',
]

const TIMELINE_NODES = `
  kind: __typename
  ... on IssueComment { ${POST_FIELDS} }
  ... on PullRequestReview { ${POST_FIELDS} state submittedAt }
  ... on PullRequestCommit { id commit { ${COMMIT} } }
  ... on HeadRefForcePushedEvent { id createdAt actor { ${AUTHOR_FIELDS} } beforeCommit { abbreviatedOid oid } afterCommit { abbreviatedOid oid } }
  ... on ReadyForReviewEvent { id createdAt actor { ${AUTHOR_FIELDS} } }
  ... on ConvertToDraftEvent { id createdAt actor { ${AUTHOR_FIELDS} } }
  ... on ReviewRequestedEvent { id createdAt actor { ${AUTHOR_FIELDS} } ${REVIEWER} }
  ... on ReviewRequestRemovedEvent { id createdAt actor { ${AUTHOR_FIELDS} } ${REVIEWER} }
  ... on ReviewDismissedEvent { id createdAt actor { ${AUTHOR_FIELDS} } dismissalMessage review { author { login } } }
  ... on RenamedTitleEvent { id createdAt actor { ${AUTHOR_FIELDS} } previousTitle currentTitle }
  ... on BaseRefChangedEvent { id createdAt actor { ${AUTHOR_FIELDS} } previousRefName currentRefName }
  ... on MergedEvent { id createdAt actor { ${AUTHOR_FIELDS} } mergeRefName commit { abbreviatedOid } }
  ... on ClosedEvent { id createdAt actor { ${AUTHOR_FIELDS} } }
  ... on ReopenedEvent { id createdAt actor { ${AUTHOR_FIELDS} } }
  ... on AutoMergeEnabledEvent { id createdAt actor { ${AUTHOR_FIELDS} } }`

const THREADS = `
  pageInfo { hasNextPage endCursor }
  nodes {
    id path line originalLine diffSide isResolved isOutdated subjectType
    resolvedBy { login }
    comments(first: 50) {
      totalCount
      nodes { ${POST_FIELDS} diffHunk outdated pullRequestReview { id } }
    }
  }`

const PULL = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        id url title number state isDraft merged mergedAt createdAt lastEditedAt updatedAt bodyHTML authorAssociation
        ${AUTHOR}
        mergedBy { ${AUTHOR_FIELDS} }
        baseRefName headRefName baseRefOid headRefOid isCrossRepository
        headRepositoryOwner { login }
        additions deletions changedFiles
        reviewDecision mergeable mergeStateStatus
        ${LABELS}
        ${ASSIGNEES}
        reviewRequests(first: 20) { nodes { ${REVIEWER} } }
        latestOpinionatedReviews(first: 20) { nodes { state submittedAt ${AUTHOR} } }
        commits(first: 100) { totalCount nodes { commit { ${COMMIT} } } }
        lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        files(first: 100) { nodes { path viewerViewedState } }
        timelineItems(first: 100, itemTypes: [${TIMELINE_TYPES.join(', ')}]) {
          pageInfo { hasNextPage endCursor }
          nodes { ${TIMELINE_NODES} }
        }
        reviewThreads(first: 100) { ${THREADS} }
      }
    }
  }`

const MORE_TIMELINE = `
  query($id: ID!, $after: String!) {
    node(id: $id) {
      ... on PullRequest {
        timelineItems(first: 100, after: $after, itemTypes: [${TIMELINE_TYPES.join(', ')}]) {
          pageInfo { hasNextPage endCursor }
          nodes { ${TIMELINE_NODES} }
        }
      }
    }
  }`

const MORE_THREADS = `
  query($id: ID!, $after: String!) {
    node(id: $id) { ... on PullRequest { reviewThreads(first: 100, after: $after) { ${THREADS} } } }
  }`

export type Reviewer =
  | { kind: 'user' | 'bot'; login: string; avatarUrl: string }
  | { kind: 'team'; name: string; avatarUrl: string }

export interface Commit {
  oid: string
  short: string
  headline: string
  at: string
  author: { name: string; login: string | null; avatarUrl: string }
  checks: Checks | null
}

export type Verdict = 'approved' | 'changes' | 'commented' | 'dismissed' | 'pending'

export interface ThreadComment extends Post {
  reviewId: string | null
  diffHunk: string
}

export interface ReviewThread {
  id: string
  path: string
  /** The line in the file as it is now, on the side the thread is on. Null once the code it was on has changed. */
  line: number | null
  originalLine: number | null
  side: 'old' | 'new'
  resolved: boolean
  resolvedBy: string | null
  outdated: boolean
  onFile: boolean
  comments: ThreadComment[]
  total: number
}

export type Entry =
  | { kind: 'comment'; id: string; at: string; post: Post }
  | { kind: 'review'; id: string; at: string; post: Post; verdict: Verdict; threads: ReviewThread[] }
  | { kind: 'commits'; id: string; at: string; commits: Commit[] }
  | { kind: 'forcePushed'; id: string; at: string; actor: Author | null; before: string | null; after: string | null }
  | { kind: 'ready' | 'draft' | 'closed' | 'reopened' | 'autoMerge'; id: string; at: string; actor: Author | null }
  | { kind: 'requested' | 'unrequested'; id: string; at: string; actor: Author | null; reviewer: Reviewer | null }
  | { kind: 'dismissed'; id: string; at: string; actor: Author | null; whose: string | null; message: string | null }
  | { kind: 'renamed'; id: string; at: string; actor: Author | null; from: string; to: string }
  | { kind: 'rebased'; id: string; at: string; actor: Author | null; from: string; to: string }
  | { kind: 'merged'; id: string; at: string; actor: Author | null; into: string; commit: string | null }

export type PullState = 'open' | 'draft' | 'merged' | 'closed'

/** Whether an entry is someone's post, a comment or a review, and not an event. */
export const isPost = (entry: Entry): entry is Extract<Entry, { kind: 'comment' | 'review' }> =>
  entry.kind === 'comment' || entry.kind === 'review'

/** Where a pull request stands on review: a verdict, someone still asked to review, or what its branch's rules ask. */
export type ReviewStanding = 'approved' | 'changes' | 'awaiting' | Review

export function reviewStanding(pull: Pull): ReviewStanding {
  if (pull.review === 'approved' || pull.review === 'changes' || pull.review === 'draft') return pull.review
  return pull.requested.length ? 'awaiting' : pull.review
}

/** Where a pull request stands on merging: done, closed, in conflict, behind its base, clear, or not known yet. */
export type MergeStanding = 'merged' | 'closed' | 'conflicts' | 'behind' | 'clean' | 'checking'

export function mergeStanding(pull: Pull): MergeStanding {
  if (pull.state === 'merged' || pull.state === 'closed') return pull.state
  if (pull.merge === 'conflicts') return 'conflicts'
  if (pull.behind) return 'behind'
  return pull.merge === 'clean' ? 'clean' : 'checking'
}

/** A changed file as GitHub's pull request lists it: whether the reader ticked it viewed there. */
export interface ChangedFileSummary {
  path: string
  viewedOnGitHub: 'VIEWED' | 'UNVIEWED' | 'DISMISSED'
}

export interface Pull {
  id: string
  ref: IssueRef
  url: string
  title: string
  state: PullState
  post: Post
  mergedBy: Author | null
  mergedAt: string | null
  updatedAt: string
  base: string
  head: string
  headOwner: string | null
  cross: boolean
  baseOid: string
  headOid: string
  additions: number
  deletions: number
  changedFiles: number
  review: Review
  merge: Merge | null
  /** Behind its base, where the base requires it to be up to date. */
  behind: boolean
  checks: Checks | null
  labels: Label[]
  assignees: Person[]
  requested: Reviewer[]
  verdicts: { verdict: Verdict; at: string; author: Author | null }[]
  commits: Commit[]
  commitCount: number
  files: ChangedFileSummary[]
  entries: Entry[]
  threads: ReviewThread[]
}

type Raw = any // PROTOTYPE: the raw answer isn't typed field by field.

// A review is a post dated when it was submitted, not when its writer started it.
const toReviewPost = (raw: Raw): Post => toPost({ ...raw, createdAt: raw.submittedAt ?? raw.createdAt })

function toReviewer(raw: Raw): Reviewer | null {
  const who = raw?.requestedReviewer
  if (!who) return null
  if (who.kind === 'Team') return { kind: 'team', name: who.name, avatarUrl: who.avatarUrl }
  return { kind: who.kind === 'Bot' ? 'bot' : 'user', login: who.login, avatarUrl: who.avatarUrl }
}

const VERDICTS: Record<string, Verdict> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
}

function toCommit(raw: Raw): Commit {
  return {
    oid: raw.oid,
    short: raw.abbreviatedOid,
    headline: raw.messageHeadline,
    at: raw.committedDate,
    author: {
      name: raw.author?.name ?? '',
      login: raw.author?.user?.login ?? null,
      avatarUrl: raw.author?.avatarUrl ?? '',
    },
    checks: toChecks(raw.statusCheckRollup?.state),
  }
}

function toThread(raw: Raw): ReviewThread {
  const comments = (raw.comments.nodes as Raw[]).filter(Boolean).map((comment): ThreadComment => ({
    ...toPost(comment),
    reviewId: comment.pullRequestReview?.id ?? null,
    diffHunk: comment.diffHunk ?? '',
  }))
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line,
    originalLine: raw.originalLine,
    side: raw.diffSide === 'LEFT' ? 'old' : 'new',
    resolved: raw.isResolved,
    resolvedBy: raw.resolvedBy?.login ?? null,
    outdated: raw.isOutdated,
    onFile: raw.subjectType === 'FILE',
    comments,
    total: raw.comments.totalCount,
  }
}

function toEntries(nodes: Raw[], threads: ReviewThread[]): Entry[] {
  const byReview = new Map<string, ReviewThread[]>()
  for (const thread of threads) {
    const review = thread.comments[0]?.reviewId
    if (review) byReview.set(review, [...(byReview.get(review) ?? []), thread])
  }
  const entries: Entry[] = []
  for (const node of nodes) {
    if (!node) continue
    const actor = toAuthor(node.actor)
    const base = { id: node.id, at: node.createdAt }
    switch (node.kind) {
      case 'IssueComment':
        entries.push({ kind: 'comment', ...base, post: toPost(node) })
        break
      case 'PullRequestReview': {
        const threadsOf = byReview.get(node.id) ?? []
        const verdict = VERDICTS[node.state] ?? 'commented'
        // A review that only answered inside threads shows as those answers, under the review that started each.
        if (verdict === 'commented' && !node.bodyHTML && !threadsOf.length) break
        entries.push({
          kind: 'review',
          id: node.id,
          at: node.submittedAt ?? node.createdAt,
          post: toReviewPost(node),
          verdict,
          threads: threadsOf,
        })
        break
      }
      case 'PullRequestCommit': {
        const commit = toCommit(node.commit)
        const last = entries.at(-1)
        if (last?.kind === 'commits') {
          last.commits.push(commit)
          last.at = commit.at
        } else entries.push({ kind: 'commits', id: node.id, at: commit.at, commits: [commit] })
        break
      }
      case 'HeadRefForcePushedEvent':
        entries.push({
          kind: 'forcePushed',
          ...base,
          actor,
          before: node.beforeCommit?.abbreviatedOid ?? null,
          after: node.afterCommit?.abbreviatedOid ?? null,
        })
        break
      case 'ReadyForReviewEvent':
        entries.push({ kind: 'ready', ...base, actor })
        break
      case 'ConvertToDraftEvent':
        entries.push({ kind: 'draft', ...base, actor })
        break
      case 'ClosedEvent':
        entries.push({ kind: 'closed', ...base, actor })
        break
      case 'ReopenedEvent':
        entries.push({ kind: 'reopened', ...base, actor })
        break
      case 'AutoMergeEnabledEvent':
        entries.push({ kind: 'autoMerge', ...base, actor })
        break
      case 'ReviewRequestedEvent':
        entries.push({ kind: 'requested', ...base, actor, reviewer: toReviewer(node) })
        break
      case 'ReviewRequestRemovedEvent':
        entries.push({ kind: 'unrequested', ...base, actor, reviewer: toReviewer(node) })
        break
      case 'ReviewDismissedEvent':
        entries.push({
          kind: 'dismissed',
          ...base,
          actor,
          whose: node.review?.author?.login ?? null,
          message: node.dismissalMessage ?? null,
        })
        break
      case 'RenamedTitleEvent':
        entries.push({ kind: 'renamed', ...base, actor, from: node.previousTitle, to: node.currentTitle })
        break
      case 'BaseRefChangedEvent':
        entries.push({ kind: 'rebased', ...base, actor, from: node.previousRefName, to: node.currentRefName })
        break
      case 'MergedEvent':
        entries.push({
          kind: 'merged',
          ...base,
          actor,
          into: node.mergeRefName,
          commit: node.commit?.abbreviatedOid ?? null,
        })
        break
    }
  }
  return entries
}

/** Reads a pull request with its conversation, reviews, threads and commits. About 2 points, more for long ones. */
export async function readPull(gh: GitHub, ref: IssueRef): Promise<Pull> {
  const [owner, name] = ref.repo.split('/')
  const { data, errors } = await gh.request<Raw>(PULL, { owner, name, number: ref.number })
  const raw = data.repository?.pullRequest
  if (!raw) throw new Error(errors[0]?.message ?? 'No pull request in the answer')

  const timeline: Raw[] = [...raw.timelineItems.nodes]
  let page = raw.timelineItems.pageInfo
  for (let more = 0; page.hasNextPage && more < 8; more++) {
    const next = await gh.query<Raw>(MORE_TIMELINE, { id: raw.id, after: page.endCursor })
    timeline.push(...next.node.timelineItems.nodes)
    page = next.node.timelineItems.pageInfo
  }
  const threadNodes: Raw[] = [...raw.reviewThreads.nodes]
  let threadPage = raw.reviewThreads.pageInfo
  for (let more = 0; threadPage.hasNextPage && more < 5; more++) {
    const next = await gh.query<Raw>(MORE_THREADS, { id: raw.id, after: threadPage.endCursor })
    threadNodes.push(...next.node.reviewThreads.nodes)
    threadPage = next.node.reviewThreads.pageInfo
  }
  const threads = threadNodes.filter(Boolean).map(toThread)
  const state: PullState = raw.merged ? 'merged' : raw.state === 'CLOSED' ? 'closed' : raw.isDraft ? 'draft' : 'open'

  return {
    id: raw.id,
    ref,
    url: raw.url,
    title: raw.title,
    state,
    post: toPost(raw),
    mergedBy: toAuthor(raw.mergedBy),
    mergedAt: raw.mergedAt,
    updatedAt: raw.updatedAt,
    base: raw.baseRefName,
    head: raw.headRefName,
    headOwner: raw.headRepositoryOwner?.login ?? null,
    cross: raw.isCrossRepository,
    baseOid: raw.baseRefOid,
    headOid: raw.headRefOid,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    review: toReview(raw),
    merge: toMerge(raw),
    behind: raw.mergeStateStatus === 'BEHIND',
    checks: toChecks(raw.lastCommit.nodes[0]?.commit.statusCheckRollup?.state),
    labels: raw.labels?.nodes.filter(Boolean) ?? [],
    assignees: raw.assignees?.nodes.filter(Boolean) ?? [],
    requested: (raw.reviewRequests.nodes as Raw[]).map(toReviewer).filter((r): r is Reviewer => !!r),
    verdicts: (raw.latestOpinionatedReviews.nodes as Raw[]).filter(Boolean).map((review) => ({
      verdict: VERDICTS[review.state] ?? 'commented',
      at: review.submittedAt,
      author: toAuthor(review.author),
    })),
    commits: (raw.commits.nodes as Raw[]).map((node) => toCommit(node.commit)),
    commitCount: raw.commits.totalCount,
    files: (raw.files.nodes as Raw[]).map((file) => ({
      path: file.path,
      viewedOnGitHub: file.viewerViewedState,
    })),
    entries: toEntries(timeline, threads),
    threads,
  }
}
