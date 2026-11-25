// The keyboard. What's on screen answers the keys it has a use for, the latest first: an open issue's j and k before
// the list's. Every shortcut is also listed below, by where it works, for the sheet that `?` opens.
import { onBeforeUnmount, onMounted } from 'vue'

/**
 * A key as the help writes it and handlers name it: `j`, `J` for Shift and j, `[`, `?`, `1`, `Enter`. Return false
 * from a handler to leave the key to the next one.
 */
type Handler = (event: KeyboardEvent) => unknown

interface Layer {
  keys: Map<string, Handler>
  /** Above 0 for a part of a page; 0 for the shortcuts that work everywhere, asked last. */
  rank: number
}

const layers: Layer[] = []

/** Answers these keys while the component is on screen. */
export function useKeys(keys: Record<string, Handler>, rank = 1) {
  const layer: Layer = { keys: new Map(Object.entries(keys)), rank }
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

// Typing, or a menu, list or dialog that has the focus, keeps the keys. A dialog holding an element marked `data-keys`,
// like the issue laid over the list, passes them on.
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
const HOLDING = '[role="dialog"]:not(:has([data-keys])), [role="alertdialog"], [role="menu"], [role="listbox"]'

addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest(TYPING) || target?.closest(HOLDING)) return
  const name = nameOf(event)
  const ordered = layers.toReversed().toSorted((a, b) => b.rank - a.rank)
  for (const layer of ordered) {
    const handler = layer.keys.get(name)
    if (!handler || handler(event) === false) continue
    event.preventDefault()
    return
  }
})

/** ↓ and ↑ move the focus through a list's items, matched by `selector`, and Home and End to its ends. */
export function roving(selector: string) {
  return (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const items = [...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(selector)]
    const at = items.indexOf(event.target as HTMLElement)
    const next = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[
      event.key
    ]
    if (at < 0 || next === undefined || !items[next]) return
    event.preventDefault()
    items[next].focus()
  }
}

/** The shortcuts, by where they work, as the help lists them: keys pressed together or one after another, and what they do. */
export const KEY_GROUPS = [
  {
    id: 'everywhere',
    keys: [
      { keys: ['?'], does: 'help' },
      { keys: ['/'], does: 'search' },
      { keys: ['1', '9'], range: true, does: 'views' },
      { keys: ['r'], does: 'refresh' },
      { keys: [','], does: 'settings' },
    ],
  },
  {
    id: 'list',
    keys: [
      { keys: ['j', 'k'], does: 'rows' },
      { keys: ['↓', '↑'], does: 'rowsArrows' },
      { keys: ['Enter'], does: 'open' },
      { keys: ['meta', 'Enter'], does: 'openOnGitHub' },
    ],
  },
  {
    id: 'issue',
    keys: [
      { keys: ['j', 'k'], does: 'issues' },
      { keys: ['Esc'], does: 'close' },
    ],
  },
  {
    id: 'pull',
    keys: [
      { keys: ['1', '4'], range: true, does: 'parts' },
      { keys: ['u'], does: 'back' },
      { keys: ['J', 'K'], shift: true, does: 'pulls' },
      { keys: ['[', ']'], does: 'commits' },
      { keys: ['a'], does: 'allChanges' },
    ],
  },
  {
    id: 'diff',
    keys: [
      { keys: ['j', 'k'], does: 'changes' },
      { keys: ['n', 'p'], does: 'files' },
      { keys: ['v'], does: 'viewed' },
    ],
  },
] as const
