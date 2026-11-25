<script setup lang="ts">
// PROTOTYPE: a pull request on its own page, at GitHub's address on Zimam's host.
import UButton from '@nuxt/ui/components/Button.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ProtoSwitch from '@/components/pull/ProtoSwitch.vue'
import PullLayout from '@/components/pull/PullLayout.vue'
import { formatNumber } from '@/locale'
import { problem, pull, reloadPull } from '@/stores/pull'
import { openSettings } from '@/stores/ui'
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
  <div class="flex h-dvh flex-col bg-default">
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
    <div v-else-if="!pull" class="mx-auto w-full max-w-5xl space-y-4 px-6 pt-8" aria-busy="true">
      <span class="sr-only">{{ t('pull.loading') }}</span>
      <USkeleton class="h-8 w-3/4" />
      <USkeleton class="h-4 w-1/2" />
      <div class="space-y-2 pt-6">
        <USkeleton v-for="n in 8" :key="n" class="h-3.5" :style="{ width: `${45 + ((n * 23) % 45)}%` }" />
      </div>
    </div>
    <PullLayout v-else />
  </div>
</template>
