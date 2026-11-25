// Who someone is on GitHub, for the card that shows when a pointer rests on their name or picture.
import type { GitHub } from './github'

/** Someone who wrote, reviewed or did something: a person, a bot, or a team asked to review. */
export interface Who {
  /** Null for a deleted account, a commit's author with no account, and a team. */
  login: string | null
  /** What to call them without a login: a commit author's name, a team's. */
  name?: string | null
  avatarUrl?: string
  bot?: boolean
  /** A team, as `owner/slug`. */
  team?: string
}

/** A GitHub account as its card shows it. */
export interface Profile {
  name: string | null
  bio: string | null
  company: string | null
  location: string | null
  pronouns: string | null
  followers: number
  joined: string
  status: string | null
  /** An organization, which has no followers or status to show. */
  org: boolean
}

const PROFILE = `
  query($login: String!) {
    repositoryOwner(login: $login) {
      kind: __typename
      ... on User { name bio company location pronouns createdAt followers { totalCount } status { message } }
      ... on Organization { name description location createdAt }
    }
  }`

interface RawOwner {
  kind: 'User' | 'Organization'
  name: string | null
  bio?: string | null
  description?: string | null
  company?: string | null
  location: string | null
  pronouns?: string | null
  createdAt: string
  followers?: { totalCount: number }
  status?: { message: string | null } | null
}

const blank = (text: string | null | undefined) => text?.trim() || null

// Read once for each account, by each client. A read that fails is tried again the next time.
const readFor = new WeakMap<GitHub, Map<string, Promise<Profile | null>>>()

/** Someone's profile, for one point the first time. Null for no such account. */
export function readProfile(gh: GitHub, login: string): Promise<Profile | null> {
  const read = readFor.get(gh) ?? new Map()
  readFor.set(gh, read)
  const key = login.toLowerCase()
  let found = read.get(key)
  if (!found) {
    found = fetchProfile(gh, login)
    read.set(key, found)
    found.catch(() => read.delete(key))
  }
  return found
}

async function fetchProfile(gh: GitHub, login: string): Promise<Profile | null> {
  const { repositoryOwner: raw } = await gh.query<{ repositoryOwner: RawOwner | null }>(PROFILE, { login })
  if (!raw) return null
  const org = raw.kind === 'Organization'
  return {
    name: blank(raw.name),
    bio: blank(org ? raw.description : raw.bio),
    company: org ? null : blank(raw.company),
    location: blank(raw.location),
    pronouns: org ? null : blank(raw.pronouns),
    followers: raw.followers?.totalCount ?? 0,
    joined: raw.createdAt,
    status: org ? null : blank(raw.status?.message),
    org,
  }
}

/** Where someone's page is on GitHub. Bots have theirs under apps, teams under their organization. */
export function profileUrl(who: Who): string | null {
  if (who.team) {
    const [owner, slug] = who.team.split('/')
    return `https://github.com/orgs/${owner}/teams/${slug}`
  }
  if (!who.login) return null
  const login = who.login.replace(/\[bot\]$/, '')
  return who.bot ? `https://github.com/apps/${login}` : `https://github.com/${login}`
}
