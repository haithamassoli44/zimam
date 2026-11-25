<script setup lang="ts">
// PROTOTYPE: the pull request's commits, newest last, with their checks and what's new since the last visit. Picking one
// shows its changes alone in the diff, and Shift picks the run from the one picked before. All the changes come first.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { useI18n } from 'vue-i18n'

import { roving } from '@/components/keys'
import { CHECK_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import { sheetOpen } from '@/components/pull/parts'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { isFresh, pull, scope, showAllChanges, showCommits, totals } from '@/stores/pull'

const { t } = useI18n()

const PICKED = 'bg-elevated before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-primary'
// The row's button covers the row, under its links, so a click anywhere else on it picks.
const COVER =
  'min-w-0 flex-1 text-start after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-primary'

// Where a run picked with Shift starts: the commit shown alone, or the one a run grew from.
let anchor: number | null = null
function pick(index: number, event: MouseEvent) {
  if (event.shiftKey) {
    const shown = scope.value
    anchor = shown && shown.from === shown.to ? shown.from : (anchor ?? shown?.from ?? index)
    showCommits(anchor, index)
  } else {
    anchor = index
    showCommits(index)
    // On a phone the sheet gives way to the diff, as a file picked from the tree does.
    sheetOpen.value = false
  }
}
function all() {
  anchor = null
  showAllChanges()
  sheetOpen.value = false
}
const arrows = roving('button[aria-pressed]')
const picked = (index: number) => !!scope.value && index >= scope.value.from && index <= scope.value.to
</script>

<template>
  <ul v-if="pull" class="pb-6 text-[13px]" @keydown="arrows">
    <li
      class="relative flex items-center gap-3 border-b border-default px-4 py-3 transition-colors"
      :class="!scope ? PICKED : 'hover:bg-elevated/60'"
    >
      <UIcon name="i-octicon-diff-16" class="size-5 shrink-0 text-muted" />
      <button type="button" :class="COVER" :aria-pressed="!scope" @click="all">
        <span class="block font-medium text-highlighted">{{ t('pull.scope.all') }}</span>
        <span class="text-muted">
          {{ t('pull.filesCount', { n: formatNumber(totals.files) }, totals.files) }}
          <span class="ms-1 font-mono text-[12px] tabular-nums" dir="ltr"
            >+{{ formatNumber(totals.additions) }} −{{ formatNumber(totals.deletions) }}</span
          >
        </span>
      </button>
    </li>
    <li
      v-for="(commit, index) in pull.commits"
      :key="commit.oid"
      class="relative flex items-start gap-3 border-b border-default px-4 py-3 transition-colors"
      :class="picked(index) ? PICKED : 'hover:bg-elevated/60'"
    >
      <span
        v-if="isFresh(commit.at)"
        class="absolute start-1.5 top-5 size-1.5 rounded-full bg-primary"
        aria-hidden="true"
      />
      <PersonLink
        :who="commit.author.login ? commit.author : null"
        :label="commit.author.login ?? commit.author.name"
        tabindex="-1"
        class="relative z-1 mt-0.5 flex shrink-0 rounded-full"
      >
        <UAvatar :src="commit.author.avatarUrl" alt="" size="2xs" />
      </PersonLink>
      <button type="button" :class="COVER" :aria-pressed="picked(index)" @click="pick(index, $event)">
        <bdi class="line-clamp-2 font-medium text-highlighted" dir="auto">{{ commit.headline }}</bdi>
        <span class="text-muted">
          <template v-if="commit.author.login !== pull.post.author?.login"
            ><bdi>{{ commit.author.login ?? commit.author.name }}</bdi> ·
          </template>
          <UTooltip :text="fullDate(commit.at)"
            ><span>{{ relativeTime(Date.parse(commit.at), now) }}</span></UTooltip
          >
          <span v-if="isFresh(commit.at)" class="ms-1 font-medium text-primary">{{ t('pull.new') }}</span>
        </span>
      </button>
      <UIcon
        v-if="commit.checks"
        :name="CHECK_LOOKS[commit.checks].icon"
        class="relative z-1 mt-0.5 size-4 shrink-0"
        :class="CHECK_LOOKS[commit.checks].color"
      />
      <a
        :href="`https://github.com/${pull.ref.repo}/pull/${pull.ref.number}/commits/${commit.oid}`"
        target="_blank"
        rel="noopener"
        :aria-label="t('pull.scope.onGitHub', { sha: commit.short })"
        class="relative z-1 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[12px] text-toned ring-1 ring-default transition-colors ring-inset hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
        >{{ commit.short }}</a
      >
    </li>
    <li v-if="pull.commitCount > pull.commits.length" class="px-4 py-3 text-[12px] text-muted">
      {{ t('pull.moreCommits', { n: formatNumber(pull.commitCount - pull.commits.length) }) }}
    </li>
    <li v-if="pull.commits.length > 1" class="px-4 py-3 text-[12px] text-muted pointer-coarse:hidden">
      {{ t('pull.scope.shift') }}
    </li>
  </ul>
</template>
