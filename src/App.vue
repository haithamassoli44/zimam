<script setup lang="ts">
import UApp from '@nuxt/ui/components/App.vue'
import { useToast } from '@nuxt/ui/composables'
import { ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'

import AppShell from '@/components/AppShell.vue'
import SetupFlow from '@/components/SetupFlow.vue'
import { uiLocale } from '@/locale'
import { update, updateReady } from '@/pwa'
import { activeWorkspace, settings } from '@/stores/settings'
import { ui } from '@/stores/ui'

const { t } = useI18n()
const toast = useToast()

const prefersDark = matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(prefersDark.matches)
prefersDark.addEventListener('change', (event) => (systemDark.value = event.matches))

watchEffect(() => {
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark.value)
  document.documentElement.classList.toggle('dark', dark)
  // The browser's bars, and an installed app's title bar, take the page's color in the theme picked here.
  const color = getComputedStyle(document.documentElement).getPropertyValue('--ui-bg').trim()
  if (!color) return
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) meta.content = color
})

watch(
  updateReady,
  () =>
    toast.add({
      title: t('app.updateReady'),
      icon: 'i-octicon-sync-16',
      duration: 0,
      actions: [{ label: t('app.reload'), color: 'neutral', onClick: () => void update() }],
    }),
  { once: true },
)
</script>

<template>
  <UApp :locale="uiLocale" :tooltip="{ delayDuration: 250 }">
    <SetupFlow v-if="!activeWorkspace || ui.setup" :key="ui.setup ?? 'first'" />
    <AppShell v-else />
  </UApp>
</template>
