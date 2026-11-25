<script setup lang="ts">
// The open part, in the side column or its sheet: its heading, with its name and count, and its pane. Each pane keeps
// its own scroll, so going back to one finds it where it was left. For the files, the heading says how many are
// viewed, with a line along its bottom edge that fills as they are.
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'

import ChecksList from '@/components/pull/ChecksList.vue'
import CommitList from '@/components/pull/CommitList.vue'
import FileTree from '@/components/pull/FileTree.vue'
import { parts } from '@/components/pull/parts'
import PullConversation from '@/components/pull/PullConversation.vue'
import type { PullPart } from '@/lib/refs'
import { formatNumber } from '@/locale'
import { pullPart } from '@/stores/view'

const { t } = useI18n()
/** Each part's pane. One that `scrolls` scrolls as a whole; the files' tree keeps its filter in sight. */
const PANES: Record<PullPart, { pane: Component; scrolls: boolean }> = {
  files: { pane: FileTree, scrolls: false },
  conversation: { pane: PullConversation, scrolls: true },
  commits: { pane: CommitList, scrolls: true },
  checks: { pane: ChecksList, scrolls: true },
}
const open = computed(() => parts.value.find((each) => each.part === pullPart.value)!)
</script>

<template>
  <div class="relative flex h-11 shrink-0 items-center gap-2 border-b border-default ps-4 pe-2 text-[13px]">
    <h2 class="font-medium text-highlighted">{{ t(`pull.tabs.${open.part}`) }}</h2>
    <span v-if="open.viewed" class="font-mono text-[12px] text-muted tabular-nums">
      {{ t('pull.viewedOf', { n: formatNumber(open.viewed.n), of: formatNumber(open.viewed.of) }) }}
    </span>
    <span v-else-if="open.count !== null" class="font-mono text-[12px] text-muted tabular-nums">{{
      formatNumber(open.count)
    }}</span>
    <span class="flex-1" />
    <slot />
    <span
      v-if="open.viewed"
      class="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-primary transition-transform duration-300 rtl:origin-right"
      :style="{ transform: `scaleX(${open.viewed.n / Math.max(open.viewed.of, 1)})` }"
      role="progressbar"
      :aria-valuenow="open.viewed.n"
      :aria-valuemax="open.viewed.of"
      :aria-label="t('pull.viewed')"
    />
  </div>
  <div class="relative min-h-0 flex-1">
    <div
      v-for="each in parts"
      v-show="each.part === pullPart"
      :key="each.part"
      class="enter absolute inset-0"
      :class="PANES[each.part].scrolls && 'overflow-y-auto'"
    >
      <component :is="PANES[each.part].pane" />
    </div>
  </div>
</template>
