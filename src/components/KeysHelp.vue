<script setup lang="ts">
// The keyboard shortcuts, by where they work. `?` opens it, and so does the keyboard button beside the settings.
import UKbd from '@nuxt/ui/components/Kbd.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { useI18n } from 'vue-i18n'

import { KEY_GROUPS } from '@/components/keys'
import { ui } from '@/stores/ui'

const { t } = useI18n()
</script>

<template>
  <UModal v-model:open="ui.keysOpen" :title="t('keys.title')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <section v-for="group in KEY_GROUPS" :key="group.id">
          <h3 class="mb-2 text-sm text-toned">{{ t(`keys.groups.${group.id}`) }}</h3>
          <ul class="space-y-1.5 text-[13px]">
            <li v-for="entry in group.keys" :key="entry.does" class="flex items-center gap-3">
              <span class="min-w-0 flex-1 text-highlighted">{{ t(`keys.does.${entry.does}`) }}</span>
              <span class="flex shrink-0 items-center gap-1 text-muted" dir="ltr">
                <template v-for="(key, index) in entry.keys" :key="key">
                  <span v-if="index && 'range' in entry" aria-hidden="true">–</span>
                  <span v-else-if="index && 'shift' in entry" class="w-1" />
                  <UKbd v-if="'shift' in entry" value="Shift" />
                  <UKbd :value="key" />
                </template>
              </span>
            </li>
          </ul>
        </section>
      </div>
      <p class="mt-6 text-[12px] text-muted">{{ t('keys.layout') }}</p>
    </template>
  </UModal>
</template>
