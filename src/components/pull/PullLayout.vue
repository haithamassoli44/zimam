<script setup lang="ts">
// PROTOTYPE: the diff with the pull request's parts beside it, like an editor's side bar. A strip of icons picks what the
// one side column shows: the files, the conversation, the commits or the checks. The diff never moves, and picking the
// open part again folds the column away. On a phone, the strip is a bar at the bottom and the column a sheet.
import UButton from '@nuxt/ui/components/Button.vue'
import UDrawer from '@nuxt/ui/components/Drawer.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, ref, useTemplateRef, watchPostEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKeys } from '@/components/keys'
import { columnWidth } from '@/components/pull/column'
import ColumnEdge from '@/components/pull/ColumnEdge.vue'
import FilesView from '@/components/pull/FilesView.vue'
import PartHeading from '@/components/pull/PartHeading.vue'
import { columnOpen, PART_ICONS, partFacts, pickPart, sheetOpen, showPart } from '@/components/pull/parts'
import PullHeader from '@/components/pull/PullHeader.vue'
import PullPanels from '@/components/pull/PullPanels.vue'
import { useStanding } from '@/components/pull/standing'
import { formatNumber, sides } from '@/locale'
import { scope, showAllChanges, shownFiles, stepCommits, viewedCount } from '@/stores/pull'
import { large } from '@/stores/ui'
import { PULL_PARTS, pullPart, type PullPart } from '@/stores/view'

const { t } = useI18n()
const header = useTemplateRef('header')
const badge = (part: PullPart) => partFacts.value[part].fresh
const { checks } = useStanding()
// The strip marks the checks when something in them wants a look.
const failing = computed(() => (checks.value && !checks.value.passing ? checks.value : null))

// The numbers pick the parts in the strip's order, and the open one again folds the column. `/` filters the files.
useKeys({
  ...Object.fromEntries(PULL_PARTS.map((part, index) => [String(index + 1), () => pickPart(part)])),
  '[': () => stepCommits(-1),
  ']': () => stepCommits(1),
  a: showAllChanges,
  '/': async () => {
    showPart('files')
    await nextTick()
    // The sheet on a phone slides up first.
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[data-file-filter]')?.focus())
  },
})

// The strip's marker slides to the middle of the open part's icon.
const strip = useTemplateRef<HTMLElement>('strip')
const marker = ref(0)
watchPostEffect(() => {
  const button = strip.value?.querySelectorAll('button')[PULL_PARTS.indexOf(pullPart.value)]
  if (button) marker.value = button.offsetTop + button.offsetHeight / 2
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <PullHeader ref="header" />
    <div class="flex min-h-0 flex-1">
      <nav
        v-if="large"
        ref="strip"
        class="relative flex w-12 shrink-0 flex-col items-center gap-1 border-e border-default bg-muted py-1"
        :aria-label="t('pull.tabsLabel')"
      >
        <span
          class="absolute start-0 top-0 h-6 w-0.5 rounded-full bg-primary transition-[transform,opacity] duration-300"
          :class="!columnOpen && 'opacity-0'"
          :style="{ transform: `translateY(${marker}px) translateY(-50%)` }"
        />
        <UTooltip
          v-for="(part, index) in PULL_PARTS"
          :key="part"
          :text="t(`pull.tabs.${part}`)"
          :kbds="[String(index + 1)]"
          :content="{ side: sides.end }"
        >
          <button
            type="button"
            class="relative grid size-9 place-items-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-primary"
            :class="
              columnOpen && pullPart === part
                ? 'bg-elevated text-highlighted'
                : 'text-muted hover:bg-elevated/60 hover:text-highlighted'
            "
            :aria-label="t(`pull.tabs.${part}`)"
            :aria-pressed="columnOpen && pullPart === part"
            @click="pickPart(part)"
          >
            <UIcon :name="PART_ICONS[part]" class="size-[18px]" />
            <span
              v-if="badge(part)"
              class="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] text-inverted tabular-nums"
              >{{ formatNumber(badge(part)) }}</span
            >
            <UIcon
              v-else-if="part === 'checks' && failing"
              :name="failing.icon"
              class="absolute -end-0.5 -top-0.5 size-3.5 rounded-full bg-default"
              :class="failing.color"
            />
          </button>
        </UTooltip>
      </nav>
      <aside
        v-if="large"
        v-show="columnOpen"
        class="enter flex shrink-0 flex-col border-e border-default"
        :style="{ width: `${columnWidth}px` }"
      >
        <PartHeading :part="pullPart">
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
        </PartHeading>
        <PullPanels :part="pullPart" />
      </aside>
      <ColumnEdge v-if="large" v-model:open="columnOpen" />
      <FilesView class="min-w-0 flex-1" @scroll="header?.follow($event)" />
    </div>

    <nav
      v-if="!large"
      class="grid shrink-0 grid-cols-4 border-t border-default bg-muted pb-[env(safe-area-inset-bottom)]"
      :aria-label="t('pull.tabsLabel')"
    >
      <button
        v-for="part in PULL_PARTS"
        :key="part"
        type="button"
        class="relative flex h-14 flex-col items-center justify-center gap-1 text-[11px] text-toned"
        @click="pickPart(part)"
      >
        <span class="relative">
          <UIcon :name="PART_ICONS[part]" class="size-5" />
          <span
            v-if="badge(part)"
            class="absolute -end-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] text-inverted tabular-nums"
            >{{ formatNumber(badge(part)) }}</span
          >
          <UIcon
            v-else-if="part === 'checks' && failing"
            :name="failing.icon"
            class="absolute -end-2 -top-1 size-3.5 rounded-full bg-muted"
            :class="failing.color"
          />
        </span>
        <span>
          {{ t(`pull.tabs.${part}`) }}
          <span v-if="part === 'files'" class="font-mono tabular-nums"
            ><template v-if="!scope">{{ formatNumber(viewedCount) }}/</template
            >{{ formatNumber(shownFiles.length) }}</span
          >
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
        <PartHeading :part="pullPart" />
        <PullPanels :part="pullPart" />
      </template>
    </UDrawer>
  </div>
</template>
