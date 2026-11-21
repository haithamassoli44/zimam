<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { settings } from '@/stores/settings'

const { t } = useI18n()
</script>

<template>
  <div class="flex items-baseline gap-2 select-none">
    <span lang="ar" class="font-brand text-[28px] leading-none text-highlighted" aria-hidden="true">زمام</span>
    <span v-if="settings.locale === 'en'" class="text-base leading-none font-medium text-highlighted" aria-hidden="true"
      >Zimam</span
    >
    <span class="sr-only">{{ t('app.name') }}</span>
  </div>
</template>
