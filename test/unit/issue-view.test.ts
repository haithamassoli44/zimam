import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import IssueView from '@/components/IssueView.vue'
import type { Post, Thread } from '@/lib/issue'
import { i18n } from '@/locale'
import { issueThread, items, loaded, moreComments, repos } from '@/stores/data'
import { openIssue } from '@/stores/view'
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
  labels: [],
  assignees: [],
  post: post('body', `${edition} description`),
  comments: Array.from({ length: shown }, (_, index) => post(`c${index}`, `${edition} comment ${index}`)),
  total: TOTAL,
  after: shown < TOTAL ? `after ${shown}` : null,
  readAt: Date.now(),
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
function open(opener: Element | null = null) {
  wrapper = mount(IssueView, {
    props: { issue: WEB, docked: true, opener },
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
  vi.useRealTimers()
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
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await wrapper?.setProps({ issue: { repo: 'acme/web', number: 13 } })
    // ↑ and ↓ wait a moment before reading.
    await vi.runOnlyPendingTimersAsync()
    vi.useRealTimers()
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
    // The last issue stays in sight while the next is read, but out of reach, and without what Show more brought.
    expect(wrapper?.find('[inert]').exists()).toBe(true)
    expect(comments()).toBe(PAGE)
  })
})

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
    open(row)
    await flushPromises()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement).toBe(wrapper?.find('h2').element)
  })

  it('stays where the reader moved it before the panel was there', async () => {
    row.focus()
    search.focus()
    open(row)
    await flushPromises()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement).toBe(search)
  })

  it('stays where the reader moved it while the issue was loading', async () => {
    row.focus()
    open(row)
    await flushPromises()
    search.focus()
    reads[0]?.answer(thread('first', 1))
    await flushPromises()
    expect(document.activeElement).toBe(search)
  })
})

// An answer whose first comment is hidden, read from GitHub at `readAt`.
const withHidden = (readAt: number): Thread => {
  const answer = thread('first', PAGE)
  return {
    ...answer,
    readAt,
    comments: answer.comments.map((each, index) => (index === 0 ? { ...each, hidden: 'outdated' } : each)),
  }
}
const showHidden = () => wrapper?.findAll('button').find((button) => button.text() === 'Show')

describe('a hidden comment, shown', () => {
  it('comes from the answer it was in while its links still work', async () => {
    open()
    await flushPromises()
    reads[0]?.answer(withHidden(Date.now()))
    await flushPromises()
    expect(wrapper?.text()).not.toContain('first comment 0')
    await showHidden()?.trigger('click')
    await flushPromises()
    expect(wrapper?.text()).toContain('first comment 0')
    expect(reads).toHaveLength(1)
  })

  it('has the issue read again for fresh links when they are about to stop working', async () => {
    open()
    await flushPromises()
    reads[0]?.answer(withHidden(0))
    await flushPromises()
    await showHidden()?.trigger('click')
    await flushPromises()
    expect(wrapper?.text()).toContain('first comment 0')
    expect(reads).toHaveLength(2)
  })
})

describe('closed on the way to the next issue', () => {
  it("doesn't read the issue it was going to", async () => {
    await openRead()
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await wrapper?.setProps({ issue: { repo: 'acme/web', number: 13 } })
    wrapper?.unmount()
    wrapper = null
    // ↑ and ↓ wait a moment before reading.
    await vi.runOnlyPendingTimersAsync()
    expect(reads).toHaveLength(1)
  })
})

describe('the next issue', () => {
  it('is the next one the list shows, past its pull requests', async () => {
    items.value = new Map([
      ['issue-12', item('2026-11-23T03:00:00Z')],
      ['pr-14', { ...item('2026-11-23T02:00:00Z', 14), id: 'pr-14', kind: 'pr' }],
      ['issue-13', item('2026-11-23T01:00:00Z', 13)],
    ])
    await openRead()
    await wrapper?.find('button[aria-label="Next issue"]').trigger('click')
    expect(openIssue.value).toEqual({ repo: 'acme/web', number: 13 })
  })
})
