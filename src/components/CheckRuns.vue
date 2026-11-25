<script setup lang="ts">
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS } from '@/components/looks'
import { RUN_STATES, type CheckRuns } from '@/lib/checks'
import { formatList, formatNumber } from '@/locale'
import { checkRuns } from '@/stores/data'
import type { Item } from '@/types'

const props = defineProps<{ item: Item }>()
const { t } = useI18n()

const answer = ref<CheckRuns | null>(null)
const failed = ref(false)
// Read once the popover opens, so only the checks someone looks at cost anything.
checkRuns(props.item).then(
  (runs) => (answer.value = runs),
  () => (failed.value = true),
)

const summary = computed(() => {
  const runs = answer.value?.runs ?? []
  return formatList(
    RUN_STATES.flatMap((state) => {
      const n = runs.filter((run) => run.state === state).length
      return n ? [t(`checks.count.${state}`, { n: formatNumber(n) }, n)] : []
    }),
  )
})

const more = computed(() => (answer.value ? answer.value.total - answer.value.runs.length : 0))
const onGitHub = computed(() => `${props.item.url}/checks`)
</script>

<template>
  <div class="w-80 max-w-[calc(100vw-2rem)]">
    <div class="border-b border-default p-3">
      <p class="text-sm font-medium text-highlighted">{{ t('checks.title') }}</p>
      <p v-if="answer && summary" class="mt-0.5 text-xs text-muted">{{ summary }}</p>
    </div>

    <div v-if="!answer && !failed" class="space-y-3 p-3" aria-busy="true">
      <span class="sr-only">{{ t('checks.loading') }}</span>
      <div v-for="index in 3" :key="index" class="flex items-center gap-2" aria-hidden="true">
        <USkeleton class="size-4 rounded-full" />
        <USkeleton class="h-3" :style="{ width: `${40 + index * 12}%` }" />
      </div>
    </div>

    <p v-else-if="failed" class="px-3 py-4 text-sm text-muted">{{ t('checks.failed') }}</p>

    <p v-else-if="!answer?.runs.length" class="px-3 py-4 text-sm text-muted">{{ t('checks.none') }}</p>

    <ul v-else class="enter max-h-80 overflow-y-auto p-1">
      <li v-for="(run, index) in answer.runs" :key="index">
        <component
          :is="run.url ? 'a' : 'div'"
          :href="run.url ?? undefined"
          :target="run.url ? '_blank' : undefined"
          :rel="run.url ? 'noopener' : undefined"
          class="group flex min-h-8 items-center gap-2 rounded-md px-2 py-1 text-sm pointer-coarse:min-h-11"
          :class="
            run.url &&
            'transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary'
          "
        >
          <UIcon :name="CHECK_LOOKS[run.state].icon" class="size-4 shrink-0" :class="CHECK_LOOKS[run.state].color" />
          <span class="sr-only">{{ t(`checks.states.${run.state}`) }}:</span>
          <span class="min-w-0 flex-1">
            <bdi class="block truncate text-toned rtl:text-right" dir="auto">{{ run.name }}</bdi>
            <bdi v-if="run.detail" class="block truncate text-xs text-muted rtl:text-right" dir="auto">{{
              run.detail
            }}</bdi>
          </span>
          <UIcon
            v-if="run.url"
            name="i-octicon-link-external-16"
            class="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
          />
        </component>
      </li>
    </ul>

    <div class="flex items-center justify-between gap-3 border-t border-default px-3 py-2 text-xs">
      <span class="text-muted">{{ more > 0 ? t('checks.more', { n: formatNumber(more) }, more) : '' }}</span>
      <a
        :href="onGitHub"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 rounded-sm text-toned transition-colors hover:text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {{ t('checks.onGitHub') }}
        <UIcon name="i-octicon-link-external-16" class="size-4" />
      </a>
    </div>
  </div>
</template>
