import {
  CHECKS,
  ITEM_KINDS,
  ITEM_STATES,
  REVIEWS,
  type Checks,
  type Item,
  type ItemKind,
  type ItemState,
  type Repo,
  type Review,
} from '@/types'

import { normalize } from './text'

const REPO_STATUSES = ['active', 'archived'] as const
const RANGES = ['day', 'week', 'month', 'quarter', 'stale'] as const
export const SORTS = ['updated', 'created', 'oldest', 'comments', 'quiet'] as const

type RepoStatus = (typeof REPO_STATUSES)[number]
type Range = (typeof RANGES)[number]
export type Sort = (typeof SORTS)[number]

export const NONE = '-'

export interface Filters {
  kind: ItemKind[]
  state: ItemState[]
  status: RepoStatus[]
  owner: string[]
  repo: string[]
  label: string[]
  author: string[]
  assignee: string[]
  review: Review[]
  checks: Checks[]
  updated: Range[]
  q: string
  sort: Sort
}

export type Facet = Exclude<keyof Filters, 'q' | 'sort'>

const FACETS = (Object.keys(defaultFilters()) as (keyof Filters)[]).filter(
  (key): key is Facet => key !== 'q' && key !== 'sort',
)

/** The values a facet can take, for the facets that have a fixed set. The others take values from the items. */
export const CHOICES: Partial<Record<Facet, readonly string[]>> = {
  kind: ITEM_KINDS,
  state: ITEM_STATES,
  status: REPO_STATUSES,
  review: REVIEWS,
  checks: CHECKS,
  updated: RANGES,
}

export function defaultFilters(): Filters {
  return {
    kind: [],
    state: ['open'],
    status: ['active'],
    owner: [],
    repo: [],
    label: [],
    author: [],
    assignee: [],
    review: [],
    checks: [],
    updated: [],
    q: '',
    sort: 'updated',
  }
}

// Defaults are left out of the URL, and an emptied list is written as `key=` so it differs from the default.
export function toQuery(filters: Filters): string {
  const params = new URLSearchParams()
  const defaults = defaultFilters()
  for (const facet of FACETS) {
    const values = everything(facet, filters[facet]) ? [] : (filters[facet] as string[])
    if (sameList(values, defaults[facet])) continue
    if (values.length === 0) params.append(facet, '')
    for (const value of values.toSorted()) params.append(facet, value)
  }
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.sort !== defaults.sort) params.set('sort', filters.sort)
  return params.toString()
}

export function fromQuery(query: string): Filters {
  const params = new URLSearchParams(query)
  const filters = defaultFilters()
  for (const facet of FACETS) {
    if (!params.has(facet)) continue
    const known = CHOICES[facet]
    ;(filters[facet] as string[]) = params.getAll(facet).filter((value) => value && (!known || known.includes(value)))
  }
  filters.q = params.get('q') ?? ''
  filters.sort = SORTS.find((sort) => sort === params.get('sort')) ?? filters.sort
  return filters
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value))
}

// Every item has a value in these facets, so picking all of their values narrows nothing and means none picked.
// Review and checks aren't among them: issues have neither.
const COVERING: Facet[] = ['kind', 'state', 'status', 'updated']

function everything(facet: Facet, values: readonly string[]): boolean {
  const choices = CHOICES[facet]
  return !!choices && COVERING.includes(facet) && choices.every((choice) => values.includes(choice))
}

/** Picks or unpicks a value, where none picked means every value: picking from none keeps only that value. */
export function toggleValue(filters: Filters, facet: Facet, value: string) {
  const current = filters[facet] as string[]
  const next = !current.length
    ? [value]
    : current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
  ;(filters[facet] as string[]) = everything(facet, next) ? [] : next
}

export interface Context {
  repos: Map<string, Repo>
  now: number
}

const DAY = 86_400_000
const RANGE_DAYS: Record<Exclude<Range, 'stale'>, number> = { day: 1, week: 7, month: 30, quarter: 90 }

function inRange(item: Item, range: Range, now: number): boolean {
  const age = now - Date.parse(item.updatedAt)
  return range === 'stale' ? age > RANGE_DAYS.quarter * DAY : age <= RANGE_DAYS[range] * DAY
}

function facetValues(item: Item, ctx: Context): Record<Facet, string[]> {
  const repo = ctx.repos.get(item.repoId)
  return {
    kind: [item.kind],
    state: [item.state],
    status: [repo?.isArchived ? 'archived' : 'active'],
    owner: [repo?.owner ?? ''],
    repo: [repo?.fullName ?? ''],
    label: item.labels.length ? item.labels.map((label) => label.name) : [NONE],
    // GitHub shows deleted accounts as "ghost".
    author: [item.author?.login ?? 'ghost'],
    assignee: item.assignees.length ? item.assignees.map((person) => person.login) : [NONE],
    review: item.review ? [item.review] : [],
    checks: item.checks ? [item.checks] : [],
    updated: RANGES.filter((range) => inRange(item, range, ctx.now)),
  }
}

const searchText = new WeakMap<Item, string>()

function matchesSearch(item: Item, terms: string[], ctx: Context): boolean {
  if (!terms.length) return true
  let text = searchText.get(item)
  if (text === undefined) {
    const repo = ctx.repos.get(item.repoId)
    text = normalize([item.title, `#${item.number}`, repo?.fullName ?? '', ...item.labels.map((l) => l.name)].join(' '))
    searchText.set(item, text)
  }
  return terms.every((term) => text.includes(term))
}

/** The facets an item fails, stopping at two: an item failing more than one is out of every count. */
function failures(values: Record<Facet, string[]>, filters: Filters): Facet[] {
  const failed: Facet[] = []
  for (const facet of FACETS) {
    const selected = filters[facet] as string[]
    if (selected.length && !values[facet].some((value) => selected.includes(value))) failed.push(facet)
    if (failed.length > 1) break
  }
  return failed
}

const searchTerms = (filters: Filters) => normalize(filters.q).split(/\s+/).filter(Boolean)

interface Result {
  items: Item[]
  counts: Record<Facet, Map<string, number>>
}

// A value's count is how many items would match if it were picked, so items failing only its facet count toward it.
export function applyFilters(all: Iterable<Item>, filters: Filters, ctx: Context): Result {
  const terms = searchTerms(filters)
  const counts = Object.fromEntries(FACETS.map((facet) => [facet, new Map()])) as Result['counts']
  const items: Item[] = []
  for (const item of all) {
    if (!matchesSearch(item, terms, ctx)) continue
    const values = facetValues(item, ctx)
    const failed = failures(values, filters)
    if (failed.length > 1) continue
    for (const facet of FACETS) {
      if (failed.length && failed[0] !== facet) continue
      for (const value of new Set(values[facet])) counts[facet].set(value, (counts[facet].get(value) ?? 0) + 1)
    }
    if (!failed.length) items.push(item)
  }
  items.sort(SORTERS[filters.sort])
  return { items, counts }
}

export function countMatches(all: Iterable<Item>, filters: Filters, ctx: Context): number {
  const terms = searchTerms(filters)
  let count = 0
  for (const item of all) {
    if (matchesSearch(item, terms, ctx) && !failures(facetValues(item, ctx), filters).length) count++
  }
  return count
}

const SORTERS: Record<Sort, (a: Item, b: Item) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  comments: (a, b) => b.comments - a.comments || b.updatedAt.localeCompare(a.updatedAt),
  quiet: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
}
