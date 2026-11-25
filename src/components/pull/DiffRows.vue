<script lang="ts">
import type { Line } from '@/lib/diff'
import type { ReviewThread } from '@/lib/pull'

// A line row is its cells across the grid: a split view's two numbers and two texts, or a unified view's numbers and
// its text. Each text cell carries the threads on its side, for the margin's markers.
export type Cell =
  | { kind: 'num'; key: string; text: string | number; css: (string | false)[]; change: boolean; fresh: boolean }
  | { kind: 'text'; key: string; line: Line | null; side?: 'old' | 'new'; css: string; threads: ReviewThread[] }
export type Row =
  | { kind: 'line'; key: string; at: number; cells: Cell[]; threads: ReviewThread[] }
  | { kind: 'gap'; key: string; from: number; to: number; first: boolean; last: boolean }

/** How many hidden lines a gap's arrows show at a time. */
export const STEP = 20
</script>

<script setup lang="ts">
// A file's diff lines, in the grid FileDiff lays out. Apart from the file's header, so ticking a file viewed or
// folding it redraws the header, not every line.
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { useI18n } from 'vue-i18n'

import ThreadCard from '@/components/pull/ThreadCard.vue'
import type { Token } from '@/lib/highlight'
import { paint } from '@/lib/paint'
import { formatNumber } from '@/locale'

const props = defineProps<{
  rows: Row[]
  mode: 'split' | 'unified'
  wrap: boolean
  /** Each side's syntax tokens, by line, once highlighted. */
  old: Token[][] | null
  new: Token[][] | null
}>()
const emit = defineEmits<{ expand: [row: { from: number; to: number }, how: 'up' | 'down' | 'all'] }>()
const { t } = useI18n()

const expand = (row: { from: number; to: number }, how: 'up' | 'down' | 'all') => emit('expand', row, how)
const sign = (line: Line | null) => (!line ? '' : line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ')
const tokensOf = (line: Line) => (line.kind === 'del' ? props.old?.[line.old! - 1] : props.new?.[(line.new ?? 0) - 1])
const pieces = (line: Line | null) => (line ? paint(line.text, tokensOf(line), line.words) : [])
</script>

<template>
  <template v-for="row in rows" :key="row.key">
    <div
      v-if="row.kind === 'gap'"
      class="col-span-full flex h-8 items-center gap-1 bg-muted text-[12px] text-muted"
      :class="!wrap && mode === 'unified' && 'sticky start-0 w-[100cqw]'"
    >
      <UButton
        v-if="!row.first && row.to - row.from > STEP"
        icon="i-octicon-fold-down-16"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('pull.expandDown', { n: formatNumber(STEP) }, STEP)"
        @click="expand(row, 'up')"
      />
      <UButton
        v-if="!row.last && row.to - row.from > STEP"
        icon="i-octicon-fold-up-16"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="t('pull.expandUp', { n: formatNumber(STEP) }, STEP)"
        @click="expand(row, 'down')"
      />
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-2 transition-colors hover:text-highlighted"
        @click="expand(row, 'all')"
      >
        <UIcon name="i-octicon-unfold-16" class="size-4" />
        {{ t('pull.hiddenLines', { n: formatNumber(row.to - row.from) }, row.to - row.from) }}
      </button>
    </div>

    <template v-else>
      <template v-for="cell in row.cells" :key="cell.key">
        <div
          v-if="cell.kind === 'num'"
          class="diff-num"
          :class="cell.css"
          :data-row="row.at"
          :data-change="cell.change || undefined"
          :data-fresh="cell.fresh || undefined"
        >
          {{ cell.text }}
        </div>
        <div v-else class="diff-cell relative" :class="cell.css" :data-side="cell.side" :data-row="row.at">
          <span class="diff-text" :style="cell.side && { '--sx': `var(--sx-${cell.side}, 0px)` }"
            ><span class="diff-sign">{{ sign(cell.line) }}</span
            ><span
              v-for="(piece, index) in pieces(cell.line)"
              :key="index"
              :class="[piece.changed && 'diff-word', piece.italic && 'italic', piece.bold && 'font-medium']"
              :style="piece.color ? { color: piece.color } : undefined"
              >{{ piece.text }}</span
            ></span
          >
        </div>
      </template>
      <div
        v-for="thread in row.threads"
        :key="thread.id"
        class="diff-thread px-3 py-3"
        :class="mode === 'unified' && ['col-span-full', !wrap && 'sticky start-0 w-[100cqw]']"
        :style="mode === 'split' && { gridColumn: thread.side === 'old' ? '1 / 3' : '3 / 5' }"
      >
        <ThreadCard :thread="thread" place="line" :class="mode === 'unified' && 'max-w-3xl'" />
      </div>
    </template>
  </template>
</template>
