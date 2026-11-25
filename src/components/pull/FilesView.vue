<script setup lang="ts">
// The changed files: a toolbar, and every file in one scroll or one at a time.
import UButton from '@nuxt/ui/components/Button.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { kbds, useKeys, useMain } from '@/components/keys'
import { shown } from '@/components/pressed'
import FileDiff from '@/components/pull/FileDiff.vue'
import {
  activeFile,
  asked,
  currentFile,
  inView,
  onBring,
  reveal,
  scroller as diffScroller,
  showFile,
} from '@/components/pull/navigation'
import { showPart } from '@/components/pull/parts'
import ScopeCard from '@/components/pull/ScopeCard.vue'
import SinceVisit from '@/components/pull/SinceVisit.vue'
import { formatNumber } from '@/locale'
import {
  canTick,
  commitSteps,
  fileMode,
  filesCapped,
  filesState,
  freshFile,
  pull,
  scope,
  setFileMode,
  shownFiles,
  setViewed,
  stepCommits,
  toggleViewed,
  viewedState,
} from '@/stores/pull'
import { settings } from '@/stores/settings'
import { openKeys, phone } from '@/stores/ui'

const { t } = useI18n()
const scroller = useTemplateRef<HTMLElement>('scroller')
// Lent as soon as it's there, before each file's own mount looks for it.
watch(scroller, (box) => (diffScroller.value = box), { flush: 'sync' })
onBeforeUnmount(() => {
  diffScroller.value = null
  onBring(null)
})

const one = computed(() => fileMode.value === 'one')
const index = computed(() =>
  Math.max(
    0,
    shownFiles.value.findIndex((file) => file.path === currentFile.value),
  ),
)
const current = computed(() => shownFiles.value[index.value] ?? null)

// FileDiff's marks: each file's section, and in it its sticky header, where each change starts and its new lines.
const sectionOf = (path: string) => scroller.value?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
/** Where the diff's lines start showing: under the sticky header of the file at the top. */
function readingTop(box: HTMLElement) {
  const header = box.querySelector('[data-path] > header')
  return box.getBoundingClientRect().top + (header?.getBoundingClientRect().height ?? 0)
}

let frame = 0
function onScroll() {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => {
    const box = scroller.value
    if (!box) return
    const top = readingTop(box)
    let found: string | null = null
    for (const section of box.querySelectorAll<HTMLElement>('[data-path]')) {
      if (section.getBoundingClientRect().top <= top) found = section.dataset.path ?? null
      else break
    }
    inView.value = found ?? shownFiles.value[0]?.path ?? null
  })
}

// --- In one scroll, a long pull request's files mount a few at a time: the first at once, the rest a batch at a time
// as the page has a moment. Showing all the changes, or a commit, then answers at once rather than after every file.
const FIRST = 12
const BATCH = 16
const mounted = ref(FIRST)
const mountedFiles = computed(() => shownFiles.value.slice(0, mounted.value))
let growing: ReturnType<typeof setTimeout> | undefined
watch(
  [mounted, shownFiles],
  () => {
    clearTimeout(growing)
    if (mounted.value < shownFiles.value.length) growing = setTimeout(() => (mounted.value += BATCH))
  },
  { immediate: true },
)
watch(
  () => scope.value?.key,
  () => (mounted.value = FIRST),
)
onBeforeUnmount(() => clearTimeout(growing))

/** Mounts the files up to this one and a batch after, so it can come to the top, for what's asked of it. */
async function mountTo(path: string) {
  const at = shownFiles.value.findIndex((file) => file.path === path)
  if (at < mounted.value) return
  mounted.value = at + 1 + BATCH
  await nextTick()
}
watch(asked, (thread) => thread && void mountTo(thread.path))

// A file asked for comes to the top of the scroll, or shows alone.
onBring(async (path) => {
  if (!one.value) await mountTo(path)
  const target = one.value ? scroller.value?.firstElementChild : sectionOf(path)
  if (target) reveal(target, 'start')
})

function step(by: -1 | 1) {
  const list = shownFiles.value
  const at = list.findIndex((file) => file.path === activeFile.value)
  const next = list[Math.min(list.length - 1, Math.max(0, at + by))]
  if (next) void showFile(next.path)
}

function viewedAndNext() {
  const file = current.value
  if (!file || !canTick(file)) return
  if (viewedState(file) !== 'viewed') setViewed([file], true)
  step(1)
}

// --- The commits shown ---
const scopeLabel = computed(() => {
  const commits = scope.value?.commits
  if (!commits) return { sha: '', text: t('pull.scope.all') }
  if (commits.length === 1) return { sha: commits[0].short, text: commits[0].headline }
  return { sha: '', text: t('pull.scope.commits', { n: formatNumber(commits.length) }, commits.length) }
})
watch(
  () => scope.value?.key,
  () => scroller.value?.scrollTo({ top: 0 }),
)
const diffKey = (path: string) => `${scope.value?.key ?? ''}:${path}`

// A change this close to where the lines start is the one being read.
const HERE = 4
function changeStep(by: -1 | 1) {
  const box = scroller.value
  if (!box) return
  const top = readingTop(box)
  const marks = [...box.querySelectorAll('[data-change]')]
  const positions = marks.map((mark) => mark.getBoundingClientRect().top - top)
  const target =
    by === 1 ? marks[positions.findIndex((y) => y > HERE)] : marks[positions.findLastIndex((y) => y < -HERE)]
  if (target) reveal(target, 'center')
}

/** Goes to the first new line of the first file changed since the last visit, or to the file while it isn't drawn. */
function firstNew() {
  const first = shownFiles.value.find(freshFile)
  if (!first) return
  const mark = one.value ? null : sectionOf(first.path)?.querySelector('[data-fresh]')
  if (mark) reveal(mark, 'center')
  else void showFile(first.path)
}

useKeys({
  changes: [() => changeStep(1), () => changeStep(-1)],
  files: [() => step(1), () => step(-1)],
  viewed: () => {
    const file = shownFiles.value.find((each) => each.path === activeFile.value)
    if (file && one.value) viewedAndNext()
    else if (file) toggleViewed([file])
  },
})
useMain(scroller)
watch(shownFiles, () => onScroll())

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
        <UTooltip :text="t('pull.scope.previous')" :kbds="kbds('commits')">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-left-16"
            :aria-label="t('pull.scope.previous')"
            :disabled="commitSteps.previous === null"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="stepCommits(-1)"
          />
        </UTooltip>
        <UTooltip :text="t('pull.scope.next')" :kbds="kbds('commits', 1)">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-octicon-chevron-right-16"
            :aria-label="t('pull.scope.next')"
            :disabled="commitSteps.next === null"
            :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
            @click="stepCommits(1)"
          />
        </UTooltip>
      </div>
      <UFieldGroup size="sm" role="group" :aria-label="t('pull.fileMode')">
        <UButton
          v-bind="shown(!one)"
          size="sm"
          :aria-pressed="!one"
          :label="t('pull.modes.all')"
          @click="setFileMode('all')"
        />
        <UButton
          v-bind="shown(one)"
          size="sm"
          :aria-pressed="one"
          :label="t('pull.modes.one')"
          @click="setFileMode('one')"
        />
      </UFieldGroup>
      <UFieldGroup v-if="!phone" size="sm" role="group" :aria-label="t('pull.diffView')">
        <UButton
          v-bind="shown(settings.diffView === 'split')"
          size="sm"
          :aria-pressed="settings.diffView === 'split'"
          icon="i-octicon-columns-16"
          :aria-label="t('pull.views.split')"
          @click="settings.diffView = 'split'"
        />
        <UButton
          v-bind="shown(settings.diffView === 'unified')"
          size="sm"
          :aria-pressed="settings.diffView === 'unified'"
          icon="i-octicon-rows-16"
          :aria-label="t('pull.views.unified')"
          @click="settings.diffView = 'unified'"
        />
      </UFieldGroup>
      <UTooltip :text="t('pull.whitespaceHelp')">
        <UButton
          v-bind="shown(settings.ignoreSpace)"
          size="sm"
          :aria-pressed="settings.ignoreSpace"
          :label="t('pull.whitespace')"
          class="max-md:hidden"
          @click="settings.ignoreSpace = !settings.ignoreSpace"
        />
      </UTooltip>
      <span class="flex-1" />
      <UTooltip :text="t('keys.title')" :kbds="kbds('help')">
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
      :aria-label="t('pull.changesLabel')"
      @scroll.passive="onScroll"
    >
      <ScopeCard v-if="scope" />
      <SinceVisit v-else @first="firstNew" />
      <p v-if="!scope && filesCapped && pull" class="border-b border-default px-4 py-2 text-[12px] text-muted sm:px-6">
        {{ t('pull.capped', { n: formatNumber(pull.changedFiles) }) }}
      </p>
      <div v-if="filesState === 'failed'" class="px-6 py-16 text-center text-toned">{{ t('pull.changesFailed') }}</div>
      <div v-else-if="filesState === 'loading'" class="space-y-3 px-6 py-8" aria-busy="true">
        <USkeleton v-for="n in 4" :key="n" class="h-10" />
      </div>
      <p v-else-if="!shownFiles.length" class="px-6 py-16 text-center text-[13px] text-muted">
        {{ scope ? t('pull.scope.empty') : t('pull.end') }}
      </p>

      <template v-else-if="!one">
        <FileDiff v-for="file in mountedFiles" :key="diffKey(file.path)" :file="file" />
        <p v-if="mountedFiles.length === shownFiles.length" class="px-6 py-10 text-center text-[13px] text-muted">
          {{ filesCapped ? t('pull.cappedEnd') : t('pull.end') }}
        </p>
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
            :label="t('pull.viewedNext')"
            trailing-icon="i-octicon-arrow-right-16"
            :disabled="!canTick(current)"
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
