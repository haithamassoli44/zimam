// What someone wrote: an issue's or a pull request's description, a comment, a review, a comment in a review's thread.
import type { Person } from '@/types'

import { PERSON } from './queries'

/** How the author of a post is tied to the repository, where GitHub says so. */
const ROLES = ['owner', 'member', 'collaborator', 'contributor'] as const
type Role = (typeof ROLES)[number]

/** Why someone hid a comment. */
const HIDDEN = ['abuse', 'offTopic', 'outdated', 'resolved', 'duplicate', 'spam', 'other'] as const
type Hidden = (typeof HIDDEN)[number]

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

/** Who wrote something, and whether a bot did. */
export const AUTHOR_FIELDS = `kind: __typename ${PERSON}`
/** A description's fields, as toPost() reads them: it can't be hidden. */
export const DESCRIPTION_FIELDS = `id url createdAt lastEditedAt authorAssociation bodyHTML author { ${AUTHOR_FIELDS} }`
/** A comment's fields, as toPost() reads them: an issue's comment, or a pull request's review or thread comment. */
export const POST_FIELDS = `${DESCRIPTION_FIELDS} isMinimized minimizedReason`

export interface RawAuthor {
  kind: string
  login: string
  avatarUrl: string
}

export interface RawComment {
  id: string
  url: string
  createdAt: string
  lastEditedAt: string | null
  /** Left out for a description. */
  isMinimized?: boolean
  minimizedReason?: string | null
  authorAssociation: string
  bodyHTML: string
  author: RawAuthor | null
}

export const toAuthor = (raw: RawAuthor | null): Author | null =>
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

export const toPost = (raw: RawComment): Post => ({
  id: raw.id,
  url: raw.url,
  author: toAuthor(raw.author),
  role: toRole(raw.authorAssociation),
  createdAt: raw.createdAt,
  edited: raw.lastEditedAt !== null,
  html: raw.bodyHTML,
  hidden: toHidden(raw),
})
