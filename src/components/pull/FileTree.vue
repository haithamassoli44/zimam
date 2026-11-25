<script setup lang="ts">
// PROTOTYPE: the changed files as a tree, with what's viewed, what's new since the last visit, and generated files left out.
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { FILE_LOOKS } from '@/components/looks'
import { formatNumber } from '@/locale'
import {
  freshFile,
  generatedFiles,
  showGenerated,
  shownFiles,
  textsDone,
  textsTotal,
  threadsByPath,
  viewedState,
  type PullFile,
} from '@/stores/pull'

defineProps<{ active?: string | null }>()
const emit = defineEmits<{ pick: [path: string] }>()
const { t } = useI18n()

const filter = ref('')
const closed = reactive(new Set<string>())

interface Folder {
  name: string
  path: string
  folders: Map<string, Folder>
  files: PullFile[]
}

type Row =
  | { kind: 'folder'; key: string; name: string; path: string; depth: number }
  | { kind: 'file'; key: string; file: PullFile; name: string; depth: number }

const rows = computed<Row[]>(() => {
  const needle = filter.value.trim().toLowerCase()
  const top: Folder = { name: '', path: '', folders: new Map(), files: [] }
  for (const file of shownFiles.value) {
    if (needle && !file.path.toLowerCase().includes(needle)) continue
    const parts = file.path.split('/')
    let folder = top
    for (const part of parts.slice(0, -1)) {
      const path = folder.path ? `${folder.path}/${part}` : part
      let next = folder.folders.get(part)
      if (!next) folder.folders.set(part, (next = { name: part, path, folders: new Map(), files: [] }))
      folder = next
    }
    folder.files.push(file)
  }
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
      out.push({ kind: 'folder', key: `d:${shown.path}`, name, path: shown.path, depth })
      if (!closed.has(shown.path)) walk(shown, depth + 1)
    }
    for (const file of folder.files)
      out.push({ kind: 'file', key: `f:${file.path}`, file, name: file.path.split('/').pop()!, depth })
  }
  walk(top, 0)
  return out
})

function toggle(path: string) {
  if (closed.has(path)) closed.delete(path)
  else closed.add(path)
}
const indent = (depth: number) => ({ paddingInlineStart: `${0.5 + depth * 0.875}rem` })
</script>

<template>
  <nav class="flex h-full min-h-0 flex-col" :aria-label="t('pull.files')">
    <div class="shrink-0 border-b border-default p-3">
      <UInput
        v-model="filter"
        size="sm"
        icon="i-octicon-filter-16"
        :placeholder="t('pull.filterFiles')"
        class="w-full"
      />
    </div>

    <ul class="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
      <li v-for="row in rows" :key="row.key">
        <button
          v-if="row.kind === 'folder'"
          type="button"
          class="flex h-7 w-full items-center gap-1.5 pe-2 text-start text-toned transition-colors hover:bg-elevated pointer-coarse:h-10"
          :style="indent(row.depth)"
          @click="toggle(row.path)"
        >
          <UIcon
            :name="closed.has(row.path) ? 'i-octicon-chevron-right-16' : 'i-octicon-chevron-down-16'"
            class="size-3.5 shrink-0 text-muted rtl:-scale-x-100"
          />
          <UIcon name="i-octicon-file-directory-fill-16" class="size-4 shrink-0 text-muted" />
          <span class="truncate font-mono text-[12px]" dir="ltr">{{ row.name }}</span>
        </button>
        <button
          v-else
          type="button"
          class="relative flex h-7 w-full items-center gap-1.5 pe-2 text-start transition-colors hover:bg-elevated pointer-coarse:h-10"
          :class="[
            active === row.file.path
              ? 'bg-elevated text-highlighted before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-primary'
              : 'text-toned',
            viewedState(row.file) === 'viewed' && 'opacity-60',
          ]"
          :style="indent(row.depth + 1)"
          @click="emit('pick', row.file.path)"
        >
          <UIcon
            :name="FILE_LOOKS[row.file.status].icon"
            class="size-4 shrink-0"
            :class="FILE_LOOKS[row.file.status].color"
          />
          <span class="min-w-0 flex-1 truncate font-mono text-[12px] rtl:text-right" dir="ltr">{{ row.name }}</span>
          <span
            v-if="freshFile(row.file)"
            class="size-1.5 shrink-0 rounded-full bg-primary"
            :title="t('pull.changedSince')"
          />
          <span
            v-if="threadsByPath.get(row.file.path)?.length"
            class="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted"
          >
            <UIcon name="i-octicon-comment-16" class="size-3" />{{ threadsByPath.get(row.file.path)!.length }}
          </span>
          <UIcon
            v-if="viewedState(row.file) === 'viewed'"
            name="i-octicon-check-16"
            class="size-4 shrink-0 text-primary"
          />
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
