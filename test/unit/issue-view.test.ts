import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineAsyncComponent, defineComponent, h, type Component } from 'vue'

import IssueView from '@/components/IssueView.vue'
import type { Post, Thread } from '@/lib/issue'
import { i18n } from '@/locale'
import { issueThread, items, loaded, moreComments, repos } from '@/stores/data'
import { openIssue, showIssue } from '@/stores/view'
import type { Item, Repo } from '@/types'

// Nuxt UI's components need its Vite plugin. Plain stand-ins do here: a button is a button with its label.
const { stand } = vi.hoisted(() => ({
  stand: (tag: string) => async () => {
    const vue = await import('vue')
    return {
      default: vue.defineComponent({
        props: { label: { type: String, default: undefined } },
        setup:
          (props, { slots }) =>
          () =>
            vue.h(tag, props.label ?? slots.default?.()),
      }),
    }
  },
}))
vi.mock('@nuxt/ui/components/Avatar.vue', stand('span'))
vi.mock('@nuxt/ui/components/Button.vue', stand('button'))
vi.mock('@nuxt/ui/components/Icon.vue', stand('span'))
vi.mock('@nuxt/ui/components/Skeleton.vue', stand('div'))
vi.mock('@nuxt/ui/components/Tooltip.vue', stand('span'))

// GitHub, answering when a test says so.
vi.mock('@/stores/data', async (original) => ({
  ...(await original<typeof import('@/stores/data')>()),
  issueThread: vi.fn(),
  moreComments: vi.fn(),
}))

const WEB = { repo: 'acme/web', number: 12 }
const LINK = 'https://github.com/acme/web/issues/12'
// GitHub gives 100 comments a page. Fewer do here, to keep the test quick.
const PAGE = 10
const TOTAL = 30

const post = (id: string, text: string): Post => ({
  id,
  url: `${LINK}#${id}`,
  author: null,
  role: null,
  createdAt: '2026-11-20T10:00:00Z',
  edited: false,
  html: `<p>${text}</p>`,
  hidden: null,
})

// The issue as one answer has it: `edition` tells answers apart, `shown` is how many comments it holds.
const thread = (edition: string, shown: number): Thread => ({
  id: 'I_12',
  ref: WEB,
  title: `The issue, ${edition}`,
  url: LINK,
  state: 'open',
  closedAs: null,
  labels: [],
  assignees: [],
  post: post('body', `${edition} description`),
  comments: Array.from({ length: shown }, (_, index) => post(`c${index}`, `${edition} comment ${index}`)),
  total: TOTAL,
  after: shown < TOTAL ? `after ${shown}` : null,
})
const edition = (answer: Thread) => answer.title.replace('The issue, ', '')
const nextPage = (answer: Thread) => thread(edition(answer), Math.min(TOTAL, answer.comments.length + PAGE))

interface Pending<T> {
  of: T
  answer: (value?: Thread) => void
  fail: () => void
}
let reads: Pending<string>[] = []
let pages: Pending<Thread>[] = []
const pending = <T>(of: T, list: Pending<T>[], make: () => Thread) =>
  new Promise<Thread>((resolve, reject) => {
    list.push({ of, answer: (value) => resolve(value ?? make()), fail: () => reject(new Error('offline')) })
  })

const item = (updatedAt: string, number = 12): Item => ({
  id: `issue-${number}`,
  kind: 'issue',
  repoId: 'repo-web',
  number,
  title: 'The issue',
  url: LINK,
  state: 'open',
  notPlanned: false,
  author: null,
  assignees: [],
  labels: [],
  comments: TOTAL,
  createdAt: '2026-11-20T10:00:00Z',
  updatedAt,
  review: null,
  checks: null,
  merge: null,
  diff: null,
})
// The list sees the issue change, and the panel reads it again.
const changeOnGitHub = (updatedAt: string, other = 'first') =>
  (items.value = new Map([
    ['issue-12', item(updatedAt)],
    ['issue-13', item(other, 13)],
  ]))

let wrapper: VueWrapper | null = null
function open() {
  wrapper = mount(IssueView, {
    props: { issue: WEB, docked: true },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return wrapper
}

const comments = () => (wrapper?.findAll('article').length ?? 1) - 1
const title = () => wrapper?.find('h2').text()
const showMore = () => wrapper?.findAll('button').find((button) => button.text().startsWith('Show'))

beforeEach(() => {
  reads = []
  pages = []
  vi.mocked(issueThread).mockImplementation(() => pending(`read ${reads.length}`, reads, () => thread('?', 0)))
  vi.mocked(moreComments).mockImplementation((answer) => pending(answer, pages, () => nextPage(answer)))
  repos.value = new Map([['repo-web', { id: 'repo-web', owner: 'acme', name: 'web', fullName: 'acme/web' } as Repo]])
  changeOnGitHub('first')
  loaded.value = true
  // jsdom lays nothing out, so it scrolls nothing either.
  Element.prototype.scrollTo = () => {}
})
afterEach(() => {
  openIssue.value = null
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
})

// The first answer, with the first page of comments.
async function openRead() {
  open()
  await flushPromises()
  reads[0]?.answer(thread('first', PAGE))
  await flushPromises()
  expect(comments()).toBe(PAGE)
}

describe('Show more while the issue is read again', () => {
  it('keeps the comments it brought when it finishes first', async () => {
    await openRead()
    changeOnGitHub('second')
    await flushPromises()
    expect(reads).toHaveLength(2)
    await showMore()?.trigger('click')
    pages[0]?.answer()
    await flushPromises()
    expect(comments()).toBe(2 * PAGE)

    reads[1]?.answer(thread('second', PAGE))
    await flushPromises()
    // The new version is read as far as the reader got.
    expect(pages).toHaveLength(2)
    expect(edition(pages[1]?.of)).toBe('second')
    pages[1]?.answer()
    await flushPromises()
    expect(comments()).toBe(2 * PAGE)
    expect(title()).toBe('The issue, second')
  })

  it('keeps the comments it brings when the new version arrives first', async () => {
    await openRead()
    changeOnGitHub('second')
    await flushPromises()
    await showMore()?.trigger('click')
    reads[1]?.answer(thread('second', PAGE))
    await flushPromises()
    // The new version waits for Show more.
    expect(title()).toBe('The issue, first')
    expect(pages).toHaveLength(1)

    pages[0]?.answer()
    await flushPromises()
    expect(comments()).toBe(2 * PAGE)
    pages[1]?.answer()
    await flushPromises()
    expect(comments()).toBe(2 * PAGE)
    expect(title()).toBe('The issue, second')
    expect(showMore()?.text()).toBe('Show 10 more comments')
  })

  it("doesn't hold the new version back when Show more fails", async () => {
    await openRead()
    changeOnGitHub('second')
    await flushPromises()
    await showMore()?.trigger('click')
    reads[1]?.answer(thread('second', PAGE))
    pages[0]?.fail()
    await flushPromises()
    expect(pages).toHaveLength(1)
    expect(comments()).toBe(PAGE)
    expect(title()).toBe('The issue, second')
  })

  it("doesn't keep the next issue waiting for it", async () => {
    await openRead()
    await showMore()?.trigger('click')
    await wrapper?.setProps({ issue: { repo: 'acme/web', number: 13 } })
    // ↑ and ↓ wait a moment before reading.
    await new Promise((resolve) => setTimeout(resolve, 200))
    reads[1]?.answer(thread('next', PAGE))
    await flushPromises()
    expect(title()).toBe('The issue, next')

    changeOnGitHub('first', 'second')
    await flushPromises()
    reads[2]?.answer(thread('next, changed', PAGE))
    await flushPromises()
    expect(title()).toBe('The issue, next, changed')
  })

  it('drops what it brings once another issue is open', async () => {
    await openRead()
    await showMore()?.trigger('click')
    await wrapper?.setProps({ issue: { repo: 'acme/web', number: 13 } })
    pages[0]?.answer()
    await flushPromises()
    expect(wrapper?.find('h2').exists()).toBe(false)
  })
})

// The panel's code loads only when the first issue is opened, so the panel comes a moment after the click. Returns
// what brings the code.
function openLate() {
  let arrive: (() => void) | undefined
  const late = defineAsyncComponent(() => new Promise<Component>((resolve) => (arrive = () => resolve(IssueView))))
  const shell = defineComponent(() => () => h(late, { issue: WEB, docked: true }))
  wrapper = mount(shell, { global: { plugins: [i18n] }, attachTo: document.body })
  return () => arrive?.()
}

describe('the focus, once the issue loads', () => {
  let row: HTMLAnchorElement
  let search: HTMLInputElement
  beforeEach(() => {
    row = Object.assign(document.createElement('a'), { href: LINK })
    search = document.createElement('input')
    document.body.append(row, search)
  })

  it('goes to the title when it stayed where the issue was opened', async () => {
    row.focus()
    showIssue(WEB)
    const arrive = openLate()
    arrive()
    await flushPromises()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement?.id).toBe('issue-title')
  })

  it('stays where the reader moved it while the panel was still loading', async () => {
    row.focus()
    showIssue(WEB)
    const arrive = openLate()
    search.focus()
    arrive()
    await flushPromises()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement).toBe(search)
  })

  it('stays where the reader moved it while the issue was loading', async () => {
    row.focus()
    showIssue(WEB)
    open()
    await flushPromises()
    search.focus()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement).toBe(search)
  })
})
