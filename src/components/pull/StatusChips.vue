<script setup lang="ts">
// PROTOTYPE: who has to act next, in a line: the review, the checks, and anything in the way of merging. Each opens its
// part of the pull request.
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed } from 'vue'

import { showPart } from '@/components/pull/parts'
import { useStanding } from '@/components/pull/standing'
import type { PullPart } from '@/stores/view'

/** `small`: the pills keep only their icons below large screens. */
defineProps<{ small?: boolean }>()
const { review, checks, merge } = useStanding()

const chips = computed(() => {
  if (!review.value || !merge.value) return []
  const list: { key: string; icon: string; color: string; text: string; part: PullPart }[] = [
    { key: 'review', ...review.value, part: 'conversation' },
  ]
  if (checks.value) list.push({ key: 'checks', ...checks.value, part: 'checks' })
  if (merge.value.short) list.push({ key: 'merge', ...merge.value, text: merge.value.short, part: 'conversation' })
  return list
})
</script>

<template>
  <span class="contents">
    <button
      v-for="chip in chips"
      :key="chip.key"
      type="button"
      class="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full ps-2 pe-2.5 text-[12px] text-toned ring-1 ring-default transition-colors ring-inset hover:bg-elevated hover:text-highlighted"
      :class="small && 'max-lg:pe-2'"
      @click="showPart(chip.part)"
    >
      <UIcon :name="chip.icon" class="size-3.5" :class="chip.color" /><span :class="small && 'max-lg:sr-only'">{{
        chip.text
      }}</span>
    </button>
  </span>
</template>
