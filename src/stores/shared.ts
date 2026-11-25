// A record the browser keeps for every tab of the app, entry by entry.
import { reactive, watch } from 'vue'

type Plain = Record<string, unknown>
const isPlain = (value: unknown): value is Plain => !!value && typeof value === 'object' && !Array.isArray(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const copied = <T>(value: T): T => {
  const text = JSON.stringify(value)
  return (text === undefined ? undefined : JSON.parse(text)) as T
}

/**
 * When a field last changed, and in which tab: a time in milliseconds, past every one the tab has seen, so a change
 * comes after those it was made over, and the tab's name, which settles two at once.
 */
type Stamp = [at: number, tab: string]
const later = (a: Stamp, b: Stamp | undefined) => !b || a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
const isStamp = (value: unknown): value is Stamp =>
  Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'string'

// Each tab keeps its own copy of storage, which can be behind another tab's write for a moment, in any browser, so a
// tab can write over a change it hasn't had yet. So the stored record keeps, under a name no entry has, when each of its
// fields last changed, for a day: what a tab changed after storage's copy of a field is the tab's to write again.
const STAMPS = '~changed'
const DAY = 86_400_000

const pathOf = (at: string) => JSON.parse(at) as string[]
// A field of a record's own, not one every object has, as a file named `toString` would read.
const own = (value: unknown, name: string): unknown =>
  isPlain(value) && Object.hasOwn(value, name) ? value[name] : undefined
const valueAt = (root: unknown, path: string[]) => path.reduce<unknown>(own, root)

function put(root: Plain, path: string[], value: unknown) {
  let parent = root
  for (const name of path.slice(0, -1)) {
    if (!isPlain(own(parent, name))) parent[name] = {}
    parent = parent[name] as Plain
  }
  const name = path[path.length - 1]
  if (value === undefined) delete parent[name]
  else parent[name] = copied(value)
}

/** The fields that differ from `before` to `after`, under `path`, down to the lists, which change whole. */
function changesFrom(before: unknown, after: unknown, path: string[]): string[][] {
  if (same(before, after)) return []
  if (!isPlain(before) || !isPlain(after)) return [path]
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((name) =>
    changesFrom(own(before, name), own(after, name), [...path, name]),
  )
}

/**
 * A record kept in the browser's storage under `key`, which may change, as with the workspace open. Each tab writes the
 * fields it changed over what the others wrote meanwhile, so one tab doesn't undo another's work, even in the same
 * entry, and shows what the others change. Of two changes to a field, the later one stays, wherever the tabs' writes
 * cross. `fit` picks the entries to keep when there are too many for the room the record has.
 */
export function sharedRecord<T extends object>(
  key: () => string,
  fit: (entries: [string, T][]) => [string, T][] = (entries) => entries,
): Record<string, T> {
  const tab = Math.random().toString(36).slice(2, 10)
  const record = reactive<Record<string, T>>({})
  // Each entry as storage last had it, as this tab knows: one that differs from it now was changed here.
  let known = new Map<string, string>()
  // When each field changed, by its path: as storage last had it, with this tab's changes since.
  let stamps = new Map<string, Stamp>()
  let clock = 0

  const changedHere = (name: string) => JSON.stringify(record[name]) !== known.get(name)
  const knownOf = (name: string): unknown => {
    const text = known.get(name)
    return text === undefined ? undefined : JSON.parse(text)
  }

  // What storage has, with when its fields changed, those of the last day.
  function read() {
    let text: string | null = null
    try {
      text = localStorage.getItem(key())
    } catch {
      // Without storage, the record starts empty.
    }
    let found: unknown = {}
    try {
      found = JSON.parse(text ?? '{}')
    } catch {
      // What isn't a record reads as none.
    }
    const { [STAMPS]: kept, ...entries } = isPlain(found) ? found : {}
    // A record taken away, as with its workspace, takes what this tab changed in it with it.
    if (text === null) stamps = new Map()
    const since = Date.now() - DAY
    const when = Object.entries(isPlain(kept) ? kept : {}).filter(
      (each): each is [string, Stamp] => isStamp(each[1]) && each[1][0] >= since,
    )
    return { entries: entries as Record<string, T>, stamps: new Map(when) }
  }

  function take(entries: Record<string, T>, found: Map<string, Stamp>) {
    for (const name of Object.keys(record)) if (!Object.hasOwn(entries, name)) delete record[name]
    for (const [name, value] of Object.entries(entries))
      if (JSON.stringify(record[name]) !== JSON.stringify(value)) record[name] = value
    known = new Map(Object.entries(entries).map(([name, value]) => [name, JSON.stringify(value)]))
    stamps = found
    for (const [at] of found.values()) clock = Math.max(clock, at)
  }

  function load() {
    known = new Map()
    stamps = new Map()
    const found = read()
    take(found.entries, found.stamps)
  }

  // Writes over what storage has what this tab changed since it last took storage, and what it has changed later.
  function save() {
    const { entries: stored, stamps: theirs } = read()
    const changes = [...new Set([...Object.keys(record), ...known.keys()])]
      .filter(changedHere)
      .flatMap((name) => changesFrom(knownOf(name), record[name], [name]))
    if (changes.length) {
      for (const [at] of theirs.values()) clock = Math.max(clock, at)
      clock = Math.max(clock + 1, Date.now())
      for (const path of changes) stamps.set(JSON.stringify(path), [clock, tab])
    }
    // Each field as the tab that changed it last has it, the shallower first. A field this tab has later, whose entry
    // storage doesn't have, brings the entry as this tab has it.
    const since = Date.now() - DAY
    const next: Plain = copied(stored)
    const all = new Map(theirs)
    const fields: [path: string[], value: unknown][] = []
    for (const [at, stamp] of stamps) {
      if (stamp[0] < since || !later(stamp, theirs.get(at))) continue
      const path = pathOf(at)
      all.set(at, stamp)
      if (!Object.hasOwn(next, path[0]) && Object.hasOwn(record, path[0])) next[path[0]] = copied(record[path[0]])
      fields.push([path, valueAt(record, path)])
    }
    if (!fields.length) {
      take(stored, theirs)
      return
    }
    for (const [at, stamp] of theirs) if (all.get(at) === stamp) fields.push([pathOf(at), valueAt(stored, pathOf(at))])
    for (const [path, value] of fields.toSorted(([a], [b]) => a.length - b.length)) put(next, path, value)
    // An entry changed in the last day stays, whatever `fit` picks: a tab that changed it would put it back.
    const picked = new Set(fit(Object.entries(next) as [string, T][]).map(([name]) => name))
    for (const at of all.keys()) picked.add(pathOf(at)[0])
    const kept = Object.fromEntries(Object.entries(next).filter(([name]) => picked.has(name))) as Record<string, T>
    const when = [...all].filter(([at]) => Object.hasOwn(kept, pathOf(at)[0]))
    try {
      localStorage.setItem(key(), JSON.stringify({ ...kept, [STAMPS]: Object.fromEntries(when) }))
    } catch {
      // Without storage, what was changed lasts until the tab closes.
      return
    }
    take(kept, new Map(when))
  }

  load()
  watch(key, load)
  watch(record, save, { deep: true })
  // Another tab wrote: what it changed shows here, and what this tab changed after, it writes again.
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key === key()) save()
  })
  return record
}
