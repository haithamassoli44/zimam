<script setup lang="ts">
import { DOT } from '@/components/looks'
import type { Label } from '@/types'

/** A label: a hairline tag with a dot of its color. */
defineProps<{ label: Label }>()
</script>

<template>
  <span
    class="inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5 text-xs text-toned ring-1 ring-default ring-inset"
  >
    <span :class="DOT" :style="{ background: `#${label.color}` }" />
    <bdi>{{ label.name }}</bdi>
  </span>
</template>
