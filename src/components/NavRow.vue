<script setup lang="ts">
import UIcon from '@nuxt/ui/components/Icon.vue'

import { formatNumber } from '@/locale'

defineProps<{ label: string; count: number; active?: boolean; icon?: string }>()
const emit = defineEmits<{ pick: [] }>()
</script>

<template>
  <div class="group relative">
    <button
      type="button"
      class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm focus-ring transition-colors pointer-coarse:h-11"
      :class="[
        active
          ? 'bg-elevated font-medium text-highlighted ring-1 ring-default ring-inset'
          : 'text-toned hover:bg-elevated/60 hover:text-highlighted',
        $slots.actions && 'pointer-coarse:pe-9',
      ]"
      :aria-current="active ? 'page' : undefined"
      @click="emit('pick')"
    >
      <UIcon v-if="icon" :name="icon" class="size-4 shrink-0 text-muted" />
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span
        class="font-mono text-xs text-muted tabular-nums"
        :class="
          $slots.actions &&
          'group-focus-within:invisible group-hover:invisible group-has-data-[state=open]:invisible pointer-coarse:visible!'
        "
        >{{ formatNumber(count) }}</span
      >
    </button>
    <div
      v-if="$slots.actions"
      class="absolute end-1 top-1/2 flex -translate-y-1/2 reveal has-data-[state=open]:opacity-100"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
