<script setup lang="ts">
// The changed files as a tree, with what's viewed, what's new since the last visit, and generated files left out. A
// folder is viewed when the files it lists are, and a tick on it ticks them. The tree follows the diff: the file being
// read stays in sight, or the folded folder it's in.
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { modified, roving, useKeys } from '@/components/keys'
import { still } from '@/components/motion'
import { FILE_LOOKS, tickLook } from '@/components/pull/looks'
import { activeFile, showFile } from '@/components/pull/navigation'
import { fileFilter } from '@/components/pull/parts'
import { filter, isFolded, toggleFold, tree, type Folder } from '@/components/pull/tree'
import { formatNumber, rtl } from '@/locale'
import {
  allViewed,
  canTick,
  freshFile,
  generatedFiles,
  showGenerated,
  textsDone,
  textsTotal,
  threadsByPath,
  toggleViewed,
  viewedState,
  type PullFile,
} from '@/stores/pull'

const { t } = useI18n()

/** A row: a folder or a file, with the files it stands for and whether they're all viewed, or some of them. */
type Row = { key: string; name: string; depth: number; files: PullFile[]; viewed: boolean; partly: boolean } & (
  | { kind: 'folder'; path: string }
  | { kind: 'file'; file: PullFile }
)

function marked(files: PullFile[]) {
  const viewed = allViewed(files)
  return { files, viewed, partly: !viewed && files.some((file) => viewedState(file) === 'viewed') }
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  function walk(folder: Folder, depth: number) {
    for (const child of folder.folders.values()) {
      // A folder holding one folder and nothing else shows as one row: `packages/nuxt/src`.
      let shown = child
      let name = child.name
      while (shown.files.length === 0 && shown.folders.size === 1) {
        shown = [...shown.folders.values()][0]
        name += `/${shown.name}`
      }
      out.push({ kind: 'folder', key: `d:${shown.path}`, name, path: shown.path, depth, ...marked(shown.all) })
      if (!isFolded(shown.path)) walk(shown, depth + 1)
    }
    for (const file of folder.files)
      out.push({
        kind: 'file',
        key: `f:${file.path}`,
        file,
        name: file.path.split('/').pop()!,
        depth,
        ...marked([file]),
      })
  }
  walk(tree.value, 0)
  return out
})

/** The row that stands for a file or a folder: its own, or the folded folder it's in. */
function standIn(path: string): string | null {
  let found: string | null = null
  for (const row of rows.value) {
    if ((row.kind === 'file' ? row.file.path : row.path) === path) return row.key
    if (row.kind === 'folder' && isFolded(row.path) && path.startsWith(`${row.path}/`)) found = row.key
  }
  return found
}
const holder = computed(() => activeFile.value && standIn(activeFile.value))

// Keeps the holder in sight with a row or two around it, gliding there when it's near and jumping when it's far.
const list = useTemplateRef<HTMLElement>('list')
const filterBox = useTemplateRef<{ inputRef: HTMLInputElement | null }>('filterBox')
watch(filterBox, (box) => (fileFilter.value = box?.inputRef ?? null), { immediate: true, flush: 'post' })
onBeforeUnmount(() => (fileFilter.value = null))
const ROOM = 2
function follow(glide: boolean) {
  const box = list.value
  const row = holder.value && box?.querySelector<HTMLElement>(`[data-key="${CSS.escape(holder.value)}"]`)
  if (!box || !row || !box.clientHeight) return
  const top = row.offsetTop
  const height = row.offsetHeight
  const room = Math.min(ROOM * height, box.clientHeight / 4)
  let to: number
  if (top < box.scrollTop + room) to = top - room
  else if (top + height > box.scrollTop + box.clientHeight - room) to = top + height + room - box.clientHeight
  else return
  const far = Math.abs(to - box.scrollTop) > box.clientHeight
  if (far) to = top - (box.clientHeight - height) / 2
  box.scrollTo({ top: to, behavior: glide && !far && !still() ? 'smooth' : 'instant' })
}
watch(holder, () => follow(true), { flush: 'post' })
// Shown again after another part, or the column unfolded: it finds the file at once.
let sizer: ResizeObserver | null = null
let shown = false
onMounted(() => {
  if (!list.value) return
  sizer = new ResizeObserver(() => {
    const now = !!list.value?.clientHeight
    if (now && !shown) follow(false)
    shown = now
  })
  sizer.observe(list.value)
})
onBeforeUnmount(() => sizer?.disconnect())

const tickable = (row: Row) => row.files.every(canTick)
// A tick that folds the focused row away, in a folder it fills, hands the focus to the folder's row.
async function tick(row: Row) {
  const focused = list.value?.contains(document.activeElement)
  const path = row.kind === 'file' ? row.file.path : row.path
  toggleViewed(row.files)
  await nextTick()
  const key = standIn(path)
  if (focused && key && !list.value?.contains(document.activeElement))
    list.value?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] [data-row]`)?.focus()
}

const rowOf = (element: Element | null) =>
  rows.value.find((row) => row.key === element?.closest<HTMLElement>('[data-key]')?.dataset.key)

useKeys(
  {
    viewed: () => {
      const row = rowOf(document.activeElement)
      if (row && tickable(row)) void tick(row)
    },
  },
  { level: 'focus', root: list },
)

// Arrows: ↓ and ↑ from row to row, and toward the reading end to open a folder, back to fold it.
const arrows = roving('[data-row]')
function onKey(event: KeyboardEvent) {
  const row = rowOf(event.target as Element)
  const open = event.key === (rtl.value ? 'ArrowLeft' : 'ArrowRight')
  const fold = event.key === (rtl.value ? 'ArrowRight' : 'ArrowLeft')
  if (row?.kind === 'folder' && (open || fold) && !modified(event)) {
    event.preventDefault()
    if (open === isFolded(row.path)) toggleFold(row.path)
  } else arrows(event)
}

const indent = (depth: number) => ({ paddingInlineStart: `${0.5 + depth * 0.875}rem` })
</script>

<template>
  <nav class="flex h-full min-h-0 flex-col" :aria-label="t('pull.files')">
    <div class="shrink-0 border-b border-default p-3">
      <UInput
        ref="filterBox"
        v-model="filter"
        size="sm"
        icon="i-octicon-filter-16"
        :placeholder="t('pull.filterFiles')"
        class="w-full"
      />
    </div>

    <ul ref="list" class="relative min-h-0 flex-1 overflow-y-auto py-1 text-[13px]" @keydown="onKey">
      <li
        v-for="row in rows"
        :key="row.key"
        :data-key="row.key"
        class="group relative flex h-7 items-center gap-1 pe-1 transition-colors hover:bg-elevated pointer-coarse:h-10"
        :class="[
          holder !== row.key
            ? row.viewed
              ? 'text-muted'
              : 'text-toned'
            : row.kind === 'file'
              ? 'picked text-highlighted'
              : 'picked-bar text-highlighted before:opacity-60',
        ]"
      >
        <button
          v-if="row.kind === 'folder'"
          type="button"
          data-row
          class="cover flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-start"
          :style="indent(row.depth)"
          :aria-expanded="!isFolded(row.path)"
          @click="toggleFold(row.path)"
        >
          <UIcon
            :name="isFolded(row.path) ? 'i-octicon-chevron-right-16' : 'i-octicon-chevron-down-16'"
            class="size-3.5 shrink-0 text-muted rtl:-scale-x-100"
          />
          <UIcon name="i-octicon-file-directory-fill-16" class="size-4 shrink-0 text-muted" />
          <span class="truncate font-mono text-[12px]" dir="ltr">{{ row.name }}</span>
          <span v-if="row.viewed" class="sr-only">{{ t('pull.viewed') }}</span>
        </button>
        <button
          v-else
          type="button"
          data-row
          class="cover flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-start"
          :style="indent(row.depth + 1)"
          :aria-current="holder === row.key || undefined"
          @click="showFile(row.file.path)"
        >
          <UIcon
            :name="FILE_LOOKS[row.file.status].icon"
            class="size-4 shrink-0"
            :class="FILE_LOOKS[row.file.status].color"
          />
          <span class="min-w-0 flex-1 truncate font-mono text-[12px] rtl:text-right" dir="ltr">{{ row.name }}</span>
          <span v-if="row.viewed" class="sr-only">{{ t('pull.viewed') }}</span>
          <span
            v-if="freshFile(row.file)"
            class="relative z-1 size-1.5 shrink-0 rounded-full bg-primary"
            :title="t('pull.changedSince')"
          />
          <span
            v-if="threadsByPath.get(row.file.path)?.length"
            class="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted"
          >
            <UIcon name="i-octicon-comment-16" class="size-3" />{{ threadsByPath.get(row.file.path)!.length }}
          </span>
        </button>
        <!-- Out of the Tab order, and the focus stays where it was: arrows go from row to row, and `v` ticks a row. -->
        <button
          type="button"
          tabindex="-1"
          class="relative z-1 grid size-6 shrink-0 place-items-center rounded-sm transition-opacity disabled:invisible pointer-coarse:size-10"
          :class="[tickLook(row.viewed).color, !row.viewed && 'reveal hover:text-highlighted']"
          :aria-label="t(row.kind === 'folder' ? 'pull.folderViewed' : 'pull.fileViewed', { name: row.name })"
          :aria-pressed="row.viewed || (row.partly && 'mixed')"
          :disabled="!tickable(row)"
          @mousedown.prevent
          @click="void tick(row)"
        >
          <UIcon :name="tickLook(row.viewed).icon" class="size-4" />
        </button>
      </li>
      <li v-if="textsTotal && textsDone < textsTotal" class="px-3 py-2 text-[12px] text-muted">
        {{ t('pull.reading', { n: formatNumber(textsDone), of: formatNumber(textsTotal) }) }}
      </li>
    </ul>

    <div v-if="generatedFiles.length" class="shrink-0 border-t border-default px-3 py-2 text-[12px] text-muted">
      <template v-if="!showGenerated">
        {{ t('pull.generatedHidden', { n: formatNumber(generatedFiles.length) }, generatedFiles.length) }} ·
        <button
          type="button"
          class="font-medium text-toned transition-colors hover:text-highlighted hover:underline"
          @click="showGenerated = true"
        >
          {{ t('issue.show') }}
        </button>
      </template>
      <button
        v-else
        type="button"
        class="font-medium text-toned transition-colors hover:text-highlighted hover:underline"
        @click="showGenerated = false"
      >
        {{ t('pull.hideGenerated', { n: formatNumber(generatedFiles.length) }, generatedFiles.length) }}
      </button>
    </div>
  </nav>
</template>
