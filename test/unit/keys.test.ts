import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { focusMain, kbds, roving, useKeys, useMain } from '@/components/keys'

enableAutoUnmount(afterEach)
afterEach(() => {
  document.body.innerHTML = ''
})

type Bindings = Parameters<typeof useKeys>[0]

/** A part that answers these shortcuts, at a level, holding a text box and a menu. In a dialog, it's the dialog. */
function answering(bindings: Bindings, options: { level?: 'panel' | 'page' | 'app'; dialog?: boolean } = {}) {
  return mount(
    defineComponent(() => {
      const root = ref<HTMLElement | null>(null)
      useKeys(bindings, { level: options.level, root })
      return () =>
        h('div', { ref: root, role: options.dialog ? 'dialog' : undefined }, [
          h('input'),
          h('div', { role: 'menu' }, [h('button')]),
          h('button', { class: 'plain' }),
        ])
    }),
    { attachTo: document.body },
  )
}
const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const j = { key: 'j', code: 'KeyJ' }

describe('useKeys', () => {
  it('answers a shortcut by its keys, each key with its own handler, and Shift makes a capital', () => {
    const calls: string[] = []
    answering({ rows: [() => calls.push('j'), () => calls.push('k')], pulls: [() => calls.push('J'), () => {}] })
    expect(press(j).defaultPrevented).toBe(true)
    press({ key: 'k', code: 'KeyK' })
    press({ key: 'J', code: 'KeyJ', shiftKey: true })
    expect(calls).toEqual(['j', 'k', 'J'])
  })

  it('gives a range one handler, with the key’s place in it', () => {
    const views = vi.fn()
    answering({ views })
    press({ key: '1', code: 'Digit1' })
    press({ key: '9', code: 'Digit9' })
    expect(views.mock.calls.map((call) => call[1])).toEqual([0, 8])
  })

  it('takes a key from another layout by where it is: ت is j, ؟ is ?', () => {
    const rows = vi.fn()
    const help = vi.fn()
    answering({ rows, help })
    press({ key: 'ت', code: 'KeyJ' })
    press({ key: '؟', code: 'Slash', shiftKey: true })
    expect([rows.mock.calls.length, help.mock.calls.length]).toEqual([1, 1])
  })

  it('leaves keys alone while typing, in a menu, or with Ctrl', () => {
    const rows = vi.fn()
    const wrapper = answering({ rows })
    press(j, wrapper.get('input').element)
    press(j, wrapper.get('[role="menu"] button').element)
    press({ ...j, ctrlKey: true })
    expect(rows).not.toHaveBeenCalled()
  })

  it('asks an open panel first, then the page, then what works everywhere, whatever came first', () => {
    const calls: string[] = []
    const panel = answering({ rows: () => (calls.push('panel declines'), false) }, { level: 'panel' })
    const list = answering({ rows: () => calls.push('page') })
    answering({ rows: () => calls.push('app') }, { level: 'app' })
    press(j)
    expect(calls).toEqual(['panel declines', 'page'])
    list.unmount()
    panel.unmount()
    press(j)
    expect(calls.slice(2)).toEqual(['app'])
  })

  it('in a dialog, lets only the part with the focus answer', () => {
    const behind = vi.fn()
    const issue = vi.fn()
    answering({ search: behind, rows: behind })
    const dialog = answering({ rows: issue }, { level: 'panel', dialog: true })
    const inside = dialog.get('.plain').element
    press({ key: '/', code: 'Slash' }, inside)
    press(j, inside)
    expect(behind).not.toHaveBeenCalled()
    expect(issue).toHaveBeenCalledOnce()
  })

  it('over a part in a dialog, still answers what works everywhere, but not in a menu', () => {
    const help = vi.fn()
    answering({ help }, { level: 'app' })
    const dialog = answering({ rows: () => {} }, { level: 'panel', dialog: true })
    press({ key: '?', code: 'Slash', shiftKey: true }, dialog.get('.plain').element)
    press({ key: '?', code: 'Slash', shiftKey: true }, dialog.get('[role="menu"] button').element)
    expect(help).toHaveBeenCalledOnce()
  })

  it('stops answering once the part is gone', () => {
    const rows = vi.fn()
    answering({ rows }).unmount()
    expect(press(j).defaultPrevented).toBe(false)
    expect(rows).not.toHaveBeenCalled()
  })
})

describe('kbds', () => {
  it('spells a capital as Shift and the letter, and a range by its place', () => {
    expect(kbds('pulls', 1)).toEqual(['Shift', 'K'])
    expect(kbds('views', 2)).toEqual(['3'])
  })
})

/** A page whose main part is its root. */
function page() {
  return mount(
    defineComponent(() => {
      const main = ref<HTMLElement | null>(null)
      useMain(main)
      return () => h('div', { ref: main, tabindex: -1 })
    }),
    { attachTo: document.body },
  )
}

describe('the main part', () => {
  it('is where the skip link goes: of one inside another, the inner one, whichever came first', () => {
    const inner = ref<HTMLElement | null>(null)
    const outer = ref<HTMLElement | null>(null)
    mount(
      defineComponent(() => {
        useMain(outer)
        return () =>
          h('div', { ref: outer, tabindex: -1 }, [
            h(
              defineComponent(() => {
                useMain(inner)
                return () => h('div', { ref: inner, tabindex: -1 })
              }),
            ),
          ])
      }),
      { attachTo: document.body },
    )
    focusMain()
    expect(document.activeElement).toBe(inner.value)
  })

  it('takes the focus for the keys that scroll, when nothing has it', () => {
    const wrapper = page()
    const event = press({ key: 'PageDown' })
    expect(document.activeElement).toBe(wrapper.element)
    // The browser scrolls it.
    expect(event.defaultPrevented).toBe(false)
  })
})

describe('roving', () => {
  it('moves the focus through the items with the arrows, Home and End', () => {
    const wrapper = mount(
      defineComponent(
        () => () =>
          h(
            'ul',
            { onKeydown: roving('button') },
            ['a', 'b', 'c'].map((name) => h('li', [h('button', name)])),
          ),
      ),
      { attachTo: document.body },
    )
    const buttons = wrapper.findAll('button').map((button) => button.element)
    buttons[0].focus()
    press({ key: 'ArrowDown' }, buttons[0])
    expect(document.activeElement).toBe(buttons[1])
    press({ key: 'End' }, buttons[1])
    expect(document.activeElement).toBe(buttons[2])
    press({ key: 'ArrowDown' }, buttons[2])
    expect(document.activeElement).toBe(buttons[2])
    press({ key: 'Home' }, buttons[2])
    expect(document.activeElement).toBe(buttons[0])
  })
})
