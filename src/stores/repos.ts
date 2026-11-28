import { computed, reactive } from 'vue'

import { arrange, defaultRepoFilters, pickRows, repoRows, type RepoFilters } from '@/lib/repos'

import { context, items, repos, status } from './data'
import { activeWorkspace } from './settings'

/** The repositories page's search, statuses and order. They last until the tab closes. */
export const repoFilters = reactive<RepoFilters>(defaultRepoFilters())

const rows = computed(() => repoRows(items.value.values(), context.value, status.value))

export const repoResult = computed(() => pickRows(rows.value, repoFilters, activeWorkspace.value?.pinned))

export const activeRepos = computed(() => [...repos.value.values()].filter((repo) => !repo.isArchived).length)

export const isPinned = (id: string) => activeWorkspace.value?.pinned.includes(id) ?? false

export function togglePin(id: string) {
  const ws = activeWorkspace.value
  if (ws) ws.pinned = isPinned(id) ? ws.pinned.filter((other) => other !== id) : [...ws.pinned, id]
}

export function arrangePinned(shown: string[]) {
  const ws = activeWorkspace.value
  if (ws) ws.pinned = arrange(ws.pinned, shown)
}
