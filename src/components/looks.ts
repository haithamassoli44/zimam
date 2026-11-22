import type { RunState } from '@/lib/checks'

/** How a check state looks wherever it shows: a pull request's checks icon, and each check in its list. */
export const CHECK_LOOKS: Record<RunState, { icon: string; color: string }> = {
  failure: { icon: 'i-octicon-x-16', color: 'text-error' },
  pending: { icon: 'i-octicon-dot-fill-16', color: 'text-warning' },
  success: { icon: 'i-octicon-check-16', color: 'text-muted' },
  skipped: { icon: 'i-octicon-skip-16', color: 'text-muted' },
}
