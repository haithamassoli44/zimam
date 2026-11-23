import { reactive, ref } from 'vue'

export const ui = reactive({ menuOpen: false, settingsOpen: false, setup: null as 'new' | 'edit' | null })

// From 80rem, Tailwind's `xl`, an issue opens beside the list, where another row is a click away. Narrower screens lay
// it over the list.
const WIDE = matchMedia('(min-width: 80rem)')
/** Whether the screen is wide enough to read an issue beside the list. */
export const wide = ref(WIDE.matches)
WIDE.addEventListener('change', (event) => (wide.value = event.matches))

export function openSetup(mode: 'new' | 'edit') {
  Object.assign(ui, { menuOpen: false, settingsOpen: false, setup: mode })
}

export function openSettings() {
  Object.assign(ui, { menuOpen: false, settingsOpen: true })
}
