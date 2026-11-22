<script setup lang="ts">
import { computed } from 'vue'

import { WEEKS } from '@/lib/repos'

// `loading` says some weeks may still be short.
const props = defineProps<{ weeks: number[]; loading?: boolean }>()

const STEP = 4
const WIDTH = WEEKS * STEP - 1
const HEIGHT = 24

// Each repository is drawn on its own scale: the bars show when it was busy, not how busy next to the others.
const bars = computed(() => {
  const most = Math.max(1, ...props.weeks)
  return props.weeks.map((count, index) => ({
    x: index * STEP,
    height: count ? Math.max(2, Math.round((count / most) * HEIGHT)) : 1,
  }))
})
</script>

<template>
  <!-- Time runs in the reading direction: the current week is at the end of the line. -->
  <svg
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    :width="WIDTH"
    :height="HEIGHT"
    class="shrink-0 text-muted rtl:-scale-x-100"
    :class="loading && 'motion-safe:animate-pulse'"
    aria-hidden="true"
  >
    <rect
      v-for="(bar, index) in bars"
      :key="index"
      :x="bar.x"
      :y="HEIGHT - bar.height"
      width="3"
      :height="bar.height"
      rx="0.5"
      fill="currentColor"
      :opacity="index === WEEKS - 1 ? 0.75 : 0.35"
    />
  </svg>
</template>
