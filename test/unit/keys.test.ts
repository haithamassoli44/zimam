import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { roving, useKeys } from '@/components/keys'

function answering(keys: Record<string, (event: KeyboardEvent) => unknown>, rank?: number) {
  return mount(
    defineComponent(() => {
      useKeys(keys, rank)
      return () => h('div', [h('input'), h('div', { role: 'menu' }, [h('button')])])
    }),
    { attachTo: document.body },
  )
}
const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useKeys', () => {
  it('answers a key by its name, and Shift makes it a capital', () => {
    const j = vi.fn()
    const J = vi.fn()
    const wrapper = answering({ j, J })
    expect(press({ key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(true)
    press({ key: 'J', code: 'KeyJ', shiftKey: true })
    expect([j.mock.calls.length, J.mock.calls.length]).toEqual([1, 1])
    wrapper.unmount()
  })

  it('takes a key from another layout by where it is: ت is j, ؟ is ?', () => {
    const j = vi.fn()
    const help = vi.fn()
    const wrapper = answering({ j, '?': help })
    press({ key: 'ت', code: 'KeyJ' })
    press({ key: '؟', code: 'Slash', shiftKey: true })
    expect([j.mock.calls.length, help.mock.calls.length]).toEqual([1, 1])
    wrapper.unmount()
  })

  it('leaves keys alone while typing, in a menu, or with Ctrl', () => {
    const j = vi.fn()
    const wrapper = answering({ j })
    press({ key: 'j', code: 'KeyJ' }, wrapper.get('input').element)
    press({ key: 'j', code: 'KeyJ' }, wrapper.get('button').element)
    press({ key: 'j', code: 'KeyJ', ctrlKey: true })
    expect(j).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('asks the latest part first, then the next when it declines, and everywhere last', () => {
    const calls: string[] = []
    const everywhere = answering({ j: () => calls.push('everywhere') }, 0)
    const list = answering({ j: () => calls.push('list') })
    const issue = answering({ j: () => (calls.push('issue declines'), false) })
    press({ key: 'j', code: 'KeyJ' })
    expect(calls).toEqual(['issue declines', 'list'])
    list.unmount()
    press({ key: 'j', code: 'KeyJ' })
    expect(calls.slice(2)).toEqual(['issue declines', 'everywhere'])
    issue.unmount()
    everywhere.unmount()
  })

  it('stops answering once the part is gone', () => {
    const j = vi.fn()
    answering({ j }).unmount()
    expect(press({ key: 'j', code: 'KeyJ' }).defaultPrevented).toBe(false)
    expect(j).not.toHaveBeenCalled()
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
    wrapper.unmount()
  })
})
