<script setup lang="ts">
// A setting picked from a few choices, under its name.
import ChoiceGroup from '@/components/ChoiceGroup.vue'

defineProps<{
  title: string
  choices: { value: string; label: string; lang?: string }[]
  picked: (value: string) => boolean
}>()
const emit = defineEmits<{ pick: [value: string] }>()
</script>

<template>
  <div class="space-y-2">
    <p class="text-sm text-toned" aria-hidden="true">{{ title }}</p>
    <ChoiceGroup
      :label="title"
      :choices="choices"
      :picked="picked"
      class="w-full *:flex-1 *:justify-center"
      @pick="emit('pick', $event)"
    />
  </div>
</template>
