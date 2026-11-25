import type { Item } from '@/types'

import type { GitHub } from './github'
import { toChecks } from './queries'

/** The checks of a pull request's last commit, with links to their logs. */
const CHECK_RUNS = `
  query($id: ID!) {
    node(id: $id) {
      ... on PullRequest {
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  totalCount
                  nodes {
                    kind: __typename
                    ... on CheckRun {
                      name status conclusion detailsUrl
                      checkSuite { workflowRun { workflow { name } } }
                    }
                    ... on StatusContext { context state targetUrl description }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`

/** How a check ended, or that it hasn't. In this order, the ones that need a look first. */
const RUN_STATES = ['failure', 'pending', 'success', 'skipped'] as const

export type RunState = (typeof RUN_STATES)[number]

export interface CheckRun {
  name: string
  /** The workflow a GitHub Actions job belongs to, or a status's description. */
  detail: string | null
  state: RunState
  /** Its log or page, where GitHub has one. */
  url: string | null
}

/** What a pull request's checks are read for: which it is, and what says they may have changed. */
export type CheckSubject = Pick<Item, 'id' | 'updatedAt' | 'checks'>

export interface CheckRuns {
  runs: CheckRun[]
  /** How many there are, which can be more than GitHub lists at once. */
  total: number
}

/** A check from GitHub: an app's check run, such as a GitHub Actions job, or a commit status from an older service. */
interface RawContext {
  kind: 'CheckRun' | 'StatusContext'
  name?: string
  status?: string
  conclusion?: string | null
  detailsUrl?: string | null
  checkSuite?: { workflowRun: { workflow: { name: string } } | null } | null
  context?: string
  state?: string
  targetUrl?: string | null
  description?: string | null
}

const FAILED = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])

function toRun(raw: RawContext): CheckRun {
  if (raw.kind === 'StatusContext') {
    return {
      name: raw.context ?? '',
      detail: raw.description || null,
      state: toChecks(raw.state) ?? 'pending',
      url: raw.targetUrl || null,
    }
  }
  const conclusion = raw.conclusion ?? ''
  return {
    name: raw.name ?? '',
    detail: raw.checkSuite?.workflowRun?.workflow.name ?? null,
    state:
      raw.status !== 'COMPLETED'
        ? 'pending'
        : FAILED.has(conclusion)
          ? 'failure'
          : conclusion === 'SUCCESS'
            ? 'success'
            : 'skipped',
    url: raw.detailsUrl || null,
  }
}

function sortRuns(runs: CheckRun[]): CheckRun[] {
  return runs.toSorted(
    (a, b) =>
      RUN_STATES.indexOf(a.state) - RUN_STATES.indexOf(b.state) ||
      (a.detail ?? '').localeCompare(b.detail ?? '') ||
      a.name.localeCompare(b.name),
  )
}

interface Answer {
  node: {
    commits?: {
      nodes: {
        commit: { statusCheckRollup: { contexts: { totalCount: number; nodes: (RawContext | null)[] } } | null }
      }[]
    }
  } | null
}

// Opening the same checks again soon after costs nothing, unless the pull request or its checks changed since. What
// one token read stays with it.
const FRESH = 60_000
const recentFor = new WeakMap<GitHub, Map<string, { key: string; at: number; answer: Promise<CheckRuns> }>>()

/** Reads the checks on a pull request's last commit. Each read costs a point. */
export function readCheckRuns(gh: GitHub, item: CheckSubject): Promise<CheckRuns> {
  const recent = recentFor.get(gh) ?? new Map()
  recentFor.set(gh, recent)
  const key = `${item.updatedAt} ${item.checks}`
  const last = recent.get(item.id)
  if (last && last.key === key && Date.now() - last.at < FRESH) return last.answer
  const answer = gh.request<Answer>(CHECK_RUNS, { id: item.id }).then(({ data, errors }) => {
    const contexts = data.node?.commits?.nodes[0]?.commit.statusCheckRollup?.contexts
    const runs = (contexts?.nodes ?? []).filter((node): node is RawContext => node !== null).map(toRun)
    // GitHub can leave out checks the token may not read. With none left, saying there are none would be wrong.
    if (errors.length && !runs.length) throw new Error(errors[0].message)
    return { runs: sortRuns(runs), total: contexts?.totalCount ?? runs.length }
  })
  recent.set(item.id, { key, at: Date.now(), answer })
  answer.catch(() => recent.get(item.id)?.answer === answer && recent.delete(item.id))
  return answer
}

/** The runs grouped by how they ended, the ones that need a look first. */
export const groupRuns = (runs: CheckRun[]) =>
  RUN_STATES.map((state) => ({ state, runs: runs.filter((run) => run.state === state) })).filter(
    (group) => group.runs.length,
  )
