import type { Repo, Source } from '@/types'

import { GitHubError, type GitHub } from './github'
import { ONE_REPO, ORG_REPOS, OWNER, toRepo, USER_REPOS, VIEWER, type Page, type RawRepo } from './queries'

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

export function sameSource(a: Source, b: Source): boolean {
  return a.kind === b.kind && a.name.toLowerCase() === b.name.toLowerCase()
}

export function belongsTo(repo: Repo, source: Source): boolean {
  const name = source.name.toLowerCase()
  return source.kind === 'repo' ? repo.fullName.toLowerCase() === name : repo.owner.toLowerCase() === name
}

/** Whether a source brings a repository into its workspace: it belongs to the source, and was picked if any were. */
export function brings(source: Source, repo: Repo): boolean {
  return belongsTo(repo, source) && (!source.only || source.only.includes(repo.id))
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
