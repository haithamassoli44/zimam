import { computed, reactive } from 'vue'

import { defaultRepoFilters, pickRows, repoRows, type RepoFilters } from '@/lib/repos'

import { now } from './clock'
import { items, repos, status } from './data'

/** The repositories page's search, statuses and order. They last until the tab closes. */
export const repoFilters = reactive<RepoFilters>(defaultRepoFilters())

const rows = computed(() => repoRows(repos.value.values(), items.value.values(), now.value, status.value.left))

export const repoResult = computed(() => pickRows(rows.value, repoFilters))

/** The workspace's repositories that aren't archived. */
export const activeRepos = computed(() => [...repos.value.values()].filter((repo) => !repo.isArchived).length)
