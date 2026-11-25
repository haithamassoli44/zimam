<script setup lang="ts">
// The keyboard shortcuts, by where they work.
import UKbd from '@nuxt/ui/components/Kbd.vue'
import UModal from '@nuxt/ui/components/Modal.vue'
import { useI18n } from 'vue-i18n'

import { keycaps, SHORTCUT_GROUPS, SHORTCUTS } from '@/components/keys'
import { ui } from '@/stores/ui'

const { t } = useI18n()
</script>

<template>
  <UModal v-model:open="ui.keysOpen" :title="t('keys.title')" :ui="{ content: 'sm:max-w-2xl' }">
    <template #body>
      <div class="gap-x-10 sm:columns-2">
        <section v-for="{ group, shortcuts } in SHORTCUT_GROUPS" :key="group" class="mb-6 break-inside-avoid">
          <h3 class="mb-2 text-sm text-toned">{{ t(`keys.groups.${group}`) }}</h3>
          <ul class="space-y-1.5 text-[13px]">
            <li v-for="id in shortcuts" :key="id" class="flex items-center gap-3">
              <span class="min-w-0 flex-1 text-highlighted">{{ t(`keys.does.${id}`) }}</span>
              <span class="flex shrink-0 items-center gap-1 text-muted" dir="ltr">
                <template v-for="(key, index) in SHORTCUTS[id].keys" :key="key">
                  <span v-if="index && 'range' in SHORTCUTS[id]" aria-hidden="true">–</span>
                  <span v-else-if="index && keycaps(key).length > 1" class="w-1" />
                  <UKbd v-for="cap in keycaps(key)" :key="cap" :value="cap" />
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
