import { computed, reactive, ref, watch } from 'vue'

import { applyFilters, countMatches, defaultFilters, fromQuery, toQuery, type Filters } from '@/lib/filters'
import { formatRef, parseRef, sameRef, type IssueRef } from '@/lib/refs'
import { randomId } from '@/lib/text'
import { i18n } from '@/locale'
import type { View } from '@/types'

import { context, itemRef, items } from './data'
import { activeWorkspace, settings, WORKSPACE_PARAM } from './settings'

export const filters = reactive<Filters>(fromQuery(location.search))
export const query = computed(() => toQuery(filters))

/** The list of issues and pull requests, or the workspace's repositories. Each has its own address. */
export type Page = 'items' | 'repos'

const BASE = import.meta.env.BASE_URL

// PROTOTYPE: a pull request's address is GitHub's, on Zimam's host: swap the host of any pull request link to open it.
// Its last segment names the part beside the diff, as GitHub's names its tab; the conversation has none.
export const PULL_PARTS = ['files', 'conversation', 'commits', 'checks'] as const
export type PullPart = (typeof PULL_PARTS)[number]
// After the files or the commits, it can name the commits the diff shows, as GitHub's does: one commit, `/commits/<sha>`,
// or the changes from one commit to another, `/files/<sha>..<sha>`.
const PULL_PATH = new RegExp(
  `^/([\\w.-]+)/([\\w.-]+)/pull/([1-9]\\d{0,8})(?:/(${PULL_PARTS.filter((part) => part !== 'conversation').join('|')})(?:/([0-9a-f]{7,40}(?:\\.\\.[0-9a-f]{7,40})?))?)?/?$`,
)
function pullAt(path: string): { ref: IssueRef; part: PullPart; scope: string | null } | null {
  const match = PULL_PATH.exec(path.slice(BASE.length - 1))
  if (!match) return null
  const part = (match[4] as PullPart) ?? 'conversation'
  return {
    ref: { repo: `${match[1]}/${match[2]}`, number: Number(match[3]) },
    part,
    scope: part === 'files' || part === 'commits' ? (match[5] ?? null) : null,
  }
}

/** A page, or (PROTOTYPE) a pull request's own page. */
const pageAt = (path: string): Page | 'pull' =>
  pullAt(path) ? 'pull' : path.replace(/\/+$/, '') === `${BASE}repos` ? 'repos' : 'items'

export const page = ref<Page | 'pull'>(pageAt(location.pathname))

const ISSUE_PARAM = 'issue'
const issueAt = (search: string) => parseRef(new URLSearchParams(search).get(ISSUE_PARAM))

/** The issue read beside the list. The list's address names it too. */
export const openIssue = ref<IssueRef | null>(page.value === 'items' ? issueAt(location.search) : null)

/** The pull request on its own page, and the part of it shown beside the diff. */
export const openPull = ref<IssueRef | null>(pullAt(location.pathname)?.ref ?? null)
export const pullPart = ref<PullPart>(pullAt(location.pathname)?.part ?? 'conversation')
/** The commits the diff shows, as the address names them: `<sha>` or `<sha>..<sha>`. Null for all the changes. */
export const pullScope = ref<string | null>(pullAt(location.pathname)?.scope ?? null)

// PROTOTYPE: opened by its address alone, a pull request opens in the workspace that brings its repository.
if (openPull.value && !new URLSearchParams(location.search).get(WORKSPACE_PARAM)) {
  const repo = openPull.value.repo.toLowerCase()
  const owner = repo.split('/')[0]
  const ws = settings.workspaces.find((each) =>
    each.sources.some((source) => source.name.toLowerCase() === (source.kind === 'repo' ? repo : owner)),
  )
  if (ws) settings.activeWorkspaceId = ws.id
}

function address(ws: string | undefined, search: string, issue: IssueRef | null = null): string {
  const params = new URLSearchParams(ws ? { [WORKSPACE_PARAM]: ws } : {})
  for (const [key, value] of new URLSearchParams(search)) params.append(key, value)
  if (issue) params.set(ISSUE_PARAM, formatRef(issue))
  return params.size ? `?${params}` : ''
}

// The list's address carries its filters and the open issue. The repositories' address only names the workspace.
function link(to: Page, ws: string | undefined, search: string, issue: IssueRef | null = null): string {
  return to === 'repos' ? `${BASE}repos${address(ws, '')}` : `${BASE}${address(ws, search, issue)}`
}

// The commits shown go in the address beside the files or the commits. Beside another part, they last until a reload.
function pullLink(pull: IssueRef, part: PullPart, scope: string | null, ws: string | undefined): string {
  const named = scope && (part === 'files' || part === 'commits') ? `/${scope}` : ''
  return `${BASE}${pull.repo}/pull/${pull.number}${part === 'conversation' ? '' : `/${part}`}${named}${address(ws, '')}`
}

// Keeps the entry's state, which says whether opening the issue added the entry: see closeIssue().
watch(
  [query, () => activeWorkspace.value?.id, page, openIssue, openPull, pullPart, pullScope],
  ([search, ws, current, issue, pull, part, scope]) => {
    const next =
      current === 'pull' && pull
        ? pullLink(pull, part, scope, ws)
        : link(current === 'pull' ? 'items' : current, ws, search, issue)
    if (next !== location.pathname + location.search) history.replaceState(history.state, '', next + location.hash)
  },
  { immediate: true },
)

/** Opens a page as a new entry in the browser's history, so Back returns to the one before. */
export function go(to: Page) {
  if (page.value === to) return
  page.value = to
  openIssue.value = null
  openPull.value = null
  history.pushState(null, '', link(to, activeWorkspace.value?.id, query.value))
}

// PROTOTYPE: what an entry added by opening a pull request from the list remembers, so its Back goes back to the list.
const FROM_LIST = 'zimamPull'

/** Opens a pull request on its own page. One opened from another pull request's page takes over its entry. */
export function showPull(pull: IssueRef, part: PullPart = 'conversation') {
  const replace = page.value === 'pull'
  openIssue.value = null
  openPull.value = pull
  pullPart.value = part
  pullScope.value = null
  page.value = 'pull'
  const next = pullLink(pull, part, null, activeWorkspace.value?.id)
  if (replace) history.replaceState(history.state, '', next)
  else history.pushState({ [FROM_LIST]: PAGE_LOAD }, '', next)
}

/** The pull request last left for the list: its row takes the focus as the list comes back. */
export const leftPull = ref<IssueRef | null>(null)
watch(openPull, (now, before) => {
  if (before && !now) leftPull.value = before
})

/** Leaves the pull request for the list it was opened from, or the list when it was opened by its address. */
export function leavePull() {
  if (history.state?.[FROM_LIST] === PAGE_LOAD) history.back()
  else go('items')
}

// What an entry added by opening an issue remembers: the page load that added it, and the filters it was opened over.
// An entry outlives a reload, but the one before it then belongs to the page that was, and going back loads the app.
const OPENED = 'zimamIssue'
const PAGE_LOAD = randomId()
// Set while going back over that entry, until the browser gets there.
let closing = false

/**
 * Opens an issue beside the list, as a new entry in the browser's history, so Back closes it. One opened in its place
 * takes over that entry, so Back doesn't step through every issue read.
 */
export function showIssue(issue: IssueRef) {
  if (closing || sameRef(openIssue.value, issue)) return
  const next = link('items', activeWorkspace.value?.id, query.value, issue)
  if (openIssue.value) history.replaceState(history.state, '', next)
  else history.pushState({ [OPENED]: { load: PAGE_LOAD, over: query.value } }, '', next)
  openIssue.value = issue
}

/**
 * Closes the issue. When this page load added the entry by opening it, and the filters are as they were, it goes back
 * over the entry, so Back doesn't open the issue again. Otherwise the entry stays, without the issue.
 */
export function closeIssue() {
  if (!openIssue.value || closing) return
  const opened = history.state?.[OPENED]
  if (opened?.load !== PAGE_LOAD || opened.over !== query.value) {
    openIssue.value = null
    history.replaceState(history.state, '', link('items', activeWorkspace.value?.id, query.value))
    return
  }
  closing = true
  history.back()
  // Should the browser not get there, the issue closes all the same.
  setTimeout(() => {
    if (!closing) return
    closing = false
    openIssue.value = null
  }, 1000)
}

addEventListener('popstate', () => {
  closing = false
  page.value = pageAt(location.pathname)
  if (page.value === 'items') Object.assign(filters, fromQuery(location.search))
  openIssue.value = page.value === 'items' ? issueAt(location.search) : null
  const pull = pullAt(location.pathname)
  openPull.value = pull?.ref ?? null
  if (pull) {
    pullPart.value = pull.part
    // Another part's address doesn't name the commits: they stay as they were.
    if (pull.part === 'files' || pull.part === 'commits') pullScope.value = pull.scope
  }
})

/** The address of the list with these filters, on top of the defaults. */
export function itemsLink(picked: Partial<Filters>): string {
  return link('items', activeWorkspace.value?.id, toQuery({ ...defaultFilters(), ...picked }))
}

/** Opens the list with these filters, on top of the defaults. */
export function showItems(picked: Partial<Filters>) {
  Object.assign(filters, defaultFilters(), picked)
  go('items')
}

watch(
  () => activeWorkspace.value?.id,
  (id, previous) => {
    if (previous && id !== previous) {
      resetFilters()
      openIssue.value = null
    }
  },
)

export function resetFilters() {
  Object.assign(filters, defaultFilters())
}

export const result = computed(() => applyFilters(items.value.values(), filters, context.value))

export const viewCounts = computed(() => {
  const views = activeWorkspace.value?.views ?? []
  return new Map(
    views.map((view) => [view.id, countMatches(items.value.values(), fromQuery(view.query), context.value)]),
  )
})

export const activeView = computed(
  () => activeWorkspace.value?.views.find((view) => view.query === query.value) ?? null,
)

export const isDefault = computed(() => query.value === toQuery(defaultFilters()))

export function viewName(view: View): string {
  return view.name ?? i18n.global.t(`presets.${view.preset}`)
}

const lastViewId = ref<string | null>(null)
export const lastView = computed(
  () => activeWorkspace.value?.views.find((view) => view.id === lastViewId.value) ?? null,
)

export const viewDialog = reactive({ open: false, viewId: null as string | null, name: '' })

export function openView(view: View) {
  Object.assign(filters, fromQuery(view.query))
  lastViewId.value = view.id
  go('items')
}

export function askToSave() {
  Object.assign(viewDialog, { open: true, viewId: null, name: '' })
}

export function askToRename(view: View) {
  Object.assign(viewDialog, { open: true, viewId: view.id, name: viewName(view) })
}

export function submitViewDialog() {
  const ws = activeWorkspace.value
  const name = viewDialog.name.trim()
  if (!ws || !name) return
  const view = ws.views.find((other) => other.id === viewDialog.viewId)
  if (view) {
    view.name = name
  } else {
    const created: View = { id: randomId(), name, query: query.value }
    ws.views.push(created)
    lastViewId.value = created.id
  }
  viewDialog.open = false
}

export function updateView(view: View) {
  view.query = query.value
}

export function deleteView(view: View) {
  const ws = activeWorkspace.value
  if (ws) ws.views = ws.views.filter((other) => other.id !== view.id)
}

export function viewLink(view: View): string {
  return `${location.origin}${link('items', activeWorkspace.value?.id, view.query)}`
}

// PROTOTYPE: moving between the list's pull requests, from one's page.

const listed = computed(() => result.value.items.flatMap((item) => (item.kind === 'pr' ? (itemRef(item) ?? []) : [])))
const position = computed(() => listed.value.findIndex((each) => sameRef(each, openPull.value)))
export const neighbors = computed(() => ({
  previous: position.value > 0 ? listed.value[position.value - 1] : null,
  next: position.value >= 0 ? (listed.value[position.value + 1] ?? null) : null,
  at: position.value,
  of: listed.value.length,
}))
export const movePull = (to: IssueRef | null) => to && showPull(to, pullPart.value)
