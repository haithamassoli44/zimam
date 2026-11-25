<script setup lang="ts">
// Lines of a placeholder, of ragged widths, as text would leave them, while what goes there loads. `label` says what's
// loading, for a screen reader, where nothing around it says so already.
import USkeleton from '@nuxt/ui/components/Skeleton.vue'

defineProps<{ lines: number; label?: string }>()
</script>

<template>
  <div class="space-y-3" aria-busy="true">
    <span v-if="label" class="sr-only">{{ label }}</span>
    <USkeleton
      v-for="n in lines"
      :key="n"
      class="h-3"
      aria-hidden="true"
      :style="{ width: `${40 + ((n * 17) % 45)}%` }"
    />
  </div>
</template>
