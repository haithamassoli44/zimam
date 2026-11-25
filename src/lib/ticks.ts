// What the reader has read of a file, as the changes they ticked viewed, each from one version of the file to another.
// A file's change in a diff, the whole pull request's or a run of its commits', reads as viewed when ticked changes
// lead from the version it starts at to the one it ends at, one after another. So ticks made commit by commit add up to
// the whole pull request, and a commit rewritten without changing the file keeps them: they hold versions, not commits.

/** The file at the pull request's base, whatever that is: where all the changes start it, as GitHub's tick does. */
export const BASE = '^'

/** A change from one version to another, as ticks hold it. */
export const changeKey = (from: string, to: string) => `${from}>${to}`
/** Whether a tick was made on all the changes, not on a run of commits: it starts at BASE. */
export const onAllChanges = (tick: string) => tick.startsWith(`${BASE}>`)

/** The versions ticks lead to from any of `starts`, a tick away at least. */
function reached(ticks: readonly string[], starts: readonly string[]): Set<string> {
  const steps = ticks.map((tick) => {
    const at = tick.indexOf('>')
    return [tick.slice(0, at), tick.slice(at + 1)] as const
  })
  const found = new Set<string>()
  const next = [...starts]
  for (let at = next.pop(); at !== undefined; at = next.pop())
    for (const [from, to] of steps)
      if (from === at && !found.has(to)) {
        found.add(to)
        next.push(to)
      }
  return found
}

export type Reading = 'viewed' | 'changed' | null

/**
 * How a file's change from `from` to `to` reads by `ticks`, where `base` is its version at the base once known. Viewed
 * when ticks lead from one to the other. A change that starts at the base starts at BASE too, and all the changes
 * start at `base` too, so ticks on all the changes and on the commits add up: a tick on all the changes counts for the
 * one commit that changed the file. Leading there takes a tick, so a change that keeps the version, like a new mode,
 * reads as viewed only once ticked itself. Changed, in all the changes only, when ticks on them lead only to other
 * versions: the file changed after it was ticked.
 */
export function readChange(ticks: readonly string[], from: string, to: string, base?: string): Reading {
  const atBase = from === BASE || from === base
  const starts = atBase && base !== undefined ? [BASE, base] : atBase ? [BASE] : [from]
  if (reached(ticks, starts).has(to)) return 'viewed'
  return from === BASE && reached(ticks, [BASE]).size ? 'changed' : null
}

/** How many ticks a file keeps, the latest: one for each of the commits a pull request lists, and no more. */
const KEPT = 100

/**
 * `ticks` with `change` in them as the latest, or without it. A tick on all the changes is the file as they leave it
 * now, so it takes the place of those on earlier heads.
 */
function withTick(ticks: readonly string[], change: string, on: boolean): string[] {
  const replaced = (tick: string) => tick === change || (on && onAllChanges(change) && onAllChanges(tick))
  const others = ticks.filter((tick) => !replaced(tick))
  return on ? [...others, change].slice(-KEPT) : others
}

/** A file's own ticks: the changes ticked viewed, and those unticked by hand that other ticks would count viewed. */
export interface FileTicks {
  ticked: readonly string[]
  unticked: readonly string[]
}

/**
 * How a file's change reads by its own ticks and `others`, like a renamed file's from before it moved, or GitHub's. A
 * change unticked by hand isn't viewed, and leads nowhere for the others. `dismissed`: GitHub took its own tick off
 * after a change, without saying which version had it, so all the changes read changed, unless unticked here.
 */
export function readFile(
  own: FileTicks,
  others: readonly string[],
  change: { from: string; to: string },
  base?: string,
  dismissed = false,
): Reading {
  if (own.unticked.includes(changeKey(change.from, change.to))) return null
  const ticks = [...own.ticked, ...others].filter((tick) => !own.unticked.includes(tick))
  const read = readChange(ticks, change.from, change.to, base)
  return !read && dismissed && change.from === BASE && !own.unticked.some(onAllChanges) ? 'changed' : read
}

/**
 * A file's own ticks once its change is ticked viewed, or unticked. A tick is new reading, so what was unticked by hand
 * on the file goes. Unticked, a change that the other ticks would still count stays unticked by hand.
 */
export function tickFile(
  own: FileTicks,
  others: readonly string[],
  change: { from: string; to: string },
  base: string | undefined,
  on: boolean,
): FileTicks {
  const key = changeKey(change.from, change.to)
  if (on) return { ticked: withTick(own.ticked, key, true), unticked: [] }
  const next = { ticked: withTick(own.ticked, key, false), unticked: withTick(own.unticked, key, false) }
  if (readFile(next, others, change, base) === 'viewed') next.unticked = withTick(next.unticked, key, true)
  return next
}
