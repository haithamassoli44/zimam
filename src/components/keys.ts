// The keyboard. Every shortcut is named once, in SHORTCUTS: what's on screen binds handlers to the shortcuts it has a
// use for, the help lists them all, and tooltips show their keys.
import { onBeforeUnmount, onMounted, type Ref } from 'vue'

import { PULL_PARTS } from '@/lib/refs'

/** Where shortcuts work, in the help's order. */
const GROUPS = ['everywhere', 'list', 'issue', 'pull', 'diff'] as const
type Group = (typeof GROUPS)[number]

/**
 * Where a shortcut works and its keys, as the help writes them: `j`, `J` for Shift and j, `[`, `?`, `Enter`. Each key
 * does its own thing, like `j` and `k`, or with `range` every key from the first to the last does, like `1` to `9`.
 * `native`: the browser or the focused element answers, and the help only lists it.
 */
interface Shortcut {
  group: Group
  keys: readonly string[]
  range?: true
  native?: true
}

export const SHORTCUTS = {
  help: { group: 'everywhere', keys: ['?'] },
  search: { group: 'everywhere', keys: ['/'] },
  views: { group: 'everywhere', keys: ['1', '9'], range: true },
  refresh: { group: 'everywhere', keys: ['r'] },
  settings: { group: 'everywhere', keys: [','] },
  rows: { group: 'list', keys: ['j', 'k'] },
  rowsArrows: { group: 'list', keys: ['↓', '↑'], native: true },
  open: { group: 'list', keys: ['Enter'], native: true },
  openOnGitHub: { group: 'list', keys: ['meta', 'Enter'], native: true },
  issues: { group: 'issue', keys: ['j', 'k'] },
  close: { group: 'issue', keys: ['Esc'], native: true },
  parts: { group: 'pull', keys: ['1', String(PULL_PARTS.length)], range: true },
  back: { group: 'pull', keys: ['u'] },
  pulls: { group: 'pull', keys: ['J', 'K'] },
  commits: { group: 'pull', keys: ['[', ']'] },
  allChanges: { group: 'pull', keys: ['a'] },
  changes: { group: 'diff', keys: ['j', 'k'] },
  files: { group: 'diff', keys: ['n', 'p'] },
  viewed: { group: 'diff', keys: ['v'] },
} as const satisfies Record<string, Shortcut>

type Id = keyof typeof SHORTCUTS
/** The shortcuts a handler can take: all but those the browser answers. */
type Bindable = { [K in Id]: (typeof SHORTCUTS)[K] extends { native: true } ? never : K }[Id]

/** The shortcuts by where they work, in the help's order. */
export const SHORTCUT_GROUPS = GROUPS.map((group) => ({
  group,
  shortcuts: (Object.keys(SHORTCUTS) as Id[]).filter((id) => SHORTCUTS[id].group === group),
}))

/** The keys a shortcut answers, from the first to the last of a range. */
function keysOf(id: Id): string[] {
  const shortcut: Shortcut = SHORTCUTS[id]
  if (!shortcut.range) return [...shortcut.keys]
  const [first, last] = shortcut.keys.map((key) => key.charCodeAt(0))
  return Array.from({ length: last - first + 1 }, (_, index) => String.fromCharCode(first + index))
}

/** A key as keycaps show it: a capital is Shift and the letter. */
export const keycaps = (key: string) => (/^[A-Z]$/.test(key) ? ['Shift', key] : [key])

/** The keycaps of a shortcut's key, the first by default, for a tooltip. */
export const kbds = (id: Id, index = 0) => keycaps(keysOf(id)[index])

/**
 * What a shortcut does. Given the key's place among the shortcut's keys: `0` for `j`, `1` for `k`, `3` for `4`. Return
 * false to leave the key to the next part asked.
 */
type Handler = (event: KeyboardEvent, index: number) => unknown

/**
 * How what's on screen ranks: a part that answers only while the focus is in it, like the files tree's rows, first;
 * then an open issue's panel before the page under it, and the page before what works everywhere. Within a level, the
 * latest shown is asked first.
 */
const LEVELS = ['focus', 'panel', 'page', 'app'] as const
type Level = (typeof LEVELS)[number]

interface Layer {
  keys: Map<string, (event: KeyboardEvent) => unknown>
  level: Level
  /** Where the part is: in a dialog, only parts inside it answer; at the focus level, only while it has the focus. */
  root?: Readonly<Ref<HTMLElement | null>>
}

const layers: Layer[] = []

/** Answers these shortcuts while the component is on screen: one handler for each key, or one for them all. */
export function useKeys(
  bindings: Partial<Record<Bindable, Handler | Handler[]>>,
  options: { level?: Level; root?: Readonly<Ref<HTMLElement | null>> } = {},
) {
  const keys = new Map<string, (event: KeyboardEvent) => unknown>()
  for (const [id, binding] of Object.entries(bindings) as [Bindable, Handler | Handler[]][])
    keysOf(id).forEach((key, index) => {
      const handler = Array.isArray(binding) ? binding[index] : binding
      if (handler) keys.set(key, (event) => handler(event, index))
    })
  const layer: Layer = { keys, level: options.level ?? 'page', root: options.root }
  onMounted(() => layers.push(layer))
  onBeforeUnmount(() => layers.splice(layers.indexOf(layer), 1))
}

// Signs by the key that makes them, for layouts like Arabic's that put other letters there.
const SIGNS: Record<string, [string, string]> = {
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Slash: ['/', '?'],
  Comma: [',', '<'],
  Period: ['.', '>'],
}

/**
 * The key's name. A Latin layout says what the key is, so `j` is wherever the layout puts it. Another layout says only
 * where it is, so `j` is the key a Latin layout puts there: an Arabic layout's ت.
 */
function nameOf(event: KeyboardEvent): string {
  const { key, code, shiftKey } = event
  if (key.length === 1 && key >= '!' && key <= '~') return key
  if (/^Key[A-Z]$/.test(code)) return shiftKey ? code[3] : code[3].toLowerCase()
  if (/^Digit\d$/.test(code)) return code[5]
  if (code in SIGNS) return SIGNS[code][shiftKey ? 1 : 0]
  return key
}

/** Whether a key comes with Ctrl, ⌘ or Alt: then it's the browser's or the system's. Shift makes a capital. */
export const modified = (event: KeyboardEvent) => event.ctrlKey || event.metaKey || event.altKey

/** Whether the page has no focus of its own: nothing, or the body. */
export const nothingFocused = () => !document.activeElement || document.activeElement === document.body

// --- The page's main part: where the skip link goes, and what the keys that scroll scroll when nothing has the focus.

const mains: Readonly<Ref<HTMLElement | null>>[] = []

/**
 * Makes this element a main part of the page while the component is on screen. It needs `tabindex`. Of main parts one
 * inside another, like the diff inside the pull request's page, the inner one is the page's.
 */
export function useMain(element: Readonly<Ref<HTMLElement | null>>) {
  onMounted(() => mains.push(element))
  onBeforeUnmount(() => mains.splice(mains.indexOf(element), 1))
}

/** Gives the page's main part the focus, without scrolling to it. */
export function focusMain() {
  const shown = mains.flatMap((each) => each.value ?? [])
  shown.find((main) => !shown.some((other) => other !== main && main.contains(other)))?.focus({ preventScroll: true })
}

// The keys that scroll. With nothing focused, they'd scroll nothing: the main part takes the focus, then the browser
// scrolls it. Taking the focus on arrival instead would draw its ring for a reader who came by the address.
const SCROLLING = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End'])

// Typing keeps the keys. So does a menu, a list or a dialog, but for the parts inside it, like the issue laid over the
// list; over a part like that, what works everywhere works too.
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const HOLDING = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || modified(event)) return
  if (nothingFocused() && SCROLLING.has(event.key)) return focusMain()
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest(TYPING)) return
  const holder = target?.closest(HOLDING)
  const inside = (layer: Layer) => !!holder?.contains(layer.root?.value ?? null)
  const hostsPart = layers.some((layer) => layer.level !== 'focus' && inside(layer))
  const answers = (layer: Layer) =>
    layer.level === 'focus'
      ? !!target && !!layer.root?.value?.contains(target)
      : !holder || inside(layer) || (layer.level === 'app' && hostsPart)
  const name = nameOf(event)
  const asked = LEVELS.flatMap((level) => layers.filter((layer) => layer.level === level).toReversed())
  for (const layer of asked) {
    const handler = layer.keys.get(name)
    if (!handler || !answers(layer) || handler(event) === false) continue
    event.preventDefault()
    return
  }
})

/** The step an arrow key takes through a list: one down or up, or to its start or end. Null for any other key. */
const STEPS: Record<string, 1 | -1 | 'start' | 'end'> = { ArrowDown: 1, ArrowUp: -1, Home: 'start', End: 'end' }
export function stepOf(event: KeyboardEvent) {
  return modified(event) ? null : (STEPS[event.key] ?? null)
}

/** ↓ and ↑ move the focus through a list's items, matched by `selector`, and Home and End to its ends. */
export function roving(selector: string) {
  return (event: KeyboardEvent) => {
    const step = stepOf(event)
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(selector)]
    const at = items.indexOf(event.target as HTMLElement)
    if (step === null || at < 0) return
    const next = items[step === 'start' ? 0 : step === 'end' ? items.length - 1 : at + step]
    if (!next) return
    event.preventDefault()
    next.focus()
  }
}
