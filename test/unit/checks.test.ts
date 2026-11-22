import { describe, expect, it, vi } from 'vitest'

import { readCheckRuns } from '@/lib/checks'
import type { GitHub, QueryError } from '@/lib/github'
import type { Item } from '@/types'

type Context = Record<string, unknown> | null

const run = (overrides: Record<string, unknown>) => ({
  kind: 'CheckRun',
  name: 'test',
  status: 'COMPLETED',
  conclusion: 'SUCCESS',
  detailsUrl: 'https://github.com/acme/web/actions/runs/1',
  checkSuite: { workflowRun: { workflow: { name: 'CI' } } },
  ...overrides,
})

const status = (state: string) => ({
  kind: 'StatusContext',
  context: 'ci/circleci',
  state,
  targetUrl: '',
  description: 'Your tests passed',
})

const answer = (nodes: Context[], errors: QueryError[] = []) => ({
  data: {
    node: {
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: nodes.length, nodes } } } }] },
    },
  },
  errors,
})

// A GitHub that gives these answers in turn.
const github = (...answers: ReturnType<typeof answer>[]) => {
  const request = vi.fn()
  for (const each of answers) request.mockResolvedValueOnce(each)
  return { gh: { request } as unknown as GitHub, request }
}

const pr = { id: 'P1', updatedAt: '2026-11-22T00:00:00Z', checks: 'failure' } as Item

const read = async (...nodes: Context[]) => (await readCheckRuns(github(answer(nodes)).gh, pr)).runs

describe('readCheckRuns', () => {
  it('reads how a GitHub Actions job ended, with its workflow and log', async () => {
    expect(await read(run({}))).toEqual([
      { name: 'test', detail: 'CI', state: 'success', url: 'https://github.com/acme/web/actions/runs/1' },
    ])
    const states = await read(
      run({ name: 'a', conclusion: 'TIMED_OUT' }),
      run({ name: 'b', conclusion: 'CANCELLED' }),
      run({ name: 'c', conclusion: 'SKIPPED' }),
      run({ name: 'd', conclusion: 'NEUTRAL' }),
      run({ name: 'e', status: 'IN_PROGRESS', conclusion: null }),
      run({ name: 'f', status: 'QUEUED', conclusion: null }),
    )
    expect(Object.fromEntries(states.map((each) => [each.name, each.state]))).toEqual({
      a: 'failure',
      b: 'failure',
      c: 'skipped',
      d: 'skipped',
      e: 'pending',
      f: 'pending',
    })
  })

  it('reads a commit status from an older service', async () => {
    expect(await read(status('SUCCESS'))).toEqual([
      { name: 'ci/circleci', detail: 'Your tests passed', state: 'success', url: null },
    ])
    expect((await read(status('ERROR')))[0].state).toBe('failure')
    expect((await read(status('EXPECTED')))[0].state).toBe('pending')
  })

  it('lists failing checks first, then running, passing and skipped ones', async () => {
    const runs = await read(
      run({ name: 'b', conclusion: 'SKIPPED' }),
      run({ name: 'a' }),
      run({ name: 'c', status: 'IN_PROGRESS' }),
      run({ name: 'z', conclusion: 'FAILURE' }),
    )
    expect(runs.map((each) => each.name)).toEqual(['z', 'c', 'a', 'b'])
  })

  it('asks once for the same checks within a minute, and again once they change', async () => {
    const { gh, request } = github(answer([run({ conclusion: 'FAILURE' })]), answer([run({})]))
    expect((await readCheckRuns(gh, pr)).runs[0].state).toBe('failure')
    await readCheckRuns(gh, pr)
    expect(request).toHaveBeenCalledTimes(1)
    expect((await readCheckRuns(gh, { ...pr, checks: 'success' })).runs[0].state).toBe('success')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('fails rather than say there are none when GitHub leaves them all out', async () => {
    const { gh } = github(answer([null], [{ type: 'FORBIDDEN', message: 'Resource not accessible' }]))
    await expect(readCheckRuns(gh, pr)).rejects.toThrow('Resource not accessible')
  })

  it('counts the ones GitHub left out as more on GitHub', async () => {
    const { gh } = github(answer([run({}), null], [{ type: 'FORBIDDEN', message: 'One hidden' }]))
    expect(await readCheckRuns(gh, pr)).toMatchObject({ total: 2, runs: [{ name: 'test' }] })
  })
})
