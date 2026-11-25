// A record the browser keeps for every tab of the app, entry by entry.
import { reactive, watch } from 'vue'

type Plain = Record<string, unknown>
const isPlain = (value: unknown): value is Plain => !!value && typeof value === 'object' && !Array.isArray(value)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * What a tab's change to an entry, from `base` to `mine`, makes of the entry another tab has written since, `theirs`:
 * field by field, down to the lists, which change whole. A field both tabs changed is this tab's, the later write.
 * Fields come in the order `theirs` has them, so a merge that changes nothing reads the same as `theirs`.
 */
function merged(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (same(mine, base)) return theirs
  if (same(theirs, base) || !isPlain(mine) || !isPlain(theirs)) return mine
  const from = isPlain(base) ? base : {}
  const result: Plain = {}
  for (const name of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
    const value = merged(from[name], mine[name], theirs[name])
    if (value !== undefined) result[name] = value
  }
  return result
}

/**
 * A record kept in the browser's storage under `key`, which may change, as with the workspace open. Each tab writes the
 * fields it changed over what the others wrote meanwhile, so one tab doesn't undo another's work, even in the same
 * entry, and shows what the others change. `fit` picks the entries to keep when there are too many for the room the
 * record has.
 */
export function sharedRecord<T extends object>(
  key: () => string,
  fit: (entries: [string, T][]) => [string, T][] = (entries) => entries,
): Record<string, T> {
  const record = reactive<Record<string, T>>({})
  // Each entry as storage last had it, as this tab knows: one that differs from it now was changed here.
  let known = new Map<string, string>()

  const changedHere = (name: string) => JSON.stringify(record[name]) !== known.get(name)
  const knownOf = (name: string): unknown => {
    const text = known.get(name)
    return text === undefined ? undefined : JSON.parse(text)
  }

  function read(): Record<string, T> {
    try {
      const found: unknown = JSON.parse(localStorage.getItem(key()) ?? '{}')
      return found && typeof found === 'object' ? (found as Record<string, T>) : {}
    } catch {
      return {}
    }
  }

  // Takes what storage has. With `keepChanged`, what this tab changed and hasn't written yet goes on top of it.
  function take(stored: Record<string, T>, keepChanged: boolean) {
    for (const name of Object.keys(record))
      if (!(name in stored) && !(keepChanged && changedHere(name))) delete record[name]
    for (const [name, value] of Object.entries(stored)) {
      const text = JSON.stringify(value)
      const next = keepChanged && changedHere(name) ? (merged(knownOf(name), record[name], value) as T) : value
      if (JSON.stringify(record[name]) !== JSON.stringify(next)) record[name] = next
      known.set(name, text)
    }
    for (const name of known.keys()) if (!(name in stored)) known.delete(name)
  }

  function load() {
    known = new Map()
    take(read(), false)
  }

  function save() {
    const stored = read()
    const next = { ...stored }
    for (const name of Object.keys(record))
      if (changedHere(name)) next[name] = merged(knownOf(name), record[name], stored[name]) as T
    for (const name of known.keys()) if (!(name in record)) delete next[name]
    const kept = Object.fromEntries(fit(Object.entries(next)))
    const text = JSON.stringify(kept)
    if (text !== JSON.stringify(stored)) {
      try {
        localStorage.setItem(key(), text)
      } catch {
        // Without storage, what was changed lasts until the tab closes.
        return
      }
    }
    take(JSON.parse(text) as Record<string, T>, false)
  }

  load()
  watch(key, load)
  watch(record, save, { deep: true })
  // Another tab wrote: what it changed shows here, under what this tab changed and is about to write.
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key === key()) take(read(), true)
  })
  return record
}
