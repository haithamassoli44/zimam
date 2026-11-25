import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { triggerRef } from 'vue'

import ItemList from '@/components/ItemList.vue'
import { i18n } from '@/locale'
import { items, loaded, repos } from '@/stores/data'
import type { Item, Repo } from '@/types'

// jsdom has no media queries.
vi.hoisted(() => {
  globalThis.matchMedia = () => ({ matches: true, addEventListener: () => {} }) as unknown as MediaQueryList
})

// jsdom lays nothing out, so the list's virtualizer draws every row, one under the other, by the keys it's given.
vi.mock('@tanstack/vue-virtual', async () => {
  const vue = await import('vue')
  return {
    useVirtualizer: (options: import('vue').Ref<{ count: number; getItemKey: (index: number) => string | number }>) =>
      vue.computed(() => {
        const { count, getItemKey } = options.value
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: getItemKey(index),
              start: index * 40,
              end: (index + 1) * 40,
              size: 40,
              lane: 0,
            })),
          getTotalSize: () => count * 40,
          scrollToIndex: () => {},
          measureElement: () => {},
          measure: () => {},
          takeSnapshot: () => [],
        }
      }),
  }
})

// A row that says when it's given the focus.
const focused = vi.hoisted(() => [] as string[])
vi.mock('@/components/ItemRow.vue', async () => {
  const vue = await import('vue')
  return {
    ROW_HEIGHT: { compact: 40, comfortable: 40 },
    default: vue.defineComponent({
      props: { item: { type: Object, required: true } },
      setup(props, { expose }) {
        expose({ focus: () => focused.push((props.item as Item).id) })
        return () => vue.h('div', (props.item as Item).title)
      },
    }),
  }
})
vi.mock('@nuxt/ui/components/Button.vue', () => ({ default: { render: () => null } }))
vi.mock('@nuxt/ui/components/Skeleton.vue', () => ({ default: { render: () => null } }))

const repo: Repo = {
  id: 'R1',
  owner: 'acme',
  ownerAvatar: '',
  name: 'web',
  fullName: 'acme/web',
  description: null,
  language: null,
  isPrivate: false,
  isArchived: false,
  pushedAt: null,
  openIssues: 2,
  openPrs: 0,
  issues: 2,
  prs: 0,
}

const issue = (id: string, updatedAt: string): Item => ({
  id,
  kind: 'issue',
  repoId: 'R1',
  number: Number(id.slice(1)),
  title: id,
  url: '',
  state: 'open',
  notPlanned: false,
  author: null,
  assignees: [],
  labels: [],
  comments: 0,
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt,
  review: null,
  checks: null,
  merge: null,
  diff: null,
})

let wrapper: VueWrapper | null = null
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  focused.length = 0
})

const press = (key: string) => dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))

describe('the focus in the list', () => {
  it('goes to the row that is left first when the first row goes', async () => {
    repos.value = new Map([['R1', repo]])
    // The latest changed first: A, then B.
    items.value = new Map([
      ['I1', issue('I1', '2026-11-25T10:00:00Z')],
      ['I2', issue('I2', '2026-11-24T10:00:00Z')],
    ])
    loaded.value = true
    wrapper = mount(ItemList, { global: { plugins: [i18n] }, attachTo: document.body })
    await flushPromises()
    press('j')
    expect(focused).toEqual(['I1'])

    // The first one is closed elsewhere, and leaves the list of open ones.
    items.value.delete('I1')
    triggerRef(items)
    await flushPromises()
    expect(wrapper.text()).not.toContain('I1')
    focused.length = 0
    press('j')
    expect(focused).toEqual(['I2'])
  })
})
