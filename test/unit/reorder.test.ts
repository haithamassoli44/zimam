import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useReorder } from '@/components/reorder'

const HEIGHT = 40

// Rows 40 pixels tall, one under the other, each drawn where its transform puts it. jsdom lays nothing out.
function layOut() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const rows = [...(this.parentElement?.children ?? [])]
    const shift = Number(/translateY\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0)
    const top = this.dataset.reorder ? rows.indexOf(this) * HEIGHT + shift : 0
    return { top, bottom: top + HEIGHT, height: HEIGHT } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEIGHT)
}

function list() {
  const order = ref(['a', 'b', 'c'])
  const done = vi.fn((ids: string[]) => (order.value = ids))
  let reorder!: ReturnType<typeof useReorder>
  const List = defineComponent(() => {
    const root = ref<HTMLElement | null>(null)
    reorder = useReorder(
      () => root.value,
      () => order.value,
      done,
    )
    return () =>
      h(
        'div',
        { ref: root },
        (reorder.draft.value ?? order.value).map((id) =>
          h(
            'div',
            {
              key: id,
              'data-reorder': id,
              style: reorder.dragged.value === id ? { transform: `translateY(${reorder.shift.value}px)` } : {},
            },
            [h('button', { id, onPointerdown: (event: PointerEvent) => reorder.start(event, id) })],
          ),
        ),
      )
  })
  const wrapper = mount(List, { attachTo: document.body })
  return { wrapper, order, done, reorder: () => reorder }
}

const pointer = (type: string, clientY: number) =>
  Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientY, button: 0 }), { isPrimary: true })

beforeEach(() => {
  layOut()
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useReorder', () => {
  it('moves a dragged row past each row whose middle it crosses, and keeps it under the pointer', async () => {
    const { wrapper, done, reorder } = list()
    wrapper.find('#a').element.dispatchEvent(pointer('pointerdown', 10))
    dispatchEvent(pointer('pointermove', 75))
    await nextTick()
    await nextTick()
    expect(reorder().draft.value).toEqual(['b', 'a', 'c'])
    // Its top is 65 pixels down, held by the pointer 10 pixels in, and its place is now the second.
    expect(reorder().shift.value).toBe(65 - HEIGHT)
    dispatchEvent(pointer('pointerup', 75))
    expect(done).toHaveBeenCalledWith(['b', 'a', 'c'])
    expect(reorder().dragged.value).toBeNull()
  })

  it('keeps a dragged row within the rows it moves among', async () => {
    const { wrapper, done } = list()
    wrapper.find('#a').element.dispatchEvent(pointer('pointerdown', 10))
    dispatchEvent(pointer('pointermove', 900))
    await nextTick()
    await nextTick()
    dispatchEvent(pointer('pointerup', 900))
    expect(done).toHaveBeenCalledWith(['b', 'c', 'a'])
  })

  it('puts the row back when Escape is pressed, or when the drag ends where it began', async () => {
    const { wrapper, done } = list()
    wrapper.find('#a').element.dispatchEvent(pointer('pointerdown', 10))
    dispatchEvent(pointer('pointermove', 75))
    await nextTick()
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    dispatchEvent(pointer('pointerup', 75))
    await nextTick()
    wrapper.find('#b').element.dispatchEvent(pointer('pointerdown', 50))
    dispatchEvent(pointer('pointermove', 55))
    await nextTick()
    dispatchEvent(pointer('pointerup', 55))
    expect(done).not.toHaveBeenCalled()
  })

  it('moves a row one place with the arrows, and keeps the focus on its handle', async () => {
    const { wrapper, order, reorder } = list()
    ;(wrapper.find('#b').element as HTMLElement).focus()
    expect(await reorder().step('b', -1)).toBe(0)
    expect(order.value).toEqual(['b', 'a', 'c'])
    expect(document.activeElement).toBe(wrapper.find('#b').element)
    expect(await reorder().step('b', -1)).toBeNull()
    expect(await reorder().step('c', 1)).toBeNull()
    expect(order.value).toEqual(['b', 'a', 'c'])
  })
})
