<script lang="ts">
// Follows the padding and line heights in the template below: change them together.
export const ROW_HEIGHT = { compact: 41, comfortable: 73 } as const
</script>

<script setup lang="ts">
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import CheckRuns from '@/components/CheckRuns.vue'
import LabelTag from '@/components/LabelTag.vue'
import { CHECK_LOOKS, ISSUE_LOOKS, PULL_LOOKS, REVIEW_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import { stateOf } from '@/lib/queries'
import { formatList, formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { FRESH_MS, itemRef } from '@/stores/data'
import { settings } from '@/stores/settings'
import { openIssue, showIssue, showPull } from '@/stores/view'
import type { Item } from '@/types'

const props = defineProps<{ item: Item; repoName: string; archived?: boolean; fresh?: boolean; opened?: boolean }>()
const { t } = useI18n()
const link = useTemplateRef<HTMLElement>('link')

const compact = computed(() => settings.density === 'compact')
const open = computed(() => props.item.state === 'open')

const state = computed(() => {
  const { item } = props
  if (item.kind === 'issue') {
    const value = stateOf(item)
    return { look: ISSUE_LOOKS[value], text: t(`item.issue.${value}`) }
  }
  const value = item.state === 'open' ? (item.review === 'draft' ? 'draft' : 'open') : item.state
  return { look: PULL_LOOKS[value], text: t(`item.pr.${value}`) }
})

const conflicts = computed(() => props.item.merge === 'conflicts')
const stateText = computed(() =>
  conflicts.value ? t('item.conflicting', { state: state.value.text }) : state.value.text,
)

// A draft says so by its icon, and a review no branch rule asks for says nothing.
const ROW_REVIEWS = ['approved', 'changes', 'required'] as const
const review = computed(() => {
  const value = props.item.review
  return open.value && value && (ROW_REVIEWS as readonly string[]).includes(value)
    ? (value as (typeof ROW_REVIEWS)[number])
    : null
})
const diff = computed(() => (open.value && settings.show.size ? props.item.diff : null))
const updated = computed(() => relativeTime(Date.parse(props.item.updatedAt), now.value))

// Three faces, then a count of the rest.
const FACES = 3
const faces = computed(() => props.item.assignees.slice(0, FACES))
const moreFaces = computed(() => props.item.assignees.slice(FACES).map((person) => person.login))

const LABELS = 3
const labels = computed(() => props.item.labels.slice(0, LABELS))
const moreLabels = computed(() => props.item.labels.slice(LABELS).map((label) => label.name))

// An issue opens in Zimam's issue panel, and a pull request on its own page (PROTOTYPE), at its files. Clicked with a
// key held or the middle button, either opens on GitHub in a new tab.
function read(event: MouseEvent): boolean {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false
  const ref = itemRef(props.item)
  if (!ref) return false
  if (props.item.kind === 'pr') showPull(ref, 'files')
  else showIssue(ref)
  return true
}

// The row holds a button, so it can't be one link. The title is the link, and a click elsewhere on the row follows it,
// unless it ends a text selection.
function follow(event: MouseEvent) {
  if (event.button > 1 || (event.target as Element).closest('a, button')) return
  if (getSelection()?.toString()) return
  if (!read(event)) window.open(props.item.url, '_blank', 'noopener')
}

function clickTitle(event: MouseEvent) {
  if (read(event)) event.preventDefault()
}

// The panel beside the list takes the focus it had with it when it closes, and the focus comes back to the issue's row.
// Over the list, the dialog gives it back itself.
watch(
  () => props.opened,
  (opened, was) => {
    if (was && !opened && !openIssue.value && document.activeElement === document.body) {
      link.value?.focus({ preventScroll: true })
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    class="group relative flex cursor-pointer gap-3 border-b border-default px-4 transition-colors has-[a[data-row]:focus-visible]:bg-elevated has-[a[data-row]:focus-visible]:outline-2 has-[a[data-row]:focus-visible]:-outline-offset-2 has-[a[data-row]:focus-visible]:outline-primary sm:px-6"
    :class="[
      compact ? 'items-center py-2' : 'py-3',
      fresh && 'arrived',
      opened
        ? 'bg-elevated before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-primary'
        : 'hover:bg-elevated/60',
    ]"
    :style="fresh ? { '--fresh': `${FRESH_MS}ms` } : undefined"
    @click="follow"
    @auxclick="follow"
  >
    <span
      v-if="fresh"
      class="absolute start-1.5 size-1.5 -translate-y-1/2 rounded-full bg-primary sm:start-2.5"
      :class="compact ? 'top-1/2' : 'top-6'"
      aria-hidden="true"
    />

    <UTooltip :text="stateText">
      <span class="relative flex shrink-0" :class="!compact && 'mt-1 self-start'">
        <UIcon :name="state.look.icon" class="size-4" :class="state.look.color" />
        <span
          v-if="conflicts"
          class="absolute -end-0.5 -bottom-0.5 size-2 rounded-full bg-error ring-2 ring-(--ui-bg) transition-colors group-hover:ring-(--ui-bg-elevated)"
        />
      </span>
    </UTooltip>

    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-x-2 gap-y-1" :class="compact ? 'flex-nowrap' : 'flex-wrap'">
        <span v-if="compact" class="shrink-0 font-mono text-xs text-muted" dir="ltr"
          >{{ repoName }}#{{ item.number }}</span
        >
        <!-- A compact title takes its direction from its own words. The hidden state text has a direction of its own, so it
             doesn't count, and neither would a title in <bdi>. -->
        <a
          ref="link"
          :href="item.url"
          target="_blank"
          rel="noopener"
          data-row
          :aria-current="opened || undefined"
          class="text-[15px] leading-6 font-medium text-highlighted transition-colors group-hover:text-primary focus-visible:outline-none"
          :class="compact && 'truncate'"
          :dir="compact ? 'auto' : undefined"
          @click="clickTitle"
          ><span class="sr-only" dir="auto">{{ stateText }}: </span><template v-if="compact">{{ item.title }}</template
          ><bdi v-else>{{ item.title }}</bdi></a
        >
        <template v-if="settings.show.labels">
          <LabelTag v-for="label in labels" :key="label.name" :label="label" class="shrink-0" />
          <UTooltip v-if="moreLabels.length" :text="formatList(moreLabels)">
            <span class="inline-flex h-5 shrink-0 items-center font-mono text-xs text-muted tabular-nums">
              <span aria-hidden="true">+{{ formatNumber(moreLabels.length) }}</span>
              <span class="sr-only">{{ t('item.moreLabels', { names: formatList(moreLabels) }) }}</span>
            </span>
          </UTooltip>
        </template>
      </div>

      <div v-if="!compact" class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-5 text-muted">
        <span class="font-mono text-xs text-toned" dir="ltr"
          >{{ repoName }}<span class="text-muted">#{{ item.number }}</span></span
        >
        <span v-if="archived">{{ t('item.archived') }}</span>
        <!-- Out of the Tab order, like the row's other parts: the title is the row's one stop. -->
        <i18n-t v-if="settings.show.author && item.author" keypath="item.by" tag="span" scope="global">
          <template #login>
            <PersonLink :who="item.author" tabindex="-1" class="inline-flex items-center gap-1.5 align-bottom">
              <UAvatar :src="item.author.avatarUrl" alt="" size="3xs" />
              <bdi>{{ item.author.login }}</bdi>
            </PersonLink>
          </template>
        </i18n-t>
        <UTooltip :text="t('item.opened', { time: fullDate(item.createdAt) })">
          <span>{{ t('item.updated', { time: updated }) }}</span>
        </UTooltip>
        <span v-if="diff" class="font-mono text-xs tabular-nums" dir="ltr">
          <span aria-hidden="true">+{{ formatNumber(diff.additions) }} −{{ formatNumber(diff.deletions) }}</span>
          <span class="sr-only">{{
            t('item.diff', { added: formatNumber(diff.additions), removed: formatNumber(diff.deletions) })
          }}</span>
        </span>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-4 text-xs text-muted" :class="!compact && 'h-6 self-start'">
      <span v-if="settings.show.review" class="flex w-4 justify-center" :class="!review && 'max-sm:hidden'">
        <UTooltip v-if="review" :text="t(`filters.review.${review}`)">
          <UIcon :name="REVIEW_LOOKS[review].icon" class="size-4" :class="REVIEW_LOOKS[review].color" />
        </UTooltip>
        <span v-if="review" class="sr-only">{{ t(`filters.review.${review}`) }}</span>
      </span>
      <span v-if="settings.show.checks" class="flex w-4 justify-center">
        <!-- Modal, so the click that closes it doesn't also open the row it lands on. -->
        <UPopover v-if="item.checks" modal :content="{ align: 'end' }">
          <UTooltip :text="t(`filters.checks.${item.checks}`)">
            <button
              type="button"
              class="tap flex rounded-sm transition-colors hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :aria-label="t('checks.show', { state: t(`filters.checks.${item.checks}`) })"
            >
              <UIcon :name="CHECK_LOOKS[item.checks].icon" class="size-4" :class="CHECK_LOOKS[item.checks].color" />
            </button>
          </UTooltip>
          <template #content>
            <CheckRuns :item="item" />
          </template>
        </UPopover>
      </span>
      <span v-if="settings.show.assignees" class="hidden w-14 justify-end sm:flex">
        <span v-if="item.assignees.length" class="flex flex-row-reverse items-center">
          <span class="sr-only">{{
            t('item.assignees', { names: formatList(item.assignees.map((p) => p.login)) })
          }}</span>
          <UTooltip v-if="moreFaces.length" :text="formatList(moreFaces)">
            <span
              class="relative -ms-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-elevated px-1 font-mono text-[10px] text-toned ring-2 ring-(--ui-bg) group-hover:ring-(--ui-bg-elevated)"
              aria-hidden="true"
              >+{{ formatNumber(moreFaces.length) }}</span
            >
          </UTooltip>
          <PersonLink
            v-for="person in faces.toReversed()"
            :key="person.login"
            :who="person"
            :label="person.login"
            tabindex="-1"
            aria-hidden="true"
            class="relative -ms-1.5 flex rounded-full last:ms-0 hover:z-1"
          >
            <UAvatar
              :src="person.avatarUrl"
              alt=""
              size="2xs"
              class="ring-2 ring-(--ui-bg) transition-colors group-hover:ring-(--ui-bg-elevated)"
            />
          </PersonLink>
        </span>
      </span>
      <span v-if="settings.show.comments" class="flex w-10 items-center justify-end gap-1 font-mono tabular-nums">
        <template v-if="item.comments">
          <UIcon name="i-octicon-comment-16" class="size-4" />
          <span aria-hidden="true">{{ formatNumber(item.comments) }}</span>
          <span class="sr-only">{{ t('item.comments', { n: formatNumber(item.comments) }, item.comments) }}</span>
        </template>
      </span>
    </div>
  </div>
</template>
