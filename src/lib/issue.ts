import type { Label, Person } from '@/types'

import type { GitHub } from './github'

/** Where an issue lives: `owner/name#number`, the way GitHub writes a reference. */
export interface IssueRef {
  repo: string
  number: number
}

const REF = /^([\w.-]+\/[\w.-]+)#([1-9]\d{0,8})$/

export function parseRef(text: string | null | undefined): IssueRef | null {
  const match = REF.exec(text ?? '')
  return match ? { repo: match[1], number: Number(match[2]) } : null
}

export const formatRef = (ref: IssueRef) => `${ref.repo}#${ref.number}`

/** GitHub doesn't mind the case of a repository's name, so neither does this. */
export const sameRef = (a: IssueRef | null, b: IssueRef | null) =>
  !!a && !!b && a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase()

export const issueUrl = (ref: IssueRef) => `https://github.com/${ref.repo}/issues/${ref.number}`

/** How the author of a post is tied to the repository, where GitHub says so. */
export const ROLES = ['owner', 'member', 'collaborator', 'contributor'] as const
export type Role = (typeof ROLES)[number]

/** Why someone hid a comment. */
export const HIDDEN = ['abuse', 'offTopic', 'outdated', 'resolved', 'duplicate', 'spam', 'other'] as const
export type Hidden = (typeof HIDDEN)[number]

export interface Author extends Person {
  bot: boolean
}

/** The description of an issue, or one of its comments. */
export interface Post {
  id: string
  url: string
  /** Null for an account that was deleted. */
  author: Author | null
  role: Role | null
  createdAt: string
  edited: boolean
  /** GitHub's rendering of the Markdown. It must go through clean() before it is shown. */
  html: string
  hidden: Hidden | null
}

export interface Thread {
  id: string
  ref: IssueRef
  title: string
  url: string
  state: 'open' | 'closed'
  /** Why a closed issue was closed. */
  closedAs: 'completed' | 'notPlanned' | 'duplicate' | null
  labels: Label[]
  assignees: Person[]
  post: Post
  comments: Post[]
  /** How many comments there are. `comments` holds the first of them. */
  total: number
  /** Where the next comments start, while there are more. */
  after: string | null
}

/** Thrown when GitHub finds no such issue: deleted, moved, a pull request's number, or out of the token's reach. */
export class IssueMissing extends Error {}

// A page of comments as large as still costs one point, with the issue around the first.
const COMMENTS = `
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes {
    id url createdAt lastEditedAt isMinimized minimizedReason authorAssociation bodyHTML
    author { kind: __typename login avatarUrl(size: 64) }
  }`

const ISSUE = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id url title state stateReason createdAt lastEditedAt authorAssociation bodyHTML
        author { kind: __typename login avatarUrl(size: 64) }
        labels(first: 20) { nodes { name color } }
        assignees(first: 10) { nodes { login avatarUrl(size: 64) } }
        comments(first: 100) { ${COMMENTS} }
      }
    }
  }`

const MORE = `
  query($id: ID!, $after: String!) {
    node(id: $id) {
      ... on Issue { comments(first: 100, after: $after) { ${COMMENTS} } }
    }
  }`

interface RawAuthor {
  kind: string
  login: string
  avatarUrl: string
}

interface RawComment {
  id: string
  url: string
  createdAt: string
  lastEditedAt: string | null
  isMinimized: boolean
  minimizedReason: string | null
  authorAssociation: string
  bodyHTML: string
  author: RawAuthor | null
}

interface RawComments {
  totalCount: number
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
  nodes: (RawComment | null)[]
}

interface RawIssue {
  id: string
  url: string
  title: string
  state: string
  stateReason: string | null
  createdAt: string
  lastEditedAt: string | null
  authorAssociation: string
  bodyHTML: string
  author: RawAuthor | null
  labels: { nodes: (Label | null)[] } | null
  assignees: { nodes: (Person | null)[] } | null
  comments: RawComments
}

const toAuthor = (raw: RawAuthor | null): Author | null =>
  raw && { login: raw.login, avatarUrl: raw.avatarUrl, bot: raw.kind === 'Bot' }

const toRole = (association: string): Role | null => {
  const role = association.toLowerCase()
  return (ROLES as readonly string[]).includes(role) ? (role as Role) : null
}

// GitHub has written the reasons as `off-topic` and as `OFF_TOPIC`.
function toHidden(raw: RawComment): Hidden | null {
  if (!raw.isMinimized) return null
  const reason = (raw.minimizedReason ?? '')
    .toLowerCase()
    .replace(/[-_](\w)/g, (_, letter: string) => letter.toUpperCase())
  return (HIDDEN as readonly string[]).includes(reason) ? (reason as Hidden) : 'other'
}

const toPost = (raw: RawComment): Post => ({
  id: raw.id,
  url: raw.url,
  author: toAuthor(raw.author),
  role: toRole(raw.authorAssociation),
  createdAt: raw.createdAt,
  edited: raw.lastEditedAt !== null,
  html: raw.bodyHTML,
  hidden: toHidden(raw),
})

const present = <T>(nodes: (T | null)[] | undefined): T[] => (nodes ?? []).filter((node): node is T => node !== null)

const CLOSED_AS: Record<string, Thread['closedAs']> = {
  COMPLETED: 'completed',
  NOT_PLANNED: 'notPlanned',
  DUPLICATE: 'duplicate',
}

function toThread(ref: IssueRef, raw: RawIssue): Thread {
  const closed = raw.state === 'CLOSED'
  return {
    id: raw.id,
    ref,
    title: raw.title,
    url: raw.url,
    state: closed ? 'closed' : 'open',
    closedAs: closed ? (CLOSED_AS[raw.stateReason ?? ''] ?? 'completed') : null,
    labels: present(raw.labels?.nodes),
    assignees: present(raw.assignees?.nodes),
    post: toPost({ ...raw, isMinimized: false, minimizedReason: null }),
    comments: present(raw.comments.nodes).map(toPost),
    total: raw.comments.totalCount,
    after: raw.comments.pageInfo.hasNextPage ? raw.comments.pageInfo.endCursor : null,
  }
}

// Opening the same issue again soon after costs nothing, unless it changed since. GitHub's image links in the answer
// stop working five minutes after it, so an answer is kept only for a minute. What one token read stays with it.
const FRESH = 60_000
const recentFor = new WeakMap<GitHub, Map<string, { version: string; at: number; answer: Promise<Thread> }>>()

/**
 * Reads an issue with its first 100 comments, for one point. `version` is when the list last saw it change, so a
 * newer change is read again.
 */
export function readIssue(gh: GitHub, ref: IssueRef, version = ''): Promise<Thread> {
  const recent = recentFor.get(gh) ?? new Map()
  recentFor.set(gh, recent)
  for (const [each, { at }] of recent) if (Date.now() - at >= FRESH) recent.delete(each)
  const key = formatRef(ref).toLowerCase()
  const last = recent.get(key)
  if (last && last.version === version && Date.now() - last.at < FRESH) return last.answer
  const [owner, name] = ref.repo.split('/')
  const answer = gh
    .request<{ repository: { issue: RawIssue | null } | null }>(ISSUE, { owner, name, number: ref.number })
    .then(({ data, errors }) => {
      const issue = data.repository?.issue
      if (issue) return toThread(ref, issue)
      if (errors.some((error) => error.type === 'NOT_FOUND')) throw new IssueMissing(errors[0].message)
      throw new Error(errors[0]?.message ?? 'No issue in the answer')
    })
  recent.set(key, { version, at: Date.now(), answer })
  answer.catch(() => recent.get(key)?.answer === answer && recent.delete(key))
  return answer
}

/** Reads the next 100 comments, for one point, and gives the thread with them added. */
export async function readMoreComments(gh: GitHub, thread: Thread): Promise<Thread> {
  if (!thread.after) return thread
  const { data } = await gh.request<{ node: { comments?: RawComments } | null }>(MORE, {
    id: thread.id,
    after: thread.after,
  })
  const page = data.node?.comments
  if (!page) throw new IssueMissing('The issue is gone')
  return {
    ...thread,
    comments: [...thread.comments, ...present(page.nodes).map(toPost)],
    total: page.totalCount,
    after: page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null,
  }
}
