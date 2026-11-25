// The parts of a pull request beside its diff: each one's icon, and what the strip, the phone's bar and its heading say
// of it. And on a narrow screen, the sheet that takes the column's place, so anything on the page can show a part.
import { computed, ref, shallowRef } from 'vue'

import { CHECK_LOOKS } from '@/components/looks'
import { columnOpen } from '@/components/pull/column'
import { isPost } from '@/lib/pull'
import { PULL_PARTS, type PullPart } from '@/lib/refs'
import { freshCounts, pull, runs, shownEntries, shownFiles, viewed } from '@/stores/pull'
import { large } from '@/stores/ui'
import { pullPart } from '@/stores/view'

/** The sheet, on a narrow screen, where the column would be. */
export const sheetOpen = ref(false)
/** The files' filter, while the tree is on screen, for `/` to focus. */
export const fileFilter = shallowRef<HTMLInputElement | null>(null)

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

const ICONS: Record<PullPart, string> = {
  files: 'i-octicon-file-diff-16',
  conversation: 'i-octicon-comment-discussion-16',
  commits: 'i-octicon-git-commit-16',
  checks: 'i-octicon-checklist-16',
}

/**
 * The parts, in their order, with what's known of each. `count`: how many there are, or null while unknown. `fresh`:
 * how many are new since the last visit. `alert`: a look that asks for a look, as failing checks do. `viewed`: how
 * many files are viewed, where they take ticks.
 */
interface Facts {
  count: number | null
  fresh: number
  alert: { icon: string; color: string } | null
  viewed: { n: number; of: number } | null
}
export const parts = computed(() => {
  const current = pull.value
  const fresh = freshCounts.value
  const checks = current?.checks
  const none = { alert: null, viewed: null }
  const facts: Record<PullPart, Facts> = {
    files: { ...none, count: shownFiles.value.length || null, fresh: fresh?.files ?? 0, viewed: viewed.value },
    conversation: {
      ...none,
      count: current ? shownEntries.value.filter(isPost).length : null,
      fresh: fresh?.comments ?? 0,
    },
    commits: { ...none, count: current?.commitCount ?? null, fresh: fresh?.commits ?? 0 },
    checks: {
      ...none,
      count: runs.value?.total ?? null,
      fresh: 0,
      alert: checks && checks !== 'success' ? CHECK_LOOKS[checks] : null,
    },
  }
  return PULL_PARTS.map((part) => ({ part, icon: ICONS[part], ...facts[part] }))
})
export type Part = (typeof parts.value)[number]
