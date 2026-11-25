import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
// The sync's status, whose time of the last sync changes with each one.
const sync = vi.hoisted(() => ({ status: null as unknown as import('vue').ShallowRef<{ syncedAt: number | null }> }))
vi.mock('@/stores/data', async () => {
  const vue = await import('vue')
  sync.status = vue.shallowRef(vue.reactive({ syncedAt: null as number | null }))
  return {
    status: sync.status,
    checkRuns: (item: { checks: string | null }) =>
      new Promise((resolve, reject) =>
        answers.push({ item: { checks: item.checks }, answer: resolve, fail: () => reject(new Error('network')) }),
      ),
  }
})
// A sync a minute after the last.
let clock = Date.now()
const synced = () => {
  clock += 60_000
  sync.status.value.syncedAt = clock
}

const runs = (state: RunState, ...more: [string, RunState][]): Runs => ({
  total: 1 + more.length,
  runs: [['test', state] as [string, RunState], ...more].map(([name, each]) => ({
    name,
    detail: null,
    state: each,
    url: null,
  })),
})

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

beforeEach(() => {
  answers.length = 0
  sync.status.value.syncedAt = null
  clock = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
})
afterEach(() => vi.restoreAllMocks())
// A test that fails midway leaves no popover open to read in the next.
enableAutoUnmount(afterEach)

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

  it("doesn't read them again for a change elsewhere, and keeps what it shows when a read fails, saying so", async () => {
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
    expect(popover.text()).toContain("Couldn't load them again")
    expect(popover.text()).not.toContain("Couldn't load the checks")

    // The next sync brings the same item: it reads them again.
    synced()
    await flushPromises()
    expect(answers).toHaveLength(3)
    answers[2].answer(runs('pending'))
    await flushPromises()
    expect(popover.text()).toContain('test: pending')
    expect(popover.text()).not.toContain("Couldn't")
    popover.unmount()
  })

  it('reads them once for a sync that changes them, not again as it ends', async () => {
    answers.length = 0
    const popover = mount(CheckRuns, { props: { item: pull('pending') }, global: { plugins: [i18n] } })
    answers[0].answer(runs('pending'))
    await flushPromises()
    clock += 50_000
    // The sync finds the checks failed, then ends a few seconds later.
    await popover.setProps({ item: pull('failure') })
    clock += 5000
    sync.status.value.syncedAt = clock
    await flushPromises()
    expect(answers.map((asked) => asked.item.checks)).toEqual(['pending', 'failure'])
    popover.unmount()
  })

  it('reads them again as the sync ends when the read the sync started failed', async () => {
    const popover = mount(CheckRuns, { props: { item: pull('pending') }, global: { plugins: [i18n] } })
    answers[0].answer(runs('pending'))
    await flushPromises()
    clock += 50_000
    // The sync finds the checks failed; reading them then fails, and the sync ends a few seconds later.
    await popover.setProps({ item: pull('failure') })
    answers[1].fail()
    await flushPromises()
    expect(popover.text()).toContain("Couldn't load them again")
    clock += 5000
    sync.status.value.syncedAt = clock
    await flushPromises()
    expect(answers).toHaveLength(3)
  })

  it('reads them again after each sync while open, as a run can finish while the checks still run', async () => {
    answers.length = 0
    const popover = mount(CheckRuns, { props: { item: pull('pending') }, global: { plugins: [i18n] } })
    answers[0].answer(runs('pending', ['lint', 'pending']))
    await flushPromises()
    expect(popover.text()).toContain('lint: pending')
    synced()
    await flushPromises()
    answers[1].answer(runs('pending', ['lint', 'success']))
    await flushPromises()
    expect(popover.text()).toContain('lint: success')
    popover.unmount()
    // Closed, it reads nothing more.
    synced()
    await flushPromises()
    expect(answers).toHaveLength(2)
  })
})
