// A pull request, read whole for its own page: its conversation, reviews and threads, commits and changed files.
import type { Checks, Label, Merge, Person, PullState, Review, ReviewStanding } from '@/types'

import type { PullHeads } from './changes'
import type { GitHub } from './github'
import type { Who } from './people'
import { AUTHOR_FIELDS, DESCRIPTION_FIELDS, POST_FIELDS, toAuthor, toPost, type Author, type Post } from './posts'
import { ASSIGNEES, LABELS, pullState, toChecks, toMerge, toReview, toState } from './queries'
import type { IssueRef } from './refs'

const AUTHOR = `author { ${AUTHOR_FIELDS} }`
const REVIEWER = `requestedReviewer { kind: __typename ... on User { login avatarUrl(size: 64) } ... on Team { name slug organization { login } avatarUrl(size: 64) } ... on Bot { login avatarUrl(size: 64) } ... on Mannequin { login avatarUrl(size: 64) } }`
const COMMIT =
  'oid abbreviatedOid messageHeadline committedDate author { name avatarUrl(size: 64) user { login } } statusCheckRollup { state }'

/** How an event in the conversation became an entry, with who did it and when. */
type Base = { id: string; at: string; actor: Author | null }

// The events the conversation shows, by GitHub's type: what to read of each, and the entry it makes.
const EVENTS: Record<string, { fields?: string; entry: (node: Raw, base: Base) => Entry }> = {
  HeadRefForcePushedEvent: {
    fields: 'beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid }',
    entry: (node, base) => ({
      kind: 'forcePushed',
      ...base,
      before: node.beforeCommit?.abbreviatedOid ?? null,
      after: node.afterCommit?.abbreviatedOid ?? null,
    }),
  },
  ReadyForReviewEvent: { entry: (_, base) => ({ kind: 'ready', ...base }) },
  ConvertToDraftEvent: { entry: (_, base) => ({ kind: 'draft', ...base }) },
  ClosedEvent: { entry: (_, base) => ({ kind: 'closed', ...base }) },
  ReopenedEvent: { entry: (_, base) => ({ kind: 'reopened', ...base }) },
  AutoMergeEnabledEvent: { entry: (_, base) => ({ kind: 'autoMerge', ...base }) },
  ReviewRequestedEvent: {
    fields: REVIEWER,
    entry: (node, base) => ({ kind: 'requested', ...base, reviewer: toReviewer(node) }),
  },
  ReviewRequestRemovedEvent: {
    fields: REVIEWER,
    entry: (node, base) => ({ kind: 'unrequested', ...base, reviewer: toReviewer(node) }),
  },
  ReviewDismissedEvent: {
    fields: 'dismissalMessage review { author { login } }',
    entry: (node, base) => ({
      kind: 'dismissed',
      ...base,
      whose: node.review?.author?.login ?? null,
      message: node.dismissalMessage ?? null,
    }),
  },
  RenamedTitleEvent: {
    fields: 'previousTitle currentTitle',
    entry: (node, base) => ({ kind: 'renamed', ...base, from: node.previousTitle, to: node.currentTitle }),
  },
  BaseRefChangedEvent: {
    fields: 'previousRefName currentRefName',
    entry: (node, base) => ({ kind: 'rebased', ...base, from: node.previousRefName, to: node.currentRefName }),
  },
  MergedEvent: {
    fields: 'mergeRefName commit { abbreviatedOid }',
    entry: (node, base) => ({
      kind: 'merged',
      ...base,
      into: node.mergeRefName,
      commit: node.commit?.abbreviatedOid ?? null,
    }),
  },
}

// The conversation's entries: posts and pushes, then the events. GitHub names the types to ask for in capitals.
const TIMELINE = {
  IssueComment: POST_FIELDS,
  PullRequestReview: `${POST_FIELDS} state submittedAt`,
  PullRequestCommit: `id commit { ${COMMIT} }`,
  ...Object.fromEntries(
    Object.entries(EVENTS).map(([type, event]) => [
      type,
      `id createdAt actor { ${AUTHOR_FIELDS} } ${event.fields ?? ''}`,
    ]),
  ),
}
const TIMELINE_TYPES = Object.keys(TIMELINE).map((type) => type.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase())
const TIMELINE_NODES = `kind: __typename ${Object.entries(TIMELINE)
  .map(([type, fields]) => `... on ${type} { ${fields} }`)
  .join(' ')}`

// What the pull request lists 100 to a page, and how many pages past the first each reads. The rest is left out.
const LISTS = {
  timelineItems: { args: `itemTypes: [${TIMELINE_TYPES.join(', ')}]`, nodes: TIMELINE_NODES, more: 8 },
  reviewThreads: {
    args: '',
    nodes: `id path line originalLine diffSide isResolved isOutdated subjectType resolvedBy { login }
      comments(first: 50) { totalCount nodes { ${POST_FIELDS} diffHunk outdated pullRequestReview { id } } }`,
    more: 5,
  },
  files: { args: '', nodes: 'path viewerViewedState', more: 9 },
}
type List = keyof typeof LISTS
const page = (list: List, after: boolean) =>
  `${list}(first: 100${after ? ', after: $after' : ''}${LISTS[list].args && `, ${LISTS[list].args}`}) {
    pageInfo { hasNextPage endCursor }
    nodes { ${LISTS[list].nodes} }
  }`

const PULL = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        ${DESCRIPTION_FIELDS} title number state isDraft mergedAt updatedAt
        mergedBy { ${AUTHOR_FIELDS} }
        baseRefName headRefName baseRefOid headRefOid isCrossRepository
        headRepositoryOwner { login }
        additions deletions changedFiles
        reviewDecision mergeable mergeStateStatus
        ${LABELS}
        ${ASSIGNEES}
        reviewRequests(first: 20) { nodes { ${REVIEWER} } }
        latestOpinionatedReviews(first: 20) { nodes { state submittedAt ${AUTHOR} } }
        commits(first: 100) { totalCount nodes { commit { ${COMMIT} messageBody parents(first: 1) { nodes { oid } } } } }
        lastCommit: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        ${page('files', false)}
        ${page('timelineItems', false)}
        ${page('reviewThreads', false)}
      }
    }
  }`

/** The rest of one of the pull request's lists, a page at a time, as far as its limit, and whether that was all. */
async function restOf(gh: GitHub, id: string, list: List, first: Raw): Promise<{ nodes: Raw[]; all: boolean }> {
  const query = `query($id: ID!, $after: String!) { node(id: $id) { ... on PullRequest { ${page(list, true)} } } }`
  const nodes: Raw[] = [...first.nodes]
  let at = first.pageInfo
  for (let more = 0; at.hasNextPage && more < LISTS[list].more; more++) {
    const next = (await gh.query<Raw>(query, { id, after: at.endCursor })).node[list]
    nodes.push(...next.nodes)
    at = next.pageInfo
  }
  return { nodes: nodes.filter(Boolean), all: !at.hasNextPage }
}

export interface Commit {
  oid: string
  short: string
  headline: string
  /** The message after its first line. Read for the pull request's own list of commits, not its timeline's. */
  body: string
  /** The commit it follows: its first parent, as a diff of the commit alone starts from. */
  parent: string | null
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
  | { kind: 'requested' | 'unrequested'; id: string; at: string; actor: Author | null; reviewer: Who | null }
  | { kind: 'dismissed'; id: string; at: string; actor: Author | null; whose: string | null; message: string | null }
  | { kind: 'renamed'; id: string; at: string; actor: Author | null; from: string; to: string }
  | { kind: 'rebased'; id: string; at: string; actor: Author | null; from: string; to: string }
  | { kind: 'merged'; id: string; at: string; actor: Author | null; into: string; commit: string | null }

/** Whether an entry is someone's post, a comment or a review, and not an event. */
export const isPost = (entry: Entry): entry is Extract<Entry, { kind: 'comment' | 'review' }> =>
  entry.kind === 'comment' || entry.kind === 'review'

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
  requested: Who[]
  verdicts: { verdict: Verdict; at: string; author: Author | null }[]
  commits: Commit[]
  commitCount: number
  files: ChangedFileSummary[]
  entries: Entry[]
  threads: ReviewThread[]
  /** Whether its conversation or its review threads go on past what is read of them, the latest left out. */
  cut: boolean
}

type Raw = any // The raw answer isn't typed field by field.

// A review is dated when it was submitted, not when its writer started it.
const reviewedAt = (raw: Raw): string => raw.submittedAt ?? raw.createdAt
const verdictOf = (raw: Raw): Verdict => VERDICTS[raw.state] ?? 'commented'

function toReviewer(raw: Raw): Who | null {
  const who = raw?.requestedReviewer
  if (!who) return null
  if (who.kind === 'Team')
    return { login: null, name: who.name, avatarUrl: who.avatarUrl, team: `${who.organization?.login}/${who.slug}` }
  return { login: who.login, avatarUrl: who.avatarUrl, bot: who.kind === 'Bot' }
}

const VERDICTS: Record<string, Verdict> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
  PENDING: 'pending',
}

// GitHub cuts a long first line short with `…`, and starts the rest of the message with the rest of it after a `…`.
function splitMessage(headline: string, body: string): { headline: string; body: string } {
  if (!headline.endsWith('…') || !body.startsWith('…')) return { headline, body }
  const [rest, ...more] = body.slice(1).split('\n')
  return { headline: headline.slice(0, -1) + rest, body: more.join('\n').trim() }
}

function toCommit(raw: Raw): Commit {
  const message = splitMessage(raw.messageHeadline, raw.messageBody?.trim() ?? '')
  return {
    oid: raw.oid,
    short: raw.abbreviatedOid,
    headline: message.headline,
    body: message.body,
    parent: raw.parents?.nodes[0]?.oid ?? null,
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
        const verdict = verdictOf(node)
        // A review that only answered inside threads shows as those answers, under the review that started each.
        if (verdict === 'commented' && !node.bodyHTML && !threadsOf.length) break
        entries.push({
          kind: 'review',
          id: node.id,
          at: reviewedAt(node),
          post: toPost({ ...node, createdAt: reviewedAt(node) }),
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
      default: {
        const event = EVENTS[node.kind]
        if (event) entries.push(event.entry(node, { ...base, actor }))
      }
    }
  }
  return entries
}

/**
 * Reads a pull request with its conversation, reviews, threads and commits. About 2 points, more for long ones.
 * `onHeads` hears where it starts and ends from the first answer, before a long one's other pages, so what it changed
 * can be read meanwhile.
 */
export async function readPull(gh: GitHub, ref: IssueRef, onHeads?: (heads: PullHeads) => void): Promise<Pull> {
  const [owner, name] = ref.repo.split('/')
  const { data, errors } = await gh.request<Raw>(PULL, { owner, name, number: ref.number })
  const raw = data.repository?.pullRequest
  if (!raw) throw new Error(errors[0]?.message ?? 'No pull request in the answer')
  onHeads?.({ ref, baseOid: raw.baseRefOid, headOid: raw.headRefOid, changedFiles: raw.changedFiles })

  const [timeline, threadNodes, files] = await Promise.all(
    (['timelineItems', 'reviewThreads', 'files'] as const).map((list) => restOf(gh, raw.id, list, raw[list])),
  )
  const threads = threadNodes.nodes.map(toThread)

  return {
    id: raw.id,
    ref,
    url: raw.url,
    title: raw.title,
    state: pullState(toState(raw.state), raw.isDraft),
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
    requested: (raw.reviewRequests.nodes as Raw[]).map(toReviewer).filter((who) => who !== null),
    verdicts: (raw.latestOpinionatedReviews.nodes as Raw[]).filter(Boolean).map((review) => ({
      verdict: verdictOf(review),
      at: reviewedAt(review),
      author: toAuthor(review.author),
    })),
    commits: (raw.commits.nodes as Raw[]).map((node) => toCommit(node.commit)),
    commitCount: raw.commits.totalCount,
    files: files.nodes.map((file) => ({ path: file.path, viewedOnGitHub: file.viewerViewedState })),
    entries: toEntries(timeline.nodes, threads),
    threads,
    cut: !timeline.all || !threadNodes.all,
  }
}
