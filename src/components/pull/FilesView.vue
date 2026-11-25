<script setup lang="ts">
// PROTOTYPE: the changed files: a toolbar, and every file in one scroll or one at a time.
import UButton from '@nuxt/ui/components/Button.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useKeys } from '@/components/keys'
import { pressed } from '@/components/pressed'
import FileDiff from '@/components/pull/FileDiff.vue'
import { showPart } from '@/components/pull/parts'
import ScopeCard from '@/components/pull/ScopeCard.vue'
import SinceVisit from '@/components/pull/SinceVisit.vue'
import { formatNumber } from '@/locale'
import {
  activeFile,
  currentFile,
  fileAsked,
  fileMode,
  filesState,
  freshFile,
  pull,
  reveal,
  scope,
  setFileMode,
  shownFiles,
  stepCommits,
  toggleViewed,
  viewedState,
} from '@/stores/pull'
import { settings } from '@/stores/settings'
import { openKeys } from '@/stores/ui'

/** `scroll`: the diff's own scroller, as it scrolls, for a header that folds away. */
const emit = defineEmits<{ scroll: [box: HTMLElement] }>()
const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')

const one = computed(() => fileMode.value === 'one')
const index = computed(() =>
  Math.max(
    0,
    shownFiles.value.findIndex((file) => file.path === currentFile.value),
  ),
)
const current = computed(() => shownFiles.value[index.value] ?? null)

// Where a file counts as at the top: just under the sticky header over each file (`min-h-11` in FileDiff.vue).
const UNDER_HEADER = 56

const inView = ref<string | null>(null)
let frame = 0
function onScroll() {
  if (scroller.value) emit('scroll', scroller.value)
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const box = scroller.value
    if (!box) return
    const top = box.getBoundingClientRect().top + UNDER_HEADER
    let found: string | null = null
    for (const section of box.querySelectorAll<HTMLElement>('[data-path]')) {
      if (section.getBoundingClientRect().top <= top) found = section.dataset.path ?? null
      else break
    }
    inView.value = found ?? shownFiles.value[0]?.path ?? null
  })
}
const active = computed(() => (one.value ? current.value?.path : inView.value) ?? null)
watch(active, (path) => (activeFile.value = path), { immediate: true })

/** Brings a file into view: to the top of the scroll, or alone. */
async function pick(path: string) {
  currentFile.value = path
  await nextTick()
  const target = one.value
    ? scroller.value?.firstElementChild
    : scroller.value?.querySelector(`[data-path="${CSS.escape(path)}"]`)
  if (target) reveal(target, 'start')
}
watch(fileAsked, (path) => {
  if (!path) return
  fileAsked.value = null
  void pick(path)
})

function step(by: -1 | 1) {
  const list = shownFiles.value
  const at = list.findIndex((file) => file.path === active.value)
  const next = list[Math.min(list.length - 1, Math.max(0, at + by))]
  if (next) void pick(next.path)
}

function viewedAndNext() {
  const file = current.value
  if (!file) return
  if (!scope.value && viewedState(file) !== 'viewed') toggleViewed(file)
  step(1)
}

// --- The commits shown ---
const commits = computed(() => pull.value?.commits ?? [])
const scopeLabel = computed(() => {
  const at = scope.value
  if (!at) return { sha: '', text: t('pull.scope.all') }
  if (at.from === at.to) return { sha: commits.value[at.from].short, text: commits.value[at.from].headline }
  const n = at.to - at.from + 1
  return { sha: '', text: t('pull.scope.commits', { n: formatNumber(n) }, n) }
})
const canStep = computed(() => ({
  back: !!scope.value && scope.value.from > 0,
  on: scope.value ? scope.value.to < commits.value.length - 1 : commits.value.length > 0,
}))
// Other commits start at their top.
watch(
  () => scope.value?.key,
  () => scroller.value?.scrollTo({ top: 0 }),
)
const diffKey = (path: string) => `${scope.value?.key ?? ''}:${path}`

function changeStep(by: -1 | 1) {
  const box = scroller.value
  if (!box) return
  const top = box.getBoundingClientRect().top + UNDER_HEADER
  const marks = [...box.querySelectorAll('[data-change]')]
  const positions = marks.map((mark) => mark.getBoundingClientRect().top - top)
  const target = by === 1 ? marks[positions.findIndex((y) => y > 4)] : marks[positions.findLastIndex((y) => y < -4)]
  if (target) reveal(target, 'center')
}

function firstNew() {
  const first = shownFiles.value.find(freshFile)
  if (!first) return
  const mark = one.value ? null : scroller.value?.querySelector('.diff-fresh')
  if (mark) reveal(mark, 'center')
  else void pick(first.path)
}

useKeys({
  j: () => changeStep(1),
  k: () => changeStep(-1),
  n: () => step(1),
  p: () => step(-1),
  v: () => {
    const file = shownFiles.value.find((each) => each.path === active.value)
    if (file && one.value) viewedAndNext()
    else if (file) toggleViewed(file)
  },
})
watch(shownFiles, () => onScroll())

// With nothing focused, the keys that scroll scroll the diff: it takes the focus, then the browser scrolls it. Taking
// the focus on arrival instead would draw its ring for a reader who came by the address.
function intoDiff() {
  if (!document.activeElement || document.activeElement === document.body)
    scroller.value?.focus({ preventScroll: true })
  return false
}
useKeys(
  Object.fromEntries([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'].map((key) => [key, intoDiff])),
)
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-3 sm:px-4">
      <div class="flex min-w-0 items-center" role="group" :aria-label="t('pull.scope.label')">
        <UTooltip :text="t('pull.scope.pick')">
          <UButton
            color="neutral"
            :variant="scope ? 'soft' : 'ghost'"
            size="sm"
            icon="i-octicon-git-commit-16"
            class="max-w-72 min-w-0"
            :aria-label="`${t('pull.scope.pick')}: ${scopeLabel.sha} ${scopeLabel.text}`"
            @click="showPart('commits')"
          >
            <span class="flex min-w-0 items-baseline gap-1.5">
              <code v-if="scopeLabel.sha" class="font-mono text-[12px] text-toned">{{ scopeLabel.sha }}</code>
              <bdi class="truncate" :class="scopeLabel.sha && 'max-md:hidden'" dir="auto">{{ scopeLabel.text }}</bdi>
            </span>
          </UButton>
        </UTooltip>
        <UTooltip :text="t('pull.scope.previous')" :kbds="['[']">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-left-16"
            :aria-label="t('pull.scope.previous')"
            :disabled="!canStep.back"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="stepCommits(-1)"
          />
        </UTooltip>
        <UTooltip :text="t('pull.scope.next')" :kbds="[']']">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-right-16"
            :aria-label="t('pull.scope.next')"
            :disabled="!canStep.on"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="stepCommits(1)"
          />
        </UTooltip>
      </div>
      <UFieldGroup size="sm" role="group" :aria-label="t('pull.fileMode')">
        <UButton v-bind="pressed(!one)" size="sm" :label="t('pull.modes.all')" @click="setFileMode('all')" />
        <UButton v-bind="pressed(one)" size="sm" :label="t('pull.modes.one')" @click="setFileMode('one')" />
      </UFieldGroup>
      <UFieldGroup size="sm" role="group" :aria-label="t('pull.diffView')" class="max-sm:hidden">
        <UButton
          v-bind="pressed(settings.diffView === 'split')"
          size="sm"
          icon="i-octicon-columns-16"
          :aria-label="t('pull.views.split')"
          @click="settings.diffView = 'split'"
        />
        <UButton
          v-bind="pressed(settings.diffView === 'unified')"
          size="sm"
          icon="i-octicon-rows-16"
          :aria-label="t('pull.views.unified')"
          @click="settings.diffView = 'unified'"
        />
      </UFieldGroup>
      <UTooltip :text="t('pull.whitespaceHelp')">
        <UButton
          v-bind="pressed(settings.ignoreSpace)"
          size="sm"
          :label="t('pull.whitespace')"
          class="max-md:hidden"
          @click="settings.ignoreSpace = !settings.ignoreSpace"
        />
      </UTooltip>
      <span class="flex-1" />
      <UTooltip :text="t('keys.title')" :kbds="['?']">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-octicon-command-palette-16"
          :aria-label="t('keys.title')"
          class="max-sm:hidden"
          @click="openKeys"
        />
      </UTooltip>
    </div>

    <div
      ref="scroller"
      class="relative min-h-0 flex-1 overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/60"
      tabindex="0"
      data-main
      :aria-label="t('pull.changesLabel')"
      @scroll.passive="onScroll"
    >
      <ScopeCard v-if="scope" />
      <SinceVisit v-else @first="firstNew" />
      <div v-if="filesState === 'failed'" class="px-6 py-16 text-center text-toned">{{ t('pull.changesFailed') }}</div>
      <div v-else-if="filesState === 'loading'" class="space-y-3 px-6 py-8" aria-busy="true">
        <USkeleton v-for="n in 4" :key="n" class="h-10" />
      </div>
      <p v-else-if="!shownFiles.length" class="px-6 py-16 text-center text-[13px] text-muted">
        {{ scope ? t('pull.scope.empty') : t('pull.end') }}
      </p>

      <template v-else-if="!one">
        <FileDiff v-for="file in shownFiles" :key="diffKey(file.path)" :file="file" />
        <p class="px-6 py-10 text-center text-[13px] text-muted">{{ t('pull.end') }}</p>
      </template>

      <template v-else-if="current">
        <div class="flex h-11 items-center gap-2 border-b border-default px-3 sm:px-4">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-left-16"
            :aria-label="t('pull.previousFile')"
            :disabled="index === 0"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="step(-1)"
          />
          <span class="font-mono text-[12px] text-muted tabular-nums"
            >{{ formatNumber(index + 1) }} / {{ formatNumber(shownFiles.length) }}</span
          >
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-right-16"
            :aria-label="t('pull.nextFile')"
            :disabled="index >= shownFiles.length - 1"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="step(1)"
          />
          <span class="flex-1" />
          <UButton
            color="neutral"
            variant="solid"
            size="sm"
            :label="scope ? t('pull.nextFile') : t('pull.viewedNext')"
            trailing-icon="i-octicon-arrow-right-16"
            :disabled="!!scope && index >= shownFiles.length - 1"
            :ui="{ trailingIcon: 'rtl:-scale-x-100' }"
            @click="viewedAndNext"
          />
        </div>
        <FileDiff :key="diffKey(current.path)" :file="current" single />
        <div class="flex justify-center px-6 py-10">
          <UButton
            v-if="index < shownFiles.length - 1"
            color="neutral"
            variant="outline"
            :label="t('pull.nextFileNamed', { name: shownFiles[index + 1].path.split('/').pop() })"
            trailing-icon="i-octicon-arrow-right-16"
            :ui="{ trailingIcon: 'rtl:-scale-x-100' }"
            @click="step(1)"
          />
          <p v-else class="text-[13px] text-muted">{{ t('pull.end') }}</p>
        </div>
      </template>
    </div>
  </div>
</template>
