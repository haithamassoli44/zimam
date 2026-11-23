import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'

import IssuePanel from '@/components/IssuePanel.vue'
import { i18n } from '@/locale'
import { closeIssue, showIssue } from '@/stores/view'

// jsdom has no media queries. The screen here is wide, so the issue opens beside the list.
const { opened } = vi.hoisted(() => {
  globalThis.matchMedia = () => ({ matches: true, addEventListener: () => {} }) as unknown as MediaQueryList
  return { opened: [] as (Element | null | undefined)[] }
})
// The issue's own code, which notes the opener it's given.
vi.mock('@/components/IssueView.vue', async () => {
  const vue = await import('vue')
  return {
    // It's loaded as a module: Vue takes the component from its default export.
    __esModule: true,
    default: vue.defineComponent({
      props: { issue: Object, opener: { type: Object, default: undefined }, docked: Boolean },
      setup(props) {
        opened.push(props.opener as Element | null | undefined)
        return () => vue.h('div')
      },
    }),
  }
})
// Nuxt UI's components need its Vite plugin, and nothing of theirs is looked at here.
const { nothing } = vi.hoisted(() => ({
  nothing: async () => {
    const vue = await import('vue')
    return { default: vue.defineComponent(() => () => null) }
  },
}))
vi.mock('@nuxt/ui/components/Slideover.vue', nothing)
vi.mock('@nuxt/ui/components/Button.vue', nothing)

let wrapper: VueWrapper | null = null
afterEach(() => {
  closeIssue()
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
})

it('notes what had the focus as the issue opened, though the issue comes later', async () => {
  const row = Object.assign(document.createElement('a'), { href: 'https://github.com/acme/web/issues/12' })
  const search = document.createElement('input')
  document.body.append(row, search)
  wrapper = mount(IssuePanel, { global: { plugins: [i18n] }, attachTo: document.body })
  row.focus()
  showIssue({ repo: 'acme/web', number: 12 })
  search.focus()
  await flushPromises()
  expect(opened).toEqual([row])
})
