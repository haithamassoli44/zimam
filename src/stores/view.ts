import { computed, reactive, ref, watch } from 'vue'

import {
  applyFilters,
  countMatches,
  defaultFilters,
  fromQuery,
  toQuery,
  type Context,
  type Filters,
} from '@/lib/filters'
import { randomId } from '@/lib/text'
import { i18n } from '@/locale'
import type { View } from '@/types'

import { now } from './clock'
import { items, repos } from './data'
import { activeWorkspace, WORKSPACE_PARAM } from './settings'

export const filters = reactive<Filters>(fromQuery(location.search))
export const query = computed(() => toQuery(filters))

/** The list of issues and pull requests, or the workspace's repositories. Each has its own address. */
export type Page = 'items' | 'repos'

const BASE = import.meta.env.BASE_URL
const pageAt = (path: string): Page => (path.replace(/\/+$/, '') === `${BASE}repos` ? 'repos' : 'items')

export const page = ref<Page>(pageAt(location.pathname))

function address(ws: string | undefined, search: string): string {
  const params = new URLSearchParams(ws ? { [WORKSPACE_PARAM]: ws } : {})
  for (const [key, value] of new URLSearchParams(search)) params.append(key, value)
  return params.size ? `?${params}` : ''
}

// The list's address carries its filters. The repositories' address only names the workspace.
function link(to: Page, ws: string | undefined, search: string): string {
  return to === 'repos' ? `${BASE}repos${address(ws, '')}` : `${BASE}${address(ws, search)}`
}

watch(
  [query, () => activeWorkspace.value?.id, page],
  ([search, ws, current]) => {
    const next = link(current, ws, search)
    if (next !== location.pathname + location.search) history.replaceState(null, '', next)
  },
  { immediate: true },
)

/** Opens a page as a new entry in the browser's history, so Back returns to the one before. */
export function go(to: Page) {
  if (page.value === to) return
  page.value = to
  history.pushState(null, '', link(to, activeWorkspace.value?.id, query.value))
}

addEventListener('popstate', () => {
  page.value = pageAt(location.pathname)
  if (page.value === 'items') Object.assign(filters, fromQuery(location.search))
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
    if (previous && id !== previous) resetFilters()
  },
)

export function resetFilters() {
  Object.assign(filters, defaultFilters())
}

const context = computed<Context>(() => ({ repos: repos.value, now: now.value }))

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
