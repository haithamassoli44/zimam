import { computed, reactive } from 'vue'

import { arrange, defaultRepoFilters, pickRows, repoRows, type RepoFilters } from '@/lib/repos'

import { items, repos, status } from './data'
import { activeWorkspace } from './settings'
import { context } from './view'

/** The repositories page's search, statuses and order. They last until the tab closes. */
export const repoFilters = reactive<RepoFilters>(defaultRepoFilters())

const rows = computed(() => repoRows(items.value.values(), context.value, status.value.left))

export const repoResult = computed(() => pickRows(rows.value, repoFilters, activeWorkspace.value?.pinned))

/** The workspace's repositories that aren't archived. */
export const activeRepos = computed(() => [...repos.value.values()].filter((repo) => !repo.isArchived).length)

export const isPinned = (id: string) => activeWorkspace.value?.pinned.includes(id) ?? false

/** Pins a repository under the others pinned, or unpins it. */
export function togglePin(id: string) {
  const ws = activeWorkspace.value
  if (ws) ws.pinned = isPinned(id) ? ws.pinned.filter((other) => other !== id) : [...ws.pinned, id]
}

/** Puts the pinned repositories shown in this order. */
export function arrangePinned(shown: string[]) {
  const ws = activeWorkspace.value
  if (ws) ws.pinned = arrange(ws.pinned, shown)
}
