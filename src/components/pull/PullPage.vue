<script setup lang="ts">
// PROTOTYPE: a pull request on its own page, at GitHub's address on Zimam's host.
import UButton from '@nuxt/ui/components/Button.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { columnWidth } from '@/components/pull/column'
import { columnOpen } from '@/components/pull/parts'
import ProtoSwitch from '@/components/pull/ProtoSwitch.vue'
import PullLayout from '@/components/pull/PullLayout.vue'
import { formatNumber } from '@/locale'
import { problem, pull, reloadPull } from '@/stores/pull'
import { large, openSettings } from '@/stores/ui'
import { activeView, leavePull, movePull, neighbors, openPull, viewName } from '@/stores/view'

const { t } = useI18n()
const backLabel = computed(() => (activeView.value ? viewName(activeView.value) : t('filters.kind.pr')))
const url = computed(
  () =>
    pull.value?.url ??
    (openPull.value ? `https://github.com/${openPull.value.repo}/pull/${openPull.value.number}` : '#'),
)
</script>

<template>
  <div class="enter flex h-dvh flex-col bg-default">
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default bg-muted px-3">
      <UButton
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-octicon-arrow-left-16"
        :label="backLabel"
        :ui="{ leadingIcon: 'rtl:-scale-x-100', label: 'max-sm:sr-only' }"
        @click="leavePull"
      />
      <span class="mx-1 h-5 w-px bg-(--ui-border-accented)" />
      <span v-if="openPull" class="min-w-0 truncate font-mono text-[13px] text-toned" dir="ltr">{{
        openPull.repo
      }}</span>
      <span class="flex-1" />
      <span v-if="neighbors.at >= 0" class="font-mono text-[12px] text-muted tabular-nums max-sm:hidden">
        {{ formatNumber(neighbors.at + 1) }} / {{ formatNumber(neighbors.of) }}
      </span>
      <UTooltip :text="t('pull.previous')">
        <UButton
          icon="i-octicon-chevron-up-16"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('pull.previous')"
          :aria-disabled="!neighbors.previous"
          @click="movePull(neighbors.previous)"
        />
      </UTooltip>
      <UTooltip :text="t('pull.next')">
        <UButton
          icon="i-octicon-chevron-down-16"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('pull.next')"
          :aria-disabled="!neighbors.next"
          @click="movePull(neighbors.next)"
        />
      </UTooltip>
      <span class="mx-1 h-5 w-px bg-(--ui-border-accented)" />
      <UButton
        :to="url"
        target="_blank"
        color="neutral"
        variant="ghost"
        size="sm"
        :label="t('issue.onGitHub')"
        trailing-icon="i-octicon-link-external-16"
        :ui="{ label: 'max-sm:sr-only', trailingIcon: 'text-muted' }"
      />
      <ProtoSwitch />
      <UTooltip :text="t('nav.settings')">
        <UButton
          icon="i-octicon-gear-16"
          color="neutral"
          variant="ghost"
          size="sm"
          :aria-label="t('nav.settings')"
          @click="openSettings"
        />
      </UTooltip>
    </header>

    <div v-if="problem" class="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <p class="max-w-md text-toned">{{ t('pull.failed') }}</p>
      <p class="max-w-md font-mono text-[12px] text-muted">{{ problem }}</p>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" :label="t('sync.retry')" @click="reloadPull" />
        <UButton
          :to="url"
          target="_blank"
          color="neutral"
          variant="outline"
          :label="t('issue.onGitHub')"
          trailing-icon="i-octicon-link-external-16"
        />
      </div>
    </div>
    <!-- While it loads, the page is drawn in its own shape: the header, the strip and the column, and the diff. -->
    <div v-else-if="!pull" class="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <span class="sr-only">{{ t('pull.loading') }}</span>
      <div class="space-y-3 border-b border-default px-4 py-3 sm:px-6" aria-hidden="true">
        <USkeleton class="my-1.5 h-4 w-2/3 max-w-xl" />
        <USkeleton class="h-6 w-1/2 max-w-md" />
      </div>
      <div class="flex min-h-0 flex-1" aria-hidden="true">
        <template v-if="large">
          <div class="w-12 shrink-0 border-e border-default bg-muted" />
          <div v-if="columnOpen" class="shrink-0 border-e border-default" :style="{ width: `${columnWidth}px` }">
            <div class="flex h-11 items-center border-b border-default px-4"><USkeleton class="h-3 w-24" /></div>
            <div class="space-y-3 p-4">
              <USkeleton v-for="n in 6" :key="n" class="h-3" :style="{ width: `${40 + ((n * 17) % 45)}%` }" />
            </div>
          </div>
        </template>
        <div class="min-w-0 flex-1">
          <div class="flex h-11 items-center border-b border-default px-3 sm:px-4"><USkeleton class="h-6 w-40" /></div>
          <div class="space-y-3 p-4 sm:px-6">
            <USkeleton class="h-10" />
            <USkeleton v-for="n in 8" :key="n" class="h-3" :style="{ width: `${45 + ((n * 23) % 45)}%` }" />
          </div>
        </div>
      </div>
    </div>
    <PullLayout v-else class="enter" />
  </div>
</template>
