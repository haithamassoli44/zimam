import { describe, expect, it } from 'vitest'

import { filters, go, itemsLink, page, showItems } from '@/stores/view'

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
