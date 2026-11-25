<script setup lang="ts">
// In place of the pull request's page while its code loads, when that takes a moment.
import { useI18n } from 'vue-i18n'

import SkeletonLines from '@/components/SkeletonLines.vue'

const { t } = useI18n()
</script>

<template>
  <div class="enter h-dvh bg-default">
    <SkeletonLines :lines="3" :label="t('pull.loading')" class="max-w-xl px-4 py-6 sm:px-6" />
  </div>
</template>
