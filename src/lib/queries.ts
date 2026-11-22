import type { Checks, Item, Language, Person, Repo, Review } from '@/types'

const PERSON = 'login avatarUrl(size: 64)'

const SHARED = `
    id number title url state createdAt updatedAt
    author { ${PERSON} }
    assignees(first: 10) { nodes { ${PERSON} } }
    labels(first: 20) { nodes { name color } }
    comments { totalCount }
    repository { id }`

const ISSUE = `fragment IssueFields on Issue { kind: __typename stateReason ${SHARED} }`
const PR = `fragment PrFields on PullRequest { kind: __typename isDraft reviewDecision ${SHARED} }`

const CHECKS = 'commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }'

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

export function repoItems(kind: 'issues' | 'pullRequests', withChecks: boolean): string {
  const fields = kind === 'issues' ? '...IssueFields' : `...PrFields ${withChecks ? CHECKS : ''}`
  const states = kind === 'issues' ? 'IssueState' : 'PullRequestState'
  return `
    query($owner: String!, $name: String!, $states: [${states}!], $first: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        ${kind}(first: $first, after: $after, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) {
          ${PAGE} nodes { ${fields} }
        }
      }
    }
    ${kind === 'issues' ? ISSUE : PR}`
}

export const SEARCH = `
  query($q: String!, $after: String) {
    search(type: ISSUE, query: $q, first: 50, after: $after) {
      issueCount ${PAGE}
      nodes { ... on Issue { ...IssueFields } ... on PullRequest { ...PrFields ${CHECKS} } }
    }
  }
  ${ISSUE} ${PR}`

export const NODES = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { id ... on Issue { ...IssueFields } ... on PullRequest { ...PrFields ${CHECKS} } }
  }
  ${ISSUE} ${PR}`

export const PR_STATUS = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) { ... on PullRequest { id isDraft reviewDecision ${CHECKS} } }
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
    review: isPr ? toReview(raw) : null,
    checks: isPr ? toChecks(raw) : null,
  }
}

export function toReview(raw: Pick<RawItem, 'isDraft' | 'reviewDecision'>): Review {
  if (raw.isDraft) return 'draft'
  if (raw.reviewDecision === 'APPROVED') return 'approved'
  if (raw.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  return 'pending'
}

export function toChecks(raw: Pick<RawItem, 'commits'>): Checks | null {
  const state = raw.commits?.nodes[0]?.commit.statusCheckRollup?.state
  if (state === 'SUCCESS') return 'success'
  if (state === 'FAILURE' || state === 'ERROR') return 'failure'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return null
}
