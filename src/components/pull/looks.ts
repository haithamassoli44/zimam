// How the pull request page's own things look: its files and their ticks, its reviewers' verdicts, merging, and the
// timeline's events.
import { PULL_LOOKS, REVIEW_LOOKS } from '@/components/looks'
import type { FileStatus } from '@/lib/changes'
import type { Entry, MergeStanding, Verdict } from '@/lib/pull'

/** How a changed file's status looks, in the tree and over its diff. Only a whole file coming or going gets color. */
export const FILE_LOOKS: Record<FileStatus, { icon: string; color: string }> = {
  added: { icon: 'i-octicon-diff-added-16', color: 'text-success' },
  removed: { icon: 'i-octicon-diff-removed-16', color: 'text-error' },
  renamed: { icon: 'i-octicon-diff-renamed-16', color: 'text-muted' },
  copied: { icon: 'i-octicon-diff-renamed-16', color: 'text-muted' },
  modified: { icon: 'i-octicon-diff-modified-16', color: 'text-muted' },
  changed: { icon: 'i-octicon-diff-modified-16', color: 'text-muted' },
}

const TICKED = { icon: 'i-octicon-check-circle-fill-16', color: 'text-primary' }
const UNTICKED = { icon: 'i-octicon-circle-16', color: 'text-muted' }
/** How a viewed tick looks, on a file, a folder or a commit, or the tick still to tick. */
export const tickLook = (viewed: boolean) => (viewed ? TICKED : UNTICKED)

/** How one reviewer's last word looks, beside their name and in the conversation. */
export const VERDICT_LOOKS: Record<Verdict, { icon: string; color: string }> = {
  approved: REVIEW_LOOKS.approved,
  changes: REVIEW_LOOKS.changes,
  commented: { icon: 'i-octicon-comment-16', color: 'text-muted' },
  dismissed: { icon: 'i-octicon-x-circle-16', color: 'text-muted' },
  pending: { icon: 'i-octicon-dot-16', color: 'text-muted' },
}

/** How where a pull request stands on merging looks. */
export const MERGE_LOOKS: Record<MergeStanding, { icon: string; color: string }> = {
  merged: PULL_LOOKS.merged,
  closed: PULL_LOOKS.closed,
  conflicts: { icon: 'i-octicon-alert-16', color: 'text-error' },
  behind: { icon: 'i-octicon-arrow-down-16', color: 'text-warning' },
  clean: { icon: 'i-octicon-check-16', color: 'text-muted' },
  checking: { icon: 'i-octicon-dot-16', color: 'text-muted' },
}

/** The entries that are things that happened, not posts or pushes. */
export type Happening = Exclude<Entry, { kind: 'comment' | 'review' | 'commits' }>

/** How each thing that happened looks in the timeline. Only a merge gets color. */
export const EVENT_LOOKS: Record<Happening['kind'], { icon: string; color?: string }> = {
  forcePushed: { icon: 'i-octicon-repo-push-16' },
  ready: { icon: 'i-octicon-eye-16' },
  draft: { icon: PULL_LOOKS.draft.icon },
  closed: { icon: PULL_LOOKS.closed.icon },
  reopened: { icon: PULL_LOOKS.open.icon },
  autoMerge: { icon: 'i-octicon-git-merge-queue-16' },
  requested: { icon: 'i-octicon-person-add-16' },
  unrequested: { icon: 'i-octicon-person-16' },
  dismissed: { icon: 'i-octicon-x-circle-16' },
  renamed: { icon: 'i-octicon-pencil-16' },
  rebased: { icon: 'i-octicon-git-branch-16' },
  merged: PULL_LOOKS.merged,
}
