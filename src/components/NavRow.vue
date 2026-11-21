<script setup lang="ts">
import { formatNumber } from '@/locale'

defineProps<{ label: string; count: number; active?: boolean }>()
const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <div class="group relative">
    <button
      type="button"
      class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary"
      :class="[
        active
          ? 'bg-elevated font-medium text-highlighted ring-1 ring-default ring-inset'
          : 'text-toned hover:bg-elevated/60 hover:text-highlighted',
        $slots.actions && 'pointer-coarse:pe-9',
      ]"
      :aria-current="active ? 'page' : undefined"
      @click="emit('pick')"
    >
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span
        class="font-mono text-xs text-muted tabular-nums"
        :class="$slots.actions && 'group-focus-within:invisible group-hover:invisible pointer-coarse:visible'"
        >{{ formatNumber(count) }}</span
      >
    </button>
    <div
      v-if="$slots.actions"
      class="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-data-[state=open]:opacity-100 pointer-coarse:opacity-100"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
