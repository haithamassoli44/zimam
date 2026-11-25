<script setup lang="ts">
// The conversation: the description, comments, reviews with their threads, and the events that matter to a
// reviewer, with a line where what's new since the last visit starts.
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import PostBlock from '@/components/PostBlock.vue'
import { EVENT_LOOKS, VERDICT_LOOKS, type Happening } from '@/components/pull/looks'
import ThreadCard from '@/components/pull/ThreadCard.vue'
import TimeAgo from '@/components/TimeAgo.vue'
import type { Entry } from '@/lib/pull'
import { formatNumber } from '@/locale'
import { isFresh, markTime, pull, shownEntries } from '@/stores/pull'

const { t } = useI18n()

/** A push lists this many of its commits; the commits part has them all. */
const PUSHED = 3

const firstFresh = computed(() => {
  if (markTime.value === null) return null
  return shownEntries.value.find((entry) => isFresh(entry.at))?.id ?? null
})

/** The words an event's sentence puts beside the people in it, who are links. */
function wordsOf(entry: Happening): { from: string; to: string; into: string; commit: string } {
  const none = { from: '', to: '', into: '', commit: '' }
  if (entry.kind === 'forcePushed') return { ...none, from: entry.before ?? '?', to: entry.after ?? '?' }
  if (entry.kind === 'renamed' || entry.kind === 'rebased') return { ...none, from: entry.from, to: entry.to }
  if (entry.kind === 'merged') return { ...none, into: entry.into, commit: entry.commit ?? '' }
  return none
}
const whomOf = (entry: Happening) =>
  entry.kind === 'requested' || entry.kind === 'unrequested' ? entry.reviewer : null
const whoseOf = (entry: Happening) => (entry.kind === 'dismissed' && entry.whose ? { login: entry.whose } : null)

const verdictText = (entry: Extract<Entry, { kind: 'review' }>) => t(`pull.verdicts.${entry.verdict}`)
</script>

<template>
  <div v-if="pull" class="pb-10">
    <article class="p-4">
      <PostBlock
        :post="pull.post"
        place="description"
        :action="t('pull.opened')"
        :fresh="isFresh(pull.post.createdAt)"
      />
      <p v-if="!pull.post.html" class="mt-2 text-[13px] text-muted">{{ t('pull.noDescription') }}</p>
    </article>

    <template v-for="entry in shownEntries" :key="entry.id">
      <div
        v-if="entry.id === firstFresh"
        class="flex items-center gap-3 px-4 py-1 text-[12px] font-medium text-primary"
      >
        <span class="h-px flex-1 bg-primary/40" />{{ t('pull.since.line') }}<span class="h-px flex-1 bg-primary/40" />
      </div>

      <article v-if="entry.kind === 'comment'" class="border-t border-default px-4 py-4">
        <PostBlock :post="entry.post" place="conversation" :fresh="isFresh(entry.at)" />
      </article>

      <article v-else-if="entry.kind === 'review'" class="border-t border-default px-4 py-4">
        <PostBlock :post="entry.post" place="conversation" :action="verdictText(entry)" :fresh="isFresh(entry.at)">
          <div v-if="!entry.post.html" class="mt-1 flex items-center gap-1.5 text-[13px]">
            <UIcon
              :name="VERDICT_LOOKS[entry.verdict].icon"
              class="size-4"
              :class="VERDICT_LOOKS[entry.verdict].color"
            />
          </div>
          <div v-if="entry.threads.length" class="mt-3 space-y-3">
            <ThreadCard v-for="thread in entry.threads" :key="thread.id" :thread="thread" place="conversation" />
          </div>
        </PostBlock>
      </article>

      <div v-else-if="entry.kind === 'commits'" class="border-t border-default px-4 py-3">
        <p class="flex items-center gap-2 text-[13px] text-muted">
          <UIcon name="i-octicon-git-commit-16" class="size-4" />
          <PersonLink :who="entry.commits[0].author" :picture="false" class="text-toned" />
          {{ t('pull.events.pushed', { n: formatNumber(entry.commits.length) }, entry.commits.length) }}
          <TimeAgo :at="entry.at" />
          <span v-if="isFresh(entry.at)" class="text-[12px] font-medium text-primary">{{ t('pull.new') }}</span>
        </p>
        <ul class="mt-2 space-y-1 ps-6">
          <li
            v-for="commit in entry.commits.slice(0, PUSHED)"
            :key="commit.oid"
            class="flex items-center gap-2 text-[13px]"
          >
            <UIcon
              v-if="commit.checks"
              :name="CHECK_LOOKS[commit.checks].icon"
              class="size-3.5 shrink-0"
              :class="CHECK_LOOKS[commit.checks].color"
            />
            <span v-else class="size-3.5 shrink-0" />
            <bdi class="min-w-0 flex-1 truncate text-toned" dir="auto">{{ commit.headline }}</bdi>
            <code class="shrink-0 font-mono text-[11px] text-muted">{{ commit.short }}</code>
          </li>
          <li v-if="entry.commits.length > PUSHED" class="text-[12px] text-muted">
            {{ t('pull.moreCommits', { n: formatNumber(entry.commits.length - PUSHED) }) }}
          </li>
        </ul>
      </div>

      <p v-else class="flex items-start gap-2 border-t border-default px-4 py-3 text-[13px] text-muted">
        <UIcon
          :name="EVENT_LOOKS[entry.kind].icon"
          class="mt-0.5 size-4 shrink-0"
          :class="EVENT_LOOKS[entry.kind].color"
        />
        <span class="min-w-0 flex-1">
          <i18n-t :keypath="`pull.events.${entry.kind}`" tag="bdi" scope="global">
            <template #who>
              <PersonLink :who="entry.actor" class="align-bottom text-toned" />
            </template>
            <template #whom>
              <PersonLink :who="whomOf(entry)" :picture="false" class="text-toned" />
            </template>
            <template #whose>
              <PersonLink :who="whoseOf(entry)" :picture="false" class="text-toned" />
            </template>
            <template #from>{{ wordsOf(entry).from }}</template>
            <template #to>{{ wordsOf(entry).to }}</template>
            <template #into>{{ wordsOf(entry).into }}</template>
            <template #commit>{{ wordsOf(entry).commit }}</template>
          </i18n-t>
          ·
          <TimeAgo :at="entry.at" />
          <span v-if="isFresh(entry.at)" class="ms-1 text-[12px] font-medium text-primary">{{ t('pull.new') }}</span>
        </span>
      </p>
    </template>

    <p class="flex flex-wrap items-center gap-x-1.5 border-t border-default px-4 pt-4 text-[13px] text-muted">
      {{ t('issue.readOnly') }}
      <span aria-hidden="true">·</span>
      <a
        :href="pull.url"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 rounded-sm font-medium text-toned focus-ring transition-colors hover:text-highlighted hover:underline"
      >
        {{ t('pull.reviewOnGitHub') }}<UIcon name="i-octicon-link-external-16" class="size-4" />
      </a>
    </p>
  </div>
</template>
