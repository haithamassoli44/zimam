<script setup lang="ts">
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import IssueText from '@/components/IssueText.vue'
import { formatRef, IssueMissing, issueUrl, sameRef, type IssueRef, type Post, type Thread } from '@/lib/issue'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { displayRepo, issueThread, items, loaded, moreComments, repos } from '@/stores/data'
import { closeIssue, openIssue, result, showIssue, takeOpener } from '@/stores/view'
import type { Item } from '@/types'

/** An issue, read-only: its description and comments, with a way to the next one in the list. */
const props = defineProps<{ issue: IssueRef; docked?: boolean }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const scroller = useTemplateRef<HTMLElement>('scroller')
const heading = useTemplateRef<HTMLElement>('heading')

const refOf = (item: Item): IssueRef | null => {
  const repo = repos.value.get(item.repoId)
  return repo ? { repo: repo.fullName, number: item.number } : null
}

// The list's copy of the issue. When it changes there, the issue is read again.
const listed = computed(() =>
  [...items.value.values()].find((item) => item.kind === 'issue' && sameRef(refOf(item), props.issue)),
)
const version = computed(() => listed.value?.updatedAt ?? '')

// ↑ and ↓ go through the issues the list shows, in its order, past its pull requests.
const issues = computed(() => result.value.items.filter((item) => item.kind === 'issue'))
const position = computed(() => issues.value.findIndex((item) => sameRef(refOf(item), props.issue)))
const neighbor = (by: -1 | 1) => (position.value < 0 ? null : (issues.value[position.value + by] ?? null))
const previous = computed(() => neighbor(-1))
const next = computed(() => neighbor(1))

function move(by: -1 | 1) {
  const target = neighbor(by)
  const issue = target && refOf(target)
  if (issue) showIssue(issue)
}

const thread = shallowRef<Thread | null>(null)
const problem = ref<'missing' | 'failed' | null>(null)
const loadingMore = ref(false)
const moreFailed = ref(false)
// The hidden comments someone chose to see.
const unhidden = reactive(new Set<string>())
// When the answer shown arrived: GitHub's image links in it work for five minutes.
let answeredAt = 0
let ticket = 0
let moreTicket = 0
// Show more, while it loads.
let loadingMoreNow: Promise<void> | null = null
// What had the focus when the issue was opened from outside the panel. The title takes the focus over once the issue
// loads, unless the focus has moved on since.
let opener: Element | null = null

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function load(refresh: boolean, settle = 0) {
  const issue = props.issue
  const mine = ++ticket
  if (!refresh) {
    thread.value = null
    problem.value = null
    moreTicket++
    loadingMore.value = false
    loadingMoreNow = null
    moreFailed.value = false
    unhidden.clear()
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
    thread.value = answer
    answeredAt = Date.now()
    problem.value = null
    const from = opener
    opener = null
    if (from && (document.activeElement === from || document.activeElement === document.body)) {
      await nextTick()
      heading.value?.focus({ preventScroll: true })
    }
  } catch (error) {
    if (mine !== ticket) return
    opener = null
    if (refresh && thread.value) return
    problem.value = error instanceof IssueMissing ? 'missing' : 'failed'
  }
}

const key = computed(() => formatRef(props.issue).toLowerCase())

watch(
  [key, version, loaded],
  ([issue], previousValues) => {
    const before = previousValues?.[0]
    const another = issue !== before
    if (another) {
      const from = takeOpener(props.issue)
      opener = props.docked && !root.value?.contains(from) ? from : null
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
        // Another issue may have been opened meanwhile. Then the answer is dropped.
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

// The next page holds up to 100 comments.
const more = computed(() =>
  thread.value?.after ? Math.min(100, thread.value.total - thread.value.comments.length) : 0,
)

// A hidden comment's images are placed only when it's shown. Should its links be about to expire, the issue is read
// again for fresh ones.
function unhide(post: Post) {
  unhidden.add(post.id)
  if (Date.now() - answeredAt > 4 * 60_000) void load(true)
}

// Beside the list, focus that was in the panel goes back to the issue's row. Over it, the dialog does that.
function close() {
  const row = document.querySelector<HTMLElement>('main a[data-row][aria-current]')
  const inside = root.value?.contains(document.activeElement)
  closeIssue()
  if (props.docked && inside) row?.focus({ preventScroll: true })
}

// Escape closes the panel beside the list, unless a menu, popover, dialog or tooltip is open to take it.
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !props.docked || !openIssue.value) return
  if (document.querySelector('[data-dismissable-layer]')) return
  close()
}
document.addEventListener('keydown', onKey)
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))

const STATES = {
  open: { icon: 'i-octicon-issue-opened-16', color: 'text-toned' },
  completed: { icon: 'i-octicon-issue-closed-16', color: 'text-merged' },
  notPlanned: { icon: 'i-octicon-skip-16', color: 'text-muted' },
  duplicate: { icon: 'i-octicon-skip-16', color: 'text-muted' },
}
const state = computed<keyof typeof STATES>(() => {
  if (thread.value) return thread.value.closedAs ?? 'open'
  if (!listed.value || listed.value.state === 'open') return 'open'
  return listed.value.notPlanned ? 'notPlanned' : 'completed'
})

const posts = computed<Post[]>(() => (thread.value ? [thread.value.post, ...thread.value.comments] : []))
const url = computed(() => thread.value?.url ?? issueUrl(props.issue))
const ago = (time: string) => relativeTime(Date.parse(time), now.value)
const BADGE = 'inline-flex h-4.5 items-center rounded-sm px-1.5 text-[11px] text-toned ring-1 ring-accented ring-inset'
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
        @click="close"
      />
      <span class="flex min-w-0 items-center gap-2 font-mono text-[13px] text-toned" :class="!docked && 'ps-1'">
        <UIcon :name="STATES[state].icon" class="size-4 shrink-0" :class="STATES[state].color" />
        <span class="truncate" dir="ltr">{{ displayRepo(issue.repo) }}#{{ issue.number }}</span>
      </span>
      <span class="flex-1" />
      <UTooltip :text="t('issue.previous')">
        <UButton
          icon="i-octicon-chevron-up-16"
          color="neutral"
          variant="ghost"
          :aria-label="t('issue.previous')"
          :aria-disabled="!previous"
          @click="move(-1)"
        />
      </UTooltip>
      <UTooltip :text="t('issue.next')">
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
            @click="close"
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

      <template v-else>
        <div class="px-4 pt-5 pb-4 sm:px-6">
          <h2
            id="issue-title"
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
              <UIcon :name="STATES[state].icon" class="size-4" :class="STATES[state].color" />
              {{ t(`issue.states.${state}`) }}
            </span>
            <i18n-t keypath="issue.opened" tag="span" scope="global">
              <template #login>
                <bdi class="font-medium text-toned">{{ thread.post.author?.login ?? t('issue.ghost') }}</bdi>
              </template>
              <template #time>
                <UTooltip :text="fullDate(thread.post.createdAt)">
                  <span>{{ ago(thread.post.createdAt) }}</span>
                </UTooltip>
              </template>
            </i18n-t>
            <span v-if="thread.total" class="inline-flex items-center gap-1 font-mono tabular-nums">
              <UIcon name="i-octicon-comment-16" class="size-4" />
              <span aria-hidden="true">{{ formatNumber(thread.total) }}</span>
              <span class="sr-only">{{ t('item.comments', { n: formatNumber(thread.total) }, thread.total) }}</span>
            </span>
          </div>
          <div v-if="thread.labels.length" class="mt-3 flex flex-wrap gap-1.5">
            <span
              v-for="label in thread.labels"
              :key="label.name"
              class="inline-flex h-5 items-center gap-1.5 rounded-sm px-1.5 text-xs text-toned ring-1 ring-default ring-inset"
            >
              <span
                class="size-2 rounded-full ring-1 ring-black/10 ring-inset dark:ring-white/15"
                :style="{ background: `#${label.color}` }"
              />
              <bdi>{{ label.name }}</bdi>
            </span>
          </div>
          <div v-if="thread.assignees.length" class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <span class="text-muted">{{ t('issue.assignees') }}</span>
            <span
              v-for="person in thread.assignees"
              :key="person.login"
              class="inline-flex items-center gap-1.5 text-toned"
            >
              <UAvatar :src="person.avatarUrl" alt="" size="3xs" />
              <bdi>{{ person.login }}</bdi>
            </span>
          </div>
        </div>

        <article
          v-for="post in posts"
          :key="post.id"
          class="border-t border-default px-4 sm:px-6"
          :class="post.hidden && !unhidden.has(post.id) ? 'py-2' : 'py-4'"
        >
          <div
            v-if="post.hidden && !unhidden.has(post.id)"
            class="flex min-h-8 items-center gap-2 text-[13px] text-muted"
          >
            <UIcon name="i-octicon-eye-closed-16" class="size-4 shrink-0" />
            <span class="min-w-0 flex-1">
              <bdi>{{ post.author?.login ?? t('issue.ghost') }}</bdi> · {{ t(`issue.hidden.${post.hidden}`) }}
            </span>
            <UButton color="neutral" variant="ghost" size="sm" :label="t('issue.show')" @click="unhide(post)" />
          </div>
          <template v-else>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <UAvatar v-if="post.author" :src="post.author.avatarUrl" alt="" size="2xs" />
              <bdi class="font-medium text-highlighted">{{ post.author?.login ?? t('issue.ghost') }}</bdi>
              <span v-if="post.author?.bot" :class="BADGE">{{ t('issue.bot') }}</span>
              <span v-else-if="post.role" :class="BADGE">{{ t(`issue.roles.${post.role}`) }}</span>
              <UTooltip :text="fullDate(post.createdAt)">
                <a
                  :href="post.url"
                  target="_blank"
                  rel="noopener"
                  class="rounded-sm hover:text-toned hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                  >{{ ago(post.createdAt) }}</a
                >
              </UTooltip>
              <template v-if="post.edited">
                <span aria-hidden="true">·</span>
                <span>{{ t('issue.edited') }}</span>
              </template>
            </div>
            <IssueText class="mt-2" :html="post.html" :link="post.url" />
          </template>
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
          <a
            :href="thread.url"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1 rounded-sm font-medium text-toned hover:text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >
            {{ t('issue.reply') }}
            <UIcon name="i-octicon-link-external-16" class="size-4" />
          </a>
        </p>
      </template>
    </div>
  </div>
</template>
