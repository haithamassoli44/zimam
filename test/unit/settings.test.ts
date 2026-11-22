import { describe, expect, it, vi } from 'vitest'

import { exportSettings, importSettings, settings } from '@/stores/settings'

describe('importSettings', () => {
  it('keeps what it knows and drops what would break the app', () => {
    importSettings(
      JSON.stringify({
        locale: 'fr',
        theme: 'dark',
        show: { labels: false },
        workspaces: [
          { id: 'a', name: 'Acme', token: '', sources: [{ kind: 'org', name: 'acme' }], views: [] },
          { id: 'broken', name: 'No sources' },
        ],
      }),
    )
    expect(settings.locale).not.toBe('fr')
    expect(settings.theme).toBe('dark')
    expect(settings.show).toMatchObject({ labels: false, author: true })
    expect(settings.workspaces.map((ws) => ws.id)).toEqual(['a'])
  })

  it('keeps the repositories picked and pinned, and drops sources and lists that would break the app', () => {
    importSettings(
      JSON.stringify({
        workspaces: [
          {
            id: 'a',
            name: 'Acme',
            token: '',
            sources: [
              { kind: 'org', name: 'acme', only: ['R1', 'R2'] },
              { kind: 'user', name: 'ali', only: 'R3' },
              { kind: 'team', name: 'x' },
              null,
            ],
            views: [],
            pinned: ['R2', 'R1'],
          },
          { id: 'b', name: 'Old', token: '', sources: [], views: [], pinned: [7] },
        ],
      }),
    )
    expect(settings.workspaces[0].sources).toEqual([
      { kind: 'org', name: 'acme', only: ['R1', 'R2'] },
      { kind: 'user', name: 'ali' },
    ])
    expect(settings.workspaces[0].pinned).toEqual(['R2', 'R1'])
    expect(settings.workspaces[1].pinned).toEqual([])
  })

  it('refuses a file without workspaces', () => {
    expect(() => importSettings('{"theme":"light"}')).toThrow()
  })

  it('leaves tokens out of exports', () => {
    settings.workspaces[0].token = 'secret'
    expect(exportSettings()).not.toContain('secret')
  })
})

describe('settings from before version 2', () => {
  const old = {
    workspaces: [
      {
        id: 'ws',
        name: 'Acme',
        token: '',
        sources: [{ kind: 'org', name: 'acme' }],
        views: [
          { id: 'open', preset: 'open', query: '' },
          { id: 'prs', preset: 'prs', query: 'kind=pr' },
          { id: 'awaiting', preset: 'awaiting', query: 'kind=pr&review=pending' },
          { id: 'quiet', preset: 'quiet', query: 'updated=stale&sort=quiet' },
          { id: 'mine', name: 'Bugs to review', query: 'label=bug&review=pending' },
        ],
      },
    ],
  }

  it('split awaiting review, sort pull requests by readiness and add a view of what involves me', () => {
    importSettings(JSON.stringify(old))
    const views = settings.workspaces[0].views
    expect(settings.version).toBe(2)
    expect(views.map((view) => view.preset ?? view.name)).toEqual([
      'open',
      'prs',
      'awaiting',
      'mine',
      'quiet',
      'Bugs to review',
    ])
    expect(views.find((view) => view.id === 'prs')?.query).toBe('kind=pr&sort=ready')
    expect(views.find((view) => view.id === 'awaiting')?.query).toBe('kind=pr&review=required')
    expect(views.find((view) => view.preset === 'mine')?.query).toBe('me=assigned&me=authored&me=review')
    expect(views.find((view) => view.id === 'mine')?.query).toBe('label=bug&review=required')
  })

  it('leave settings that are already up to date alone', () => {
    const current = { ...old, version: 2 }
    importSettings(JSON.stringify(current))
    expect(settings.workspaces[0].views.map((view) => view.query)).toEqual(old.workspaces[0].views.map((v) => v.query))
  })

  it('are saved once upgraded, so the upgrade happens once', async () => {
    localStorage.setItem('zimam:settings', JSON.stringify(old))
    vi.resetModules()
    const first = await import('@/stores/settings')
    const added = first.settings.workspaces[0].views.find((view) => view.preset === 'mine')
    expect(JSON.parse(localStorage.getItem('zimam:settings')!).version).toBe(2)
    vi.resetModules()
    const second = await import('@/stores/settings')
    expect(second.settings.workspaces[0].views.filter((view) => view.preset === 'mine')).toEqual([added])
  })
})

describe('settings at load', () => {
  it("leave stored settings alone when they can't be read", async () => {
    localStorage.setItem('zimam:settings', '{not json')
    vi.resetModules()
    await import('@/stores/settings')
    expect(localStorage.getItem('zimam:settings')).toBe('{not json')
  })

  it("drop views that would break the app, and don't store a workspace picked by the address", async () => {
    const stored = {
      version: 2,
      activeWorkspaceId: 'a',
      workspaces: ['a', 'b'].map((id) => ({
        id,
        name: id,
        token: '',
        sources: [],
        views: [null, { id: 'v', query: '' }, { id: 7 }],
      })),
    }
    localStorage.setItem('zimam:settings', JSON.stringify(stored))
    history.replaceState(null, '', '/?w=b')
    vi.resetModules()
    const { settings: loaded } = await import('@/stores/settings')
    history.replaceState(null, '', '/')
    expect(loaded.activeWorkspaceId).toBe('b')
    expect(loaded.workspaces[0].views).toEqual([{ id: 'v', query: '' }])
    expect(JSON.parse(localStorage.getItem('zimam:settings')!).activeWorkspaceId).toBe('a')
  })
})
