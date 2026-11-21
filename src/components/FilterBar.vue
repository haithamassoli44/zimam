<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UKbd from '@nuxt/ui/components/Kbd.vue'
import { defineShortcuts } from '@nuxt/ui/composables'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceGroup from '@/components/ChoiceGroup.vue'
import FacetMenu, { type Option } from '@/components/FacetMenu.vue'
import { CHOICES, NONE, SORTS, toggleValue, type Facet } from '@/lib/filters'
import { formatNumber } from '@/locale'
import { displayRepo, owners, people, progress, status } from '@/stores/data'
import {
  activeView,
  askToSave,
  filters,
  isDefault,
  lastView,
  resetFilters,
  result,
  updateView,
  viewName,
} from '@/stores/view'

const { t } = useI18n()
const search = useTemplateRef<{ inputRef: HTMLInputElement | null }>('search')

defineShortcuts({ '/': () => search.value?.inputRef?.focus() })

const counts = computed(() => result.value.counts)
const selected = (facet: Facet) => filters[facet] as string[]

function options(facet: Facet, describe: (value: string) => Omit<Option, 'value' | 'count'>): Option[] {
  const values = CHOICES[facet] ?? [...new Set([...counts.value[facet].keys(), ...selected(facet)])]
  return values.map((value) => ({ value, count: counts.value[facet].get(value) ?? 0, ...describe(value) }))
}

const named = (facet: Facet) => (value: string) => ({ label: t(`filters.${facet}.${value}`) })

const menus = computed(() => {
  const all: [Facet, Option[]][] = [
    ['owner', options('owner', (value) => ({ label: value, avatar: owners.value.get(value) }))],
    ['repo', options('repo', (value) => ({ label: displayRepo(value) }))],
    [
      'label',
      options('label', (value) => ({
        label: value === NONE ? t('filters.label.none') : value,
        color: people.value.colors.get(value),
      })),
    ],
    ['author', options('author', (value) => ({ label: value, avatar: people.value.avatars.get(value) }))],
    [
      'assignee',
      options('assignee', (value) => ({
        label: value === NONE ? t('filters.assignee.none') : value,
        avatar: people.value.avatars.get(value),
      })),
    ],
    ['review', options('review', named('review'))],
    ['checks', options('checks', named('checks'))],
    ['updated', options('updated', named('updated'))],
  ]
  // Accounts only matter when the workspace covers more than one, or one is already picked.
  return all.filter(([facet]) => facet !== 'owner' || owners.value.size > 1 || filters.owner.length > 0)
})

const TOGGLES = ['kind', 'state', 'status'] as const
const toggle = (facet: Facet, value: string) => toggleValue(filters, facet, value)

const toggles = computed(() =>
  TOGGLES.map((facet) => ({
    facet,
    choices: CHOICES[facet]!.map((value) => ({
      value,
      label: t(`filters.${facet}.${value}`),
      count: counts.value[facet].get(value) ?? 0,
    })),
  })),
)

const sortItems = computed<DropdownMenuItem[]>(() =>
  SORTS.map((sort) => ({
    label: t(`filters.sorts.${sort}`),
    type: 'checkbox',
    checked: filters.sort === sort,
    onSelect: () => (filters.sort = sort),
  })),
)

const total = computed(() => result.value.items.length)
const title = computed(() => (activeView.value ? viewName(activeView.value) : t('results.custom')))

const historyPercent = computed(() => {
  const wantsClosed = filters.state.length === 0 || filters.state.some((state) => state !== 'open')
  if (status.value.historyDone || !wantsClosed || !status.value.syncedAt) return null
  return status.value.phase === 'history' ? (progress.value ?? 0) : 0
})
</script>

<template>
  <div class="border-b border-default">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-3 px-4 pt-4 sm:px-6 lg:h-16 lg:flex-nowrap lg:pt-0">
      <h1
        class="flex min-w-0 flex-1 items-baseline gap-2 text-2xl font-medium text-highlighted lg:text-[28px] lg:leading-9"
      >
        <span class="truncate">{{ title }}</span>
        <span class="shrink-0 font-normal text-muted tabular-nums" aria-hidden="true">{{ formatNumber(total) }}</span>
        <span class="sr-only">{{ t('results.count', { n: formatNumber(total) }, total) }}</span>
      </h1>

      <UInput
        ref="search"
        v-model="filters.q"
        icon="i-octicon-search-16"
        :placeholder="t('filters.search')"
        class="order-last w-full lg:order-none lg:w-72"
        :ui="{ trailing: 'pe-1.5' }"
      >
        <template #trailing>
          <UButton
            v-if="filters.q"
            icon="i-octicon-x-16"
            color="neutral"
            variant="link"
            size="sm"
            :aria-label="t('filters.clear')"
            @click="filters.q = ''"
          />
          <UKbd v-else value="/" />
        </template>
      </UInput>

      <div class="flex items-center gap-1">
        <template v-if="!activeView">
          <UButton
            v-if="lastView"
            color="neutral"
            variant="ghost"
            class="hidden sm:inline-flex"
            :label="t('views.update', { name: viewName(lastView) })"
            @click="updateView(lastView)"
          />
          <UButton
            color="neutral"
            icon="i-octicon-bookmark-16"
            :label="t('views.save')"
            :ui="{ label: 'hidden sm:block', leadingIcon: 'sm:hidden' }"
            @click="askToSave"
          />
        </template>
        <UDropdownMenu :items="sortItems" :content="{ align: 'end' }">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-octicon-sort-desc-16"
            :label="t(`filters.sorts.${filters.sort}`)"
            :aria-label="t('filters.sort')"
            :ui="{ base: 'text-toned', label: 'hidden sm:block', leadingIcon: 'text-muted' }"
          />
        </UDropdownMenu>
      </div>
    </div>

    <div
      class="flex [scrollbar-width:none] items-center gap-2 overflow-x-auto px-4 py-3 *:shrink-0 sm:flex-wrap sm:overflow-visible sm:px-6"
    >
      <ChoiceGroup
        v-for="group in toggles"
        :key="group.facet"
        :label="t(`filters.${group.facet}.title`)"
        :choices="group.choices"
        :picked="(value) => selected(group.facet).includes(value)"
        @pick="(value) => toggle(group.facet, value)"
      />

      <FacetMenu
        v-for="[facet, list] in menus"
        :key="facet"
        v-model="filters[facet]"
        :title="t(`filters.${facet}.title`)"
        :options="list"
        :single="facet === 'updated'"
      />

      <UButton v-if="!isDefault" color="neutral" variant="link" :label="t('filters.clear')" @click="resetFilters" />

      <span v-if="historyPercent !== null" class="text-xs text-muted sm:ms-auto">{{
        t('results.historyLoading', { percent: historyPercent })
      }}</span>
    </div>
  </div>
</template>
