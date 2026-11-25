<script setup lang="ts">
// Where the pull request stands, above its conversation: the reviews, the checks in a line that opens them,
// what's in the way of merging, and its labels and assignees.
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { runsSummary } from '@/components/checks'
import LabelTag from '@/components/LabelTag.vue'
import PersonLink from '@/components/PersonLink.vue'
import { VERDICT_LOOKS } from '@/components/pull/looks'
import { showPart } from '@/components/pull/parts'
import { useStanding } from '@/components/pull/standing'
import { pull, runs, runsState } from '@/stores/pull'
const { t } = useI18n()
const { review, checks, merge } = useStanding()

const summary = computed(() => (runs.value ? runsSummary(runs.value.runs) : null))
</script>

<template>
  <div v-if="pull && review && merge" class="divide-y divide-default text-[13px]">
    <section class="space-y-2 p-4">
      <h3 class="flex items-center gap-2 font-medium text-highlighted">
        <UIcon :name="review.icon" class="size-4" :class="review.color" />{{ review.text }}
      </h3>
      <ul v-if="pull.verdicts.length || pull.requested.length" class="space-y-2">
        <li v-for="(verdict, index) in pull.verdicts" :key="index" class="flex items-center gap-2">
          <span class="min-w-0 flex-1">
            <PersonLink :who="verdict.author" class="max-w-full text-toned" />
          </span>
          <UTooltip :text="t(`pull.verdicts.${verdict.verdict}`)">
            <UIcon
              :name="VERDICT_LOOKS[verdict.verdict].icon"
              class="size-4"
              :class="VERDICT_LOOKS[verdict.verdict].color"
            />
          </UTooltip>
        </li>
        <li v-for="(reviewer, index) in pull.requested" :key="index" class="flex items-center gap-2">
          <span class="min-w-0 flex-1">
            <PersonLink :who="reviewer" class="max-w-full text-toned" />
          </span>
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
        <USkeleton v-if="checks && runsState === 'loading'" class="mt-2 h-3 w-2/3" />
        <span v-else-if="summary" class="mt-0.5 block text-muted">{{ summary }}</span>
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
        <PersonLink v-for="person in pull.assignees" :key="person.login" :who="person" class="text-toned" />
      </div>
    </section>
  </div>
</template>
