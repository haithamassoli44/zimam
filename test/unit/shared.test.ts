import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import { sharedRecord } from '@/stores/shared'

interface Entry {
  at: number
  ticked: string[]
}

interface Seen {
  at: number
  ticked: Record<string, string[]>
}

// A key of its own for each test, which the tabs of the tests before don't hear of.
let KEY = ''
let tests = 0
const keyOfTest = () => {
  const name = KEY
  return () => name
}
// The entries stored, without when their fields changed.
const stored = (key = KEY) =>
  Object.fromEntries(
    Object.entries(JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Entry>).filter(
      ([name]) => name !== '~changed',
    ),
  )
// What the browser tells the other tabs once one writes. It doesn't tell the tab that wrote.
const told = () => dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: localStorage.getItem(KEY) }))

beforeEach(() => {
  localStorage.clear()
  KEY = `zimam:seen:ws${++tests}`
})
afterEach(() => vi.restoreAllMocks())

describe('a record shared by tabs', () => {
  it("keeps what each tab changed, when one writes before hearing of the other's change", async () => {
    // Two tabs open on the same workspace.
    const first = sharedRecord<Entry>(keyOfTest())
    const second = sharedRecord<Entry>(keyOfTest())
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
    const first = sharedRecord<Entry>(keyOfTest())
    const second = sharedRecord<Entry>(keyOfTest())
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
    const first = sharedRecord<Entry>(keyOfTest())
    const second = sharedRecord<Entry>(keyOfTest())
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
    const first = sharedRecord<Seen>(keyOfTest())
    const second = sharedRecord<Seen>(keyOfTest())
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
    const first = sharedRecord<Seen>(keyOfTest())
    const second = sharedRecord<Seen>(keyOfTest())
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

  it('keeps the entries `fit` picks and those changed in the last day, and drops the rest here too', async () => {
    // Pull requests visited long ago.
    localStorage.setItem(KEY, JSON.stringify({ pr1: { at: 1, ticked: [] }, pr2: { at: 2, ticked: [] } }))
    const latest = (entries: [string, Entry][]) => entries.toSorted(([, a], [, b]) => b.at - a.at).slice(0, 2)
    const record = sharedRecord<Entry>(keyOfTest(), latest)
    record.pr3 = { at: 3, ticked: [] }
    await nextTick()
    expect(Object.keys(stored()).toSorted()).toEqual(['pr2', 'pr3'])
    expect(Object.keys(record).toSorted()).toEqual(['pr2', 'pr3'])
    // One changed now stays, though `fit` leaves it out: a tab that changed it would put it back.
    record.pr0 = { at: 0, ticked: [] }
    await nextTick()
    expect(Object.keys(stored()).toSorted()).toEqual(['pr0', 'pr2', 'pr3'])
  })

  it('keeps saving after unticking files named like what every object has', async () => {
    const record = sharedRecord<Seen>(keyOfTest())
    record.pr1 = { at: 1, ticked: { toString: ['x'], constructor: ['y'], 'a.ts': ['z'] } }
    await nextTick()
    for (const name of ['toString', 'constructor']) delete record.pr1.ticked[name]
    await nextTick()
    record.pr2 = { at: 2, ticked: { 'b.ts': ['w'] } }
    await nextTick()
    expect(stored()).toEqual({
      pr1: { at: 1, ticked: { 'a.ts': ['z'] } },
      pr2: { at: 2, ticked: { 'b.ts': ['w'] } },
    })
  })

  it("doesn't write back a record another tab took away, as with its workspace", async () => {
    const record = sharedRecord<Entry>(keyOfTest())
    record.pr1 = { at: 1, ticked: ['a.ts'] }
    await nextTick()
    const before = localStorage.getItem(KEY)
    localStorage.removeItem(KEY)
    told()
    // Nor when it hears late of a write from before.
    dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: before }))
    await nextTick()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(record).toEqual({})
  })

  it('works without storage, until the tab closes', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const record = sharedRecord<Entry>(keyOfTest())
    record.pr1 = { at: 1, ticked: ['a.ts'] }
    await nextTick()
    expect(record.pr1.ticked).toEqual(['a.ts'])
  })
})

interface Tab {
  record: Record<string, Seen>
  copy: { text: string | null; at: number }
  inbox: { text: string; at: number }[]
  // Writes the tab's copy has, that it hasn't heard of yet.
  unheard: string[]
  storage: Pick<Storage, 'getItem' | 'setItem'>
  listener: (event: StorageEvent) => void
}

const threeLatest = (entries: [string, Seen][]) => entries.toSorted(([, a], [, b]) => b.at - a.at).slice(0, 3)

const entriesOf = (text: string | null) => {
  const { '~changed': changed, ...entries } = JSON.parse(text ?? '{}') as Record<string, unknown>
  expect(typeof changed === 'object' || changed === undefined).toBe(true)
  return entries
}

/**
 * Tabs that each keep their own copy of storage, as browsers do. A tab's write reaches another's copy, and tells it,
 * once `deliver` hands it on, in the order the tab wrote. A copy keeps a later write over it, as storage has. A copy
 * can have a write before the tab hears of it.
 */
function browser() {
  let writes = 0
  const tabs: Tab[] = []
  function newTab(fit?: (entries: [string, Seen][]) => [string, Seen][]): Tab {
    const self = { copy: { text: null, at: 0 }, inbox: [], unheard: [] } as unknown as Tab
    self.storage = {
      getItem: (name) => (name === KEY ? self.copy.text : null),
      setItem(_key, text) {
        const write = { text, at: ++writes }
        self.copy = write
        for (const other of tabs) if (other !== self) other.inbox.push(write)
      },
    }
    vi.stubGlobal('localStorage', self.storage)
    vi.stubGlobal('addEventListener', (_type: string, listener: Tab['listener']) => (self.listener = listener))
    self.record = sharedRecord<Seen>(keyOfTest(), fit)
    vi.unstubAllGlobals()
    tabs.push(self)
    return self
  }
  // Does something in a tab, and lets it write.
  async function inTab(tab: Tab, act: () => void) {
    vi.stubGlobal('localStorage', tab.storage)
    act()
    await nextTick()
    await nextTick()
    vi.unstubAllGlobals()
  }
  // Tells a tab of the writes its copy has that it hasn't heard of.
  async function hear(tab: Tab) {
    const heard = tab.unheard.splice(0)
    for (const text of heard)
      await inTab(tab, () => tab.listener(new StorageEvent('storage', { key: KEY, newValue: text })))
    return heard.length > 0
  }
  // Hands a tab the next write another one made, which it hears of, or not yet.
  async function deliver(tab: Tab, heard = true) {
    const write = tab.inbox.shift()
    if (!write) return false
    if (write.at > tab.copy.at) tab.copy = write
    tab.unheard.push(write.text)
    if (heard) await hear(tab)
    return true
  }
  // Hands every write on, until no tab writes again.
  async function settle() {
    for (let round = 0; round < 500; round++) {
      let any = false
      for (const each of tabs) any = (await hear(each)) || (await deliver(each)) || any
      if (!any) return
    }
    throw new Error('the tabs kept writing')
  }
  const same = () => {
    for (const each of tabs) {
      expect(each.record).toEqual(tabs[0].record)
      expect(each.copy.text).toBe(tabs[0].copy.text)
    }
    expect(entriesOf(tabs[0].copy.text)).toEqual(tabs[0].record)
  }
  // A tab closing hears of no more writes, and makes none.
  const close = (tab: Tab) => tabs.splice(tabs.indexOf(tab), 1)
  return { newTab, inTab, deliver, hear, settle, same, close }
}

describe('a record shared by tabs that each keep their own copy of storage', () => {
  it("keeps what each tab changed when one writes before its copy has the other's write", async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: {} }))
    await tabs.settle()
    await tabs.inTab(first, () => (first.record.pr1.ticked['a.ts'] = ['x']))
    await tabs.inTab(second, () => (second.record.pr1.ticked['b.ts'] = ['y']))
    await tabs.settle()
    expect(first.record.pr1).toEqual({ at: 1, ticked: { 'a.ts': ['x'], 'b.ts': ['y'] } })
    tabs.same()
  })

  it('keeps what a tab wrote though it closed before the other tab, writing over it, heard of it', async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: {} }))
    await tabs.settle()
    await tabs.inTab(first, () => (first.record.pr1.ticked['a.ts'] = ['x']))
    tabs.close(first)
    await tabs.inTab(second, () => (second.record.pr1.ticked['b.ts'] = ['y']))
    await tabs.settle()
    expect(second.record.pr1).toEqual({ at: 1, ticked: { 'a.ts': ['x'], 'b.ts': ['y'] } })
    expect(entriesOf(second.copy.text)).toEqual(second.record)
  })

  it('leaves out a change another tab took back after hearing of it', async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: { 'a.ts': ['x'] } }))
    await tabs.settle()
    await tabs.inTab(second, () => delete second.record.pr1.ticked['a.ts'])
    await tabs.settle()
    expect(first.record.pr1).toEqual({ at: 1, ticked: {} })
    tabs.same()
  })

  it('leaves out a change its tab took back, though another tab wrote over the first without hearing of it', async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: {} }))
    await tabs.settle()
    // The second tab ticks a file; the first, not having heard of it yet, ticks another and unticks it.
    await tabs.inTab(second, () => (second.record.pr1.ticked['b.ts'] = ['y']))
    await tabs.inTab(first, () => (first.record.pr1.ticked['t.ts'] = ['x']))
    await tabs.inTab(first, () => delete first.record.pr1.ticked['t.ts'])
    // The second tab hears of the tick first, and writes its own over it again before hearing it was taken back.
    await tabs.deliver(second)
    await tabs.settle()
    expect(first.record.pr1).toEqual({ at: 1, ticked: { 'b.ts': ['y'] } })
    tabs.same()
  })

  it('gets back its own change that another wrote over, though its copy had that write before it heard of it', async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: {} }))
    await tabs.settle()
    await tabs.inTab(second, () => (second.record.pr1.ticked['b.ts'] = ['y']))
    await tabs.inTab(first, () => (first.record.pr1.ticked['a.ts'] = ['x']))
    // The second tab's copy has the tick before it hears of it, and writes over it: its copy then had no tick of a.ts.
    await tabs.deliver(second, false)
    await tabs.inTab(second, () => (second.record.pr1.at = 2))
    await tabs.settle()
    expect(first.record.pr1).toEqual({ at: 2, ticked: { 'a.ts': ['x'], 'b.ts': ['y'] } })
    tabs.same()
  })

  it('settles on one of the values two tabs give a field at once', async () => {
    const tabs = browser()
    const first = tabs.newTab()
    const second = tabs.newTab()
    await tabs.inTab(first, () => (first.record.pr1 = { at: 1, ticked: {} }))
    await tabs.settle()
    await tabs.inTab(first, () => (first.record.pr1.at = 2))
    await tabs.inTab(second, () => (second.record.pr1.at = 3))
    await tabs.settle()
    tabs.same()
  })

  it('settles when the record leaves out entries for room, though changes to them cross', async () => {
    // Changes in the same millisecond, which the tabs' names settle.
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    for (const seed of [...Array.from({ length: 60 }, (_, index) => index + 1), 470, 543, 966]) {
      let state = seed
      const random = (below: number) => {
        state = (state * 48_271) % 2_147_483_647
        return Math.floor((state / 2_147_483_647) * below)
      }
      const tabs = browser()
      const all = [tabs.newTab(threeLatest), tabs.newTab(threeLatest), tabs.newTab(threeLatest)]
      for (let step = 0; step < 40; step++) {
        const tab = all[random(3)]
        const choice = random(3)
        const name = `pr${random(6)}`
        if (choice === 0)
          await tabs.inTab(tab, () => (tab.record[name] = { ...tab.record[name], ticked: {}, at: random(20) }))
        else if (choice === 1) await tabs.deliver(tab, random(2) === 0)
        else await tabs.hear(tab)
      }
      await tabs.settle()
      tabs.same()
    }
  })

  it('keeps what three tabs ticked and leaves out what they unticked, however their writes cross', async () => {
    for (let seed = 1; seed <= 60; seed++) {
      let state = seed
      const random = (below: number) => {
        state = (state * 48_271) % 2_147_483_647
        return Math.floor((state / 2_147_483_647) * below)
      }
      const tabs = browser()
      const all = [tabs.newTab(), tabs.newTab(), tabs.newTab()]
      await tabs.inTab(all[0], () => (all[0].record.pr1 = { at: 0, ticked: {} }))
      await tabs.settle()
      // What each tab means to have ticked, of its own files.
      const meant = all.map(() => new Set<string>())
      for (let step = 0; step < 40; step++) {
        const index = random(3)
        const tab = all[index]
        const choice = random(6)
        if (choice === 0) {
          const name = `${index}-${step}.ts`
          meant[index].add(name)
          await tabs.inTab(tab, () => (tab.record.pr1.ticked[name] = [String(step)]))
        } else if (choice === 1 && meant[index].size) {
          const name = [...meant[index]][random(meant[index].size)]
          meant[index].delete(name)
          await tabs.inTab(tab, () => delete tab.record.pr1.ticked[name])
        } else if (choice === 2) await tabs.inTab(tab, () => (tab.record.pr1.at = step))
        else if (choice === 3) await tabs.deliver(tab, false)
        else if (choice === 4) await tabs.hear(tab)
        else await tabs.deliver(tab)
      }
      await tabs.settle()
      const ticked = Object.keys(all[0].record.pr1.ticked).toSorted()
      expect({ seed, ticked }).toEqual({ seed, ticked: meant.flatMap((each) => [...each]).toSorted() })
      tabs.same()
    }
  })
})
