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

export const statusOf = (repo: Pick<Repo, 'isArchived'> | undefined): RepoStatus =>
  repo?.isArchived ? 'archived' : 'active'

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

// Time ranges nest, so one is picked at a time.
const SINGLE: Facet[] = ['updated']
export const singlePick = (facet: Facet) => SINGLE.includes(facet)

/** Picks or unpicks a value, by the facet's rule. */
export function toggleValue(filters: Filters, facet: Facet, value: string) {
  const picked = filters[facet] as string[]
  let next: string[]
  if (singlePick(facet)) next = picked.includes(value) ? [] : [value]
  else if (COVERING.includes(facet)) next = pickChoice(picked, value, CHOICES[facet] ?? [])
  else next = picked.includes(value) ? picked.filter((other) => other !== value) : [...picked, value]
  ;(filters[facet] as string[]) = next
}

export interface Context {
  repos: Map<string, Repo>
  now: number
  me: Me
}

const DAY = 86_400_000
const QUARTER = 90 * DAY

// The ranges an item updated this long ago falls in. They nest, so each age gives one of these few lists.
const AGES: [number, readonly Range[]][] = [
  [DAY, ['day', 'week', 'month', 'quarter']],
  [7 * DAY, ['week', 'month', 'quarter']],
  [30 * DAY, ['month', 'quarter']],
  [QUARTER, ['quarter']],
]
const STALE: readonly Range[] = ['stale']
const rangesOf = (age: number) => AGES.find(([most]) => age <= most)?.[1] ?? STALE

/**
 * What the filters read of an item itself, worked out once: a changed item is a new object. Lists the filters
 * compare are shared and never changed.
 */
interface Facts {
  values: Pick<
    Record<Facet, readonly string[]>,
    'kind' | 'state' | 'label' | 'author' | 'assignee' | 'review' | 'checks' | 'merge'
  >
  updated: number
  created: number
  /** The author's and assignees' logins without case, for what involves the reader. */
  author: string | null
  assignees: readonly string[]
  /**
   * Its values in every facet as last read, and the context they were read in: another look through the items in the
   * same context, as after a filter is picked, takes them from here.
   */
  context?: Context
  all?: Values
  /** What a search looks through, once searched, and the repository name it holds: see matchesText. */
  text?: string
  textRepo?: string
}

const known = new WeakMap<Item, Facts>()
const NOTHING: readonly string[] = []

// The same values make the same lists, shared by every item that has them: a big workspace has tens of thousands.
const lists = new Map<string, readonly string[]>()

/** The list of one value. */
function one(value: string): readonly string[] {
  let list = lists.get(value)
  if (!list) lists.set(value, (list = [value]))
  return list
}

/** A list of values. Values never hold a line break, so a list of several never takes one value's key. */
function listOf(values: string[]): readonly string[] {
  if (values.length < 2) return values.length ? one(values[0]) : NOTHING
  const key = values.join('\n')
  let list = lists.get(key)
  if (!list) lists.set(key, (list = values))
  return list
}

function factsOf(item: Item): Facts {
  let facts = known.get(item)
  if (facts) return facts
  facts = {
    values: {
      kind: one(item.kind),
      state: one(item.state),
      label: item.labels.length ? listOf(item.labels.map((label) => label.name)) : one(NONE),
      // GitHub shows deleted accounts as "ghost".
      author: one(item.author?.login ?? 'ghost'),
      assignee: item.assignees.length ? listOf(item.assignees.map((person) => person.login)) : one(NONE),
      review: item.review ? one(item.review) : NOTHING,
      checks: item.checks ? one(item.checks) : NOTHING,
      merge: item.merge ? one(item.merge) : NOTHING,
    },
    updated: Date.parse(item.updatedAt),
    created: Date.parse(item.createdAt),
    author: item.author?.login.toLowerCase() ?? null,
    assignees: item.assignees.length ? listOf(item.assignees.map((person) => person.login.toLowerCase())) : NOTHING,
  }
  known.set(item, facts)
  return facts
}

/** When an item was last updated and opened, in milliseconds. */
export function timesOf(item: Item): { updated: number; created: number } {
  return factsOf(item)
}

// What the filters read of a repository, once for each.
const repoValues = new WeakMap<Repo, Pick<Record<Facet, readonly string[]>, 'status' | 'owner' | 'repo'>>()
const NO_REPO = { status: [statusOf(undefined)], owner: [''], repo: [''] }

function repoOf(repo: Repo | undefined) {
  if (!repo) return NO_REPO
  let values = repoValues.get(repo)
  if (!values) {
    values = { status: [statusOf(repo)], owner: [repo.owner], repo: [repo.fullName] }
    repoValues.set(repo, values)
  }
  return values
}

type Values = Record<Facet, readonly string[]>

/** A look through the items: what's the same for all of them, read once. */
interface Pass {
  ctx: Context
  /** The reader's login without case, or null before it's known. */
  login: string | null
}

const passOf = (ctx: Context): Pass => ({ ctx, login: ctx.me.login?.toLowerCase() ?? null })

function facetValues(item: Item, facts: Facts, pass: Pass): Values {
  if (facts.context === pass.ctx && facts.all) return facts.all
  const { values } = facts
  const repo = repoOf(pass.ctx.repos.get(item.repoId))
  facts.context = pass.ctx
  facts.all = {
    kind: values.kind,
    state: values.state,
    status: repo.status,
    owner: repo.owner,
    repo: repo.repo,
    label: values.label,
    author: values.author,
    assignee: values.assignee,
    me: involvement(item, facts, pass),
    review: values.review,
    checks: values.checks,
    merge: values.merge,
    updated: rangesOf(pass.ctx.now - facts.updated),
  }
  return facts.all
}

function involvement(item: Item, facts: Facts, { login, ctx }: Pass): readonly Involvement[] {
  if (!login) return []
  const values: Involvement[] = []
  if (ctx.me.requested.has(item.id) && item.state === 'open') values.push('review')
  if (facts.assignees.includes(login)) values.push('assigned')
  if (facts.author === login) values.push('authored')
  return values
}

/** A search: words an item's text must hold, and qualifiers such as `label:bug` or `-author:bot`. */
export interface Search {
  terms: string[]
  qualifiers: Qualifier[]
}

/** Keeps items with any of its values in its facet, or with none of them when `negated`. */
interface Qualifier {
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

// An item's title, number, repository and labels: what a search's words look for.
function matchesText(item: Item, facts: Facts, terms: string[], ctx: Context): boolean {
  if (!terms.length) return true
  // A repository renamed keeps its items as they were, so the text is made again once its name isn't the one it holds.
  const repo = ctx.repos.get(item.repoId)?.fullName ?? ''
  if (facts.text === undefined || facts.textRepo !== repo) {
    facts.text = normalize([item.title, `#${item.number}`, repo, ...item.labels.map((label) => label.name)].join(' '))
    facts.textRepo = repo
  }
  for (const term of terms) if (!facts.text.includes(term)) return false
  return true
}

// Values are compared without case. A repository matches by its full name or its name alone, and `@me` is whoever
// the token belongs to, so `involves:@me` is anything that involves them.
function holds(values: Values, facet: Facet, wanted: string, ctx: Context): boolean {
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

const matchesQualifiers = (values: Values, search: Search, ctx: Context) =>
  search.qualifiers.every(
    ({ pairs, negated }) => pairs.some(([facet, value]) => holds(values, facet, value, ctx)) !== negated,
  )

/** Filters ready to test items with: the search, and the values picked in each facet that has some. */
interface Plan {
  search: Search
  picked: [Facet, Set<string>][]
}

function planOf(filters: Filters): Plan {
  const picked: [Facet, Set<string>][] = []
  for (const facet of FACETS) {
    const selected = filters[facet] as string[]
    if (selected.length) picked.push([facet, new Set(selected)])
  }
  return { search: parseSearch(filters.q), picked }
}

/** The one facet an item fails, null for none, or false for more than one: such an item is out of every count. */
function failure(values: Values, plan: Plan): Facet | null | false {
  let failed: Facet | null = null
  for (const [facet, wanted] of plan.picked) {
    if (values[facet].some((value) => wanted.has(value))) continue
    if (failed) return false
    failed = facet
  }
  return failed
}

/** Whether an item has one of the values picked in every facet that has some. */
const passes = (values: Values, plan: Plan) =>
  plan.picked.every(([facet, wanted]) => values[facet].some((value) => wanted.has(value)))

const matches = (item: Item, facts: Facts, values: Values, plan: Plan, ctx: Context) =>
  passes(values, plan) &&
  matchesText(item, facts, plan.search.terms, ctx) &&
  matchesQualifiers(values, plan.search, ctx)

interface Result {
  items: Item[]
  counts: Record<Facet, Map<string, number>>
}

function tally(counts: Map<string, number>, values: readonly string[]) {
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
}

// A value's count is how many items would match if it were picked, so items failing only its facet count toward it.
export function applyFilters(all: Iterable<Item>, filters: Filters, ctx: Context): Result {
  const plan = planOf(filters)
  const pass = passOf(ctx)
  const counts = Object.fromEntries(FACETS.map((facet) => [facet, new Map()])) as Result['counts']
  const items: Item[] = []
  for (const item of all) {
    // The words first: most items fail them, and then their other values aren't needed.
    const facts = factsOf(item)
    if (!matchesText(item, facts, plan.search.terms, ctx)) continue
    const values = facetValues(item, facts, pass)
    if (!matchesQualifiers(values, plan.search, ctx)) continue
    const failed = failure(values, plan)
    if (failed) tally(counts[failed], values[failed])
    else if (failed === null) {
      for (const facet of FACETS) tally(counts[facet], values[facet])
      items.push(item)
    }
  }
  return { items: sortItems(items, filters.sort), counts }
}

/** Tells whether one item matches the filters, the way the list decides it. */
export function matcher(filters: Filters, ctx: Context): (item: Item) => boolean {
  const plan = planOf(filters)
  const pass = passOf(ctx)
  return (item) => {
    const facts = factsOf(item)
    return matches(item, facts, facetValues(item, facts, pass), plan, ctx)
  }
}

/** How many items match each of the filters, in one look through them. */
export function countEach(all: Iterable<Item>, list: Filters[], ctx: Context): number[] {
  const plans = list.map(planOf)
  const pass = passOf(ctx)
  const counts = plans.map(() => 0)
  for (const item of all) {
    const facts = factsOf(item)
    const values = facetValues(item, facts, pass)
    plans.forEach((plan, index) => {
      if (matches(item, facts, values, plan, ctx)) counts[index]++
    })
  }
  return counts
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

// Items sort by their times as numbers, read once for each.
interface Sorted {
  item: Item
  facts: Facts
}

const latest = (a: Sorted, b: Sorted) => b.facts.updated - a.facts.updated

const SORTERS: Record<Sort, (a: Sorted, b: Sorted) => number> = {
  updated: latest,
  ready: (a, b) => readiness(a.item) - readiness(b.item) || latest(a, b),
  created: (a, b) => b.facts.created - a.facts.created,
  oldest: (a, b) => a.facts.created - b.facts.created,
  comments: (a, b) => b.item.comments - a.item.comments || latest(a, b),
  quiet: (a, b) => a.facts.updated - b.facts.updated,
}

function sortItems(items: Item[], sort: Sort): Item[] {
  return items
    .map((item) => ({ item, facts: factsOf(item) }))
    .toSorted(SORTERS[sort])
    .map((each) => each.item)
}
