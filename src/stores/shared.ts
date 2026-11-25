// A record the browser keeps for every tab of the app, entry by entry.
import { reactive, watch } from 'vue'

/**
 * A record kept in the browser's storage under `key`, which may change, as with the workspace open. Each tab writes the
 * entries it changed over what the others wrote meanwhile, so one tab doesn't undo another's work, and shows the
 * entries the others change. `fit` picks the entries to keep when there are too many for the room the record has.
 */
export function sharedRecord<T extends object>(
  key: () => string,
  fit: (entries: [string, T][]) => [string, T][] = (entries) => entries,
): Record<string, T> {
  const record = reactive<Record<string, T>>({})
  // Each entry as storage last had it, as this tab knows: one that differs from it now was changed here.
  let known = new Map<string, string>()

  const changedHere = (name: string) => JSON.stringify(record[name]) !== known.get(name)

  function read(): Record<string, T> {
    try {
      const found: unknown = JSON.parse(localStorage.getItem(key()) ?? '{}')
      return found && typeof found === 'object' ? (found as Record<string, T>) : {}
    } catch {
      return {}
    }
  }

  // Takes what storage has, keeping the entries this tab changed and hasn't written yet.
  function take(stored: Record<string, T>, keepChanged: boolean) {
    for (const name of Object.keys(record))
      if (!(name in stored) && !(keepChanged && changedHere(name))) delete record[name]
    for (const [name, value] of Object.entries(stored)) {
      const text = JSON.stringify(value)
      if (!(keepChanged && changedHere(name)) && JSON.stringify(record[name]) !== text) record[name] = value
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
    for (const name of Object.keys(record)) if (changedHere(name)) next[name] = record[name]
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
  // Another tab wrote: its entries show here, except those this tab changed and is about to write.
  globalThis.addEventListener?.('storage', (event) => {
    if (event.key === key()) take(read(), true)
  })
  return record
}
