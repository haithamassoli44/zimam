<script setup lang="ts">
// When something happened, as a while ago, with the full date on hover: plain, or a link to it.
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'

import { fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'

const props = defineProps<{ at: string; href?: string }>()
defineSlots<{ default?: (props: { ago: string }) => unknown }>()
const ago = computed(() => relativeTime(Date.parse(props.at), now.value))
</script>

<template>
  <UTooltip :text="fullDate(at)">
    <a
      v-if="href"
      :href="href"
      target="_blank"
      rel="noopener"
      class="rounded-sm focus-ring transition-colors hover:text-toned hover:underline"
      ><slot :ago="ago">{{ ago }}</slot></a
    >
    <span v-else
      ><slot :ago="ago">{{ ago }}</slot></span
    >
  </UTooltip>
</template>
