import { computed, reactive } from 'vue'

import { defaultRepoFilters, pickRows, repoRows, type RepoFilters } from '@/lib/repos'

import { now } from './clock'
import { items, repos } from './data'

/** The repositories page's search, statuses and order. They last until the tab closes. */
export const repoFilters = reactive<RepoFilters>(defaultRepoFilters())

const rows = computed(() => repoRows(repos.value.values(), items.value.values(), now.value))

export const repoResult = computed(() => pickRows(rows.value, repoFilters))

/** The workspace's repositories that aren't archived. */
export const activeRepos = computed(() => rows.value.filter((row) => !row.repo.isArchived).length)
