<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ItemRow, { ROW_HEIGHT } from '@/components/ItemRow.vue'
import { sameRef } from '@/lib/issue'
import { displayRepo, highlighted, items, loaded, repos, status, syncNow } from '@/stores/data'
import { settings } from '@/stores/settings'
import { openSetup } from '@/stores/ui'
import { isDefault, openIssue, query, resetFilters, result } from '@/stores/view'
import type { Item } from '@/types'

const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')
const rows = computed(() => result.value.items)

function isOpen(item: Item, fullName: string | undefined) {
  return item.kind === 'issue' && !!fullName && sameRef(openIssue.value, { repo: fullName, number: item.number })
}

function rowProps(item: Item) {
  const repo = repos.value.get(item.repoId)
  return {
    item,
    repoName: displayRepo(repo?.fullName ?? ''),
    archived: repo?.isArchived,
    fresh: highlighted.value.has(item.id),
    opened: isOpen(item, repo?.fullName),
  }
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT[settings.density],
    getItemKey: (index: number) => rows.value[index]?.id ?? index,
    overscan: 12,
  })),
)

const virtualRows = computed(() => virtualizer.value.getVirtualItems())

function measure(element: unknown) {
  if (element instanceof Element) virtualizer.value.measureElement(element)
}

watch(query, () => scroller.value?.scrollTo({ top: 0 }))

// The issue that ↑ and ↓ in its panel move to stays in sight.
watch(openIssue, (issue) => {
  if (!issue) return
  const index = rows.value.findIndex((item) => isOpen(item, repos.value.get(item.repoId)?.fullName))
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
})
watch(
  () => settings.density,
  () => virtualizer.value.measure(),
)

const empty = computed(() => loaded.value && items.value.size === 0)
const gathering = computed(
  () =>
    !loaded.value || (empty.value && (status.value.phase !== 'idle' || !status.value.syncedAt) && !status.value.error),
)
const failed = computed(() => empty.value && status.value.error)
</script>

<template>
  <div ref="scroller" class="overflow-y-auto">
    <div v-if="gathering" aria-busy="true">
      <p class="px-4 py-3 text-sm text-muted sm:px-6">{{ t('results.gathering') }}</p>
      <div
        v-for="index in 8"
        :key="index"
        class="flex gap-3 border-b border-default px-4 py-3 sm:px-6"
        aria-hidden="true"
      >
        <USkeleton class="mt-1 size-4 rounded-full" />
        <div class="flex-1 space-y-2 pt-1">
          <USkeleton class="h-4" :style="{ width: `${40 + ((index * 17) % 45)}%` }" />
          <USkeleton class="h-3 w-40" />
        </div>
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
      <UButton v-else class="mt-2" color="neutral" variant="outline" :label="t('sync.retry')" @click="syncNow(true)" />
    </div>

    <div v-else-if="!rows.length" class="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
      <p class="text-xl font-medium text-highlighted">{{ isDefault ? t('results.allClear') : t('results.empty') }}</p>
      <p class="text-sm text-muted">{{ isDefault ? t('results.allClearHint') : t('results.emptyHint') }}</p>
      <UButton
        v-if="!isDefault"
        class="mt-2"
        color="neutral"
        variant="outline"
        :label="t('filters.clear')"
        @click="resetFilters"
      />
    </div>

    <ul v-else class="relative" :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <li
        v-for="row in virtualRows"
        :key="String(row.key)"
        :ref="measure"
        :data-index="row.index"
        class="absolute inset-x-0 top-0"
        :style="{ transform: `translateY(${row.start}px)` }"
      >
        <ItemRow v-bind="rowProps(rows[row.index]!)" />
      </li>
    </ul>
  </div>
</template>
