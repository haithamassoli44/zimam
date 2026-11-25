<script setup lang="ts">
// PROTOTYPE: the changed files: a toolbar, and every file in one scroll or one at a time.
import UButton from '@nuxt/ui/components/Button.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'
import UKbd from '@nuxt/ui/components/Kbd.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { pressed } from '@/components/pressed'
import FileDiff from '@/components/pull/FileDiff.vue'
import SinceVisit from '@/components/pull/SinceVisit.vue'
import { formatNumber } from '@/locale'
import {
  activeFile,
  changesProblem,
  currentFile,
  fileAsked,
  fileMode,
  files,
  freshFile,
  reveal,
  setFileMode,
  shownFiles,
  toggleViewed,
  viewedState,
} from '@/stores/pull'
import { settings } from '@/stores/settings'

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
  if (viewedState(file) !== 'viewed') toggleViewed(file)
  step(1)
}

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

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, [contenteditable]') || document.querySelector('[data-dismissable-layer]')) return
  if (event.key === 'j') changeStep(1)
  else if (event.key === 'k') changeStep(-1)
  else if (event.key === 'n') step(1)
  else if (event.key === 'p') step(-1)
  else if (event.key === 'v') {
    const file = shownFiles.value.find((each) => each.path === active.value)
    if (file && one.value) viewedAndNext()
    else if (file) toggleViewed(file)
  } else return
  event.preventDefault()
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
watch(shownFiles, () => onScroll())

const KEYS = [
  ['j', 'k', 'pull.keys.changes'],
  ['n', 'p', 'pull.keys.files'],
  ['v', '', 'pull.keys.viewed'],
] as const
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-default px-3 sm:px-4">
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
      <UPopover :content="{ align: 'end' }">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-octicon-command-palette-16"
          :aria-label="t('pull.keys.title')"
          class="max-sm:hidden"
        />
        <template #content>
          <div class="w-60 space-y-2 p-3 text-[13px]">
            <p class="font-medium text-highlighted">{{ t('pull.keys.title') }}</p>
            <p v-for="[a, b, label] in KEYS" :key="label" class="flex items-center gap-2 text-toned">
              <UKbd :value="a" /><UKbd v-if="b" :value="b" /><span>{{ t(label) }}</span>
            </p>
          </div>
        </template>
      </UPopover>
    </div>

    <div ref="scroller" class="relative min-h-0 flex-1 overflow-y-auto" @scroll.passive="onScroll">
      <SinceVisit @first="firstNew" />
      <div v-if="changesProblem" class="px-6 py-16 text-center text-toned">{{ t('pull.changesFailed') }}</div>
      <div v-else-if="!files.length" class="space-y-3 px-6 py-8" aria-busy="true">
        <USkeleton v-for="n in 4" :key="n" class="h-10" />
      </div>

      <template v-else-if="!one">
        <FileDiff v-for="file in shownFiles" :key="file.path" :file="file" />
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
            :label="t('pull.viewedNext')"
            trailing-icon="i-octicon-arrow-right-16"
            :ui="{ trailingIcon: 'rtl:-scale-x-100' }"
            @click="viewedAndNext"
          />
        </div>
        <FileDiff :key="current.path" :file="current" single />
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
