<script lang="ts">
// Follows the padding and line heights in the template below: change them together.
export const ROW_HEIGHT = { compact: 41, comfortable: 73 } as const
</script>

<script setup lang="ts">
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UAvatarGroup from '@nuxt/ui/components/AvatarGroup.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatList, formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { settings } from '@/stores/settings'
import type { Item } from '@/types'

const props = defineProps<{ item: Item; repoName: string; archived?: boolean; fresh?: boolean }>()
const { t } = useI18n()

const compact = computed(() => settings.density === 'compact')

// GitHub's glyphs already tell the state by shape.
const STATES = {
  issueOpen: { icon: 'i-octicon-issue-opened-16', color: 'text-toned' },
  issueClosed: { icon: 'i-octicon-issue-closed-16', color: 'text-merged' },
  issueNotPlanned: { icon: 'i-octicon-skip-16', color: 'text-muted' },
  prOpen: { icon: 'i-octicon-git-pull-request-16', color: 'text-toned' },
  prDraft: { icon: 'i-octicon-git-pull-request-draft-16', color: 'text-muted' },
  prMerged: { icon: 'i-octicon-git-merge-16', color: 'text-merged' },
  prClosed: { icon: 'i-octicon-git-pull-request-closed-16', color: 'text-error' },
}

const state = computed<keyof typeof STATES>(() => {
  const { kind, state: value, notPlanned, review } = props.item
  if (kind === 'issue') return value === 'open' ? 'issueOpen' : notPlanned ? 'issueNotPlanned' : 'issueClosed'
  if (value === 'merged') return 'prMerged'
  if (value === 'closed') return 'prClosed'
  return review === 'draft' ? 'prDraft' : 'prOpen'
})

const CHECKS = {
  success: { icon: 'i-octicon-check-16', color: 'text-muted' },
  failure: { icon: 'i-octicon-x-16', color: 'text-error' },
  pending: { icon: 'i-octicon-dot-fill-16', color: 'text-warning' },
}

const checks = computed(() => (props.item.state === 'open' ? props.item.checks : null))
const review = computed(() =>
  props.item.state === 'open' && (props.item.review === 'approved' || props.item.review === 'changes')
    ? props.item.review
    : null,
)
const updated = computed(() => relativeTime(Date.parse(props.item.updatedAt), now.value))
</script>

<template>
  <a
    :href="item.url"
    target="_blank"
    rel="noopener"
    class="group relative flex gap-3 border-b border-default px-4 transition-colors hover:bg-elevated/60 focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary sm:px-6"
    :class="[compact ? 'items-center py-2' : 'py-3', fresh && 'arrived']"
  >
    <span
      v-if="fresh"
      class="absolute start-1.5 size-1.5 -translate-y-1/2 rounded-full bg-primary sm:start-2.5"
      :class="compact ? 'top-1/2' : 'top-6'"
      aria-hidden="true"
    />

    <UTooltip :text="t(`item.${state}`)">
      <UIcon :name="STATES[state].icon" class="size-4 shrink-0" :class="[STATES[state].color, !compact && 'mt-1']" />
    </UTooltip>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-x-2 gap-y-1" :class="compact ? 'flex-nowrap' : 'flex-wrap'">
        <span v-if="compact" class="shrink-0 font-mono text-xs text-muted" dir="ltr"
          >{{ repoName }}#{{ item.number }}</span
        >
        <span class="sr-only">{{ t(`item.${state}`) }}</span>
        <span
          class="text-[15px] leading-6 font-medium text-highlighted transition-colors group-hover:text-primary"
          :class="compact && 'truncate'"
          :dir="compact ? 'auto' : undefined"
          ><bdi>{{ item.title }}</bdi></span
        >
        <template v-if="settings.show.labels">
          <span
            v-for="label in item.labels"
            :key="label.name"
            class="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs text-toned ring-1 ring-default ring-inset"
          >
            <span
              class="size-2 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15"
              :style="{ background: `#${label.color}` }"
            />
            <bdi>{{ label.name }}</bdi>
          </span>
        </template>
      </div>

      <div v-if="!compact" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted">
        <span class="font-mono text-xs text-toned" dir="ltr"
          >{{ repoName }}<span class="text-muted">#{{ item.number }}</span></span
        >
        <span v-if="archived">{{ t('item.archived') }}</span>
        <span v-if="settings.show.author && item.author" class="inline-flex items-center gap-1.5">
          <UAvatar :src="item.author.avatarUrl" :alt="item.author.login" size="3xs" />
          <i18n-t keypath="item.by" tag="span" scope="global">
            <template #login>
              <bdi>{{ item.author.login }}</bdi>
            </template>
          </i18n-t>
        </span>
        <UTooltip :text="t('item.opened', { time: fullDate(item.createdAt) })">
          <span>{{ t('item.updated', { time: updated }) }}</span>
        </UTooltip>
        <span v-if="review" :class="review === 'approved' ? 'text-success' : 'text-error'">{{
          t(`filters.review.${review}`)
        }}</span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-4 text-xs text-muted" :class="!compact && 'h-6 self-start'">
      <span v-if="settings.show.checks" class="flex w-4 justify-center">
        <UTooltip v-if="checks" :text="t(`filters.checks.${checks}`)">
          <UIcon :name="CHECKS[checks].icon" class="size-4" :class="CHECKS[checks].color" />
        </UTooltip>
        <span v-if="checks" class="sr-only">{{ t(`filters.checks.${checks}`) }}</span>
      </span>
      <span v-if="settings.show.assignees" class="hidden w-14 justify-end sm:flex">
        <UTooltip
          v-if="item.assignees.length"
          :text="t('item.assignees', { names: formatList(item.assignees.map((person) => person.login)) })"
        >
          <UAvatarGroup size="2xs" :max="3">
            <UAvatar v-for="person in item.assignees" :key="person.login" :src="person.avatarUrl" :alt="person.login" />
          </UAvatarGroup>
        </UTooltip>
      </span>
      <span v-if="settings.show.comments" class="flex w-10 items-center justify-end gap-1 font-mono tabular-nums">
        <template v-if="item.comments">
          <UIcon name="i-octicon-comment-16" class="size-4" />
          <span aria-hidden="true">{{ formatNumber(item.comments) }}</span>
          <span class="sr-only">{{ t('item.comments', { n: formatNumber(item.comments) }, item.comments) }}</span>
        </template>
      </span>
    </div>
  </a>
</template>
