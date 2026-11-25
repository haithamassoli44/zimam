// Checks in a line: how many ended each way, the ones that need a look first.
import { groupRuns, type CheckRun } from '@/lib/checks'
import { formatList, formatNumber, i18n } from '@/locale'

export const runsSummary = (runs: CheckRun[]) =>
  formatList(
    groupRuns(runs).map(({ state, runs: those }) =>
      i18n.global.t(`checks.count.${state}`, { n: formatNumber(those.length) }, those.length),
    ),
  )
