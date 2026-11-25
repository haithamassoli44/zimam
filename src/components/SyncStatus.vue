<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { clockTime, formatList, formatNumber, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { status, syncNow } from '@/stores/data'
import { openSetup } from '@/stores/ui'

const { t } = useI18n()

const paused = computed(() => (status.value.pausedUntil ?? 0) > now.value)

// Only trouble is announced to screen readers; progress and "updated" would repeat every few seconds.
const alert = computed(() => {
  if (paused.value) return t('sync.paused', { time: clockTime(status.value.pausedUntil!) })
  return status.value.error ? t(`sync.error.${status.value.error}`) : ''
})

const message = computed(() => {
  const { phase, done, total, history, syncedAt } = status.value
  if (alert.value) return alert.value
  if (phase !== 'idle') return t(`sync.phase.${phase}`, phase === 'history' ? { ...history } : { done, total })
  return syncedAt ? t('sync.synced', { time: relativeTime(syncedAt, now.value) }) : t('sync.never')
})

const rate = computed(() => {
  const limit = status.value.rate
  return limit ? t('sync.rate', { remaining: formatNumber(limit.remaining), limit: formatNumber(limit.limit) }) : ''
})

const LOOK = {
  watching: { dot: 'bg-primary', text: 'text-muted' },
  waiting: { dot: 'bg-warning', text: 'text-warning' },
  broken: { dot: 'bg-error', text: 'text-error' },
}
const look = computed(() => {
  if (status.value.error === 'auth' || status.value.error === 'query') return LOOK.broken
  return alert.value ? LOOK.waiting : LOOK.watching
})
</script>

<template>
  <div class="space-y-2">
    <div class="flex h-6 items-center gap-2">
      <span class="size-1.5 shrink-0 rounded-full" :class="look.dot" aria-hidden="true" />
      <UTooltip :text="rate" :disabled="!rate">
        <span class="min-w-0 flex-1 truncate text-xs" :class="look.text">{{ message }}</span>
      </UTooltip>
      <span class="sr-only" aria-live="polite">{{ alert }}</span>
      <UButton
        icon="i-octicon-sync-16"
        size="xs"
        color="neutral"
        variant="ghost"
        class="ms-auto -me-1 text-muted"
        :loading="status.phase !== 'idle'"
        :aria-label="t('sync.refresh')"
        @click="syncNow(true)"
      />
    </div>
    <p v-if="status.failedSources.length" class="text-xs text-warning">
      {{ t('sync.failedSources', { names: formatList(status.failedSources) }) }}
    </p>
    <UButton
      v-if="status.error === 'auth'"
      size="xs"
      color="error"
      variant="soft"
      :label="t('sync.replaceToken')"
      @click="openSetup('edit')"
    />
  </div>
</template>
