// Moving about the diff: the file it's on, and showing a file or a thread's line when the tree, the conversation or the
// keys ask. The files view lends its scroller and brings files into view; each file on screen opens its threads.
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import { sheetOpen } from '@/components/pull/parts'
import type { ReviewThread } from '@/lib/pull'
import { fileMode, shownFiles, showThreadsFile } from '@/stores/pull'
import { openPull } from '@/stores/view'

/** The diff's scroller, while the files view is on screen. */
export const scroller = shallowRef<HTMLElement | null>(null)

/** The file one at a time shows. */
export const currentFile = ref<string | null>(null)
watch(shownFiles, (list) => {
  if (!list.some((file) => file.path === currentFile.value)) currentFile.value = list[0]?.path ?? null
})
/** In one scroll, the file at the top of the diff. */
export const inView = ref<string | null>(null)
/** The file the diff is on, for the tree and the keys. */
export const activeFile = computed(() => (fileMode.value === 'one' ? currentFile.value : inView.value))

let bring: ((path: string) => void) | null = null
/** How the files view brings a file into view, while it's on screen. */
export function onBring(handler: typeof bring) {
  bring = handler
}

/** Gives the screen to the diff, after something in it was picked: a sheet over it closes. */
export function toDiff() {
  sheetOpen.value = false
}

/** Shows a file in the diff. */
export async function showFile(path: string) {
  toDiff()
  asked.value = null
  currentFile.value = path
  await nextTick()
  bring?.(path)
}

/** A thread asked for, until the file it's on, once on screen, shows its line. */
export const asked = shallowRef<ReviewThread | null>(null)
watch(openPull, () => (asked.value = null))

/** Shows a thread's line in the diff. */
export function showThread(thread: ReviewThread) {
  toDiff()
  showThreadsFile(thread)
  currentFile.value = thread.path
  asked.value = thread
}

// The header folds as the reader scrolls the diff, but not when the diff moves on its own: that leaves it where
// reveal() put it, until the reader moves it.
let revealedAt: number | null = null
/** Brings part of the diff into view on the diff's own account: a file, a change, or a thread's line. */
export function reveal(element: Element, block: ScrollLogicalPosition) {
  element.scrollIntoView({ block })
  revealedAt = scroller.value?.scrollTop ?? null
}
/** Whether the diff is still where reveal() last put it, and the reader hasn't scrolled it since. */
export function scrolledBySelf() {
  const self = revealedAt !== null && scroller.value?.scrollTop === revealedAt
  if (!self) revealedAt = null
  return self
}
