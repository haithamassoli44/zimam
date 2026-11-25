// PROTOTYPE: the side column's width. One width for every part, so the diff stays put when the part changes, kept in
// this browser.
import { computed, ref } from 'vue'

export const COLUMN = { min: 240, start: 384 }
const KEY = 'zimam:pull-column'
/** The strip of part icons beside the column, `w-12` in PullLayout.vue. */
const STRIP = 48

function read() {
  try {
    const width = Number(localStorage.getItem(KEY))
    return width >= COLUMN.min ? width : COLUMN.start
  } catch {
    return COLUMN.start
  }
}

const windowWidth = ref(innerWidth)
addEventListener('resize', () => (windowWidth.value = innerWidth))

/** The diff keeps at least half of the room it shares with the column. */
export const widest = computed(() => Math.max(COLUMN.min, Math.floor((windowWidth.value - STRIP) / 2)))
const clamp = (width: number) => Math.round(Math.min(widest.value, Math.max(COLUMN.min, width)))

const wanted = ref(read())
export const columnWidth = computed(() => clamp(wanted.value))

/** Sets the width, within its limits. `keep`: remember it, once a drag ends. */
export function setColumn(width: number, keep = true) {
  wanted.value = clamp(width)
  if (!keep) return
  try {
    localStorage.setItem(KEY, String(wanted.value))
  } catch {
    // Not kept in a private window. The width still holds until the page closes.
  }
}
