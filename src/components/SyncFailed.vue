<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { useI18n } from 'vue-i18n'

import type { SyncStatus } from '@/lib/sync'
import { syncNow } from '@/stores/data'
import { openSetup } from '@/stores/ui'

/** Why the workspace couldn't load, with what to do about it. */
defineProps<{ error: NonNullable<SyncStatus['error']> }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
    <p class="text-xl font-medium text-highlighted">{{ t(`sync.error.${error}`) }}</p>
    <UButton
      v-if="error === 'auth'"
      class="mt-2"
      color="neutral"
      variant="outline"
      :label="t('sync.replaceToken')"
      @click="openSetup('edit')"
    />
    <UButton v-else class="mt-2" color="neutral" variant="outline" :label="t('sync.retry')" @click="syncNow(true)" />
  </div>
</template>
