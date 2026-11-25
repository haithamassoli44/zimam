<script lang="ts">
import type { VirtualItem } from '@tanstack/vue-virtual'

// Where the list was scrolled to as it went, with the heights of the rows it had measured: back from a pull request or
// the repositories, the same workspace, density and filters show the list where it was.
let left = null as { key: string; offset: number; rows: VirtualItem[] } | null
</script>

<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ItemRow, { ROW_HEIGHT } from '@/components/ItemRow.vue'
import { useKeys } from '@/components/keys'
import { EASE_OUT, still } from '@/components/motion'
import SyncFailed from '@/components/SyncFailed.vue'
import { sameRef } from '@/lib/refs'
import { displayRepo, gathered, highlighted, issueRef, itemRef, items, repos } from '@/stores/data'
import { activeWorkspace, settings } from '@/stores/settings'
import { activeView, isDefault, leftPull, openIssue, query, resetFilters, result, viewName } from '@/stores/view'
import type { Item } from '@/types'

const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')
const rows = computed(() => result.value.items)

const isOpen = (item: Item) => sameRef(openIssue.value, issueRef(item))

function rowProps(item: Item) {
  const repo = repos.value.get(item.repoId)
  return {
    item,
    repoName: displayRepo(repo?.fullName ?? ''),
    archived: repo?.isArchived,
    fresh: highlighted.value.has(item.id),
    opened: isOpen(item),
  }
}

const place = computed(() => `${activeWorkspace.value?.id} ${settings.density} ${query.value}`)
const back = left?.key === place.value ? left : null

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => ROW_HEIGHT[settings.density],
    getItemKey: (index: number) => rows.value[index]?.id ?? index,
    overscan: 12,
    initialOffset: back?.offset ?? 0,
    initialMeasurementsCache: back?.rows ?? [],
  })),
)

onBeforeUnmount(() => {
  const offset = scroller.value?.scrollTop ?? 0
  left = { key: place.value, offset, rows: virtualizer.value.takeSnapshot() }
})

const virtualRows = computed(() => virtualizer.value.getVirtualItems())

function measure(element: unknown) {
  if (element instanceof Element) virtualizer.value.measureElement(element)
}

watch(query, () => scroller.value?.scrollTo({ top: 0 }))

// Another saved view fades in, rather than its rows taking the last one's places at once.
watch(
  () => activeView.value?.id,
  (view) => {
    if (view && !still()) scroller.value?.animate({ opacity: [0, 1] }, { duration: 160, easing: EASE_OUT })
  },
)

// The issue that ↑ and ↓ in its panel move to stays in sight.
watch(openIssue, (issue) => {
  if (!issue) return
  const index = rows.value.findIndex(isOpen)
  if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
})
watch(
  () => settings.density,
  () => virtualizer.value.measure(),
)

const { gathering, failed } = gathered(() => items.value.size)

// --- The keyboard: j and k, or ↓ and ↑ from a row, move the focus from row to row. Enter on a row opens it. ---

/** Gives a row's title the focus, once the list has drawn it. */
function focusRow(index: number, tries = 3) {
  const count = rows.value.length
  if (!count) return
  const at = Math.max(0, Math.min(count - 1, index))
  virtualizer.value.scrollToIndex(at, { align: 'auto' })
  requestAnimationFrame(() => {
    const link = scroller.value?.querySelector<HTMLElement>(`li[data-index="${at}"] a[data-row]`)
    if (link) link.focus({ preventScroll: true })
    else if (tries) focusRow(at, tries - 1)
  })
}
/** The row that has the focus, or the first in sight. */
function rowAt(): { index: number; focused: boolean } {
  const row = document.activeElement?.closest<HTMLElement>('li[data-index]')
  if (row && scroller.value?.contains(row)) return { index: Number(row.dataset.index), focused: true }
  const top = scroller.value?.scrollTop ?? 0
  return { index: virtualRows.value.find((each) => each.end > top + 1)?.index ?? 0, focused: false }
}
function moveFocus(by: -1 | 1) {
  const { index, focused } = rowAt()
  focusRow(focused ? index + by : index)
}
// An open issue takes j and k for itself, to go to the next one.
useKeys({ j: () => moveFocus(1), k: () => moveFocus(-1) })
function onArrow(event: KeyboardEvent) {
  const by = ({ ArrowDown: 1, ArrowUp: -1 } as const)[event.key as 'ArrowDown' | 'ArrowUp']
  if (!by || event.altKey || event.ctrlKey || event.metaKey || !(event.target as Element).matches('a[data-row]')) return
  event.preventDefault()
  moveFocus(by)
}

// Back from a pull request, its row has the focus again, as an issue's has once its panel closes.
onMounted(() => {
  const from = leftPull.value
  leftPull.value = null
  if (!from || (document.activeElement && document.activeElement !== document.body)) return
  const index = rows.value.findIndex((item) => sameRef(itemRef(item), from))
  if (index >= 0) focusRow(index)
})
</script>

<template>
  <div ref="scroller" class="overflow-y-auto focus:outline-none" tabindex="-1" data-main>
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

    <SyncFailed v-else-if="failed" :error="failed" />

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

    <ul
      v-else
      class="enter relative"
      :style="{ height: `${virtualizer.getTotalSize()}px` }"
      :aria-label="activeView ? viewName(activeView) : t('results.custom')"
      @keydown="onArrow"
    >
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
