<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UKbd from '@nuxt/ui/components/Kbd.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceGroup from '@/components/ChoiceGroup.vue'
import { useKeys, useMain } from '@/components/keys'
import { useReorder } from '@/components/reorder'
import RepoRow, { REPO_COLUMN_WIDTHS, REPO_COLUMNS, REPO_GRID } from '@/components/RepoRow.vue'
import SyncFailed from '@/components/SyncFailed.vue'
import { REPO_STATUSES, type RepoStatus } from '@/lib/filters'
import { defaultRepoFilters, isFiltered, REPO_SORTS, toggleStatus, type RepoRow as Row } from '@/lib/repos'
import { formatNumber } from '@/locale'
import { displayRepo, gathered, repos } from '@/stores/data'
import { arrangePinned, repoFilters, repoResult } from '@/stores/repos'

const { t } = useI18n()
const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')
const scroller = useTemplateRef<HTMLElement>('scroller')

useKeys({ search: () => search.value?.inputRef?.focus() })
useMain(scroller)

const shown = computed(() => repoResult.value.pinned.length + repoResult.value.rest.length)

// Pinned repositories stay on top in the order they were put in, whatever the sort. Their handles move them.
const shownPinned = () => repoResult.value.pinned.map((row) => row.repo.id)
const reorder = useReorder(() => scroller.value, shownPinned, arrangePinned)
const pinned = computed(() => {
  const rows = repoResult.value.pinned
  const draft = reorder.draft.value
  if (!draft) return rows
  const byId = new Map(rows.map((row) => [row.repo.id, row]))
  return draft.flatMap((id) => byId.get(id) ?? [])
})
const moved = ref('')

async function step(row: Row, by: -1 | 1) {
  const to = await reorder.step(row.repo.id, by)
  if (to === null) return
  moved.value = t('repos.moved', {
    name: displayRepo(row.repo.fullName),
    n: formatNumber(to + 1),
    total: formatNumber(pinned.value.length),
  })
}

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

const GROUP = 'border-b border-default bg-muted px-4 py-1.5 text-xs leading-4 font-medium text-muted sm:px-6'

const filtered = computed(() => isFiltered(repoFilters))

function clear() {
  Object.assign(repoFilters, { q: '', status: defaultRepoFilters().status })
}

watch(
  () => [repoFilters.q, repoFilters.status, repoFilters.sort],
  () => scroller.value?.scrollTo({ top: 0 }),
)

const { gathering, failed } = gathered(() => repos.value.size)
</script>

<template>
  <div class="@container flex flex-col" :style="REPO_COLUMN_WIDTHS">
    <div class="shrink-0 border-b border-default">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-3 px-4 pt-4 sm:px-6 lg:h-16 lg:flex-nowrap lg:pt-0">
        <h1
          class="flex min-w-0 flex-1 items-baseline gap-2 text-2xl font-medium text-highlighted lg:text-[28px] lg:leading-9"
        >
          <span class="truncate">{{ t('nav.repos') }}</span>
          <span class="shrink-0 font-normal text-muted tabular-nums" aria-hidden="true">{{ formatNumber(shown) }}</span>
          <span class="sr-only">{{ t('repos.count', { n: formatNumber(shown) }, shown) }}</span>
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
        <UButton
          v-if="filtered"
          color="neutral"
          variant="link"
          class="enter"
          :label="t('filters.clear')"
          @click="clear"
        />
      </div>
    </div>

    <!-- Relative, so what's placed absolutely in the list, like the hidden announcement, can't stretch the window. -->
    <div ref="scroller" class="relative min-h-0 flex-1 overflow-y-auto focus:outline-none" tabindex="-1">
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

      <SyncFailed v-else-if="failed" :error="failed" />

      <div v-else-if="!shown" class="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
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

      <div v-else class="enter">
        <div
          class="sticky top-0 z-10 hidden min-h-9 items-center border-b border-default bg-default px-6 py-1.5 text-xs leading-4 text-muted"
          :class="REPO_GRID"
        >
          <template v-for="column in REPO_COLUMNS" :key="column.key">
            <button
              v-if="column.sort"
              type="button"
              class="inline-flex items-center gap-1 rounded-sm text-balance focus-ring transition-colors hover:text-highlighted"
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
            <span v-else-if="column.named !== false" class="text-balance">{{ t(`repos.columns.${column.key}`) }}</span>
          </template>
        </div>
        <template v-if="pinned.length">
          <h2 :class="GROUP">{{ t('repos.pinned') }}</h2>
          <RepoRow
            v-for="row in pinned"
            :key="row.repo.id"
            :row="row"
            :data-reorder="row.repo.id"
            :class="reorder.dragged.value === row.repo.id && 'z-1 bg-elevated shadow-md'"
            :style="reorder.dragged.value === row.repo.id && { transform: `translateY(${reorder.shift.value}px)` }"
            @grab="reorder.start($event, row.repo.id)"
            @step="step(row, $event)"
          />
          <h2 v-if="repoResult.rest.length" :class="GROUP">{{ t('repos.rest') }}</h2>
        </template>
        <RepoRow v-for="row in repoResult.rest" :key="row.repo.id" :row="row" />
      </div>
      <p class="sr-only" aria-live="polite">{{ moved }}</p>
    </div>
  </div>
</template>
