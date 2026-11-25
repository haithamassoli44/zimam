// The files tree: its folders, the filter that looks through it, and which folders are folded. A folder whose files
// are all viewed folds itself, and opens again once one isn't; a viewed folder opened by hand stays open. All of it
// outlasts the tree on screen, which the phone's sheet draws anew each time it opens. A pull request starts afresh.
import { computed, reactive, ref, watch } from 'vue'

import { refKey } from '@/lib/refs'
import { allViewed, shownFiles, type PullFile } from '@/stores/pull'
import { openPull } from '@/stores/view'

/** A folder: the folders and files right in it, and every file under it, however deep. */
export interface Folder {
  name: string
  path: string
  folders: Map<string, Folder>
  files: PullFile[]
  all: PullFile[]
}

/** The files as a tree, its folders and files in the order the files come. */
function treeOf(files: PullFile[]): Folder {
  const top: Folder = { name: '', path: '', folders: new Map(), files: [], all: [] }
  for (const file of files) {
    let folder = top
    for (const name of file.path.split('/').slice(0, -1)) {
      let next = folder.folders.get(name)
      if (!next) {
        const path = folder.path ? `${folder.path}/${name}` : name
        folder.folders.set(name, (next = { name, path, folders: new Map(), files: [], all: [] }))
      }
      next.all.push(file)
      folder = next
    }
    folder.files.push(file)
  }
  return top
}

function* foldersIn(folder: Folder): Generator<Folder> {
  for (const child of folder.folders.values()) {
    yield child
    yield* foldersIn(child)
  }
}

/** What the tree's filter looks for in the files' paths. */
export const filter = ref('')
const needle = computed(() => filter.value.trim().toLowerCase())

const whole = computed(() => treeOf(shownFiles.value))
/** The tree of the files shown, or of those the filter finds. */
export const tree = computed(() =>
  needle.value
    ? treeOf(shownFiles.value.filter((file) => file.path.toLowerCase().includes(needle.value)))
    : whole.value,
)

const viewedFolders = computed(() => {
  const viewed = [...foldersIn(whole.value)].filter((folder) => allViewed(folder.all))
  return new Set(viewed.map((folder) => folder.path))
})

const closed = reactive(new Set<string>())
// Of those, the folders that folded themselves.
const foldedViewed = reactive(new Set<string>())
const keptOpen = new Set<string>()
let wasViewed = new Set<string>()
watch(
  () => openPull.value && refKey(openPull.value),
  () => {
    filter.value = ''
    closed.clear()
    foldedViewed.clear()
    keptOpen.clear()
    wasViewed = new Set()
  },
)
watch(
  viewedFolders,
  (now) => {
    for (const path of now)
      if (!wasViewed.has(path) && !keptOpen.has(path) && !closed.has(path)) {
        closed.add(path)
        foldedViewed.add(path)
      }
    for (const path of wasViewed)
      if (!now.has(path) && foldedViewed.has(path)) {
        closed.delete(path)
        foldedViewed.delete(path)
      }
    wasViewed = now
  },
  { immediate: true },
)

/** Whether a folder is folded. While the filter looks for files, the folders that folded themselves show open. */
export const isFolded = (path: string) => closed.has(path) && !(needle.value && foldedViewed.has(path))

/** Folds a folder by hand, or opens it. */
export function toggleFold(path: string) {
  const wasFolded = isFolded(path)
  foldedViewed.delete(path)
  if (wasFolded) {
    closed.delete(path)
    if (viewedFolders.value.has(path)) keptOpen.add(path)
  } else {
    closed.add(path)
    keptOpen.delete(path)
  }
}
