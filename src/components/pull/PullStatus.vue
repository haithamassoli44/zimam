<script setup lang="ts">
// PROTOTYPE: where the pull request stands, above its conversation: the reviews, the checks in a line that opens them,
// what's in the way of merging, and its labels and assignees.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import LabelTag from '@/components/LabelTag.vue'
import { VERDICT_LOOKS } from '@/components/looks'
import { showPart } from '@/components/pull/parts'
import { useStanding } from '@/components/pull/standing'
import { formatList, formatNumber } from '@/locale'
import { pull, runGroups, runs, runsFailed } from '@/stores/pull'
const { t } = useI18n()
const { review, checks, merge } = useStanding()

const summary = computed(() =>
  formatList(
    runGroups.value.map(({ state, runs: list }) =>
      t(`checks.count.${state}`, { n: formatNumber(list.length) }, list.length),
    ),
  ),
)
</script>

<template>
  <div v-if="pull && review && merge" class="divide-y divide-default text-[13px]">
    <section class="space-y-2 p-4">
      <h3 class="flex items-center gap-2 font-medium text-highlighted">
        <UIcon :name="review.icon" class="size-4" :class="review.color" />{{ review.text }}
      </h3>
      <ul v-if="pull.verdicts.length || pull.requested.length" class="space-y-2">
        <li v-for="verdict in pull.verdicts" :key="verdict.author?.login" class="flex items-center gap-2">
          <UAvatar v-if="verdict.author" :src="verdict.author.avatarUrl" alt="" size="3xs" />
          <bdi class="min-w-0 flex-1 truncate text-toned">{{ verdict.author?.login }}</bdi>
          <UTooltip :text="t(`pull.verdicts.${verdict.verdict}`)">
            <UIcon
              :name="VERDICT_LOOKS[verdict.verdict].icon"
              class="size-4"
              :class="VERDICT_LOOKS[verdict.verdict].color"
            />
          </UTooltip>
        </li>
        <li v-for="(reviewer, index) in pull.requested" :key="index" class="flex items-center gap-2">
          <UAvatar :src="reviewer.avatarUrl" alt="" size="3xs" />
          <bdi class="min-w-0 flex-1 truncate text-toned">{{
            reviewer.kind === 'team' ? reviewer.name : reviewer.login
          }}</bdi>
          <UTooltip :text="t('pull.awaiting')">
            <UIcon :name="VERDICT_LOOKS.pending.icon" class="size-4" :class="VERDICT_LOOKS.pending.color" />
          </UTooltip>
        </li>
      </ul>
      <p v-else class="text-muted">{{ t('pull.noReviewers') }}</p>
    </section>

    <button
      type="button"
      class="flex w-full items-start gap-2 p-4 text-start transition-colors hover:bg-elevated/60"
      :disabled="!checks"
      @click="showPart('checks')"
    >
      <UIcon
        :name="checks?.icon ?? 'i-octicon-dot-16'"
        class="mt-0.5 size-4 shrink-0"
        :class="checks?.color ?? 'text-muted'"
      />
      <span class="min-w-0 flex-1">
        <span class="block font-medium text-highlighted">{{ checks?.text ?? t('checks.none') }}</span>
        <USkeleton v-if="checks && !runs && !runsFailed" class="mt-2 h-3 w-2/3" />
        <span v-else-if="runs" class="mt-0.5 block text-muted">{{ summary }}</span>
      </span>
      <UIcon
        v-if="checks"
        name="i-octicon-chevron-right-16"
        class="mt-0.5 size-4 shrink-0 text-muted rtl:-scale-x-100"
      />
    </button>

    <p class="flex items-start gap-2 p-4">
      <UIcon :name="merge.icon" class="mt-0.5 size-4 shrink-0" :class="merge.color" />
      <span class="text-toned">{{ merge.text }}</span>
    </p>

    <section v-if="pull.labels.length || pull.assignees.length" class="space-y-3 p-4">
      <div v-if="pull.labels.length" class="flex flex-wrap gap-2">
        <LabelTag v-for="label in pull.labels" :key="label.name" :label="label" />
      </div>
      <div v-if="pull.assignees.length" class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span class="text-muted">{{ t('issue.assignees') }}</span>
        <span v-for="person in pull.assignees" :key="person.login" class="inline-flex items-center gap-1.5 text-toned">
          <UAvatar :src="person.avatarUrl" alt="" size="3xs" /><bdi>{{ person.login }}</bdi>
        </span>
      </div>
    </section>
  </div>
</template>
