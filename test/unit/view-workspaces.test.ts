import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { settings } from '@/stores/settings'
import { filters, go, page, showItems } from '@/stores/view'
import type { Workspace } from '@/types'

// Opening a workspace starts its sync, which this GitHub turns down without going out to the network.
vi.mock('@/lib/github', async (original) => {
  const real = await original<typeof import('@/lib/github')>()
  const refused = () => Promise.reject(new real.GitHubError('Bad credentials', 'auth'))
  return {
    ...real,
    createGitHub: () => ({
      scopes: () => null,
      rate: () => null,
      query: refused,
      request: refused,
      rest: refused,
      probe: async () => 'failed',
    }),
  }
})

const popped = () => new Promise((resolve) => addEventListener('popstate', resolve, { once: true }))
const workspace = (id: string): Workspace => ({
  id,
  name: id,
  token: 't',
  sources: [{ kind: 'org', name: id }],
  views: [],
  pinned: [],
})

describe('workspaces in the history', () => {
  it('goes back to the workspace an entry was in, with its filters, and forward to the next', async () => {
    settings.workspaces = [workspace('a'), workspace('b')]
    settings.activeWorkspaceId = 'a'
    await nextTick()
    showItems({ repo: ['a/web'] })
    await nextTick()
    go('repos')
    // Another workspace, picked from the sidebar on the repositories page.
    settings.activeWorkspaceId = 'b'
    await nextTick()
    expect(filters.repo).toEqual([])

    const back = popped()
    history.back()
    await back
    await nextTick()
    expect(settings.activeWorkspaceId).toBe('a')
    expect(page.value).toBe('items')
    expect(filters.repo).toEqual(['a/web'])
    expect(new URLSearchParams(location.search).get('w')).toBe('a')

    const forward = popped()
    history.forward()
    await forward
    await nextTick()
    expect(settings.activeWorkspaceId).toBe('b')
    expect(page.value).toBe('repos')
    expect(filters.repo).toEqual([])
    expect(new URLSearchParams(location.search).get('w')).toBe('b')
  })

  it('stays in the workspace open when an entry names one that is gone', async () => {
    settings.workspaces = [workspace('a'), workspace('b')]
    settings.activeWorkspaceId = 'a'
    await nextTick()
    go('items')
    go('repos')
    settings.workspaces = [workspace('b')]
    settings.activeWorkspaceId = 'b'
    await nextTick()
    const back = popped()
    history.back()
    await back
    await nextTick()
    expect(settings.activeWorkspaceId).toBe('b')
    expect(new URLSearchParams(location.search).get('w')).toBe('b')
  })
})
