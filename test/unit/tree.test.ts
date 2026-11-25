import { describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

import type { PullFile } from '@/stores/pull'

// The tree reads the files shown and which are viewed from the store, and the open pull request from the address.
const viewed = reactive(new Set<string>())
const shown = ref<PullFile[]>([])
const open = ref({ repo: 'o/r', number: 1 })
vi.mock('@/stores/pull', () => ({
  shownFiles: shown,
  allViewed: (files: PullFile[]) => files.length > 0 && files.every((file) => viewed.has(file.path)),
}))
vi.mock('@/stores/view', () => ({ openPull: open }))

const { filter, isFolded, toggleFold } = await import('@/components/pull/tree')

const file = (path: string) => ({ path }) as PullFile
shown.value = ['src/a.ts', 'src/b.ts', 'docs/c.md'].map(file)

async function view(...paths: string[]) {
  for (const path of paths) viewed.add(path)
  await nextTick()
}
async function unview(path: string) {
  viewed.delete(path)
  await nextTick()
}

describe('the files tree’s folds', () => {
  it('folds a folder once its files are all viewed, and opens it again once one isn’t', async () => {
    await view('src/a.ts')
    expect(isFolded('src')).toBe(false)
    await view('src/b.ts')
    expect(isFolded('src')).toBe(true)
    await unview('src/b.ts')
    expect(isFolded('src')).toBe(false)
  })

  it('keeps a viewed folder opened by hand open, and one folded by hand folded', async () => {
    await view('src/b.ts')
    toggleFold('src')
    expect(isFolded('src')).toBe(false)
    await unview('src/a.ts')
    await view('src/a.ts')
    expect(isFolded('src')).toBe(false)
    toggleFold('docs')
    await view('docs/c.md')
    await unview('docs/c.md')
    expect(isFolded('docs')).toBe(true)
  })

  it('shows the folders that folded themselves open while the filter looks, and folds one by hand then', async () => {
    open.value = { repo: 'o/r', number: 2 }
    await nextTick()
    viewed.clear()
    await view('src/a.ts', 'src/b.ts', 'docs/c.md')
    filter.value = 'a.ts'
    expect(isFolded('src')).toBe(false)
    toggleFold('src')
    expect(isFolded('src')).toBe(true)
    filter.value = ''
    expect(isFolded('src')).toBe(true)
    expect(isFolded('docs')).toBe(true)
  })

  it('starts another pull request with none folded and no filter', async () => {
    filter.value = 'x'
    open.value = { repo: 'o/r', number: 3 }
    await nextTick()
    expect(filter.value).toBe('')
    expect(isFolded('docs')).toBe(false)
  })
})
