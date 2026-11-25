// Tooltips and people's cards are each a handful of components, and a long list has hundreds of them. Its rows draw
// them only once a mouse points at the row or the keyboard reaches it, so rows scrolled past never pay for them. Touch
// shows neither, so a tap arms nothing: what it taps stays the element it tapped.
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, inject, nextTick, provide, ref, type FunctionalComponent, type InjectionKey, type Ref } from 'vue'

const ARMED: InjectionKey<Readonly<Ref<boolean>>> = Symbol('armed')
const ALWAYS = ref(true)

/** What stands for a tooltip or a card until its row is armed: what it wraps, alone. */
export const Plain: FunctionalComponent = (_props, { slots }) => slots.default?.()
Plain.inheritAttrs = false

const FOCUSABLE = 'a[href], button, [tabindex]'

/**
 * Makes a row arm what's in it when a mouse points at it or the keyboard focuses it. Bind `arming` to the row's root.
 * `cards`: the people's cards in the row wait for it too. Drawing a tooltip around an element draws the element anew,
 * so the keyboard's focus moves to its new self.
 */
export function useArming(root: Readonly<Ref<HTMLElement | null>>, { cards = false } = {}) {
  const armed = ref(false)
  if (cards) provide(ARMED, armed)
  function onPointerenter(event: PointerEvent) {
    if (event.pointerType !== 'touch') armed.value = true
  }
  // Focus from a pointer, as when a phone's tap focuses a link, would draw the element anew between the press and
  // the release, and lose the tap.
  function onFocusin(event: FocusEvent) {
    const target = event.target
    if (armed.value || !(target instanceof HTMLElement) || !target.matches(':focus-visible') || !root.value) return
    armed.value = true
    const at = [...root.value.querySelectorAll(FOCUSABLE)].indexOf(target)
    void nextTick(() => {
      if (!target.isConnected) root.value?.querySelectorAll<HTMLElement>(FOCUSABLE)[at]?.focus({ preventScroll: true })
    })
  }
  return {
    armed,
    /** A tooltip once armed. */
    tip: computed(() => (armed.value ? UTooltip : Plain)),
    arming: { onPointerenter, onFocusin },
  }
}

/** Whether what's in a row may draw its people's cards yet. Outside an arming row, always. */
export const useArmed = () => inject(ARMED, ALWAYS)
