<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'

import { languageName, otherLocale, switchLanguage } from '@/locale'
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    :lang="otherLocale"
    :label="languageName(otherLocale)"
    :ui="{ base: 'px-2 text-toned' }"
    @click="switchLanguage"
  />
</template>
