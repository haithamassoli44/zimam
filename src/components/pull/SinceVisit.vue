<script setup lang="ts">
// PROTOTYPE: what changed since the reader's last visit, in one line, with a way to the first new change.
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatList, formatNumber, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { freshCounts, markTime, pretend, pull } from '@/stores/pull'

const emit = defineEmits<{ first: [] }>()
const { t } = useI18n()

const parts = computed(() => {
  const value = freshCounts.value
  if (!value) return []
  return [
    value.commits && t('pull.since.commits', { n: formatNumber(value.commits) }, value.commits),
    value.files && t('pull.since.files', { n: formatNumber(value.files) }, value.files),
    value.comments && t('pull.since.comments', { n: formatNumber(value.comments) }, value.comments),
  ].filter((part): part is string => !!part)
})
const when = computed(() => (markTime.value !== null ? relativeTime(markTime.value, now.value) : ''))
</script>

<template>
  <div
    v-if="pull"
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default bg-muted px-4 py-3 text-[13px] sm:px-6"
  >
    <template v-if="markTime !== null">
      <span class="inline-flex items-center gap-1.5 font-medium text-highlighted">
        <span class="size-2 rounded-full bg-primary" />
        {{ t('pull.since.title', { when }) }}
      </span>
      <span class="text-toned">{{ formatList(parts) || t('pull.since.nothing') }}</span>
      <span class="text-[12px] text-muted max-md:hidden">{{ t('pull.since.legend') }}</span>
      <span class="flex-1" />
      <UButton
        v-if="freshCounts?.files"
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-octicon-arrow-down-16"
        :label="t('pull.since.first')"
        @click="emit('first')"
      />
      <span v-if="pretend" class="rounded-sm px-1.5 text-[11px] text-muted ring-1 ring-accented ring-inset">{{
        t('pull.since.pretend')
      }}</span>
    </template>
    <p v-else class="flex items-start gap-2 text-toned">
      <UIcon name="i-octicon-eye-16" class="mt-0.5 size-4 shrink-0 text-muted" />{{ t('pull.since.firstVisit') }}
    </p>
  </div>
</template>
