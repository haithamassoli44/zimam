<script setup lang="ts">
// What a part's icon carries, in the strip and the phone's bar: how many are new since the last visit, or else a look
// that asks for a look, as failing checks do.
import UIcon from '@nuxt/ui/components/Icon.vue'

import type { Part } from '@/components/pull/parts'
import { formatNumber } from '@/locale'

defineProps<{ part: Part }>()
</script>

<template>
  <span
    v-if="part.fresh"
    class="absolute grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] text-inverted tabular-nums"
    >{{ formatNumber(part.fresh) }}</span
  >
  <UIcon
    v-else-if="part.alert"
    :name="part.alert.icon"
    class="absolute size-3.5 rounded-full"
    :class="part.alert.color"
  />
</template>
