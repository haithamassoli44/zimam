import type { FileStatus } from '@/lib/changes'
import type { RunState } from '@/lib/checks'
import type { MergeStanding, PullState, ReviewStanding, Verdict } from '@/lib/pull'
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

/** How a pull request's state looks, in its row and on its page, where it sits in a pill. */
export const PULL_LOOKS: Record<PullState, { icon: string; color: string; pill: string }> = {
  open: { icon: 'i-octicon-git-pull-request-16', color: 'text-toned', pill: 'bg-elevated text-highlighted' },
  draft: { icon: 'i-octicon-git-pull-request-draft-16', color: 'text-muted', pill: 'bg-elevated text-toned' },
  merged: { icon: 'i-octicon-git-merge-16', color: 'text-merged', pill: 'bg-merged/12 text-merged' },
  closed: { icon: 'i-octicon-git-pull-request-closed-16', color: 'text-error', pill: 'bg-error/10 text-error' },
}

/** How a changed file's status looks, in the tree and over its diff. Only a whole file coming or going gets color. */
export const FILE_LOOKS: Record<FileStatus, { icon: string; color: string }> = {
  added: { icon: 'i-octicon-diff-added-16', color: 'text-success' },
  removed: { icon: 'i-octicon-diff-removed-16', color: 'text-error' },
  renamed: { icon: 'i-octicon-diff-renamed-16', color: 'text-muted' },
  copied: { icon: 'i-octicon-diff-renamed-16', color: 'text-muted' },
  modified: { icon: 'i-octicon-diff-modified-16', color: 'text-muted' },
  changed: { icon: 'i-octicon-diff-modified-16', color: 'text-muted' },
}

/** How where a pull request stands on review looks. Only a verdict gets color; waiting on someone is neutral. */
export const REVIEW_LOOKS: Record<ReviewStanding, { icon: string; color: string }> = {
  approved: { icon: 'i-octicon-check-circle-16', color: 'text-success' },
  changes: { icon: 'i-octicon-file-diff-16', color: 'text-error' },
  awaiting: { icon: 'i-octicon-code-review-16', color: 'text-muted' },
  required: { icon: 'i-octicon-code-review-16', color: 'text-muted' },
  optional: { icon: 'i-octicon-code-review-16', color: 'text-muted' },
  draft: { icon: 'i-octicon-git-pull-request-draft-16', color: 'text-muted' },
}

/** How one reviewer's last word looks, beside their name and in the conversation. */
export const VERDICT_LOOKS: Record<Verdict, { icon: string; color: string }> = {
  approved: { icon: 'i-octicon-check-circle-16', color: 'text-success' },
  changes: { icon: 'i-octicon-file-diff-16', color: 'text-error' },
  commented: { icon: 'i-octicon-comment-16', color: 'text-muted' },
  dismissed: { icon: 'i-octicon-x-circle-16', color: 'text-muted' },
  pending: { icon: 'i-octicon-dot-16', color: 'text-muted' },
}

/** How where a pull request stands on merging looks. */
export const MERGE_LOOKS: Record<MergeStanding, { icon: string; color: string }> = {
  merged: { icon: 'i-octicon-git-merge-16', color: 'text-merged' },
  closed: { icon: 'i-octicon-git-pull-request-closed-16', color: 'text-error' },
  conflicts: { icon: 'i-octicon-alert-16', color: 'text-error' },
  behind: { icon: 'i-octicon-arrow-down-16', color: 'text-warning' },
  clean: { icon: 'i-octicon-check-16', color: 'text-muted' },
  checking: { icon: 'i-octicon-dot-16', color: 'text-muted' },
}
