import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { closeIssue, filters, go, itemsLink, openIssue, page, resetFilters, showIssue, showItems } from '@/stores/view'

const back = () =>
  new Promise((resolve) => {
    addEventListener('popstate', resolve, { once: true })
    history.back()
  })

describe('pages', () => {
  it('links to the list with filters on top of the defaults', () => {
    expect(itemsLink({ repo: ['acme/web'] })).toBe('/?repo=acme%2Fweb')
  })

  it('gives the repositories their own address, and Back returns to each page', async () => {
    go('repos')
    expect(location.pathname).toBe('/repos')
    showItems({ repo: ['acme/web'], kind: ['pr'] })
    expect(page.value).toBe('items')
    expect(location.pathname).toBe('/')
    expect(new URLSearchParams(location.search).getAll('repo')).toEqual(['acme/web'])

    await back()
    expect(page.value).toBe('repos')
    await back()
    expect(page.value).toBe('items')
    expect(filters.repo).toEqual([])
  })
})

const WEB = { repo: 'acme/web', number: 12 }
const API = { repo: 'acme/api', number: 3 }
const named = () => new URLSearchParams(location.search).get('issue')
const popped = () => new Promise((resolve) => addEventListener('popstate', resolve, { once: true }))

describe('the open issue', () => {
  it('is named in the address, and Back closes it', async () => {
    showIssue(WEB)
    expect(openIssue.value).toEqual(WEB)
    expect(named()).toBe('acme/web#12')
    await back()
    expect(openIssue.value).toBeNull()
    expect(named()).toBeNull()
  })

  it('gives way to the next one in the same entry, so Back closes the panel instead of stepping through', async () => {
    showIssue(WEB)
    const entries = history.length
    showIssue(API)
    expect(history.length).toBe(entries)
    expect(named()).toBe('acme/api#3')
    await back()
    expect(openIssue.value).toBeNull()
  })

  it('closes by going back over the entry that opened it', async () => {
    showIssue(WEB)
    const closed = popped()
    closeIssue()
    await closed
    expect(openIssue.value).toBeNull()
    expect(named()).toBeNull()
  })

  it('goes back only once when closed twice before the browser gets there', async () => {
    // A browser goes back a moment later, and until then the entry's state is still the issue's.
    const goBack = history.back.bind(history)
    const later = vi.spyOn(history, 'back').mockImplementation(() => void setTimeout(() => goBack(), 20))
    try {
      showIssue(WEB)
      const closed = popped()
      closeIssue()
      closeIssue()
      await closed
      expect(later).toHaveBeenCalledTimes(1)
      expect(openIssue.value).toBeNull()
    } finally {
      later.mockRestore()
    }
  })

  it('closes in place when its entry is from before a reload', async () => {
    showIssue(WEB)
    // A reload keeps the entry's state, but the page that added it is gone.
    history.replaceState({ zimamIssue: { ...history.state.zimamIssue, load: 'an earlier page' } }, '')
    closeIssue()
    expect(openIssue.value).toBeNull()
    await nextTick()
    expect(named()).toBeNull()
    await back()
  })

  it('closes in place when the filters changed while it was open', async () => {
    showIssue(WEB)
    filters.kind = ['issue']
    await nextTick()
    expect(named()).toBe('acme/web#12')
    closeIssue()
    expect(openIssue.value).toBeNull()
    await nextTick()
    expect(named()).toBeNull()
    expect(new URLSearchParams(location.search).get('kind')).toBe('issue')
    resetFilters()
    await nextTick()
  })

  it('closes on the repositories page, and Back opens it again', async () => {
    showIssue(WEB)
    go('repos')
    expect(openIssue.value).toBeNull()
    expect(location.pathname).toBe('/repos')
    expect(named()).toBeNull()
    await back()
    expect(page.value).toBe('items')
    expect(openIssue.value).toEqual(WEB)
    await back()
    expect(openIssue.value).toBeNull()
  })

  it('opens the issue an address names, and ignores one it names badly', () => {
    history.pushState(null, '', '/?issue=acme%2Fweb%2312')
    dispatchEvent(new PopStateEvent('popstate'))
    expect(openIssue.value).toEqual(WEB)
    history.pushState(null, '', '/?issue=acme%2Fweb')
    dispatchEvent(new PopStateEvent('popstate'))
    expect(openIssue.value).toBeNull()
  })
})
