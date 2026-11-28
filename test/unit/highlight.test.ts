import { describe, expect, it } from 'vitest'

import { languageOf } from '@/lib/highlight'

describe('the language of a file', () => {
  it('goes by its name, then its extension', () => {
    expect(languageOf('src/app.ts')).toBe('typescript')
    expect(languageOf('docker/Dockerfile')).toBe('docker')
    expect(languageOf('README')).toBeNull()
  })

  it('is none for a name or extension that is also a name every object has', () => {
    for (const path of ['constructor', 'lib/toString', 'a.constructor', 'b.hasOwnProperty', '__proto__', 'c.valueOf'])
      expect(languageOf(path)).toBeNull()
  })
})
