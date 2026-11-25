<script setup lang="ts">
// "Viewed" in a line of text, for a diff whose files are all viewed: all the changes, or a commit's.
import UIcon from '@nuxt/ui/components/Icon.vue'
import { useI18n } from 'vue-i18n'

import { tickLook } from '@/components/pull/looks'

const { t } = useI18n()
</script>

<template>
  <span class="text-toned"
    ><UIcon :name="tickLook(true).icon" class="me-1 inline size-3.5 align-[-0.125em]" :class="tickLook(true).color" />{{
      t('pull.viewed')
    }}</span
  >
</template>
