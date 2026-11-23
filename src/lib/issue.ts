import type { IssueState, Label, Person } from '@/types'

import type { GitHub } from './github'
import { ASSIGNEES, closedAs, LABELS, PERSON } from './queries'
import { refKey, type IssueRef } from './refs'

// GitHub signs the links to the files people upload, on this host, anew in every answer. Each lasts five minutes.
const SIGNED_HOST = 'private-user-images.githubusercontent.com'
const SIGNED_FOR = 5 * 60_000

/** The address without its signature, should it be one of GitHub's signed links. */
export function unsigned(address: string): string {
  try {
    const url = new URL(address)
    if (url.hostname !== SIGNED_HOST) return address
    url.searchParams.delete('jwt')
    return url.href
  } catch {
    return address
  }
}

/** Whether the signed links in this thread stop working within a minute. */
export const expiring = (thread: Thread) => Date.now() - thread.readAt > SIGNED_FOR - 60_000

/** How the author of a post is tied to the repository, where GitHub says so. */
const ROLES = ['owner', 'member', 'collaborator', 'contributor'] as const
type Role = (typeof ROLES)[number]

/** Why someone hid a comment. */
const HIDDEN = ['abuse', 'offTopic', 'outdated', 'resolved', 'duplicate', 'spam', 'other'] as const
type Hidden = (typeof HIDDEN)[number]

interface Author extends Person {
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
  state: IssueState
  labels: Label[]
  assignees: Person[]
  post: Post
  comments: Post[]
  /** How many comments there are. `comments` holds the first of them. */
  total: number
  /** Where the next comments start, while there are more. */
  after: string | null
  /** When GitHub was asked for it, which its signed links count from. */
  readAt: number
}

/** Thrown when GitHub finds no such issue: deleted, moved, a pull request's number, or out of the token's reach. */
export class IssueMissing extends Error {}

// A page of comments as large as still costs one point, with the issue around the first.
const PAGE = 100
const COMMENTS = `
  totalCount
  pageInfo { hasNextPage endCursor }
  nodes {
    id url createdAt lastEditedAt isMinimized minimizedReason authorAssociation bodyHTML
    author { kind: __typename ${PERSON} }
  }`

const ISSUE = `
  query($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      issue(number: $number) {
        id url title state stateReason createdAt lastEditedAt authorAssociation bodyHTML
        author { kind: __typename ${PERSON} }
        ${LABELS}
        ${ASSIGNEES}
        comments(first: ${PAGE}) { ${COMMENTS} }
      }
    }
  }`

const MORE = `
  query($id: ID!, $after: String!) {
    node(id: $id) {
      ... on Issue { comments(first: ${PAGE}, after: $after) { ${COMMENTS} } }
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

function toThread(ref: IssueRef, raw: RawIssue, readAt: number): Thread {
  return {
    id: raw.id,
    ref,
    title: raw.title,
    url: raw.url,
    state: raw.state === 'CLOSED' ? closedAs(raw.stateReason) : 'open',
    labels: present(raw.labels?.nodes),
    assignees: present(raw.assignees?.nodes),
    post: toPost({ ...raw, isMinimized: false, minimizedReason: null }),
    comments: present(raw.comments.nodes).map(toPost),
    total: raw.comments.totalCount,
    after: raw.comments.pageInfo.hasNextPage ? raw.comments.pageInfo.endCursor : null,
    readAt,
  }
}

export const nextPage = (thread: Thread) => (thread.after ? Math.min(PAGE, thread.total - thread.comments.length) : 0)

// Opening the same issue again soon after costs nothing, unless it changed since. The signed links in an answer don't
// last, so it's kept only for a minute. What one token read stays with it.
const FRESH = 60_000
const recentFor = new WeakMap<GitHub, Map<string, { version: string; at: number; answer: Promise<Thread> }>>()

/**
 * Reads an issue with its first page of comments, for one point. `version` is when the list last saw it change, so a
 * newer change is read again.
 */
export function readIssue(gh: GitHub, ref: IssueRef, version = ''): Promise<Thread> {
  const recent = recentFor.get(gh) ?? new Map()
  recentFor.set(gh, recent)
  for (const [each, { at }] of recent) if (Date.now() - at >= FRESH) recent.delete(each)
  const key = refKey(ref)
  const last = recent.get(key)
  if (last && last.version === version && Date.now() - last.at < FRESH) return last.answer
  const [owner, name] = ref.repo.split('/')
  const at = Date.now()
  const answer = gh
    .request<{ repository: { issue: RawIssue | null } | null }>(ISSUE, { owner, name, number: ref.number })
    .then(({ data, errors }) => {
      const issue = data.repository?.issue
      if (issue) return toThread(ref, issue, at)
      if (errors.some((error) => error.type === 'NOT_FOUND')) throw new IssueMissing(errors[0].message)
      throw new Error(errors[0]?.message ?? 'No issue in the answer')
    })
  recent.set(key, { version, at, answer })
  answer.catch(() => recent.get(key)?.answer === answer && recent.delete(key))
  return answer
}

/** Reads the next page of comments, for one point, and gives the thread with them added. */
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
