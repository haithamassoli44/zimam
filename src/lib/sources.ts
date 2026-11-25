import type { Repo, Source } from '@/types'

import { GitHubError, type GitHub } from './github'
import {
  CONTRIBUTED,
  ONE_REPO,
  opened,
  ORG_REPOS,
  OWNER,
  toRepo,
  USER_REPOS,
  VIEWER,
  type Page,
  type RawRepo,
} from './queries'

interface Owner {
  login: string
  name: string | null
  avatarUrl: string
}

export interface Viewer extends Owner {
  organizations: Owner[]
}

export interface SourceChoice {
  source: Source
  label: string
  avatar?: string
}

/** What tells a source apart. GitHub doesn't mind the case of a name. */
export const sourceKey = (source: Source) => `${source.kind}:${source.name.toLowerCase()}`

export const sameSource = (a: Source, b: Source) => sourceKey(a) === sourceKey(b)

/** Whether a repository, by its `owner/name`, belongs to a source: it is the source, or its owner is. */
export function belongsTo(fullName: string, source: Source): boolean {
  const name = source.name.toLowerCase()
  const repo = fullName.toLowerCase()
  return source.kind === 'repo' ? repo === name : repo.split('/')[0] === name
}

/** Whether a source brings a repository into its workspace: it belongs to the source, and was picked if any were. */
export function brings(source: Source, repo: Repo): boolean {
  return belongsTo(repo.fullName, source) && (!source.only || source.only.includes(repo.id))
}

/** The search qualifier that finds a source's issues and pull requests, such as `org:acme`. */
export function qualifier(source: Source): string {
  return `${source.kind}:${source.name}`
}

export function sourcesKey(sources: Source[]): string {
  return JSON.stringify(sources)
}

export async function findViewer(gh: GitHub): Promise<Viewer> {
  const { viewer } = await gh.query<{ viewer: Owner & { organizations: { nodes: Owner[] } } }>(VIEWER)
  return { ...viewer, organizations: viewer.organizations.nodes }
}

/** Looks up what someone typed or pasted: an owner, `owner/repo`, or a github.com link to either. */
export async function findSource(gh: GitHub, typed: string): Promise<SourceChoice | null> {
  const value = typed
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/+$/, '')
  if (!value) return null
  if (value.includes('/')) {
    const [owner, name] = value.split('/')
    const { repository } = await gh.query<{ repository: RawRepo | null }>(ONE_REPO, { owner, name })
    return repository && { source: { kind: 'repo', name: repository.nameWithOwner }, label: repository.nameWithOwner }
  }
  const { repositoryOwner: owner } = await gh.query<{
    repositoryOwner: { kind: string; login: string; avatarUrl: string } | null
  }>(OWNER, { login: value })
  if (!owner) return null
  const kind = owner.kind === 'Organization' ? 'org' : 'user'
  return { source: { kind, name: owner.login }, label: owner.login, avatar: owner.avatarUrl }
}

/** Every repository a source covers. A source GitHub can't find throws a `query` error. */
export async function reposOf(gh: GitHub, source: Source): Promise<Repo[]> {
  if (source.kind === 'repo') {
    const [owner, name] = source.name.split('/')
    const data = await gh.query<{ repository: RawRepo | null }>(ONE_REPO, { owner, name })
    if (!data.repository) throw new GitHubError(source.name, 'query')
    return [toRepo(data.repository)]
  }
  const key = source.kind === 'org' ? 'organization' : 'user'
  const repos: Repo[] = []
  let after: string | null = null
  do {
    const data: Record<string, { repositories: Page<RawRepo | null> } | null> = await gh.query(
      source.kind === 'org' ? ORG_REPOS : USER_REPOS,
      { login: source.name, after },
    )
    const owner = data[key]
    if (!owner) throw new GitHubError(source.name, 'query')
    for (const raw of owner.repositories.nodes) if (raw) repos.push(toRepo(raw))
    after = owner.repositories.pageInfo.hasNextPage ? owner.repositories.pageInfo.endCursor : null
  } while (after)
  return repos
}

export const CONTRIBUTION_KINDS = ['commit', 'pr', 'issue', 'review'] as const
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number]

/** A repository someone contributed to: how, how many pull requests and issues they opened in it, and when last. */
export interface Contribution {
  repo: Repo
  kinds: ContributionKind[]
  prs: number
  issues: number
  /** When they last opened a pull request or issue in it. Unknown for commits and reviews alone. */
  lastAt: string | null
}

/** How many pages of 100 of what someone opened are read, the latest first. Past them, the counts are partial. */
export const OPENED_PAGES = 10

/**
 * The repositories someone contributed to, that the token can read. GitHub lists the recent ones by kind of
 * contribution, 100 of each at most, and what they opened finds the older ones. `partial` names the kinds GitHub
 * listed more of than were read.
 */
export async function contributionsOf(
  gh: GitHub,
  login: string,
): Promise<{ contributions: Contribution[]; partial: ContributionKind[] }> {
  const found = new Map<string, Contribution>()
  const add = (raw: RawRepo, kind: ContributionKind) => {
    let entry = found.get(raw.id)
    if (!entry) found.set(raw.id, (entry = { repo: toRepo(raw), kinds: [], prs: 0, issues: 0, lastAt: null }))
    if (!entry.kinds.includes(kind)) entry.kinds.push(kind)
    return entry
  }
  type User<T> = { user: T | null }
  type Listed = { totalCount: number; nodes: (RawRepo | null)[] }
  const recent = await gh.query<User<Record<ContributionKind, Listed>>>(CONTRIBUTED, { login })
  if (!recent.user) throw new GitHubError(login, 'query')
  const partial = new Set<ContributionKind>()
  for (const kind of CONTRIBUTION_KINDS) {
    const listed = recent.user[kind]
    for (const raw of listed.nodes) if (raw) add(raw, kind)
    if (listed.totalCount > listed.nodes.length) partial.add(kind)
  }
  for (const [kind, list] of [
    ['pr', 'pullRequests'],
    ['issue', 'issues'],
  ] as const) {
    let after: string | null = null
    for (let pages = 0; pages < OPENED_PAGES; pages++) {
      const data: User<{ list: Page<{ createdAt: string; repository: RawRepo | null } | null> }> = await gh.query(
        opened(list),
        { login, after },
      )
      const page = data.user?.list
      if (!page) break
      for (const node of page.nodes) {
        if (!node?.repository) continue
        const entry = add(node.repository, kind)
        if (kind === 'pr') entry.prs++
        else entry.issues++
        if (!entry.lastAt || node.createdAt > entry.lastAt) entry.lastAt = node.createdAt
      }
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
      if (!after) break
    }
    if (after !== null) partial.add(kind)
  }
  for (const entry of found.values())
    entry.kinds.sort((a, b) => CONTRIBUTION_KINDS.indexOf(a) - CONTRIBUTION_KINDS.indexOf(b))
  return { contributions: [...found.values()], partial: CONTRIBUTION_KINDS.filter((kind) => partial.has(kind)) }
}
