import { nextTick } from 'vue'

/** The curve every move in Zimam eases out on, as `--ease-out` in style.css, for animations started from script. */
export const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** Whether the reader asked for less motion. Without a way to ask, as in tests, nothing moves. */
export const still = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true

/**
 * Makes a change that redraws the whole page, like another theme or language, and crossfades to it where the browser
 * can, rather than flashing. The browser takes its picture of the page before the change is made.
 */
export function crossfade(change: () => void) {
  if (!document.startViewTransition || still()) return change()
  document.startViewTransition(() => {
    change()
    return nextTick()
  })
}
