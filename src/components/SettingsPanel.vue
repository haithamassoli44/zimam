<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UFormField from '@nuxt/ui/components/FormField.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import USeparator from '@nuxt/ui/components/Separator.vue'
import USlideover from '@nuxt/ui/components/Slideover.vue'
import USwitch from '@nuxt/ui/components/Switch.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceGroup from '@/components/ChoiceGroup.vue'
import { languageName, sides } from '@/locale'
import { deleteWorkspace, reloadWorkspace } from '@/stores/data'
import { activeWorkspace, exportSettings, importSettings, settings, updateWorkspace } from '@/stores/settings'
import { openSetup, ui } from '@/stores/ui'
import { DENSITIES, LOCALES, ROW_PARTS, THEMES, type Workspace } from '@/types'

const { t } = useI18n()
const toast = useToast()

const groups = computed(() => [
  {
    key: 'language',
    choices: LOCALES.map((value) => ({ value, label: languageName(value), lang: value })),
    picked: (value: string) => settings.locale === value,
    pick: (value: string) => (settings.locale = value as typeof settings.locale),
  },
  {
    key: 'theme',
    choices: THEMES.map((value) => ({ value, label: t(`settings.themes.${value}`) })),
    picked: (value: string) => settings.theme === value,
    pick: (value: string) => (settings.theme = value as typeof settings.theme),
  },
  {
    key: 'density',
    choices: DENSITIES.map((value) => ({ value, label: t(`settings.densities.${value}`) })),
    picked: (value: string) => settings.density === value,
    pick: (value: string) => (settings.density = value as typeof settings.density),
  },
])

async function reload() {
  ui.settingsOpen = false
  await reloadWorkspace()
}

async function remove(ws: Workspace) {
  if (!confirm(t('settings.deleteConfirm', { name: ws.name }))) return
  ui.settingsOpen = false
  await deleteWorkspace()
}

function download() {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([exportSettings()], { type: 'application/json' }))
  link.download = 'zimam-settings.json'
  link.click()
  URL.revokeObjectURL(link.href)
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    importSettings(await file.text())
    toast.add({ title: t('settings.imported'), icon: 'i-octicon-check-16' })
  } catch {
    toast.add({ title: t('settings.importFailed'), color: 'error', icon: 'i-octicon-alert-16' })
  }
}
</script>

<template>
  <USlideover v-model:open="ui.settingsOpen" :title="t('settings.title')" :side="sides.end">
    <template #body>
      <div class="space-y-6">
        <div v-for="group in groups" :key="group.key" class="space-y-2">
          <p class="text-sm font-medium text-highlighted" aria-hidden="true">{{ t(`settings.${group.key}`) }}</p>
          <ChoiceGroup
            :label="t(`settings.${group.key}`)"
            :choices="group.choices"
            :picked="group.picked"
            class="w-full *:flex-1 *:justify-center"
            @pick="group.pick"
          />
        </div>

        <fieldset class="space-y-2">
          <legend class="mb-3 text-sm font-medium text-highlighted">{{ t('settings.rows') }}</legend>
          <USwitch
            v-for="part in ROW_PARTS"
            :key="part"
            v-model="settings.show[part]"
            :label="t(`settings.parts.${part}`)"
          />
        </fieldset>

        <template v-if="activeWorkspace">
          <USeparator />
          <section class="space-y-3">
            <h3 class="font-medium text-highlighted">{{ t('settings.workspace') }}</h3>
            <UFormField :label="t('setup.nameLabel')">
              <UInput
                :model-value="activeWorkspace.name"
                class="w-full"
                @change="
                  (event: Event) =>
                    updateWorkspace(activeWorkspace!.id, { name: (event.target as HTMLInputElement).value })
                "
              />
            </UFormField>
            <UButton
              color="neutral"
              variant="outline"
              block
              :label="t('settings.editSources')"
              @click="openSetup('edit')"
            />
            <div>
              <UButton color="neutral" variant="outline" block :label="t('settings.reload')" @click="reload" />
              <p class="mt-1 text-xs text-muted">{{ t('settings.reloadHelp') }}</p>
            </div>
            <UButton
              color="error"
              variant="ghost"
              block
              :label="t('settings.delete')"
              @click="remove(activeWorkspace)"
            />
          </section>
        </template>

        <USeparator />
        <section class="space-y-2">
          <h3 class="font-medium text-highlighted">{{ t('settings.data') }}</h3>
          <p class="text-xs text-muted">{{ t('settings.exportHelp') }}</p>
          <div class="flex gap-2">
            <UButton color="neutral" variant="outline" :label="t('settings.export')" @click="download" />
            <UButton
              as="label"
              color="neutral"
              variant="outline"
              class="focus-within:outline-2 focus-within:outline-primary"
            >
              {{ t('settings.import') }}
              <input type="file" accept="application/json" class="sr-only" @change="upload" />
            </UButton>
          </div>
        </section>
      </div>
    </template>
  </USlideover>
</template>
