<script setup lang="ts">
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CheckRow from '@/components/CheckRow.vue'
import { runsSummary } from '@/components/checks'
import type { CheckRuns } from '@/lib/checks'
import { formatNumber } from '@/locale'
import { checkRuns, status } from '@/stores/data'
import type { Item } from '@/types'

const props = defineProps<{ item: Item }>()
const { t } = useI18n()

const answer = ref<CheckRuns | null>(null)
// Whether no answer could be read, and whether the answer shown is older than the last read, which failed.
const failed = ref(false)
const behind = ref(false)
// Read once the popover opens, so only the checks someone looks at cost anything, and again after each sync while it's
// open: a run can finish while the checks as a whole still run, which nothing in the item says. A sync that changed the
// item had them read already, as it went. What it shows stays until the new answer is in, and an answer to an earlier
// read is let go.
const FRESH = 30_000
let reads = 0
let readAt = 0
watch(
  [() => props.item.id, () => props.item.updatedAt, () => props.item.checks, () => status.value.syncedAt],
  ([id, updatedAt, checks], before) => {
    const [idBefore, updatedBefore, checksBefore] = before ?? []
    const synced = id === idBefore && updatedAt === updatedBefore && checks === checksBefore
    if (synced && Date.now() - readAt < FRESH) return
    readAt = Date.now()
    const read = ++reads
    if (before && id !== idBefore) {
      answer.value = null
      behind.value = false
    }
    failed.value = false
    checkRuns(props.item).then(
      (runs) => {
        if (read !== reads) return
        answer.value = runs
        behind.value = false
      },
      () => {
        if (read !== reads) return
        if (answer.value) behind.value = true
        else failed.value = true
        // So the sync's end asks again.
        readAt = 0
      },
    )
  },
  { immediate: true },
)

const summary = computed(() => runsSummary(answer.value?.runs ?? []))

const more = computed(() => (answer.value ? answer.value.total - answer.value.runs.length : 0))
const onGitHub = computed(() => `${props.item.url}/checks`)
</script>

<template>
  <div class="w-80 max-w-[calc(100vw-2rem)]">
    <div class="border-b border-default p-3">
      <p class="text-sm font-medium text-highlighted">{{ t('checks.title') }}</p>
      <p v-if="answer && summary" class="mt-0.5 text-xs text-muted">{{ summary }}</p>
      <p v-if="answer && behind" class="mt-0.5 text-xs text-muted">{{ t('checks.behind') }}</p>
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
        <CheckRow :run="run" class="rounded-md px-2 text-sm" />
      </li>
    </ul>

    <div class="flex items-center justify-between gap-3 border-t border-default px-3 py-2 text-xs">
      <span class="text-muted">{{ more > 0 ? t('checks.more', { n: formatNumber(more) }, more) : '' }}</span>
      <a
        :href="onGitHub"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 rounded-sm text-toned focus-ring transition-colors hover:text-highlighted hover:underline"
      >
        {{ t('checks.onGitHub') }}
        <UIcon name="i-octicon-link-external-16" class="size-4" />
      </a>
    </div>
  </div>
</template>
