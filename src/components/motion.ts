// Motion from script, on the timings style.css sets for the whole page.
import { nextTick } from 'vue'

import { settings } from '@/stores/settings'

/** Whether the reader asked for less motion. Without a way to ask, as in tests, nothing moves. */
export const still = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Plays keyframes on an element over the page's feedback duration and curve, unless nothing should move. */
export function animate(element: Element, keyframes: Keyframe[]) {
  if (still() || typeof element.animate !== 'function') return
  element.animate(keyframes, {
    duration: parseFloat(token('--default-transition-duration')),
    easing: token('--ease-out'),
  })
}

// Where a cubic Bézier curve from 0 to 1, through points a and b, is at its own time t.
const along = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3

/** The page's curve, `--ease-out`, as a function of the time gone from 0 to 1, for a move stepped from script. */
export function easeOut(): (time: number) => number {
  const [x1, y1, x2, y2] = (token('--ease-out').match(/[\d.]+/g) ?? ['0.22', '1', '0.36', '1']).map(Number)
  return (time) => {
    // The curve's own time for this much of the move's, found by halving.
    let low = 0
    let high = 1
    for (let step = 0; step < 20; step++) {
      const middle = (low + high) / 2
      if (along(x1, x2, middle) < time) low = middle
      else high = middle
    }
    return along(y1, y2, (low + high) / 2)
  }
}

/**
 * Changes how the whole page looks, its language, theme or density, and crossfades to it where the browser can,
 * rather than flashing. The browser takes its picture of the page before the change is made.
 */
export function setLook<K extends 'locale' | 'theme' | 'density'>(key: K, value: (typeof settings)[K]) {
  const change = () => {
    settings[key] = value
  }
  if (!document.startViewTransition || still()) {
    change()
    return
  }
  document.startViewTransition(() => {
    change()
    return nextTick()
  })
}
