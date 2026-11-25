<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { useI18n } from 'vue-i18n'

import { useKeys } from '@/components/keys'
import { pullUrl } from '@/lib/refs'
import { leavePull, openPull } from '@/stores/view'

/** In place of the pull request's page, when its code couldn't load: a way to GitHub, and a way back. */
const { t } = useI18n()
useKeys({ back: leavePull })
</script>

<template>
  <div class="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
    <p class="max-w-sm text-balance text-toned">{{ t('pull.failed') }}</p>
    <div class="flex flex-wrap justify-center gap-2">
      <UButton
        v-if="openPull"
        :to="pullUrl(openPull)"
        target="_blank"
        color="neutral"
        variant="outline"
        :label="t('issue.onGitHub')"
        trailing-icon="i-octicon-link-external-16"
      />
      <UButton color="neutral" variant="outline" :label="t('keys.does.back')" @click="leavePull" />
    </div>
  </div>
</template>
