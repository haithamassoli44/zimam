import {
  CHECKS,
  INVOLVEMENTS,
  ITEM_KINDS,
  ITEM_STATES,
  MERGES,
  REVIEWS,
  type Checks,
  type Involvement,
  type Item,
  type ItemKind,
  type ItemState,
  type Me,
  type Merge,
  type Repo,
  type Review,
} from '@/types'

import { normalize } from './text'

export const REPO_STATUSES = ['active', 'archived'] as const
const RANGES = ['day', 'week', 'month', 'quarter', 'stale'] as const
export const SORTS = ['updated', 'ready', 'created', 'oldest', 'comments', 'quiet'] as const

export type RepoStatus = (typeof REPO_STATUSES)[number]
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
  me: Involvement[]
  review: Review[]
  checks: Checks[]
  merge: Merge[]
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
  me: INVOLVEMENTS,
  review: REVIEWS,
  checks: CHECKS,
  merge: MERGES,
  updated: RANGES,
}

// Values an older Zimam wrote into addresses and views, and what they mean now.
const RENAMED: Partial<Record<Facet, Record<string, string>>> = { review: { pending: 'required' } }

/** A record's own entry. Typed or linked words like `constructor` mustn't find what every object inherits. */
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined =>
  record && Object.hasOwn(record, key) ? record[key] : undefined

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
    me: [],
    review: [],
    checks: [],
    merge: [],
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
    const values = params.getAll(facet).map((value) => own(RENAMED[facet], value) ?? value)
    ;(filters[facet] as string[]) = [...new Set(values)].filter((value) => value && (!known || known.includes(value)))
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

/**
 * Picks or unpicks one of a fixed set of values, where none picked means every value. Of two, picking one drops the
 * other, so it switches between them: both picked would show what none picked shows. Of more, picks add up.
 */
export function pickChoice<T extends string>(picked: readonly T[], value: T, choices: readonly T[]): T[] {
  if (picked.includes(value)) return picked.filter((other) => other !== value)
  return choices.length === 2 ? [value] : [...picked, value]
}

export function toggleValue(filters: Filters, facet: Facet, value: string) {
  ;(filters[facet] as string[]) = pickChoice(filters[facet] as string[], value, CHOICES[facet] ?? [])
}

export interface Context {
  repos: Map<string, Repo>
  now: number
  me: Me
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
    me: involvement(item, ctx.me),
    review: item.review ? [item.review] : [],
    checks: item.checks ? [item.checks] : [],
    merge: item.merge ? [item.merge] : [],
    updated: RANGES.filter((range) => inRange(item, range, ctx.now)),
  }
}

function involvement(item: Item, me: Me): Involvement[] {
  if (!me.login) return []
  const login = me.login.toLowerCase()
  const values: Involvement[] = []
  if (me.requested.has(item.id) && item.state === 'open') values.push('review')
  if (item.assignees.some((person) => person.login.toLowerCase() === login)) values.push('assigned')
  if (item.author?.login.toLowerCase() === login) values.push('authored')
  return values
}

/** A search: words an item's text must hold, and qualifiers such as `label:bug` or `-author:bot`. */
export interface Search {
  terms: string[]
  qualifiers: Qualifier[]
}

/** Keeps items with any of its values in its facet, or with none of them when `negated`. */
export interface Qualifier {
  pairs: [Facet, string][]
  negated: boolean
}

/** What can be typed before a colon, and the facet each value goes to. `is:` and `no:` take fixed values instead. */
const KEYS: Record<string, Facet> = {
  author: 'author',
  assignee: 'assignee',
  label: 'label',
  repo: 'repo',
  org: 'owner',
  user: 'owner',
  owner: 'owner',
  review: 'review',
  checks: 'checks',
  involves: 'me',
}

const IS: Record<string, [Facet, string]> = {
  open: ['state', 'open'],
  closed: ['state', 'closed'],
  merged: ['state', 'merged'],
  issue: ['kind', 'issue'],
  pr: ['kind', 'pr'],
  draft: ['review', 'draft'],
  archived: ['status', 'archived'],
  conflicting: ['merge', 'conflicts'],
}

const NO: Record<string, [Facet, string]> = { label: ['label', NONE], assignee: ['assignee', NONE] }

const parsed = new Map<string, Search>()

/** Splits a search into words and qualifiers. Quotes keep spaces in a value: `label:"good first issue"`. */
export function parseSearch(q: string): Search {
  let search = parsed.get(q)
  if (search) return search
  search = { terms: [], qualifiers: [] }
  for (const [, token] of q.matchAll(/((?:[^\s"]|"[^"]*"?)+)/g)) {
    const match = /^(-?)([a-z]+):(.+)$/i.exec(token)
    const key = match?.[2].toLowerCase() ?? ''
    if (!match || !(Object.hasOwn(KEYS, key) || key === 'is' || key === 'no')) {
      const word = normalize(token.replaceAll('"', ''))
      if (word) search.terms.push(word)
      continue
    }
    const values = match[3]
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((value) => value.replaceAll('"', '').trim())
      .filter(Boolean)
    // An `is:` or `no:` value Zimam doesn't know gives no pair, so its qualifier matches nothing, as on GitHub.
    const pairs = values.flatMap((value): [Facet, string][] => {
      if (key === 'is' || key === 'no') {
        const pair = own(key === 'is' ? IS : NO, value.toLowerCase())
        return pair ? [pair] : []
      }
      return [[KEYS[key], own(RENAMED[KEYS[key]], value.toLowerCase()) ?? value]]
    })
    if (values.length) search.qualifiers.push({ pairs, negated: match[1] === '-' })
  }
  if (parsed.size > 100) parsed.clear()
  parsed.set(q, search)
  return search
}

const searchText = new WeakMap<Item, string>()

function matchesText(item: Item, terms: string[], ctx: Context): boolean {
  if (!terms.length) return true
  let text = searchText.get(item)
  if (text === undefined) {
    const repo = ctx.repos.get(item.repoId)
    text = normalize([item.title, `#${item.number}`, repo?.fullName ?? '', ...item.labels.map((l) => l.name)].join(' '))
    searchText.set(item, text)
  }
  return terms.every((term) => text.includes(term))
}

// Values are compared without case. A repository matches by its full name or its name alone, and `@me` is whoever
// the token belongs to, so `involves:@me` is anything that involves them.
function holds(values: Record<Facet, string[]>, facet: Facet, wanted: string, ctx: Context): boolean {
  if (facet === 'me' && wanted === '@me') return values.me.length > 0
  const target = (
    wanted === '@me' && (facet === 'author' || facet === 'assignee') ? ctx.me.login : wanted
  )?.toLowerCase()
  if (!target) return false
  return values[facet].some((held) => {
    const lower = held.toLowerCase()
    return lower === target || (facet === 'repo' && lower.slice(lower.indexOf('/') + 1) === target)
  })
}

function matchesSearch(item: Item, values: Record<Facet, string[]>, search: Search, ctx: Context): boolean {
  if (!matchesText(item, search.terms, ctx)) return false
  return search.qualifiers.every(
    ({ pairs, negated }) => pairs.some(([facet, value]) => holds(values, facet, value, ctx)) !== negated,
  )
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

interface Result {
  items: Item[]
  counts: Record<Facet, Map<string, number>>
}

// A value's count is how many items would match if it were picked, so items failing only its facet count toward it.
export function applyFilters(all: Iterable<Item>, filters: Filters, ctx: Context): Result {
  const search = parseSearch(filters.q)
  const counts = Object.fromEntries(FACETS.map((facet) => [facet, new Map()])) as Result['counts']
  const items: Item[] = []
  for (const item of all) {
    const values = facetValues(item, ctx)
    if (!matchesSearch(item, values, search, ctx)) continue
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

/** Tells whether one item matches the filters, the way the list decides it. */
export function matcher(filters: Filters, ctx: Context): (item: Item) => boolean {
  const search = parseSearch(filters.q)
  return (item) => {
    const values = facetValues(item, ctx)
    return matchesSearch(item, values, search, ctx) && !failures(values, filters).length
  }
}

export function countMatches(all: Iterable<Item>, filters: Filters, ctx: Context): number {
  const matches = matcher(filters, ctx)
  let count = 0
  for (const item of all) if (matches(item)) count++
  return count
}

/**
 * How close an open pull request is to merging, lower first: approved and passing, then passing where no review is
 * required, then waiting on its checks, then on a review. Blocked ones follow (changes requested, failing checks or
 * conflicts), then drafts, then everything that isn't an open pull request. No checks at all counts as passing.
 */
function readiness(item: Item): number {
  if (item.kind !== 'pr' || item.state !== 'open') return 6
  if (item.review === 'draft') return 5
  if (item.review === 'changes' || item.checks === 'failure' || item.merge === 'conflicts') return 4
  if (item.checks === 'pending') return 2
  if (item.review === 'required') return 3
  return item.review === 'approved' ? 0 : 1
}

const latest = (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt)

const SORTERS: Record<Sort, (a: Item, b: Item) => number> = {
  updated: latest,
  ready: (a, b) => readiness(a) - readiness(b) || latest(a, b),
  created: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  comments: (a, b) => b.comments - a.comments || b.updatedAt.localeCompare(a.updatedAt),
  quiet: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
}
