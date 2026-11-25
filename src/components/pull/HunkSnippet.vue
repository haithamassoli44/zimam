<script setup lang="ts">
// The end of the hunk a review comment was written on, as GitHub sends it with the comment.
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
      class="px-3 whitespace-pre"
      :class="line.kind === 'add' ? 'diff-add' : line.kind === 'del' ? 'diff-del' : ''"
    >
      <span class="diff-sign">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ' }}</span
      >{{ line.text }}
    </div>
  </div>
</template>
