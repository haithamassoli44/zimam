import { describe, expect, it } from 'vitest'

import { formatRef, parseRef, sameRef } from '@/lib/refs'

describe('issue references', () => {
  it('reads and writes them the way GitHub writes them', () => {
    expect(parseRef('nuxt/nuxt#33041')).toEqual({ repo: 'nuxt/nuxt', number: 33041 })
    expect(parseRef('a-b/c.d_e#1')).toEqual({ repo: 'a-b/c.d_e', number: 1 })
    expect(formatRef({ repo: 'nuxt/nuxt', number: 33041 })).toBe('nuxt/nuxt#33041')
  })

  it('refuses anything else', () => {
    for (const text of ['', 'nuxt#1', 'nuxt/nuxt', 'nuxt/nuxt#', 'nuxt/nuxt#0', 'nuxt/nuxt#01', 'a/b/c#1', 'a b/c#1']) {
      expect(parseRef(text)).toBeNull()
    }
    expect(parseRef('nuxt/nuxt#1234567890')).toBeNull()
    expect(parseRef(null)).toBeNull()
  })

  it("ignores the case of a repository's name, as GitHub does", () => {
    expect(sameRef({ repo: 'Nuxt/Nuxt', number: 1 }, { repo: 'nuxt/nuxt', number: 1 })).toBe(true)
    expect(sameRef({ repo: 'nuxt/nuxt', number: 1 }, { repo: 'nuxt/nuxt', number: 2 })).toBe(false)
    expect(sameRef(null, { repo: 'nuxt/nuxt', number: 1 })).toBe(false)
  })
})
