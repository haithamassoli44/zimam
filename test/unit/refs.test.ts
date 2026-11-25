import { describe, expect, it } from 'vitest'

import { formatRef, parsePullPath, parseRef, pullPath, sameRef } from '@/lib/refs'

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

describe('pull request pages', () => {
  const ref = { repo: 'nuxt/nuxt', number: 36177 }
  const sha = '174dbb0a51ced4987800dc9a5ac39fd07396a951'

  it('read GitHub’s addresses: the part, and the commits the diff shows', () => {
    expect(parsePullPath('/nuxt/nuxt/pull/36177')).toEqual({ ref, part: 'conversation', run: null })
    expect(parsePullPath('/nuxt/nuxt/pull/36177/checks/')).toEqual({ ref, part: 'checks', run: null })
    expect(parsePullPath(`/nuxt/nuxt/pull/36177/commits/${sha}`)?.run).toEqual({ before: null, last: sha })
    expect(parsePullPath('/nuxt/nuxt/pull/36177/files/41e4c13..174dbb0')?.run).toEqual({
      before: '41e4c13',
      last: '174dbb0',
    })
  })

  it('refuse other paths, and drop commits beside a part that has none', () => {
    for (const path of ['/nuxt/nuxt', '/nuxt/nuxt/pull/0', '/nuxt/nuxt/pull/1/talk', '/nuxt/nuxt/issues/1'])
      expect(parsePullPath(path)).toBeNull()
    expect(parsePullPath(`/nuxt/nuxt/pull/1/checks/${sha}`)?.run).toBeNull()
  })

  it('write back what they read', () => {
    for (const path of [
      '/nuxt/nuxt/pull/36177',
      '/nuxt/nuxt/pull/36177/files',
      `/nuxt/nuxt/pull/36177/commits/${sha}`,
      '/nuxt/nuxt/pull/36177/files/41e4c13..174dbb0',
    ])
      expect(pullPath(parsePullPath(path)!)).toBe(path)
  })

  it('leave the commits out beside a part that doesn’t name them', () => {
    expect(pullPath({ ref, part: 'conversation', run: { before: null, last: sha } })).toBe('/nuxt/nuxt/pull/36177')
  })
})
