<script setup lang="ts">
// PROTOTYPE: the conversation: the description, comments, reviews with their threads, and the events that matter to a
// reviewer, with a line where what's new since the last visit starts.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS, VERDICT_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import PostBlock from '@/components/pull/PostBlock.vue'
import ThreadCard from '@/components/pull/ThreadCard.vue'
import type { Entry } from '@/lib/pull'
import { isPost, reviewerWho } from '@/lib/pull'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { isFresh, markTime, pull, shownEntries } from '@/stores/pull'
import { postLook } from '@/stores/settings'

const { t } = useI18n()

/** The entries that are things that happened, not posts or pushes. */
type Happening = Exclude<Entry, { kind: 'comment' | 'review' | 'commits' }>

const EVENT_ICON: Record<Happening['kind'], string> = {
  forcePushed: 'i-octicon-repo-push-16',
  ready: 'i-octicon-eye-16',
  draft: 'i-octicon-git-pull-request-draft-16',
  closed: 'i-octicon-git-pull-request-closed-16',
  reopened: 'i-octicon-git-pull-request-16',
  autoMerge: 'i-octicon-git-merge-queue-16',
  requested: 'i-octicon-person-add-16',
  unrequested: 'i-octicon-person-16',
  dismissed: 'i-octicon-x-circle-16',
  renamed: 'i-octicon-pencil-16',
  rebased: 'i-octicon-git-branch-16',
  merged: 'i-octicon-git-merge-16',
}

const lookOf = (entry: Entry) => (isPost(entry) ? postLook(entry.post.author) : 'show')
/** A push lists this many of its commits; the commits part has them all. */
const PUSHED = 3

// The first entry newer than the last visit gets the line above it.
const firstFresh = computed(() => {
  if (markTime.value === null) return null
  return shownEntries.value.find((entry) => isFresh(entry.at))?.id ?? null
})

const ago = (time: string) => relativeTime(Date.parse(time), now.value)

/** The words an event's sentence puts beside the people in it, who are links. */
function wordsOf(entry: Happening): { from: string; to: string; into: string; commit: string } {
  const none = { from: '', to: '', into: '', commit: '' }
  if (entry.kind === 'forcePushed') return { ...none, from: entry.before ?? '?', to: entry.after ?? '?' }
  if (entry.kind === 'renamed' || entry.kind === 'rebased') return { ...none, from: entry.from, to: entry.to }
  if (entry.kind === 'merged') return { ...none, into: entry.into, commit: entry.commit ?? '' }
  return none
}
const whomOf = (entry: Happening) =>
  entry.kind === 'requested' || entry.kind === 'unrequested' ? reviewerWho(entry.reviewer) : null
const whoseOf = (entry: Happening) => (entry.kind === 'dismissed' && entry.whose ? { login: entry.whose } : null)

const verdictText = (entry: Extract<Entry, { kind: 'review' }>) => t(`pull.verdicts.${entry.verdict}`)
</script>

<template>
  <div v-if="pull" class="pb-10">
    <article class="p-4">
      <PostBlock :post="pull.post" :action="t('pull.opened')" />
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
        <PostBlock :post="entry.post" :look="lookOf(entry)" />
      </article>

      <article v-else-if="entry.kind === 'review'" class="border-t border-default px-4 py-4">
        <PostBlock :post="entry.post" :action="verdictText(entry)" :look="lookOf(entry)" />
        <div v-if="!entry.post.html && lookOf(entry) === 'show'" class="mt-1 flex items-center gap-1.5 text-[13px]">
          <UIcon :name="VERDICT_LOOKS[entry.verdict].icon" class="size-4" :class="VERDICT_LOOKS[entry.verdict].color" />
        </div>
        <div v-if="entry.threads.length && lookOf(entry) === 'show'" class="mt-3 space-y-3">
          <ThreadCard v-for="thread in entry.threads" :key="thread.id" :thread="thread" snippet where />
        </div>
        <p v-else-if="entry.threads.length" class="mt-2 text-[12px] text-muted">
          {{ t('pull.botThreads', { n: formatNumber(entry.threads.length) }, entry.threads.length) }}
        </p>
      </article>

      <div v-else-if="entry.kind === 'commits'" class="border-t border-default px-4 py-3">
        <p class="flex items-center gap-2 text-[13px] text-muted">
          <UIcon name="i-octicon-git-commit-16" class="size-4" />
          <PersonLink :who="entry.commits[0].author" class="text-toned"
            ><bdi>{{ entry.commits[0].author.login ?? entry.commits[0].author.name }}</bdi></PersonLink
          >
          {{ t('pull.events.pushed', { n: formatNumber(entry.commits.length) }, entry.commits.length) }}
          <UTooltip :text="fullDate(entry.at)"
            ><span>{{ ago(entry.at) }}</span></UTooltip
          >
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
          :name="EVENT_ICON[entry.kind]"
          class="mt-0.5 size-4 shrink-0"
          :class="entry.kind === 'merged' && 'text-merged'"
        />
        <span class="min-w-0 flex-1">
          <i18n-t :keypath="`pull.events.${entry.kind}`" tag="bdi" scope="global">
            <template #who>
              <PersonLink :who="entry.actor" class="text-toned">
                <UAvatar
                  v-if="entry.actor"
                  :src="entry.actor.avatarUrl"
                  alt=""
                  size="3xs"
                  class="me-1.5 align-[-3px]"
                /><bdi>{{ entry.actor?.login ?? t('issue.ghost') }}</bdi>
              </PersonLink>
            </template>
            <template #whom>
              <PersonLink :who="whomOf(entry)" class="text-toned"
                ><bdi>{{ whomOf(entry)?.login ?? t('issue.ghost') }}</bdi></PersonLink
              >
            </template>
            <template #whose>
              <PersonLink :who="whoseOf(entry)" class="text-toned"
                ><bdi>{{ whoseOf(entry)?.login ?? t('issue.ghost') }}</bdi></PersonLink
              >
            </template>
            <template #from>{{ wordsOf(entry).from }}</template>
            <template #to>{{ wordsOf(entry).to }}</template>
            <template #into>{{ wordsOf(entry).into }}</template>
            <template #commit>{{ wordsOf(entry).commit }}</template>
          </i18n-t>
          ·
          <UTooltip :text="fullDate(entry.at)"
            ><span>{{ ago(entry.at) }}</span></UTooltip
          >
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
        class="inline-flex items-center gap-1 rounded-sm font-medium text-toned transition-colors hover:text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {{ t('pull.reviewOnGitHub') }}<UIcon name="i-octicon-link-external-16" class="size-4" />
      </a>
    </p>
  </div>
</template>
