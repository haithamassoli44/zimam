<script setup lang="ts">
// Lines added and removed, as `+12 −3`.
import { formatNumber } from '@/locale'

defineProps<{ additions: number; deletions: number }>()
</script>

<template>
  <span class="font-mono tabular-nums" dir="ltr"
    ><span class="text-success">+{{ formatNumber(additions) }}</span>
    <span class="ms-1 text-error">−{{ formatNumber(deletions) }}</span></span
  >
</template>
