import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import CheckRuns from '@/components/CheckRuns.vue'
import type { CheckRuns as Runs, RunState } from '@/lib/checks'
import { i18n } from '@/locale'
import type { Item } from '@/types'

vi.mock('@nuxt/ui/components/Icon.vue', () => ({ default: { render: () => null } }))
vi.mock('@nuxt/ui/components/Skeleton.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/CheckRow.vue', async () => {
  const vue = await import('vue')
  return {
    default: vue.defineComponent({
      props: { run: { type: Object, required: true } },
      setup: (props) => () =>
        vue.h('p', `${(props.run as { name: string }).name}: ${(props.run as { state: string }).state}`),
    }),
  }
})

// GitHub's answers about the checks, each held until a test lets it go.
const answers = vi.hoisted(
  () => [] as { item: { checks: string | null }; answer: (runs: unknown) => void; fail: () => void }[],
)
vi.mock('@/stores/data', () => ({
  checkRuns: (item: { checks: string | null }) =>
    new Promise((resolve, reject) =>
      answers.push({ item: { checks: item.checks }, answer: resolve, fail: () => reject(new Error('network')) }),
    ),
}))

const runs = (state: RunState): Runs => ({ total: 1, runs: [{ name: 'test', detail: null, state, url: null }] })

const pull = (checks: Item['checks'], updatedAt = '2026-11-25T10:00:00Z'): Item => ({
  id: 'P1',
  kind: 'pr',
  repoId: 'R1',
  number: 1,
  title: 'Add a thing',
  url: 'https://github.com/acme/web/pull/1',
  state: 'open',
  notPlanned: false,
  author: null,
  assignees: [],
  labels: [],
  comments: 0,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt,
  review: 'optional',
  checks,
  merge: 'clean',
  diff: { additions: 1, deletions: 0 },
})

describe('the checks popover', () => {
  it('reads the checks again when they change while it is open, keeping the last answer only', async () => {
    const popover = mount(CheckRuns, { props: { item: pull('pending') }, global: { plugins: [i18n] } })
    answers[0].answer(runs('pending'))
    await flushPromises()
    expect(popover.text()).toContain('test: pending')

    // A sync finds the checks failed, then GitHub answers about that too, before the read it started answers.
    await popover.setProps({ item: pull('failure') })
    await popover.setProps({ item: pull('success', '2026-11-25T10:05:00Z') })
    expect(answers.map((asked) => asked.item.checks)).toEqual(['pending', 'failure', 'success'])
    // Meanwhile it shows what it had.
    expect(popover.text()).toContain('test: pending')
    answers[2].answer(runs('success'))
    await flushPromises()
    answers[1].answer(runs('failure'))
    await flushPromises()
    expect(popover.text()).toContain('test: success')
    popover.unmount()
  })

  it("doesn't read them again for a change elsewhere, and keeps what it shows when a read fails", async () => {
    answers.length = 0
    const popover = mount(CheckRuns, { props: { item: pull('failure') }, global: { plugins: [i18n] } })
    answers[0].answer(runs('failure'))
    await flushPromises()
    // A sync makes the item anew for a change to its conflicts alone.
    await popover.setProps({ item: { ...pull('failure'), merge: 'conflicts' } })
    expect(answers).toHaveLength(1)
    // Its checks run again, and reading them fails.
    await popover.setProps({ item: pull('pending', '2026-11-25T10:09:00Z') })
    answers[1].fail()
    await flushPromises()
    expect(popover.text()).toContain('test: failure')
    expect(popover.text()).not.toContain("Couldn't")
    popover.unmount()
  })
})
