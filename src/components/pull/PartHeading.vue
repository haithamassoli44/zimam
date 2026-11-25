<script setup lang="ts">
// PROTOTYPE: the heading of a part in the side column or its sheet: its name and count. For the files, how many are
// viewed, with a line along the bottom edge that fills as they are.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { partFacts } from '@/components/pull/parts'
import { formatNumber } from '@/locale'
import { shownFiles, viewedCount } from '@/stores/pull'
import type { PullPart } from '@/stores/view'

const props = defineProps<{ part: PullPart }>()
const { t } = useI18n()
const count = computed(() => partFacts.value[props.part].count)
const viewed = computed(() => viewedCount.value / Math.max(shownFiles.value.length, 1))
</script>

<template>
  <div class="relative flex h-11 shrink-0 items-center gap-2 border-b border-default ps-4 pe-2 text-[13px]">
    <h2 class="font-medium text-highlighted">{{ t(`pull.tabs.${part}`) }}</h2>
    <span v-if="part === 'files'" class="font-mono text-[12px] text-muted tabular-nums">
      {{ t('pull.viewedOf', { n: formatNumber(viewedCount), of: formatNumber(shownFiles.length) }) }}
    </span>
    <span v-else-if="count !== null" class="font-mono text-[12px] text-muted tabular-nums">{{
      formatNumber(count)
    }}</span>
    <span class="flex-1" />
    <slot />
    <span
      v-if="part === 'files'"
      class="absolute inset-x-0 -bottom-px h-0.5 origin-left bg-primary transition-transform duration-300 rtl:origin-right"
      :style="{ transform: `scaleX(${viewed})` }"
      role="progressbar"
      :aria-valuenow="viewedCount"
      :aria-valuemax="shownFiles.length"
      :aria-label="t('pull.viewed')"
    />
  </div>
</template>
