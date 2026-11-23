import type { RunState } from '@/lib/checks'
import type { IssueState } from '@/types'

/** How a check state looks wherever it shows: a pull request's checks icon, and each check in its list. */
export const CHECK_LOOKS: Record<RunState, { icon: string; color: string }> = {
  failure: { icon: 'i-octicon-x-16', color: 'text-error' },
  pending: { icon: 'i-octicon-dot-fill-16', color: 'text-warning' },
  success: { icon: 'i-octicon-check-16', color: 'text-muted' },
  skipped: { icon: 'i-octicon-skip-16', color: 'text-muted' },
}

/** A dot of a label's or a language's color, with a hairline so a pale one shows on any surface. */
export const DOT = 'size-2 shrink-0 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15'

/** How an issue's state looks, in its row and in its panel. GitHub's glyphs already tell the state by shape. */
export const ISSUE_LOOKS: Record<IssueState, { icon: string; color: string }> = {
  open: { icon: 'i-octicon-issue-opened-16', color: 'text-toned' },
  completed: { icon: 'i-octicon-issue-closed-16', color: 'text-merged' },
  notPlanned: { icon: 'i-octicon-skip-16', color: 'text-muted' },
  duplicate: { icon: 'i-octicon-skip-16', color: 'text-muted' },
}
