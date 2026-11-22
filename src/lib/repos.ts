import type { Item, Repo } from '@/types'

import { REPO_STATUSES, type RepoStatus } from './filters'
import { normalize } from './text'

const WEEK = 7 * 86_400_000
/** How many weeks of new issues and pull requests each repository shows: about six months. */
export const WEEKS = 26

export const REPO_SORTS = ['activity', 'name', 'issues', 'prs', 'awaiting', 'failing'] as const

export type RepoSort = (typeof REPO_SORTS)[number]

export interface RepoRow {
  repo: Repo
  /** Open pull requests waiting for a review, as the Awaiting review view counts them. */
  awaiting: number
  /** Open pull requests whose checks fail. */
  failing: number
  /** The last push, or the last change to one of its issues or pull requests, whichever came later. */
  activeAt: number
  /** Issues and pull requests opened in each of the last WEEKS weeks, oldest first. The last week ends now. */
  weeks: number[]
}

export interface RepoFilters {
  q: string
  /** None picked means both. */
  status: RepoStatus[]
  sort: RepoSort
}

export function defaultRepoFilters(): RepoFilters {
  return { q: '', status: ['active'], sort: 'activity' }
}

export const statusOf = (repo: Repo): RepoStatus => (repo.isArchived ? 'archived' : 'active')

export function repoRows(repos: Iterable<Repo>, items: Iterable<Item>, now: number): RepoRow[] {
  const rows = new Map<string, RepoRow>()
  for (const repo of repos) {
    const pushedAt = repo.pushedAt ? Date.parse(repo.pushedAt) : 0
    rows.set(repo.id, { repo, awaiting: 0, failing: 0, activeAt: pushedAt, weeks: Array<number>(WEEKS).fill(0) })
  }
  for (const item of items) {
    const row = rows.get(item.repoId)
    if (!row) continue
    row.activeAt = Math.max(row.activeAt, Date.parse(item.updatedAt))
    const week = Math.floor((now - Date.parse(item.createdAt)) / WEEK)
    if (week >= 0 && week < WEEKS) row.weeks[WEEKS - 1 - week]++
    if (item.kind !== 'pr' || item.state !== 'open') continue
    if (item.review === 'pending') row.awaiting++
    if (item.checks === 'failure') row.failing++
  }
  return [...rows.values()]
}

const searchText = new WeakMap<Repo, string>()

function matches(repo: Repo, terms: string[]): boolean {
  if (!terms.length) return true
  let text = searchText.get(repo)
  if (text === undefined) {
    text = normalize(`${repo.fullName} ${repo.description ?? ''}`)
    searchText.set(repo, text)
  }
  return terms.every((term) => text.includes(term))
}

const byName = (a: RepoRow, b: RepoRow) => a.repo.fullName.localeCompare(b.repo.fullName)
const most = (count: (row: RepoRow) => number) => (a: RepoRow, b: RepoRow) =>
  count(b) - count(a) || b.activeAt - a.activeAt || byName(a, b)

const ORDER: Record<RepoSort, (a: RepoRow, b: RepoRow) => number> = {
  activity: most((row) => row.activeAt),
  name: byName,
  issues: most((row) => row.repo.openIssues),
  prs: most((row) => row.repo.openPrs),
  awaiting: most((row) => row.awaiting),
  failing: most((row) => row.failing),
}

/** The rows the filters keep, in their order, with how many rows the search finds in each status. */
export function pickRows(rows: RepoRow[], filters: RepoFilters) {
  const terms = normalize(filters.q).split(/\s+/).filter(Boolean)
  const counts: Record<RepoStatus, number> = { active: 0, archived: 0 }
  const picked: RepoRow[] = []
  for (const row of rows) {
    if (!matches(row.repo, terms)) continue
    const status = statusOf(row.repo)
    counts[status]++
    if (!filters.status.length || filters.status.includes(status)) picked.push(row)
  }
  return { rows: picked.toSorted(ORDER[filters.sort]), counts }
}

/** Picks or unpicks a status. Picking both is the same as picking none. */
export function toggleStatus(filters: RepoFilters, status: RepoStatus) {
  const current = filters.status
  const next = !current.length
    ? [status]
    : current.includes(status)
      ? current.filter((other) => other !== status)
      : [...current, status]
  filters.status = next.length === REPO_STATUSES.length ? [] : next
}
