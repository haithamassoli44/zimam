import './style.css'
import { _api } from '@iconify/vue'
import ui from '@nuxt/ui/vue-plugin'
import { createApp } from 'vue'

import App from './App.vue'
import { i18n } from './locale'

// Icons only come from the build's bundle. Without this, @iconify/vue loads any other icon from the public Iconify API.
_api.setAPIModule('', {
  prepare: (_provider, prefix, icons) => {
    console.warn(`Icons aren't in the bundle: ${icons.map((icon) => `${prefix}:${icon}`).join(', ')}`)
    return []
  },
  send: () => {},
})

createApp(App).use(ui).use(i18n).mount('#app')

// PROTOTYPE: on a fresh origin, start with a Nuxt workspace read with this machine's gh token, so pull requests open at once.
if (import.meta.env.DEV) {
  void (async () => {
    const { settings, createWorkspace } = await import('./stores/settings')
    if (settings.workspaces.length) return
    const { DEV_TOKEN_PATH } = await import('./dev')
    const response = await fetch(DEV_TOKEN_PATH)
    if (!response.ok) return
    createWorkspace({ name: 'Nuxt', token: (await response.text()).trim(), sources: [{ kind: 'org', name: 'nuxt' }] })
  })()
}
