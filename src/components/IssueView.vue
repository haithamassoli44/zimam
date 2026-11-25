<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { kbds, useKeys } from '@/components/keys'
import LabelTag from '@/components/LabelTag.vue'
import { ISSUE_LOOKS } from '@/components/looks'
import PersonLink from '@/components/PersonLink.vue'
import PostBlock from '@/components/PostBlock.vue'
import TimeAgo from '@/components/TimeAgo.vue'
import { expiring, IssueMissing, nextPage, type Thread } from '@/lib/issue'
import type { Post } from '@/lib/posts'
import { stateOf } from '@/lib/queries'
import { issueUrl, refKey, sameRef, type IssueRef } from '@/lib/refs'
import { formatNumber } from '@/locale'
import { displayRepo, issueRef, issueThread, items, loaded, moreComments } from '@/stores/data'
import { postShown } from '@/stores/settings'
import { closeIssue, neighborsIn, openIssue, showIssue } from '@/stores/view'

/**
 * An issue, read-only: its description and comments, with a way to the next one in the list. `opener` is what had the
 * focus as it opened.
 */
const props = defineProps<{ issue: IssueRef; docked?: boolean; opener?: Element | null }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const scroller = useTemplateRef<HTMLElement>('scroller')
const heading = useTemplateRef<HTMLElement>('heading')

// The list's copy of the issue. When it changes there, the issue is read again.
const listed = computed(() => [...items.value.values()].find((item) => sameRef(issueRef(item), props.issue)))
const version = computed(() => listed.value?.updatedAt ?? '')

// ↑ and ↓ go through the issues the list shows, in its order, past its pull requests.
const around = neighborsIn('issue', () => props.issue)
const previous = computed(() => around.value.previous)
const next = computed(() => around.value.next)

function move(by: -1 | 1) {
  const issue = by === 1 ? next.value : previous.value
  if (issue) showIssue(issue)
}
// While the panel slides away, the keys go to the list again.
useKeys(
  { issues: [() => (openIssue.value ? move(1) : false), () => (openIssue.value ? move(-1) : false)] },
  { level: 'panel', root },
)

const thread = shallowRef<Thread | null>(null)
// Going to another issue leaves the last one in sight, dimmed, while the next is read, so a quick read goes straight
// from one to the other. Only a slow one shows the placeholder.
const stale = ref(false)
const STALE_MS = 400
let staleTimer = 0
function fresh(answer: Thread | null) {
  clearTimeout(staleTimer)
  thread.value = answer
  stale.value = false
}
const problem = ref<'missing' | 'failed' | null>(null)
const loadingMore = ref(false)
const moreFailed = ref(false)
let ticket = 0
let moreTicket = 0
let loadingMoreNow: Promise<void> | null = null
// What had the focus when the issue was opened from outside the panel. The title takes the focus over once the issue
// loads, unless the focus has moved on since.
let focusFrom: Element | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function load(refresh: boolean, settle = 0) {
  const issue = props.issue
  const mine = ++ticket
  if (!refresh) {
    clearTimeout(staleTimer)
    stale.value = thread.value !== null
    if (stale.value) staleTimer = window.setTimeout(() => fresh(null), STALE_MS)
    problem.value = null
    moreTicket++
    loadingMore.value = false
    loadingMoreNow = null
    moreFailed.value = false
  }
  if (!loaded.value) return
  // Going through issues with ↑ and ↓ reads only the one stopped at.
  if (settle) {
    await wait(settle)
    if (mine !== ticket) return
  }
  try {
    let answer = await issueThread(issue, version.value)
    // A newer version is read with as many comments as are shown when it's ready, and what's shown stays until then.
    // Show more, should it be loading, finishes first, so the comments it brings are counted too.
    for (;;) {
      if (refresh && loadingMoreNow) await loadingMoreNow
      if (mine !== ticket) return
      const shown = refresh && thread.value ? thread.value.comments.length : 0
      if (!answer.after || answer.comments.length >= shown) break
      answer = await moreComments(answer)
    }
    fresh(answer)
    problem.value = null
    const from = focusFrom
    focusFrom = null
    if (from && (document.activeElement === from || document.activeElement === document.body)) {
      await nextTick()
      heading.value?.focus({ preventScroll: true })
    }
  } catch (error) {
    if (mine !== ticket) return
    focusFrom = null
    if (refresh && thread.value) return
    fresh(null)
    problem.value = error instanceof IssueMissing ? 'missing' : 'failed'
  }
}

const key = computed(() => refKey(props.issue))

watch(
  [key, version, loaded],
  ([issue], previousValues) => {
    const before = previousValues?.[0]
    const another = issue !== before
    if (another) {
      const from = props.opener ?? null
      focusFrom = props.docked && !root.value?.contains(from) ? from : null
      scroller.value?.scrollTo({ top: 0 })
    }
    void load(!another && thread.value !== null, another && before ? 150 : 0)
  },
  { immediate: true },
)

function showMore() {
  const current = thread.value
  if (!current?.after || loadingMore.value) return
  const mine = ++moreTicket
  loadingMore.value = true
  moreFailed.value = false
  const loading: Promise<void> = moreComments(current)
    .then(
      (answer) => {
        if (mine === moreTicket && thread.value === current) thread.value = answer
      },
      () => {
        if (mine === moreTicket) moreFailed.value = true
      },
    )
    .finally(() => {
      if (loadingMoreNow === loading) loadingMoreNow = null
      if (mine === moreTicket) loadingMore.value = false
    })
  loadingMoreNow = loading
}

const more = computed(() => (thread.value ? nextPage(thread.value) : 0))

// A hidden comment's images are placed only when it's shown. Should its links be about to expire, the issue is read
// again for fresh ones.
function readAgainIfExpiring() {
  if (thread.value && expiring(thread.value)) void load(true)
}

// Escape closes the panel beside the list, unless a menu, popover, dialog or tooltip is open to take it.
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !props.docked || !openIssue.value) return
  if (document.querySelector('[data-dismissable-layer]')) return
  closeIssue()
}
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey)
  // What's still to load is for a panel no longer there.
  ticket++
  clearTimeout(staleTimer)
})

const state = computed(() => thread.value?.state ?? (listed.value ? stateOf(listed.value) : 'open'))

const posts = computed<Post[]>(() =>
  thread.value ? [thread.value.post, ...thread.value.comments.filter((post) => postShown(post.author))] : [],
)
const url = computed(() => thread.value?.url ?? issueUrl(props.issue))
</script>

<template>
  <div ref="root" class="flex h-full min-h-0 flex-col bg-default">
    <header
      class="flex shrink-0 items-center gap-1 border-b border-default"
      :class="docked ? 'h-16 ps-6 pe-3' : 'h-14 px-2'"
    >
      <UButton
        v-if="!docked"
        icon="i-octicon-arrow-left-16"
        color="neutral"
        variant="ghost"
        :aria-label="t('issue.close')"
        :ui="{ leadingIcon: 'rtl:-scale-x-100' }"
        @click="closeIssue"
      />
      <span class="flex min-w-0 items-center gap-2 font-mono text-[13px] text-toned" :class="!docked && 'ps-1'">
        <UIcon :name="ISSUE_LOOKS[state].icon" class="size-4 shrink-0" :class="ISSUE_LOOKS[state].color" />
        <span class="truncate" dir="ltr">{{ displayRepo(issue.repo) }}#{{ issue.number }}</span>
      </span>
      <span class="flex-1" />
      <UTooltip :text="t('issue.previous')" :kbds="kbds('issues', 1)">
        <UButton
          icon="i-octicon-chevron-up-16"
          color="neutral"
          variant="ghost"
          :aria-label="t('issue.previous')"
          :aria-disabled="!previous"
          @click="move(-1)"
        />
      </UTooltip>
      <UTooltip :text="t('issue.next')" :kbds="kbds('issues')">
        <UButton
          icon="i-octicon-chevron-down-16"
          color="neutral"
          variant="ghost"
          :aria-label="t('issue.next')"
          :aria-disabled="!next"
          @click="move(1)"
        />
      </UTooltip>
      <template v-if="docked">
        <span class="mx-1 h-5 w-px bg-(--ui-border-accented)" aria-hidden="true" />
        <UButton
          :to="url"
          target="_blank"
          color="neutral"
          variant="ghost"
          :label="t('issue.onGitHub')"
          trailing-icon="i-octicon-link-external-16"
          :ui="{ base: 'text-toned', trailingIcon: 'text-muted' }"
        />
        <UTooltip :text="t('issue.close')">
          <UButton
            icon="i-octicon-x-16"
            color="neutral"
            variant="ghost"
            :aria-label="t('issue.close')"
            @click="closeIssue"
          />
        </UTooltip>
      </template>
      <UTooltip v-else :text="t('issue.onGitHub')">
        <UButton
          :to="url"
          target="_blank"
          icon="i-octicon-link-external-16"
          color="neutral"
          variant="ghost"
          :aria-label="t('issue.onGitHub')"
        />
      </UTooltip>
    </header>

    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div v-if="problem" class="flex flex-col items-center gap-4 px-6 py-24 text-center">
        <p class="max-w-sm text-balance text-toned">{{ t(`issue.${problem}`) }}</p>
        <div class="flex flex-wrap justify-center gap-2">
          <UButton
            v-if="problem === 'failed'"
            color="neutral"
            variant="outline"
            :label="t('sync.retry')"
            @click="load(false)"
          />
          <UButton
            :to="url"
            target="_blank"
            color="neutral"
            variant="outline"
            :label="t('issue.onGitHub')"
            trailing-icon="i-octicon-link-external-16"
          />
        </div>
      </div>

      <div v-else-if="!thread" class="space-y-3 px-4 pt-5 sm:px-6" aria-busy="true">
        <span class="sr-only">{{ t('issue.loading') }}</span>
        <div class="space-y-3" aria-hidden="true">
          <USkeleton class="h-6 w-4/5" />
          <USkeleton class="h-4 w-1/2" />
          <div class="space-y-2 pt-6">
            <USkeleton
              v-for="index in 6"
              :key="index"
              class="h-3.5"
              :style="{ width: `${55 + ((index * 23) % 40)}%` }"
            />
          </div>
        </div>
      </div>

      <!-- Each issue fades in. The last one, while the next is read, dims a moment later, so a quick read doesn't. -->
      <div
        v-else
        :key="refKey(thread.ref)"
        class="enter transition-opacity"
        :class="stale && 'opacity-40 delay-150 duration-300'"
        :inert="stale"
        :aria-busy="stale || undefined"
      >
        <div class="px-4 pt-5 pb-4 sm:px-6">
          <h2
            ref="heading"
            tabindex="-1"
            class="text-xl leading-7 font-medium text-highlighted focus:outline-none"
            dir="auto"
          >
            {{ thread.title }}
          </h2>
          <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
            <span
              class="inline-flex h-6 items-center gap-1.5 rounded-full bg-elevated ps-2 pe-2.5 font-medium text-highlighted"
            >
              <UIcon :name="ISSUE_LOOKS[state].icon" class="size-4" :class="ISSUE_LOOKS[state].color" />
              {{ t(`issue.states.${state}`) }}
            </span>
            <i18n-t keypath="issue.opened" tag="span" scope="global">
              <template #login>
                <PersonLink :who="thread.post.author" :picture="false" class="font-medium text-toned" />
              </template>
              <template #time>
                <TimeAgo :at="thread.post.createdAt" />
              </template>
            </i18n-t>
            <span v-if="thread.total" class="inline-flex items-center gap-1 font-mono tabular-nums">
              <UIcon name="i-octicon-comment-16" class="size-4" />
              <span aria-hidden="true">{{ formatNumber(thread.total) }}</span>
              <span class="sr-only">{{ t('item.comments', { n: formatNumber(thread.total) }, thread.total) }}</span>
            </span>
          </div>
          <div v-if="thread.labels.length" class="mt-3 flex flex-wrap gap-1.5">
            <LabelTag v-for="label in thread.labels" :key="label.name" :label="label" />
          </div>
          <div v-if="thread.assignees.length" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <span class="text-muted">{{ t('issue.assignees') }}</span>
            <PersonLink v-for="person in thread.assignees" :key="person.login" :who="person" class="text-toned" />
          </div>
        </div>

        <article
          v-for="post in posts"
          :key="post.id"
          class="border-t border-default px-4 py-4 has-[[data-folded]]:py-2 sm:px-6"
        >
          <PostBlock
            :post="post"
            :place="post === thread.post ? 'description' : 'conversation'"
            @unfold="readAgainIfExpiring"
          />
        </article>

        <div v-if="thread.after" class="flex flex-col items-center gap-2 border-t border-default px-4 py-4 sm:px-6">
          <UButton
            color="neutral"
            variant="outline"
            :loading="loadingMore"
            :label="t('issue.more', { n: formatNumber(more) }, more)"
            @click="showMore"
          />
          <p v-if="moreFailed" class="text-[13px] text-muted">{{ t('issue.moreFailed') }}</p>
        </div>

        <p
          class="flex flex-wrap items-center gap-x-1.5 border-t border-default px-4 pt-4 pb-7 text-[13px] text-muted sm:px-6"
        >
          {{ t('issue.readOnly') }}
          <span aria-hidden="true">·</span>
          <a
            :href="thread.url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 rounded-sm font-medium text-toned focus-ring transition-colors hover:text-highlighted hover:underline"
          >
            {{ t('issue.reply') }}
            <UIcon name="i-octicon-link-external-16" class="size-4" />
          </a>
        </p>
      </div>
    </div>
  </div>
</template>
