<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UKbd from '@nuxt/ui/components/Kbd.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { defineShortcuts } from '@nuxt/ui/composables'
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceGroup from '@/components/ChoiceGroup.vue'
import RepoRow, { REPO_COLUMNS } from '@/components/RepoRow.vue'
import { REPO_STATUSES, type RepoStatus } from '@/lib/filters'
import { defaultRepoFilters, REPO_SORTS, toggleStatus, type RepoSort } from '@/lib/repos'
import { formatNumber } from '@/locale'
import { loaded, repos, status, syncNow } from '@/stores/data'
import { repoFilters, repoResult } from '@/stores/repos'
import { openSetup } from '@/stores/ui'

const { t } = useI18n()
const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')
const scroller = useTemplateRef<HTMLElement>('scroller')

defineShortcuts({ '/': () => search.value?.inputRef?.focus() })

const rows = computed(() => repoResult.value.rows)

const statuses = computed(() =>
  REPO_STATUSES.map((value) => ({
    value,
    label: t(`filters.status.${value}`),
    count: repoResult.value.counts[value],
  })),
)

const isPicked = (value: string) => repoFilters.status.includes(value as RepoStatus)
const pick = (value: string) => toggleStatus(repoFilters, value as RepoStatus)

const sortItems = computed<DropdownMenuItem[]>(() =>
  REPO_SORTS.map((sort) => ({
    label: t(`repos.sorts.${sort}`),
    type: 'checkbox',
    checked: repoFilters.sort === sort,
    onSelect: () => (repoFilters.sort = sort),
  })),
)

// The header names each column, and sorts by it where that means something.
const COLUMNS: { key: string; sort?: RepoSort; start?: boolean }[] = [
  { key: 'name', sort: 'name', start: true },
  { key: 'opened', start: true },
  { key: 'issues', sort: 'issues' },
  { key: 'prs', sort: 'prs' },
  { key: 'awaiting', sort: 'awaiting' },
  { key: 'failing', sort: 'failing' },
  { key: 'activity', sort: 'activity' },
]

const filtered = computed(() => repoFilters.q.trim() !== '' || repoFilters.status.join() !== 'active')

function clear() {
  Object.assign(repoFilters, { q: '', status: defaultRepoFilters().status })
}

watch(
  () => [repoFilters.q, repoFilters.status, repoFilters.sort],
  () => scroller.value?.scrollTo({ top: 0 }),
)

const empty = computed(() => loaded.value && repos.value.size === 0)
const gathering = computed(
  () =>
    !loaded.value || (empty.value && (status.value.phase !== 'idle' || !status.value.syncedAt) && !status.value.error),
)
const failed = computed(() => empty.value && status.value.error)
</script>

<template>
  <div class="@container flex flex-col">
    <div class="shrink-0 border-b border-default">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-3 px-4 pt-4 sm:px-6 lg:h-16 lg:flex-nowrap lg:pt-0">
        <h1
          class="flex min-w-0 flex-1 items-baseline gap-2 text-2xl font-medium text-highlighted lg:text-[28px] lg:leading-9"
        >
          <span class="truncate">{{ t('nav.repos') }}</span>
          <span class="shrink-0 font-normal text-muted tabular-nums" aria-hidden="true">{{
            formatNumber(rows.length)
          }}</span>
          <span class="sr-only">{{ t('repos.count', { n: formatNumber(rows.length) }, rows.length) }}</span>
        </h1>

        <UInput
          ref="search"
          v-model="repoFilters.q"
          icon="i-octicon-search-16"
          :placeholder="t('repos.search')"
          class="order-last w-full lg:order-none lg:w-72"
          :ui="{ trailing: 'pe-1.5' }"
        >
          <template #trailing>
            <UButton
              v-if="repoFilters.q"
              icon="i-octicon-x-16"
              color="neutral"
              variant="link"
              size="sm"
              :aria-label="t('filters.clear')"
              @click="repoFilters.q = ''"
            />
            <UKbd v-else value="/" class="pointer-coarse:hidden" />
          </template>
        </UInput>

        <UDropdownMenu :items="sortItems" :content="{ align: 'end' }">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-octicon-sort-desc-16"
            :label="t(`repos.sorts.${repoFilters.sort}`)"
            :aria-label="t('filters.sort')"
            :ui="{ base: 'text-toned', label: 'hidden sm:block', leadingIcon: 'text-muted' }"
          />
        </UDropdownMenu>
      </div>

      <div class="flex items-center gap-2 px-4 py-3 sm:px-6">
        <ChoiceGroup :label="t('filters.status.title')" :choices="statuses" :picked="isPicked" @pick="pick" />
        <UButton v-if="filtered" color="neutral" variant="link" :label="t('filters.clear')" @click="clear" />
      </div>
    </div>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="gathering" aria-busy="true">
        <p class="px-4 py-3 text-sm text-muted sm:px-6">{{ t('results.gathering') }}</p>
        <div
          v-for="index in 8"
          :key="index"
          class="space-y-2 border-b border-default px-4 py-4 sm:px-6"
          aria-hidden="true"
        >
          <USkeleton class="h-4" :style="{ width: `${15 + ((index * 17) % 25)}%` }" />
          <USkeleton class="h-3" :style="{ width: `${30 + ((index * 13) % 35)}%` }" />
        </div>
      </div>

      <div v-else-if="failed" class="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
        <p class="text-xl font-medium text-highlighted">{{ t(`sync.error.${failed}`) }}</p>
        <UButton
          v-if="failed === 'auth'"
          class="mt-2"
          color="neutral"
          variant="outline"
          :label="t('sync.replaceToken')"
          @click="openSetup('edit')"
        />
        <UButton
          v-else
          class="mt-2"
          color="neutral"
          variant="outline"
          :label="t('sync.retry')"
          @click="syncNow(true)"
        />
      </div>

      <div v-else-if="!rows.length" class="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
        <p class="text-xl font-medium text-highlighted">{{ filtered ? t('filters.nothing') : t('results.empty') }}</p>
        <UButton
          v-if="filtered"
          class="mt-2"
          color="neutral"
          variant="outline"
          :label="t('filters.clear')"
          @click="clear"
        />
      </div>

      <template v-else>
        <div
          class="sticky top-0 z-10 hidden min-h-9 items-center border-b border-default bg-default px-6 py-1.5 text-xs leading-4 text-muted"
          :class="REPO_COLUMNS"
        >
          <template v-for="column in COLUMNS" :key="column.key">
            <button
              v-if="column.sort"
              type="button"
              class="inline-flex items-center gap-1 rounded-sm text-balance transition-colors hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
              :class="[
                column.start ? 'justify-self-start text-start' : 'justify-self-end text-end',
                repoFilters.sort === column.sort && 'font-medium text-highlighted',
              ]"
              :aria-pressed="repoFilters.sort === column.sort"
              @click="repoFilters.sort = column.sort"
            >
              {{ t(`repos.columns.${column.key}`) }}
              <UIcon v-if="repoFilters.sort === column.sort" name="i-octicon-arrow-down-16" class="size-3 shrink-0" />
            </button>
            <span v-else class="text-balance">{{ t(`repos.columns.${column.key}`) }}</span>
          </template>
        </div>
        <RepoRow v-for="row in rows" :key="row.repo.id" :row="row" />
      </template>
    </div>
  </div>
</template>
