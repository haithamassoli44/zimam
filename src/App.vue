<script setup lang="ts">
import UApp from '@nuxt/ui/components/App.vue'
import { ref, watchEffect } from 'vue'

import AppShell from '@/components/AppShell.vue'
import SetupFlow from '@/components/SetupFlow.vue'
import { uiLocale } from '@/locale'
import { activeWorkspace, settings } from '@/stores/settings'
import { ui } from '@/stores/ui'

const prefersDark = matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(prefersDark.matches)
prefersDark.addEventListener('change', (event) => (systemDark.value = event.matches))

watchEffect(() => {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark.value)
  document.documentElement.classList.toggle('dark', dark)
})
</script>

<template>
  <UApp :locale="uiLocale" :tooltip="{ delayDuration: 250 }">
    <SetupFlow v-if="!activeWorkspace || ui.setup" :key="ui.setup ?? 'first'" />
    <AppShell v-else />
  </UApp>
</template>
