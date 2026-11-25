import { computed, reactive, ref, watch } from 'vue'

import { applyFilters, countMatches, defaultFilters, fromQuery, toQuery, type Filters } from '@/lib/filters'
import {
  formatRef,
  namesRun,
  parsePullPath,
  parseRef,
  pullPath,
  sameRef,
  type IssueRef,
  type PullAddress,
  type PullPart,
  type Run,
} from '@/lib/refs'
import { randomId } from '@/lib/text'
import { i18n } from '@/locale'
import type { ItemKind, View } from '@/types'

import { context, itemRef, items } from './data'
import { activeWorkspace, WORKSPACE_PARAM } from './settings'

export const filters = reactive<Filters>(fromQuery(location.search))
export const query = computed(() => toQuery(filters))

/** The list of issues and pull requests, or the workspace's repositories. Each has its own address. */
export type Page = 'items' | 'repos'

const BASE = import.meta.env.BASE_URL

/** A page, or a pull request's own page. */
const pageAt = (path: string): Page | 'pull' =>
  parsePullPath(path) ? 'pull' : path.replace(/\/+$/, '') === `${BASE}repos` ? 'repos' : 'items'

export const page = ref<Page | 'pull'>(pageAt(location.pathname))

const ISSUE_PARAM = 'issue'
const issueAt = (search: string) => parseRef(new URLSearchParams(search).get(ISSUE_PARAM))

/** The issue read beside the list. The list's address names it too. */
export const openIssue = ref<IssueRef | null>(page.value === 'items' ? issueAt(location.search) : null)

const startPull = parsePullPath(location.pathname)
/** The pull request on its own page, and the part of it shown beside the diff. */
export const openPull = ref<IssueRef | null>(startPull?.ref ?? null)
export const pullPart = ref<PullPart>(startPull?.part ?? 'conversation')
/** The commits the diff shows, as the address names them. Null for all the changes. */
export const pullScope = ref<Run | null>(startPull?.run ?? null)

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

// Beside a part that doesn't name them, the commits shown last until a reload.
const pullLink = (pull: PullAddress, ws: string | undefined) => `${pullPath(pull)}${address(ws, '')}`

// Keeps the entry's state, which says whether opening the issue added the entry: see closeIssue().
watch(
  [query, () => activeWorkspace.value?.id, page, openIssue, openPull, pullPart, pullScope],
  ([search, ws, current, issue, pull, part, scope]) => {
    const next =
      current === 'pull' && pull
        ? pullLink({ ref: pull, part, run: scope }, ws)
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

// What an entry added by opening a pull request from the list remembers, so its Back goes back to the list.
const FROM_LIST = 'zimamPull'

/** Opens a pull request on its own page. One opened from another pull request's page takes over its entry. */
export function showPull(pull: IssueRef, part: PullPart) {
  const replace = page.value === 'pull'
  openIssue.value = null
  openPull.value = pull
  pullPart.value = part
  pullScope.value = null
  page.value = 'pull'
  const next = pullLink({ ref: pull, part, run: null }, activeWorkspace.value?.id)
  if (replace) history.replaceState(history.state, '', next)
  else history.pushState({ [FROM_LIST]: PAGE_LOAD }, '', next)
}

/** The issue or pull request closed last, for its row in the list to take the focus back. */
export const closedLast = ref<IssueRef | null>(null)
watch([openIssue, openPull], ([issue, pull], [issueBefore, pullBefore]) => {
  // A copy, so closing the same one again counts as news.
  if ((issueBefore && !issue) || (pullBefore && !pull)) closedLast.value = { ...(issueBefore ?? pullBefore)! }
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
  const pull = parsePullPath(location.pathname)
  openPull.value = pull?.ref ?? null
  if (pull) {
    pullPart.value = pull.part
    // Another part's address doesn't name the commits: they stay as they were.
    if (namesRun(pull.part)) pullScope.value = pull.run
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

/** The issues or the pull requests the list shows, in its order, and the one before and after `open` among them. */
export function neighborsIn(kind: ItemKind, open: () => IssueRef | null) {
  return computed(() => {
    const listed = result.value.items.flatMap((item) => (item.kind === kind ? (itemRef(item) ?? []) : []))
    const at = listed.findIndex((each) => sameRef(each, open()))
    return {
      previous: at > 0 ? listed[at - 1] : null,
      next: at >= 0 ? (listed[at + 1] ?? null) : null,
      at,
      of: listed.length,
    }
  })
}

// Moving between the list's pull requests, from one's page.
export const neighbors = neighborsIn('pr', () => openPull.value)
export const movePull = (to: IssueRef | null) => to && showPull(to, pullPart.value)
