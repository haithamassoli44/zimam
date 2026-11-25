<script setup lang="ts">
// PROTOTYPE: the end of the hunk a review comment was written on, as GitHub sends it with the comment.
import { computed } from 'vue'

const props = defineProps<{ hunk: string }>()

// The last few lines lead up to the commented line, which comes last.
const lines = computed(() =>
  props.hunk
    .split('\n')
    .filter((line) => !line.startsWith('@@'))
    .slice(-5)
    .map((line) => ({ kind: line[0] === '+' ? 'add' : line[0] === '-' ? 'del' : 'same', text: line.slice(1) })),
)
</script>

<template>
  <div class="diff-code overflow-x-auto border-b border-default py-1" dir="ltr">
    <div
      v-for="(line, index) in lines"
      :key="index"
      class="flex px-3 whitespace-pre"
      :class="line.kind === 'add' ? 'bg-(--diff-add)' : line.kind === 'del' ? 'bg-(--diff-del)' : ''"
    >
      <span class="w-4 shrink-0 text-muted select-none">{{
        line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '
      }}</span>
      <span>{{ line.text }}</span>
    </div>
  </div>
</template>
