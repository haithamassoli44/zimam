<script setup lang="ts">
// A pull request on its own page, at GitHub's address on Zimam's host.
import UButton from '@nuxt/ui/components/Button.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { kbds, useKeys, useMain } from '@/components/keys'
import PullLayout from '@/components/pull/PullLayout.vue'
import { pullUrl, refKey } from '@/lib/refs'
import { formatNumber } from '@/locale'
import { problem, pull, reloadPull } from '@/stores/pull'
import { openSettings } from '@/stores/ui'
import { activeView, leavePull, movePull, neighbors, openPull, viewName } from '@/stores/view'

const { t } = useI18n()
useKeys({ back: leavePull, pulls: [() => movePull(neighbors.value.next), () => movePull(neighbors.value.previous)] })
// When the pull request can't be read, what says so is the page's main part, as the diff is otherwise.
const page = useTemplateRef<HTMLElement>('page')
useMain(page)
const backLabel = computed(() => (activeView.value ? viewName(activeView.value) : t('filters.kind.pr')))
const url = computed(() => pull.value?.url ?? (openPull.value ? pullUrl(openPull.value) : '#'))
</script>

<template>
  <div class="enter flex h-dvh flex-col bg-default">
    <header class="flex h-12 shrink-0 items-center gap-1 border-b border-default bg-muted px-3">
      <UTooltip :text="t('keys.does.back')" :kbds="kbds('back')">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-octicon-arrow-left-16"
          :label="backLabel"
          :ui="{ leadingIcon: 'rtl:-scale-x-100', label: 'max-sm:sr-only' }"
          @click="leavePull"
        />
      </UTooltip>
      <span class="mx-1 h-5 w-px bg-(--ui-border-accented)" />
      <span v-if="openPull" class="min-w-0 truncate font-mono text-[13px] text-toned" dir="ltr">{{
        openPull.repo
      }}</span>
      <span class="flex-1" />
      <span v-if="neighbors.at >= 0" class="font-mono text-[12px] text-muted tabular-nums max-sm:hidden">
        {{ formatNumber(neighbors.at + 1) }} / {{ formatNumber(neighbors.of) }}
      </span>
      <UTooltip :text="t('pull.previous')" :kbds="kbds('pulls', 1)">
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
      <UTooltip :text="t('pull.next')" :kbds="kbds('pulls')">
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

    <div
      v-if="problem"
      ref="page"
      class="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center focus:outline-none"
      tabindex="-1"
    >
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
    <PullLayout v-else-if="openPull" :key="refKey(openPull)" class="enter" />
  </div>
</template>
