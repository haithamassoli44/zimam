import { nextTick, onBeforeUnmount, ref } from 'vue'

// Holding a dragged row this close to the top or bottom of the list scrolls it, this many pixels a frame.
const EDGE = 48
const SPEED = 10

/**
 * Lets rows be put in a new order by dragging their handles, with a mouse, a finger or a pen, or by pressing the up
 * and down arrows on a focused one. Each row carries `data-reorder` with its id. `order` gives the ids as shown, and
 * `done` takes the new order.
 */
export function useReorder(list: () => HTMLElement | null, order: () => string[], done: (ids: string[]) => void) {
  /** The order while a row is dragged, the row, and how far it is drawn from its place. */
  const draft = ref<string[] | null>(null)
  const dragged = ref<string | null>(null)
  const shift = ref(0)

  let pointerY = 0
  let grab = 0
  let frame = 0

  const rowOf = (id: string) =>
    [...(list()?.querySelectorAll<HTMLElement>('[data-reorder]') ?? [])].find((row) => row.dataset.reorder === id) ??
    null

  function start(event: PointerEvent, id: string) {
    const row = rowOf(id)
    if (!event.isPrimary || event.button !== 0 || dragged.value || !row) return
    // No text selection, and no scrolling on a touch screen: see `touch-none` on the handle.
    event.preventDefault()
    draft.value = order()
    dragged.value = id
    shift.value = 0
    pointerY = event.clientY
    grab = event.clientY - row.getBoundingClientRect().top
    document.documentElement.style.cursor = 'grabbing'
    addEventListener('pointermove', move)
    addEventListener('pointerup', drop)
    addEventListener('pointercancel', end)
    addEventListener('keydown', escape)
    frame = requestAnimationFrame(scroll)
  }

  function move(event: PointerEvent) {
    if (!event.isPrimary) return
    pointerY = event.clientY
    void follow()
  }

  // Moves the row past each one whose middle the pointer takes it across, and draws it under the pointer, kept within
  // the rows it moves among.
  async function follow() {
    const id = dragged.value
    const ids = draft.value
    const row = id && rowOf(id)
    if (!row || !ids) return
    const place = (other: string) => {
      const box = rowOf(other)?.getBoundingClientRect()
      const moved = other === id ? shift.value : 0
      return box ? { top: box.top - moved, bottom: box.bottom - moved } : null
    }
    const first = place(ids[0])
    const last = place(ids.at(-1)!)
    if (!first || !last) return
    const middle = pointerY - grab + row.offsetHeight / 2
    const others = ids.filter((other) => other !== id)
    const index = others.filter((other) => {
      const box = place(other)
      return box && (box.top + box.bottom) / 2 < middle
    }).length
    if (ids.indexOf(id) !== index) {
      draft.value = others.toSpliced(index, 0, id)
      await nextTick()
    }
    const top = Math.min(Math.max(pointerY - grab, first.top), last.bottom - row.offsetHeight)
    shift.value = top - (row.getBoundingClientRect().top - shift.value)
  }

  function scroll() {
    const scroller = list()
    const box = scroller?.getBoundingClientRect()
    const by = !box ? 0 : pointerY < box.top + EDGE ? -SPEED : pointerY > box.bottom - EDGE ? SPEED : 0
    if (scroller && by) {
      scroller.scrollTop += by
      void follow()
    }
    frame = requestAnimationFrame(scroll)
  }

  function drop() {
    const ids = draft.value
    end()
    if (ids && ids.join() !== order().join()) done(ids)
  }

  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    end()
  }

  function end() {
    cancelAnimationFrame(frame)
    removeEventListener('pointermove', move)
    removeEventListener('pointerup', drop)
    removeEventListener('pointercancel', end)
    removeEventListener('keydown', escape)
    document.documentElement.style.cursor = ''
    draft.value = null
    dragged.value = null
    shift.value = 0
  }

  /** Moves a row one place up or down, and returns its new place, counting from 0, or null if it can't move. */
  async function step(id: string, by: -1 | 1): Promise<number | null> {
    const ids = order()
    const from = ids.indexOf(id)
    const to = from + by
    if (from < 0 || to < 0 || to >= ids.length) return null
    // Moving the row takes it out of the page for a moment, which takes the focus from its handle.
    const focused = document.activeElement
    done(ids.toSpliced(from, 1).toSpliced(to, 0, id))
    await nextTick()
    if (focused instanceof HTMLElement) focused.focus()
    return to
  }

  onBeforeUnmount(end)

  return { draft, dragged, shift, start, step }
}
