// Where the open pull request stands on review, on its checks and on merging, in words and looks. The
// header's pills, the side bar and the conversation say it the same way.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS, REVIEW_LOOKS } from '@/components/looks'
import { MERGE_LOOKS } from '@/components/pull/looks'
import { mergeStanding, reviewStanding } from '@/lib/pull'
import { formatNumber, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { pull } from '@/stores/pull'

export function useStanding() {
  const { t } = useI18n()

  const review = computed(() => {
    const current = pull.value
    if (!current) return null
    const standing = reviewStanding(current)
    const waiting = current.requested.length
    return {
      ...REVIEW_LOOKS[standing],
      text:
        standing === 'awaiting'
          ? t('pull.awaitingCount', { n: formatNumber(waiting) }, waiting)
          : t(`filters.review.${standing}`),
    }
  })

  const checks = computed(() => {
    const state = pull.value?.checks
    return state ? { ...CHECK_LOOKS[state], text: t(`filters.checks.${state}`) } : null
  })

  /** `short`: the few words a pill has room for, only when the merge is held up. */
  const merge = computed(() => {
    const current = pull.value
    if (!current) return null
    const standing = mergeStanding(current)
    const base = current.base
    const text = {
      merged: () =>
        t('pull.mergedBy', {
          who: current.mergedBy?.login ?? t('issue.ghost'),
          into: base,
          when: relativeTime(Date.parse(current.mergedAt!), now.value),
        }),
      closed: () => t('pull.closedUnmerged'),
      conflicts: () => t('pull.conflicts', { base }),
      behind: () => t('pull.behind', { base }),
      clean: () => t('pull.noConflicts', { base }),
      checking: () => t('pull.checkingConflicts'),
    }[standing]()
    const short = standing === 'conflicts' ? text : standing === 'behind' ? t('pull.behindShort', { base }) : null
    return { ...MERGE_LOOKS[standing], text, short }
  })

  return { review, checks, merge }
}
