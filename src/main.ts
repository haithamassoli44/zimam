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
