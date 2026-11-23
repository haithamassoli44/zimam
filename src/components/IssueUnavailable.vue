<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import { useI18n } from 'vue-i18n'

import { issueUrl } from '@/lib/refs'
import { closeIssue, openIssue } from '@/stores/view'

/** In place of the issue, when its code couldn't load: a way to GitHub, and a way out. */
const { t } = useI18n()
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-4 px-6 py-24 text-center">
    <p class="max-w-sm text-balance text-toned">{{ t('issue.failed') }}</p>
    <div class="flex flex-wrap justify-center gap-2">
      <UButton
        v-if="openIssue"
        :to="issueUrl(openIssue)"
        target="_blank"
        color="neutral"
        variant="outline"
        :label="t('issue.onGitHub')"
        trailing-icon="i-octicon-link-external-16"
      />
      <UButton color="neutral" variant="outline" :label="t('issue.close')" @click="closeIssue" />
    </div>
  </div>
</template>
