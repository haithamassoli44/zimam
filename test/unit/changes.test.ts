import { describe, expect, it } from 'vitest'

import { NO_FILE, readTexts, readVersions } from '@/lib/changes'
import type { GitHub } from '@/lib/github'

// GitHub's answer to a read of three blobs: one there, one missing, one it couldn't give.
function answering(found: Record<string, unknown>) {
  const asked: string[] = []
  const gh = {
    request: async (query: string) => {
      asked.push(query)
      return { data: { repository: { f0: found, f1: null } }, errors: [{ message: 'no', path: ['repository', 'f2'] }] }
    },
  } as unknown as GitHub
  return { gh, asked }
}
const batch = ['head:a.ts', 'head:gone.ts', 'head:big.bin']

describe('reading blobs', () => {
  it('gives each text with the file’s version, and why there’s none', async () => {
    const { gh } = answering({ oid: 'abc', text: 'x', isBinary: false, isTruncated: false, byteSize: 1 })
    expect(await readTexts(gh, 'o/r', batch)).toEqual([
      { content: { text: 'x' }, version: 'abc' },
      { content: { missing: true }, version: NO_FILE },
      { content: { failed: true }, version: undefined },
    ])
  })

  it('reads files’ versions alone, leaving out those GitHub couldn’t give', async () => {
    const { gh, asked } = answering({ oid: 'abc' })
    expect(await readVersions(gh, 'o/r', batch)).toEqual(
      new Map([
        ['head:a.ts', 'abc'],
        ['head:gone.ts', NO_FILE],
      ]),
    )
    expect(asked[0]).not.toContain('text')
  })

  it('fails every blob when GitHub gives no repository, as when access is lost', async () => {
    const gh = {
      request: async () => ({ data: { repository: null }, errors: [{ message: 'gone', path: ['repository'] }] }),
    } as unknown as GitHub
    expect((await readTexts(gh, 'o/r', batch)).map((found) => found.version)).toEqual([undefined, undefined, undefined])
    expect(await readVersions(gh, 'o/r', batch)).toEqual(new Map())
  })
})
