<script setup lang="ts">
// The diff with the pull request's parts beside it, like an editor's side bar. A strip of icons picks what the
// one side column shows: the files, the conversation, the commits or the checks. The diff never moves, and picking the
// open part again folds the column away. On a phone, the strip is a bar at the bottom and the column a sheet.
import UButton from '@nuxt/ui/components/Button.vue'
import UDrawer from '@nuxt/ui/components/Drawer.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { nextTick, ref, useTemplateRef, watchPostEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import { kbds, useKeys } from '@/components/keys'
import { COLUMN, columnOpen, columnWidth } from '@/components/pull/column'
import ColumnEdge from '@/components/pull/ColumnEdge.vue'
import FilesView from '@/components/pull/FilesView.vue'
import PartColumn from '@/components/pull/PartColumn.vue'
import PartMark from '@/components/pull/PartMark.vue'
import { fileFilter, parts, pickPart, sheetOpen, showPart } from '@/components/pull/parts'
import PullHeader from '@/components/pull/PullHeader.vue'
import { PULL_PARTS } from '@/lib/refs'
import { formatNumber, sides } from '@/locale'
import { showAllChanges, stepCommits } from '@/stores/pull'
import { large } from '@/stores/ui'
import { pullPart } from '@/stores/view'

const { t } = useI18n()
useKeys({
  parts: (_, index) => pickPart(PULL_PARTS[index]),
  commits: [() => stepCommits(-1), () => stepCommits(1)],
  allChanges: showAllChanges,
  search: async () => {
    showPart('files')
    await nextTick()
    // The sheet on a phone slides up first.
    requestAnimationFrame(() => fileFilter.value?.focus())
  },
})

// The strip's marker slides to the middle of the open part's icon.
const strip = useTemplateRef<HTMLElement>('strip')
const marker = ref(0)
watchPostEffect(() => {
  const button = strip.value?.querySelector<HTMLElement>(`[data-part="${pullPart.value}"]`)
  if (button) marker.value = button.offsetTop + button.offsetHeight / 2
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PullHeader />
    <div class="flex min-h-0 flex-1">
      <nav
        v-if="large"
        ref="strip"
        class="relative flex shrink-0 flex-col items-center gap-1 border-e border-default bg-muted py-1"
        :style="{ width: `${COLUMN.strip}px` }"
        :aria-label="t('pull.tabsLabel')"
      >
        <span
          class="absolute start-0 top-0 h-6 w-0.5 rounded-full bg-primary transition-[transform,opacity] duration-300"
          :class="!columnOpen && 'opacity-0'"
          :style="{ transform: `translateY(${marker}px) translateY(-50%)` }"
        />
        <UTooltip
          v-for="(each, index) in parts"
          :key="each.part"
          :text="t(`pull.tabs.${each.part}`)"
          :kbds="kbds('parts', index)"
          :content="{ side: sides.end }"
        >
          <button
            type="button"
            class="relative grid size-9 place-items-center rounded-md focus-ring transition-colors"
            :class="
              columnOpen && pullPart === each.part
                ? 'bg-elevated text-highlighted'
                : 'text-muted hover:bg-elevated/60 hover:text-highlighted'
            "
            :aria-label="t(`pull.tabs.${each.part}`)"
            :aria-pressed="columnOpen && pullPart === each.part"
            :data-part="each.part"
            @click="pickPart(each.part)"
          >
            <UIcon :name="each.icon" class="size-[18px]" />
            <PartMark :part="each" class="-end-0.5 -top-0.5 bg-default" />
          </button>
        </UTooltip>
      </nav>
      <aside
        v-if="large"
        v-show="columnOpen"
        class="enter flex shrink-0 flex-col border-e border-default"
        :style="{ width: `${columnWidth}px` }"
      >
        <PartColumn>
          <UTooltip :text="t('pull.panel.hide')">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-octicon-sidebar-expand-16"
              :aria-label="t('pull.panel.hide')"
              :ui="{ leadingIcon: 'ltr:-scale-x-100' }"
              @click="columnOpen = false"
            />
          </UTooltip>
        </PartColumn>
      </aside>
      <ColumnEdge v-if="large" />
      <FilesView class="min-w-0 flex-1" />
    </div>

    <nav
      v-if="!large"
      class="grid shrink-0 border-t border-default bg-muted pb-[env(safe-area-inset-bottom)]"
      :style="{ gridTemplateColumns: `repeat(${parts.length}, 1fr)` }"
      :aria-label="t('pull.tabsLabel')"
    >
      <button
        v-for="each in parts"
        :key="each.part"
        type="button"
        class="relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-toned"
        @click="pickPart(each.part)"
      >
        <span class="relative">
          <UIcon :name="each.icon" class="size-5" />
          <PartMark :part="each" class="-end-2 -top-1 bg-muted" />
        </span>
        <span>
          {{ t(`pull.tabs.${each.part}`) }}
          <span v-if="each.viewed" class="font-mono tabular-nums"
            >{{ formatNumber(each.viewed.n) }}/{{ formatNumber(each.viewed.of) }}</span
          >
          <span v-else-if="each.part === 'files' && each.count" class="font-mono tabular-nums">{{
            formatNumber(each.count)
          }}</span>
        </span>
      </button>
    </nav>
    <UDrawer
      v-if="!large"
      v-model:open="sheetOpen"
      :title="t(`pull.tabs.${pullPart}`)"
      :ui="{
        content: 'h-[80dvh]',
        container: 'min-h-0 flex-1 gap-0 overflow-hidden p-0',
        header: 'sr-only',
        body: 'flex min-h-0 flex-col',
      }"
    >
      <template #body>
        <PartColumn />
      </template>
    </UDrawer>
  </div>
</template>
