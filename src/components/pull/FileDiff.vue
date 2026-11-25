<script setup lang="ts">
// One changed file, diffed by Zimam from its two whole texts, with its review threads under their lines.
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LineCounts from '@/components/LineCounts.vue'
import { FILE_LOOKS, tickLook } from '@/components/pull/looks'
import { asked, reveal, scroller } from '@/components/pull/navigation'
import ThreadCard from '@/components/pull/ThreadCard.vue'
import SkeletonLines from '@/components/SkeletonLines.vue'
import { splitRows, visibleBlocks, type FileDiff, type Line } from '@/lib/diff'
import { languageOf, tokenize, type Token } from '@/lib/highlight'
import { paint } from '@/lib/paint'
import type { ReviewThread } from '@/lib/pull'
import { blobUrl } from '@/lib/refs'
import { formatNumber } from '@/locale'
import {
  canTick,
  contentOf,
  diffOf,
  freshFile,
  pull,
  threadsByPath,
  toggleViewed,
  viewedState,
  type PullFile,
} from '@/stores/pull'
import { settings } from '@/stores/settings'
import { phone } from '@/stores/ui'

const props = defineProps<{ file: PullFile; single?: boolean }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const grid = useTemplateRef<HTMLElement>('grid')

const diff = computed(() => diffOf(props.file))
const ready = computed<FileDiff | null>(() => (typeof diff.value === 'object' ? diff.value : null))

// A new or deleted file has one side, so it takes the full width even in a split view.
const oneSided = computed(() => !props.file.oldAt || !props.file.newAt)
const mode = computed(() => (settings.diffView === 'split' && !oneSided.value && !phone.value ? 'split' : 'unified'))
const wrap = computed(() => settings.longLines === 'wrap')

const viewed = computed(() => viewedState(props.file))
const folded = ref(viewed.value === 'viewed' && !props.single)
watch(viewed, (state) => {
  if (!props.single) folded.value = state === 'viewed'
})

// Rendered once near the screen, and kept. Near is within the diff's scroller: a page's margin stops at the scroller,
// which clips what's past its edge first.
const near = ref(!!props.single)
let observer: IntersectionObserver | null = null
onMounted(() => {
  if (near.value || !root.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (!entry?.isIntersecting) return
      near.value = true
      observer?.disconnect()
    },
    { root: scroller.value, rootMargin: '1200px 0px' },
  )
  observer.observe(root.value)
})

const lang = computed(() => languageOf(props.file.path))
const oldTokens = shallowRef<Token[][] | null>(null)
const newTokens = shallowRef<Token[][] | null>(null)
watch(
  [near, ready],
  async ([isNear, value]) => {
    if (!isNear || !value) return
    const old = contentOf(props.file.oldAt)
    const next = contentOf(props.file.newAt)
    const [a, b] = await Promise.all([
      old && 'text' in old ? tokenize(old, lang.value) : null,
      next && 'text' in next ? tokenize(next, lang.value) : null,
    ])
    oldTokens.value = a
    newTokens.value = b
  },
  { immediate: true },
)

const tokensOf = (line: Line) =>
  line.kind === 'del' ? oldTokens.value?.[line.old! - 1] : newTokens.value?.[(line.new ?? 0) - 1]

// --- Threads ---
const threads = computed(() => threadsByPath.value.get(props.file.path) ?? [])
const anchored = computed(() =>
  threads.value.filter((thread) => thread.line !== null && !thread.outdated && !thread.onFile),
)
const loose = computed(() => threads.value.filter((thread) => !anchored.value.includes(thread)))
const showLoose = ref(false)

function indexOf(thread: ReviewThread): number {
  const lines = ready.value?.lines ?? []
  return thread.side === 'new'
    ? lines.findIndex((line) => line.new === thread.line && line.kind !== 'del')
    : lines.findIndex((line) => line.old === thread.line && line.kind !== 'add')
}

const threadsAt = computed(() => {
  const map = new Map<number, ReviewThread[]>()
  for (const thread of anchored.value) {
    const index = indexOf(thread)
    if (index >= 0) map.set(index, [...(map.get(index) ?? []), thread])
  }
  return map
})

// --- Folding unchanged lines ---
const CONTEXT = 3
// Unfolded by hand, by line index. Another diff of the file (whitespace on or off) numbers its lines anew.
const opened = reactive(new Set<number>())
watch(ready, () => opened.clear())
// A thread's line shows with the lines around it, as a change does.
const blocks = computed(() =>
  ready.value ? visibleBlocks(ready.value, CONTEXT, { anchors: threadsAt.value.keys(), open: opened }) : [],
)
const STEP = 20
function expand(block: { from: number; to: number }, how: 'up' | 'down' | 'all') {
  const from = how === 'down' ? Math.max(block.from, block.to - STEP) : block.from
  const to = how === 'up' ? Math.min(block.to, block.from + STEP) : block.to
  for (let index = from; index < to; index++) opened.add(index)
}

// --- Rows ---
// A line row is its cells across the grid: a split view's two numbers and two texts, or a unified view's numbers and
// its text. Each text cell carries the threads on its side, for the margin's markers.
type Cell =
  | { kind: 'num'; key: string; text: string | number; css: (string | false)[]; change: boolean; fresh: boolean }
  | { kind: 'text'; key: string; line: Line | null; side?: 'old' | 'new'; css: string; threads: ReviewThread[] }
type Row =
  | { kind: 'line'; key: string; at: number; cells: Cell[]; threads: ReviewThread[] }
  | { kind: 'gap'; key: string; from: number; to: number; first: boolean; last: boolean }

const changeStarts = computed(() => new Set(ready.value?.changes ?? []))

function splitCells(left: Line | null, right: Line | null, at: number, here: ReviewThread[]): Cell[] {
  return [
    {
      kind: 'num',
      key: 'a',
      text: left?.old ?? '',
      css: [tone(left), freshBar(left) && 'diff-fresh'],
      change: changeStarts.value.has(at),
      fresh: freshBar(left),
    },
    {
      kind: 'text',
      key: 'b',
      line: left,
      side: 'old',
      css: tone(left),
      threads: here.filter((thread) => thread.side === 'old'),
    },
    {
      kind: 'num',
      key: 'c',
      text: right?.new ?? '',
      css: [tone(right), freshBar(right) && 'diff-fresh'],
      change: false,
      fresh: freshBar(right),
    },
    {
      kind: 'text',
      key: 'd',
      line: right,
      side: 'new',
      css: tone(right),
      threads: here.filter((thread) => thread.side === 'new'),
    },
  ]
}
// Long lines that scroll keep the numbers in place, so they stick at the start.
function unifiedCells(line: Line, at: number, here: ReviewThread[]): Cell[] {
  const stick = !wrap.value
  const own: Cell = {
    kind: 'num',
    key: 'b',
    text: (props.file.newAt ? line.new : line.old) ?? '',
    css: [
      tone(line),
      freshBar(line) && 'diff-fresh',
      stick && 'sticky z-1',
      stick && (oneSided.value ? 'start-0' : 'start-(--num-w)'),
    ],
    change: oneSided.value && changeStarts.value.has(at),
    fresh: freshBar(line),
  }
  const text: Cell = { kind: 'text', key: 'c', line, css: tone(line), threads: here }
  if (oneSided.value) return [own, text]
  const old: Cell = {
    kind: 'num',
    key: 'a',
    text: line.old ?? '',
    css: [tone(line), stick && 'sticky start-0 z-1'],
    change: changeStarts.value.has(at),
    fresh: false,
  }
  return [old, own, text]
}

const rows = computed<Row[]>(() => {
  const value = ready.value
  if (!value) return []
  const out: Row[] = []
  const list = blocks.value
  list.forEach((block, position) => {
    if (block.kind === 'gap') {
      out.push({
        kind: 'gap',
        key: `g${block.from}`,
        from: block.from,
        to: block.to,
        first: position === 0,
        last: position === list.length - 1,
      })
      return
    }
    if (mode.value === 'split') {
      for (const row of splitRows(value.lines, block.from, block.to)) {
        const indexes = new Set([row.leftAt, row.rightAt])
        const here = [...indexes].flatMap((index) => (index === null ? [] : (threadsAt.value.get(index) ?? [])))
        out.push({
          kind: 'line',
          key: `l${row.at}`,
          at: row.at,
          cells: splitCells(row.left, row.right, row.at, here),
          threads: here,
        })
      }
    } else {
      for (let index = block.from; index < block.to; index++) {
        const here = threadsAt.value.get(index) ?? []
        out.push({
          kind: 'line',
          key: `l${index}`,
          at: index,
          cells: unifiedCells(value.lines[index], index, here),
          threads: here,
        })
      }
    }
  })
  return out
})
// The grid's columns, by the layout and the line numbers' width: the stylesheet sizes them.
const layout = computed(() =>
  mode.value === 'split' ? 'diff-split' : oneSided.value ? 'diff-one-sided' : 'diff-unified',
)
const digits = computed(() => ({ '--digits': String(Math.max(ready.value?.lines.length ?? 0, 10)).length }))

function tone(line: Line | null): string {
  if (!line) return 'diff-empty'
  if (line.kind === 'same') return ''
  const base = line.kind === 'add' ? 'diff-add' : 'diff-del'
  return line.seen ? `${base} diff-seen` : base
}
const freshBar = (line: Line | null) => !!line && line.kind !== 'same' && line.seen === false
const sign = (line: Line | null) => (!line ? '' : line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' ')

// --- Long lines that scroll: each side of a split view scrolls on its own, through a bar under the file ---
const longest = computed(() => {
  const value = ready.value
  let old = 0
  let next = 0
  for (const line of value?.lines ?? []) {
    if (line.kind !== 'add') old = Math.max(old, line.text.length)
    if (line.kind !== 'del') next = Math.max(next, line.text.length)
  }
  return { old, new: next }
})
function shift(side: 'old' | 'new', event: Event) {
  root.value?.style.setProperty(`--sx-${side}`, `${(event.target as HTMLElement).scrollLeft}px`)
}
const bars = { old: useTemplateRef<HTMLElement>('barOld'), new: useTemplateRef<HTMLElement>('barNew') }
function onWheel(event: WheelEvent) {
  if (wrap.value || mode.value !== 'split') return
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0
  if (!delta) return
  const side = (event.target as Element).closest('[data-side]')?.getAttribute('data-side') as 'old' | 'new' | null
  const bar = side && bars[side].value
  if (!bar) return
  bar.scrollLeft += delta
  event.preventDefault()
}

const rowOf = (thread: ReviewThread) =>
  rows.value.find((row): row is Extract<Row, { kind: 'line' }> => row.kind === 'line' && row.threads.includes(thread))

/** Lights up a row once, as the line a thread was asked for. */
function hot(at: number) {
  for (const element of grid.value?.querySelectorAll<HTMLElement>(`[data-row="${at}"]`) ?? []) {
    // Off, a layout, and on again: a row lit a moment ago lights up from the start.
    element.classList.remove('diff-hot')
    void element.offsetWidth
    element.classList.add('diff-hot')
    element.addEventListener('animationend', () => element.classList.remove('diff-hot'), { once: true })
  }
}

// Asked for from the conversation: open the file and the thread, and once the line is drawn, bring it into view.
watch(
  [asked, rows, diff],
  async ([thread]) => {
    if (!thread || thread.path !== props.file.path) return
    folded.value = false
    near.value = true
    if (loose.value.includes(thread)) showLoose.value = true
    // The texts are still on their way: this runs again once they're in.
    if (diff.value === null) return
    await nextTick()
    const row = rowOf(thread)
    const target = row
      ? grid.value?.querySelector(`[data-row="${row.at}"]`)
      : (root.value?.querySelector(`[data-loose="${thread.id}"]`) ?? root.value)
    if (!target || asked.value !== thread) return
    asked.value = null
    reveal(target, 'center')
    if (row) hot(row.at)
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  observer?.disconnect()
})

// --- Header ---
const dir = computed(() =>
  props.file.path.includes('/') ? props.file.path.slice(0, props.file.path.lastIndexOf('/') + 1) : '',
)
const base = computed(() => props.file.path.slice(dir.value.length))
const fresh = computed(() => freshFile(props.file))
// The file as the commits shown leave it.
const onGitHub = computed(() => (pull.value ? blobUrl(pull.value.ref.repo, props.file.at, props.file.path) : '#'))
// What a file likely shows before it's drawn: its changes and some lines around them.
const unread = computed(() => ({ '--lines': Math.max(3, props.file.additions + props.file.deletions + 6) }))
const pieces = (line: Line | null) => (line ? paint(line.text, tokensOf(line), line.words) : [])
</script>

<template>
  <section ref="root" class="border-b border-default" :data-path="file.path">
    <header
      class="sticky top-0 z-10 flex min-h-11 items-center gap-2 border-b border-default bg-default/95 px-3 backdrop-blur sm:px-4"
    >
      <UButton
        v-if="!single"
        :icon="folded ? 'i-octicon-chevron-right-16' : 'i-octicon-chevron-down-16'"
        color="neutral"
        variant="ghost"
        size="xs"
        :aria-label="folded ? t('pull.unfold') : t('pull.fold')"
        :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
        @click="folded = !folded"
      />
      <UTooltip :text="t(`pull.status.${file.status}`)">
        <UIcon :name="FILE_LOOKS[file.status].icon" class="size-4 shrink-0" :class="FILE_LOOKS[file.status].color" />
      </UTooltip>
      <span class="flex min-w-0 flex-1 items-baseline gap-2 font-mono text-[13px]" dir="ltr">
        <span class="min-w-0 truncate"
          ><span class="text-muted">{{ dir }}</span
          ><span class="font-medium text-highlighted">{{ base }}</span></span
        >
        <span v-if="file.oldPath" class="hidden min-w-0 truncate text-[12px] text-muted md:inline"
          >← {{ file.oldPath }}</span
        >
      </span>
      <span v-if="fresh" class="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary">
        <span class="size-1.5 rounded-full bg-primary" /><span class="max-sm:hidden">{{ t('pull.changedSince') }}</span>
      </span>
      <span v-if="file.generated" class="tag">{{ t('pull.generatedTag') }}</span>
      <span v-if="threads.length" class="inline-flex shrink-0 items-center gap-1 text-[12px] text-muted">
        <UIcon name="i-octicon-comment-discussion-16" class="size-4" />{{ formatNumber(threads.length) }}
      </span>
      <LineCounts
        :additions="ready?.additions ?? file.additions"
        :deletions="ready?.deletions ?? file.deletions"
        class="shrink-0 text-[12px] max-sm:hidden"
      />
      <UTooltip :text="t('pull.onGitHub')">
        <UButton
          :to="onGitHub"
          target="_blank"
          icon="i-octicon-link-external-16"
          color="neutral"
          variant="ghost"
          size="xs"
          :aria-label="t('pull.onGitHub')"
          class="max-sm:hidden"
        />
      </UTooltip>
      <button
        type="button"
        class="tap inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] ring-1 transition-colors ring-inset disabled:opacity-50"
        :class="
          viewed === 'viewed'
            ? 'bg-elevated text-highlighted ring-accented'
            : 'text-toned ring-default enabled:hover:bg-elevated enabled:hover:text-highlighted'
        "
        :aria-pressed="viewed === 'viewed'"
        :disabled="!canTick(file)"
        @click="toggleViewed([file])"
      >
        <UIcon :name="tickLook(viewed === 'viewed').icon" class="size-4" :class="tickLook(viewed === 'viewed').color" />
        <span class="max-sm:sr-only">{{ t('pull.viewed') }}</span>
      </button>
    </header>

    <div v-if="!folded">
      <p
        v-if="viewed === 'changed'"
        class="flex items-center gap-2 border-b border-default bg-muted px-4 py-2 text-[12px] text-toned"
      >
        <UIcon name="i-octicon-dot-fill-16" class="size-4 text-primary" />{{ t('pull.unticked') }}
      </p>

      <div v-if="loose.length" class="border-b border-default bg-muted px-4 py-2 text-[13px]">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-toned transition-colors hover:text-highlighted"
          @click="showLoose = !showLoose"
        >
          <UIcon
            :name="showLoose ? 'i-octicon-chevron-down-16' : 'i-octicon-chevron-right-16'"
            class="size-4 rtl:-scale-x-100"
          />
          {{ t('pull.looseThreads', { n: formatNumber(loose.length) }, loose.length) }}
        </button>
        <div v-if="showLoose" class="mt-2 max-w-3xl space-y-2 pb-2">
          <ThreadCard v-for="thread in loose" :key="thread.id" :thread="thread" :data-loose="thread.id" place="file" />
        </div>
      </div>

      <div v-if="!near" class="diff-unread" :style="unread" />
      <SkeletonLines v-else-if="diff === null" :lines="5" class="p-4" />
      <p v-else-if="diff === 'binary'" class="px-4 py-6 text-center text-[13px] text-muted">{{ t('pull.binary') }}</p>
      <p v-else-if="diff === 'tooBig' || diff === 'failed'" class="px-4 py-6 text-center text-[13px] text-muted">
        {{ diff === 'failed' ? t('pull.readFailed') : t('pull.tooBig') }}
        <a :href="onGitHub" target="_blank" rel="noopener" class="font-medium text-toned underline">{{
          t('pull.onGitHub')
        }}</a>
      </p>
      <p v-else-if="ready && !ready.lines.length" class="px-4 py-6 text-center text-[13px] text-muted">
        {{ t('pull.empty') }}
      </p>
      <!-- A container: rows that keep to the visible width size by `cqw`, so a resize restyles them alone, not every line. -->
      <div
        v-else-if="ready"
        class="@container"
        :class="!wrap && mode === 'unified' && 'overflow-x-auto overscroll-x-contain'"
        @wheel="onWheel"
      >
        <div
          ref="grid"
          class="diff-code relative grid"
          :class="[layout, wrap ? 'diff-wrap' : 'diff-scroll', !wrap && mode === 'unified' && 'w-max min-w-full']"
          :style="digits"
          dir="ltr"
        >
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
        </div>

        <div
          v-if="!wrap && mode === 'split'"
          class="diff-bars diff-split sticky bottom-0 z-1 grid h-3"
          :style="digits"
          dir="ltr"
        >
          <span />
          <div ref="barOld" class="overflow-x-auto" @scroll="shift('old', $event)">
            <div class="diff-span h-px" :style="{ '--longest': longest.old }" />
          </div>
          <span />
          <div ref="barNew" class="overflow-x-auto" @scroll="shift('new', $event)">
            <div class="diff-span h-px" :style="{ '--longest': longest.new }" />
          </div>
        </div>
      </div>

      <p v-if="ready?.rewritten" class="border-t border-default px-4 py-2 text-[12px] text-muted">
        {{ t('pull.rewritten') }}
      </p>
    </div>
  </section>
</template>
