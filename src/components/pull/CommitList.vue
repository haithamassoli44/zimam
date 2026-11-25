<script setup lang="ts">
// The pull request's commits, newest last, with their checks, what's new since the last visit, and those viewed whole.
// Picking one shows its changes alone in the diff, and Shift picks the run from the one picked before. All the changes
// come first.
import UIcon from '@nuxt/ui/components/Icon.vue'
import { useI18n } from 'vue-i18n'

import { roving } from '@/components/keys'
import LineCounts from '@/components/LineCounts.vue'
import { CHECK_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import { toDiff } from '@/components/pull/navigation'
import ViewedMark from '@/components/pull/ViewedMark.vue'
import SkeletonLines from '@/components/SkeletonLines.vue'
import TimeAgo from '@/components/TimeAgo.vue'
import { commitUrl } from '@/lib/refs'
import { formatNumber } from '@/locale'
import { freshCommit, pull, scope, showAllChanges, showCommits, totals, viewedWhole } from '@/stores/pull'

const { t } = useI18n()

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
    toDiff()
  }
}
function all() {
  anchor = null
  showAllChanges()
  toDiff()
}
const arrows = roving('button[aria-pressed]')
const picked = (index: number) => !!scope.value && index >= scope.value.from && index <= scope.value.to
</script>

<template>
  <SkeletonLines v-if="!pull" :lines="8" :label="t('pull.loading')" class="p-4" />
  <ul v-else class="pb-6 text-[13px]" @keydown="arrows">
    <li
      class="relative flex items-center gap-3 border-b border-default px-4 py-3 transition-colors"
      :class="!scope ? 'picked' : 'hover:bg-elevated/60'"
    >
      <UIcon name="i-octicon-diff-16" class="size-5 shrink-0 text-muted" />
      <button type="button" class="cover min-w-0 flex-1 text-start" :aria-pressed="!scope" @click="all">
        <span class="block font-medium text-highlighted">{{ t('pull.scope.all') }}</span>
        <span class="text-muted">
          {{ t('pull.filesCount', { n: formatNumber(totals.files) }, totals.files) }}
          <LineCounts :additions="totals.additions" :deletions="totals.deletions" class="ms-1 text-[12px]" />
          <ViewedMark v-if="viewedWhole.all" class="ms-2" />
        </span>
      </button>
    </li>
    <li
      v-for="(commit, index) in pull.commits"
      :key="commit.oid"
      class="relative flex items-start gap-3 border-b border-default px-4 py-3 transition-colors"
      :class="picked(index) ? 'picked' : 'hover:bg-elevated/60'"
    >
      <span
        v-if="freshCommit(commit)"
        class="absolute start-1.5 top-5 size-1.5 rounded-full bg-primary"
        aria-hidden="true"
      />
      <PersonLink
        :who="commit.author"
        picture="2xs"
        :name="false"
        tabindex="-1"
        class="relative z-1 mt-0.5 flex shrink-0 rounded-full"
      />
      <button
        type="button"
        class="cover min-w-0 flex-1 text-start"
        :aria-pressed="picked(index)"
        @click="pick(index, $event)"
      >
        <bdi class="line-clamp-2 font-medium text-highlighted" dir="auto">{{ commit.headline }}</bdi>
        <span class="text-muted">
          <template v-if="commit.author.login !== pull.post.author?.login"
            ><bdi>{{ commit.author.login ?? commit.author.name }}</bdi> ·
          </template>
          <TimeAgo :at="commit.at" />
          <span v-if="freshCommit(commit)" class="ms-1 font-medium text-primary">{{ t('pull.new') }}</span>
          <ViewedMark v-if="viewedWhole.commits.has(commit.oid)" class="ms-2" />
        </span>
      </button>
      <UIcon
        v-if="commit.checks"
        :name="CHECK_LOOKS[commit.checks].icon"
        class="relative z-1 mt-0.5 size-4 shrink-0"
        :class="CHECK_LOOKS[commit.checks].color"
      />
      <a
        :href="commitUrl(pull.ref, commit.oid)"
        target="_blank"
        rel="noopener"
        :aria-label="t('pull.scope.onGitHub', { sha: commit.short })"
        class="relative z-1 shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[12px] text-toned ring-1 ring-default focus-ring transition-colors ring-inset hover:text-highlighted"
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
