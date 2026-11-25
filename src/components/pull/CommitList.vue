<script setup lang="ts">
// PROTOTYPE: the pull request's commits, newest last, with their checks and what's new since the last visit.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS } from '@/components/looks'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { isFresh, pull } from '@/stores/pull'

const { t } = useI18n()
</script>

<template>
  <ul v-if="pull" class="pb-6">
    <li
      v-for="commit in pull.commits"
      :key="commit.oid"
      class="flex items-start gap-3 border-b border-default px-4 py-3 text-[13px]"
      :class="isFresh(commit.at) && 'shadow-[inset_3px_0_0_var(--ui-primary)]'"
    >
      <UAvatar :src="commit.author.avatarUrl" alt="" size="2xs" class="mt-0.5" />
      <div class="min-w-0 flex-1">
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
      </div>
      <UIcon
        v-if="commit.checks"
        :name="CHECK_LOOKS[commit.checks].icon"
        class="mt-0.5 size-4 shrink-0"
        :class="CHECK_LOOKS[commit.checks].color"
      />
      <a
        :href="`https://github.com/${pull.ref.repo}/pull/${pull.ref.number}/commits/${commit.oid}`"
        target="_blank"
        rel="noopener"
        class="shrink-0 rounded-sm px-1.5 py-0.5 font-mono text-[12px] text-toned ring-1 ring-default transition-colors ring-inset hover:text-highlighted"
        >{{ commit.short }}</a
      >
    </li>
    <li v-if="pull.commitCount > pull.commits.length" class="px-4 py-3 text-[12px] text-muted">
      {{ t('pull.moreCommits', { n: formatNumber(pull.commitCount - pull.commits.length) }) }}
    </li>
  </ul>
</template>
