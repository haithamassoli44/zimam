<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'

import { pressed } from '@/components/pressed'
import { formatNumber } from '@/locale'

interface Choice {
  value: string
  label: string
  count?: number
  lang?: string
}

defineProps<{ label: string; choices: Choice[]; picked: (value: string) => boolean }>()
const emit = defineEmits<{ pick: [value: string] }>()
</script>

<template>
  <UFieldGroup role="group" :aria-label="label">
    <UButton
      v-for="choice in choices"
      :key="choice.value"
      v-bind="pressed(picked(choice.value))"
      :aria-pressed="picked(choice.value)"
      :lang="choice.lang"
      @click="emit('pick', choice.value)"
    >
      {{ choice.label }}
      <span v-if="choice.count !== undefined" class="font-mono text-xs font-normal tabular-nums opacity-70">{{
        formatNumber(choice.count)
      }}</span>
    </UButton>
  </UFieldGroup>
</template>
