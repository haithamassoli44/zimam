import { reactive } from 'vue'

export const ui = reactive({ menuOpen: false, settingsOpen: false, setup: null as 'new' | 'edit' | null })

export function openSetup(mode: 'new' | 'edit') {
  Object.assign(ui, { menuOpen: false, settingsOpen: false, setup: mode })
}

export function openSettings() {
  Object.assign(ui, { menuOpen: false, settingsOpen: true })
}
