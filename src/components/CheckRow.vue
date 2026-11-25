<script setup lang="ts">
// One check: how it ended and its name, as a link to its log on GitHub when it has one.
import UIcon from '@nuxt/ui/components/Icon.vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS } from '@/components/looks'
import type { CheckRun } from '@/lib/checks'

defineProps<{ run: CheckRun }>()
const { t } = useI18n()
</script>

<template>
  <component
    :is="run.url ? 'a' : 'div'"
    :href="run.url ?? undefined"
    :target="run.url ? '_blank' : undefined"
    :rel="run.url ? 'noopener' : undefined"
    class="group flex min-h-8 items-center gap-2 py-1 pointer-coarse:min-h-11"
    :class="run.url && 'focus-ring-inset transition-colors hover:bg-elevated focus-visible:bg-elevated'"
  >
    <UIcon :name="CHECK_LOOKS[run.state].icon" class="size-4 shrink-0" :class="CHECK_LOOKS[run.state].color" />
    <span class="sr-only">{{ t(`checks.states.${run.state}`) }}:</span>
    <span class="min-w-0 flex-1">
      <bdi class="block truncate text-toned rtl:text-right" dir="auto">{{ run.name }}</bdi>
      <bdi v-if="run.detail" class="block truncate text-xs text-muted rtl:text-right" dir="auto">{{ run.detail }}</bdi>
    </span>
    <UIcon
      v-if="run.url"
      name="i-octicon-link-external-16"
      class="size-4 shrink-0 text-muted reveal transition-opacity"
    />
  </component>
</template>
