import { describe, expect, it } from 'vitest'

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

  it('refuses a file without workspaces', () => {
    expect(() => importSettings('{"theme":"light"}')).toThrow()
  })

  it('leaves tokens out of exports', () => {
    settings.workspaces[0].token = 'secret'
    expect(exportSettings()).not.toContain('secret')
  })
})
