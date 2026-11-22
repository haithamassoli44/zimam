import type { Checks, Item, Language, Merge, Person, Repo, Review } from '@/types'

const PERSON = 'login avatarUrl(size: 64)'

const SHARED = `
    id number title url state createdAt updatedAt
    author { ${PERSON} }
    assignees(first: 10) { nodes { ${PERSON} } }
    labels(first: 20) { nodes { name color } }
    comments { totalCount }
    repository { id }`

const ISSUE = `fragment IssueFields on Issue { kind: __typename stateReason ${SHARED} }`
const PR = `fragment PrFields on PullRequest { kind: __typename isDraft reviewDecision additions deletions ${SHARED} }`

// What changes on an open pull request without changing its update time: its checks, and whether it conflicts with a
// base branch that moved. Asking for `mergeable` makes GitHub work it out, so closed pull requests don't ask. Every
// query that can return an open pull request asks for these: the sync counts one as checked when it arrives.
const STATUS = 'mergeable commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }'

// GitHub charges a point for every 100 lists a query could open, rounded to the nearest point: the page's own list
// once, and each list inside an item once per item. So a page costs one point while that comes to 148 at most.
const lists = (fields: string) => fields.match(/\b(?:first|last):\s*\d+/g)?.length ?? 0
const pageSize = (...fields: string[]) => Math.floor(148 / Math.max(...fields.map(lists)))

const REPO = `
  fragment RepoFields on Repository {
    id name nameWithOwner description isPrivate isArchived pushedAt owner { login avatarUrl(size: 64) }
    primaryLanguage { name color }
    openIssues: issues(states: OPEN) { totalCount }
    openPrs: pullRequests(states: OPEN) { totalCount }
    allIssues: issues { totalCount }
    allPrs: pullRequests { totalCount }
  }`

const PAGE = 'pageInfo { hasNextPage endCursor }'

export const VIEWER = `
  query {
    viewer {
      login name avatarUrl(size: 96)
      organizations(first: 100) { nodes { login name avatarUrl(size: 96) } }
    }
  }`

export const OWNER = `
  query($login: String!) {
    repositoryOwner(login: $login) { kind: __typename login avatarUrl(size: 96) }
  }`

export const ORG_REPOS = `
  query($login: String!, $after: String) {
    organization(login: $login) { repositories(first: 100, after: $after) { ${PAGE} nodes { ...RepoFields } } }
  }
  ${REPO}`

export const USER_REPOS = `
  query($login: String!, $after: String) {
    user(login: $login) {
      repositories(first: 100, after: $after, ownerAffiliations: [OWNER]) { ${PAGE} nodes { ...RepoFields } }
    }
  }
  ${REPO}`

export const ONE_REPO = `
  query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ...RepoFields } }
  ${REPO}`

/** A page of a repository's issues or pull requests, and the most items it may ask for at one point. */
export function repoItems(kind: 'issues' | 'pullRequests', open: boolean): { query: string; size: number } {
  const fields = kind === 'issues' ? '...IssueFields' : `...PrFields ${open ? STATUS : ''}`
  const states = kind === 'issues' ? 'IssueState' : 'PullRequestState'
  const size = kind === 'issues' ? pageSize(ISSUE) : pageSize(open ? PR + STATUS : PR)
  const query = `
    query($owner: String!, $name: String!, $states: [${states}!], $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        ${kind}(first: $first, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
          ${PAGE} nodes { ${fields} }
        }
      }
    }
    ${kind === 'issues' ? ISSUE : PR}`
  return { query, size }
}

export const SEARCH = `
  query($q: String!, $after: String) {
    search(type: ISSUE, query: $q, first: ${pageSize(ISSUE, PR + STATUS)}, after: $after) {
      issueCount ${PAGE}
      nodes { ... on Issue { ...IssueFields } ... on PullRequest { ...PrFields ${STATUS} } }
    }
  }
  ${ISSUE} ${PR}`

export const NODES = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { id ... on Issue { ...IssueFields } ... on PullRequest { ...PrFields ${STATUS} } }
  }
  ${ISSUE} ${PR}`

export const PR_STATUS = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on PullRequest { id isDraft reviewDecision ${STATUS} } }
  }`

/** The open pull requests that ask for a review from the viewer, or from a team of theirs. Each costs a point. */
export const REVIEW_REQUESTED = `
  query($q: String!, $after: String) {
    viewer { login }
    search(type: ISSUE, query: $q, first: 100, after: $after) { ${PAGE} nodes { ... on PullRequest { id } } }
  }`

export interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: T[]
}

export interface RawRepo {
  id: string
  name: string
  nameWithOwner: string
  description: string | null
  isPrivate: boolean
  isArchived: boolean
  pushedAt: string | null
  owner: { login: string; avatarUrl: string }
  primaryLanguage: Language | null
  openIssues: { totalCount: number }
  openPrs: { totalCount: number }
  allIssues: { totalCount: number }
  allPrs: { totalCount: number }
}

export function toRepo(raw: RawRepo): Repo {
  return {
    id: raw.id,
    owner: raw.owner.login,
    ownerAvatar: raw.owner.avatarUrl,
    name: raw.name,
    fullName: raw.nameWithOwner,
    description: raw.description,
    language: raw.primaryLanguage,
    isPrivate: raw.isPrivate,
    isArchived: raw.isArchived,
    pushedAt: raw.pushedAt,
    openIssues: raw.openIssues.totalCount,
    openPrs: raw.openPrs.totalCount,
    issues: raw.allIssues.totalCount,
    prs: raw.allPrs.totalCount,
  }
}

export interface RawItem {
  kind: 'Issue' | 'PullRequest'
  id: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  stateReason?: string | null
  isDraft?: boolean
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  additions?: number
  deletions?: number
  createdAt: string
  updatedAt: string
  author: Person | null
  assignees: { nodes: Person[] }
  labels: { nodes: { name: string; color: string }[] } | null
  comments: { totalCount: number }
  repository: { id: string }
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

export function toItem(raw: RawItem): Item {
  const isPr = raw.kind === 'PullRequest'
  return {
    id: raw.id,
    kind: isPr ? 'pr' : 'issue',
    repoId: raw.repository.id,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state === 'OPEN' ? 'open' : raw.state === 'MERGED' ? 'merged' : 'closed',
    notPlanned: raw.stateReason === 'NOT_PLANNED' || raw.stateReason === 'DUPLICATE',
    author: raw.author,
    assignees: raw.assignees.nodes,
    labels: raw.labels?.nodes ?? [],
    comments: raw.comments.totalCount,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(isPr ? toStatus(raw, raw.state === 'OPEN') : { review: null, checks: null, merge: null }),
    diff: isPr ? { additions: raw.additions ?? 0, deletions: raw.deletions ?? 0 } : null,
  }
}

/** What a pull request's status says. A closed one has no checks or conflicts that still matter, so it shows none. */
export const STATUS_FIELDS = ['review', 'checks', 'merge'] as const

export type RawStatus = Pick<RawItem, 'isDraft' | 'reviewDecision' | 'mergeable' | 'commits'>

export function toStatus(raw: RawStatus, open: boolean): Pick<Item, (typeof STATUS_FIELDS)[number]> {
  const state = raw.commits?.nodes[0]?.commit.statusCheckRollup?.state
  return { review: toReview(raw), checks: open ? toChecks(state) : null, merge: open ? toMerge(raw) : null }
}

// GitHub gives no decision where the branch doesn't require a review, even after someone approves.
function toReview(raw: Pick<RawItem, 'isDraft' | 'reviewDecision'>): Review {
  if (raw.isDraft) return 'draft'
  if (raw.reviewDecision === 'APPROVED') return 'approved'
  if (raw.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (raw.reviewDecision === 'REVIEW_REQUIRED') return 'required'
  return 'optional'
}

function toMerge(raw: Pick<RawItem, 'mergeable'>): Merge | null {
  if (raw.mergeable === 'CONFLICTING') return 'conflicts'
  if (raw.mergeable === 'MERGEABLE') return 'clean'
  return null
}

/** A combined or single commit status, as GitHub states it. */
export function toChecks(state: string | null | undefined): Checks | null {
  if (state === 'SUCCESS') return 'success'
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return null
}
