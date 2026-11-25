<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'

import { setLook } from '@/components/motion'
import { languageName, otherLocale } from '@/locale'
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    :lang="otherLocale"
    :label="languageName(otherLocale)"
    :ui="{ base: 'px-2 text-toned' }"
    @click="setLook('locale', otherLocale)"
  />
</template>
