import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { sharedRecord } from '@/stores/shared'

interface Entry {
  at: number
  ticked: string[]
}

const KEY = 'zimam:seen:ws'
const stored = (key = KEY) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Entry>
// What the browser tells the other tabs once one writes. It doesn't tell the tab that wrote.
const told = () => dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY) }))

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('a record shared by tabs', () => {
  it("keeps what each tab changed, when one writes before hearing of the other's change", async () => {
    // Two tabs open on the same workspace.
    const first = sharedRecord<Entry>(() => KEY)
    const second = sharedRecord<Entry>(() => KEY)
    first.pr1 = { at: 1, ticked: ['a.ts'] }
    await nextTick()
    // The second tab writes before the browser tells it of the first one's write.
    second.pr2 = { at: 2, ticked: [] }
    await nextTick()
    expect(stored()).toEqual({ pr1: { at: 1, ticked: ['a.ts'] }, pr2: { at: 2, ticked: [] } })
    // What it wrote over shows in it too.
    expect(second.pr1).toEqual({ at: 1, ticked: ['a.ts'] })
  })

  it('shows what another tab changes', async () => {
    const first = sharedRecord<Entry>(() => KEY)
    const second = sharedRecord<Entry>(() => KEY)
    first.pr1 = { at: 1, ticked: [] }
    await nextTick()
    told()
    expect(second.pr1).toEqual({ at: 1, ticked: [] })
    first.pr1.ticked.push('a.ts')
    await nextTick()
    told()
    expect(second.pr1.ticked).toEqual(['a.ts'])
  })

  it("keeps its own change to an entry when another tab's write comes before it is written", async () => {
    const first = sharedRecord<Entry>(() => KEY)
    const second = sharedRecord<Entry>(() => KEY)
    first.pr1 = { at: 1, ticked: [] }
    await nextTick()
    told()
    first.pr1 = { at: 2, ticked: ['first.ts'] }
    await nextTick()
    second.pr1 = { at: 3, ticked: ['second.ts'] }
    told()
    expect(second.pr1.ticked).toEqual(['second.ts'])
    await nextTick()
    expect(stored().pr1.ticked).toEqual(['second.ts'])
  })

  it('keeps what each tab changed in the same entry, when one writes before hearing of the other', async () => {
    interface Seen {
      at: number
      ticked: Record<string, string[]>
    }
    const first = sharedRecord<Seen>(() => KEY)
    const second = sharedRecord<Seen>(() => KEY)
    first.pr1 = { at: 1, ticked: { 'gone.ts': ['g'] } }
    await nextTick()
    told()
    // One tab ticks a file and unticks another; the other ticks a third before the browser tells it.
    first.pr1.ticked['a.ts'] = ['x']
    delete first.pr1.ticked['gone.ts']
    await nextTick()
    second.pr1.ticked['b.ts'] = ['y']
    await nextTick()
    told()
    const both = { at: 1, ticked: { 'a.ts': ['x'], 'b.ts': ['y'] } }
    expect(stored().pr1).toEqual(both)
    expect(first.pr1).toEqual(both)
    expect(second.pr1).toEqual(both)

    // A visit the second tab records, before hearing of a tick, keeps the tick.
    first.pr1.ticked['c.ts'] = ['z']
    await nextTick()
    second.pr1 = { ...second.pr1, at: 2 }
    await nextTick()
    told()
    expect(stored().pr1).toEqual({ at: 2, ticked: { 'a.ts': ['x'], 'b.ts': ['y'], 'c.ts': ['z'] } })
  })

  it("puts what a tab hasn't written yet on top of what another tab wrote meanwhile", async () => {
    interface Seen {
      at: number
      ticked: Record<string, string[]>
    }
    const first = sharedRecord<Seen>(() => KEY)
    const second = sharedRecord<Seen>(() => KEY)
    first.pr1 = { at: 1, ticked: {} }
    await nextTick()
    told()
    first.pr1.ticked['a.ts'] = ['x']
    await nextTick()
    // The browser tells the second tab between its change and its write.
    second.pr1.ticked['b.ts'] = ['y']
    told()
    expect(second.pr1.ticked).toEqual({ 'a.ts': ['x'], 'b.ts': ['y'] })
    await nextTick()
    expect(stored().pr1.ticked).toEqual({ 'a.ts': ['x'], 'b.ts': ['y'] })
  })

  it('reads the entries of the key it moves to, and writes there', async () => {
    localStorage.setItem('zimam:seen:other', JSON.stringify({ pr9: { at: 9, ticked: [] } }))
    const key = ref(KEY)
    const record = sharedRecord<Entry>(() => key.value)
    record.pr1 = { at: 1, ticked: [] }
    await nextTick()
    key.value = 'zimam:seen:other'
    await nextTick()
    expect(Object.keys(record)).toEqual(['pr9'])
    record.pr10 = { at: 10, ticked: [] }
    await nextTick()
    expect(Object.keys(stored('zimam:seen:other')).toSorted()).toEqual(['pr10', 'pr9'])
    expect(Object.keys(stored())).toEqual(['pr1'])
  })

  it('keeps the entries `fit` picks, and drops the rest here too', async () => {
    const latest = (entries: [string, Entry][]) => entries.toSorted(([, a], [, b]) => b.at - a.at).slice(0, 2)
    const record = sharedRecord<Entry>(() => KEY, latest)
    record.pr1 = { at: 1, ticked: [] }
    record.pr2 = { at: 2, ticked: [] }
    record.pr3 = { at: 3, ticked: [] }
    await nextTick()
    expect(Object.keys(stored()).toSorted()).toEqual(['pr2', 'pr3'])
    expect(Object.keys(record).toSorted()).toEqual(['pr2', 'pr3'])
  })

  it('works without storage, until the tab closes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const record = sharedRecord<Entry>(() => KEY)
    record.pr1 = { at: 1, ticked: ['a.ts'] }
    await nextTick()
    expect(record.pr1.ticked).toEqual(['a.ts'])
  })
})
