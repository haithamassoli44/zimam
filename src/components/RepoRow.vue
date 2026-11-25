<script lang="ts">
import { BARS_WIDTH } from '@/components/WeekBars.vue'
import { COUNT_KEYS, type Count, type RepoSort } from '@/lib/repos'

// Totals stay quiet with an icon of what they count. What waits on someone reads clearly, and failing checks alone
// are red. Each count has a column of its own width on wide screens.
const LOOKS: Record<Count, { icon?: string; tone: string; width: string }> = {
  issues: { icon: 'i-octicon-issue-opened-16', tone: 'text-toned', width: '4.5rem' },
  prs: { icon: 'i-octicon-git-pull-request-16', tone: 'text-toned', width: '5rem' },
  awaiting: { tone: 'text-highlighted', width: '5rem' },
  failing: { tone: 'text-error', width: '4.5rem' },
  conflicts: { tone: 'text-highlighted', width: '4.5rem' },
}

/**
 * The repositories page's columns, in order, shared by its header and its rows. The header names each, and sorts by it
 * where that means something. The last holds the pin and the link.
 */
export const REPO_COLUMNS: { key: string; width: string; sort?: RepoSort; start?: boolean; named?: false }[] = [
  { key: 'name', width: 'minmax(0,1fr)', sort: 'name', start: true },
  { key: 'opened', width: `${BARS_WIDTH}px`, start: true },
  ...COUNT_KEYS.map((key) => ({ key, width: LOOKS[key].width, sort: key })),
  { key: 'activity', width: '6rem', sort: 'activity' },
  { key: 'actions', width: '3.25rem', named: false },
]
// The page sets the widths for its header and rows. Below this width the rows stack instead.
export const REPO_GRID = '@4xl:grid @4xl:grid-cols-(--repo-columns) @4xl:gap-x-3'
export const REPO_COLUMN_WIDTHS = { '--repo-columns': REPO_COLUMNS.map((column) => column.width).join(' ') }
</script>

<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { DOT } from '@/components/looks'
import WeekBars from '@/components/WeekBars.vue'
import { statusOf, type Filters } from '@/lib/filters'
import { COUNTS, TALLIED, type RepoRow } from '@/lib/repos'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { displayRepo } from '@/stores/data'
import { isPinned, togglePin } from '@/stores/repos'
import { itemsLink, showItems } from '@/stores/view'

const props = defineProps<{ row: RepoRow }>()
const emit = defineEmits<{ grab: [event: PointerEvent]; step: [by: -1 | 1] }>()
const { t } = useI18n()

const repo = computed(() => props.row.repo)
const pinned = computed(() => isPinned(repo.value.id))
const opened = computed(() =>
  t(props.row.weeksLoading ? 'repos.openedSoFar' : 'repos.opened', {
    n: formatNumber(props.row.weeks.reduce((sum, n) => sum + n, 0)),
  }),
)
const active = computed(() => (props.row.activeAt ? relativeTime(props.row.activeAt, now.value) : ''))

const only = computed<Partial<Filters>>(() => ({ repo: [repo.value.fullName], status: [statusOf(repo.value)] }))
// The name opens what is open in the repository. Nothing changes in an archived one, so it opens everything there.
const everything = computed<Partial<Filters>>(() => ({ ...only.value, ...(repo.value.isArchived && { state: [] }) }))

const counts = computed(() =>
  COUNT_KEYS.map((key) => ({
    key,
    ...LOOKS[key],
    count: props.row.counts[key],
    tallied: TALLIED.includes(key),
    loading: TALLIED.includes(key) && props.row.countsLoading,
    filters: { ...only.value, ...COUNTS[key].filters },
  })),
)
const totals = computed(() => counts.value.filter((count) => !count.tallied))
const tallied = computed(() => counts.value.filter((count) => count.tallied))
type Shown = (typeof counts.value)[number]

// A click opens the list in place. With a modifier key or the middle button, the browser opens the link itself.
function follow(event: MouseEvent, filters: Partial<Filters>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  showItems(filters)
}

const label = (count: Shown) =>
  `${t(`repos.columns.${count.key}`)}: ${count.loading ? t('repos.loading') : formatNumber(count.count)}`
const LINK = 'rounded-sm hover:underline focus-ring'

// The pin and the link to GitHub sit by the name on narrow screens, and in a column of their own on wide ones. They show
// on hover, and always on a touch screen, but a pinned repository's pin always shows. Its handle sits with them on
// narrow screens, away from the edge, where a swipe would go back a page, and at the start of the row on wide ones.
const BUTTON = { color: 'neutral', variant: 'ghost', size: 'xs' } as const
const pin = computed(() => ({
  ...BUTTON,
  icon: 'i-octicon-pin-16',
  class: !pinned.value && 'reveal',
  'aria-label': t('repos.pinLabel', { name: repo.value.fullName }),
  'aria-pressed': pinned.value,
  ui: { leadingIcon: pinned.value ? 'text-highlighted' : 'text-muted' },
  onClick: () => togglePin(repo.value.id),
}))
const handle = computed(() => ({
  'aria-label': t('repos.move', { name: repo.value.fullName }),
  onPointerdown: (event: PointerEvent) => emit('grab', event),
  onKeydown: (event: KeyboardEvent) => {
    const by = ({ ArrowUp: -1, ArrowDown: 1 } as const)[event.key as 'ArrowUp' | 'ArrowDown']
    if (!by) return
    event.preventDefault()
    emit('step', by)
  },
}))
const link = computed(() => ({
  ...BUTTON,
  href: `https://github.com/${repo.value.fullName}`,
  target: '_blank',
  rel: 'noopener',
  icon: 'i-octicon-link-external-16',
  class: 'reveal',
  'aria-label': t('repos.onGitHub', { name: repo.value.fullName }),
  ui: { leadingIcon: 'text-muted' },
}))
</script>

<template>
  <div
    class="group relative border-b border-default px-4 py-3 transition-colors hover:bg-elevated/60 sm:px-6 @4xl:items-center @4xl:py-2.5"
    :class="REPO_GRID"
  >
    <button
      v-if="pinned"
      v-bind="handle"
      type="button"
      class="absolute inset-y-0 start-0 hidden w-6 cursor-grab touch-none items-center justify-center text-dimmed focus-ring-inset transition-colors hover:text-toned focus-visible:text-highlighted @4xl:flex"
    >
      <UIcon name="i-octicon-grabber-16" class="size-4" />
    </button>
    <div class="min-w-0">
      <div class="flex min-w-0 items-center gap-2">
        <a
          :href="itemsLink(everything)"
          class="min-w-0 truncate rounded-sm text-[15px] leading-6 font-medium text-highlighted focus-ring transition-colors hover:text-primary"
          @click="follow($event, everything)"
          ><bdi>{{ displayRepo(repo.fullName) }}</bdi></a
        >
        <UTooltip v-if="repo.isPrivate" :text="t('repos.private')">
          <UIcon name="i-octicon-lock-16" class="size-4 shrink-0 text-muted" />
        </UTooltip>
        <span v-if="repo.isPrivate" class="sr-only">{{ t('repos.private') }}</span>
        <span
          v-if="repo.isArchived"
          class="inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs text-toned ring-1 ring-default ring-inset"
          >{{ t('item.archived') }}</span
        >
        <div class="ms-auto flex shrink-0 items-center gap-0.5 @4xl:hidden">
          <UButton
            v-if="pinned"
            v-bind="{ ...BUTTON, ...handle }"
            icon="i-octicon-grabber-16"
            class="cursor-grab touch-none"
            :ui="{ leadingIcon: 'text-muted' }"
          />
          <UTooltip :text="pinned ? t('repos.unpin') : t('repos.pin')"><UButton v-bind="pin" /></UTooltip>
          <UButton v-bind="link" />
        </div>
      </div>
      <div
        v-if="repo.description || repo.language"
        class="mt-0.5 flex min-w-0 items-center gap-3 text-[13px] leading-5 text-muted"
      >
        <span v-if="repo.description" class="truncate" dir="auto">{{ repo.description }}</span>
        <span v-if="repo.language" class="hidden shrink-0 items-center gap-1.5 sm:inline-flex">
          <span :class="DOT" :style="{ background: repo.language.color ?? 'currentColor' }" />
          <bdi>{{ repo.language.name }}</bdi>
        </span>
      </div>

      <!-- Narrow screens: the counts under the name, the weeks at the end. -->
      <div class="mt-2 flex items-end gap-4 @4xl:hidden">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-5 text-muted">
          <a
            v-for="count in totals"
            :key="count.key"
            :href="itemsLink(count.filters)"
            class="inline-flex items-center gap-1.5 text-toned"
            :class="LINK"
            :aria-label="label(count)"
            @click="follow($event, count.filters)"
          >
            <UIcon :name="count.icon!" class="size-4 text-muted" />
            <span class="font-mono tabular-nums">{{ formatNumber(count.count) }}</span>
          </a>
          <span v-if="row.countsLoading" class="inline-flex">
            <span class="h-3 w-24 animate-pulse rounded-md bg-elevated" aria-hidden="true" />
            <span v-for="count in tallied" :key="count.key" class="sr-only">{{ label(count) }}</span>
          </span>
          <template v-for="count in tallied" v-else :key="count.key">
            <a
              v-if="count.count"
              :href="itemsLink(count.filters)"
              :class="[LINK, count.tone]"
              @click="follow($event, count.filters)"
              >{{ t(`repos.${count.key}Count`, { n: formatNumber(count.count) }) }}</a
            >
          </template>
          <UTooltip v-if="active" :text="fullDate(row.activeAt)">
            <span>{{ active }}</span>
          </UTooltip>
        </div>
        <UTooltip :text="opened">
          <span class="flex" :aria-label="opened" role="img"
            ><WeekBars :weeks="row.weeks" :loading="row.weeksLoading"
          /></span>
        </UTooltip>
      </div>
    </div>

    <!-- Wide screens: one column each. -->
    <UTooltip :text="opened">
      <span class="hidden @4xl:flex" :aria-label="opened" role="img"
        ><WeekBars :weeks="row.weeks" :loading="row.weeksLoading"
      /></span>
    </UTooltip>
    <template v-for="count in counts" :key="count.key">
      <span v-if="count.loading" class="hidden justify-self-end @4xl:block">
        <span class="block h-3 w-6 animate-pulse rounded-md bg-elevated" aria-hidden="true" />
        <span class="sr-only">{{ label(count) }}</span>
      </span>
      <a
        v-else-if="count.count"
        :href="itemsLink(count.filters)"
        class="hidden justify-self-end font-mono text-[13px] tabular-nums @4xl:block"
        :class="[LINK, count.tone]"
        :aria-label="label(count)"
        @click="follow($event, count.filters)"
        >{{ formatNumber(count.count) }}</a
      >
      <span v-else class="hidden justify-self-end font-mono text-[13px] text-muted opacity-60 @4xl:block">
        <span aria-hidden="true">–</span>
        <span class="sr-only">{{ label(count) }}</span>
      </span>
    </template>
    <UTooltip v-if="active" :text="fullDate(row.activeAt)">
      <span class="hidden justify-self-end text-[13px] whitespace-nowrap text-muted @4xl:block">{{ active }}</span>
    </UTooltip>
    <span v-else class="hidden @4xl:block" />
    <div class="hidden items-center gap-0.5 justify-self-end @4xl:flex">
      <UTooltip :text="pinned ? t('repos.unpin') : t('repos.pin')"><UButton v-bind="pin" /></UTooltip>
      <UButton v-bind="link" />
    </div>
  </div>
</template>
