// PROTOTYPE: the parts of a pull request the side column shows: each one's icon, its count, and what's new in it since
// the last visit. And whether the column is open, or on a narrow screen the sheet that takes its place, so anything on
// the page can show a part.
import { computed, ref } from 'vue'

import { isPost, type ReviewThread } from '@/lib/pull'
import { fileAsked, freshCounts, jump, pull, runs, shownEntries, shownFiles } from '@/stores/pull'
import { large } from '@/stores/ui'
import { pullPart, type PullPart } from '@/stores/view'

/** The column, on a wide screen. */
export const columnOpen = ref(true)
/** The sheet, on a narrow one. */
export const sheetOpen = ref(false)

/** Shows a part: in the column, or in the sheet. */
export function showPart(part: PullPart) {
  pullPart.value = part
  if (large.value) columnOpen.value = true
  else sheetOpen.value = true
}

/** Picks a part from the strip or the bar. On a wide screen, picking the open one again folds the column. */
export function pickPart(part: PullPart) {
  if (large.value && columnOpen.value && pullPart.value === part) columnOpen.value = false
  else showPart(part)
}

/** A file from the tree, shown in the diff: a sheet over it closes. */
export function showFile(path: string) {
  sheetOpen.value = false
  fileAsked.value = path
}

/** A thread from the conversation, shown in the diff: a sheet over it closes. */
export function showThread(thread: ReviewThread) {
  sheetOpen.value = false
  jump(thread)
}

export const PART_ICONS: Record<PullPart, string> = {
  files: 'i-octicon-file-diff-16',
  conversation: 'i-octicon-comment-discussion-16',
  commits: 'i-octicon-git-commit-16',
  checks: 'i-octicon-checklist-16',
}

/** `count`: how many there are, or null while unknown. `fresh`: how many are new since the last visit. */
export const partFacts = computed<Record<PullPart, { count: number | null; fresh: number }>>(() => {
  const current = pull.value
  const fresh = freshCounts.value
  return {
    files: { count: shownFiles.value.length || null, fresh: fresh?.files ?? 0 },
    conversation: { count: current ? shownEntries.value.filter(isPost).length : null, fresh: fresh?.comments ?? 0 },
    commits: { count: current?.commitCount ?? null, fresh: fresh?.commits ?? 0 },
    checks: { count: runs.value?.runs.length ?? null, fresh: 0 },
  }
})
