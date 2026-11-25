<script setup lang="ts">
// PROTOTYPE: a review thread on the code: its comments, folded when resolved or written by a bot.
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import HunkSnippet from '@/components/pull/HunkSnippet.vue'
import { showThread } from '@/components/pull/parts'
import PostBlock from '@/components/pull/PostBlock.vue'
import type { ReviewThread } from '@/lib/pull'
import { formatNumber } from '@/locale'
import { isFresh } from '@/stores/pull'
import { postLook } from '@/stores/settings'

const props = defineProps<{ thread: ReviewThread; snippet?: boolean; where?: boolean }>()
const { t } = useI18n()

const look = computed(() => postLook(props.thread.comments[0]?.author))
const unfolded = ref(false)
const folded = computed(() => !unfolded.value && (props.thread.resolved || look.value === 'collapse'))
const fresh = computed(() => props.thread.comments.some((comment) => isFresh(comment.createdAt)))
const where = computed(() => {
  const { thread } = props
  const line = thread.line ?? thread.originalLine
  return line ? `${thread.path}:${line}` : thread.path
})
const first = computed(() => props.thread.comments[0])
</script>

<template>
  <div
    class="overflow-hidden rounded-lg border bg-default text-start font-sans"
    :class="fresh ? 'border-primary/50' : 'border-default'"
    dir="auto"
  >
    <div
      v-if="props.where || thread.outdated || thread.resolved || fresh"
      class="flex min-h-9 items-center gap-2 border-b border-default bg-muted px-3 text-[12px] text-muted"
    >
      <button
        v-if="props.where"
        type="button"
        class="min-w-0 truncate font-mono text-toned hover:text-primary hover:underline"
        dir="ltr"
        @click="showThread(thread)"
      >
        {{ where }}
      </button>
      <span class="flex-1" />
      <span v-if="fresh" class="inline-flex items-center gap-1 font-medium text-primary">
        <span class="size-1.5 rounded-full bg-primary" />{{ t('pull.new') }}
      </span>
      <span v-if="thread.outdated" class="rounded-sm px-1.5 ring-1 ring-accented ring-inset">{{
        t('pull.outdated')
      }}</span>
      <span v-if="thread.resolved" class="inline-flex items-center gap-1">
        <UIcon name="i-octicon-check-circle-16" class="size-3.5" />{{ t('pull.resolved') }}
      </span>
    </div>
    <HunkSnippet v-if="snippet && first?.diffHunk" :hunk="first.diffHunk" />
    <div v-if="folded" class="flex min-h-10 items-center gap-2 px-3 text-[13px] text-muted">
      <span class="min-w-0 flex-1 truncate">
        <bdi class="text-toned">{{ first?.author?.login ?? t('issue.ghost') }}</bdi>
        · {{ t('pull.threadComments', { n: formatNumber(thread.total) }, thread.total) }}
        <template v-if="thread.resolved && thread.resolvedBy">
          · {{ t('pull.resolvedBy', { login: thread.resolvedBy }) }}</template
        >
      </span>
      <UButton color="neutral" variant="ghost" size="xs" :label="t('issue.show')" @click="unfolded = true" />
    </div>
    <div v-else class="divide-y divide-default">
      <div v-for="comment in thread.comments" :key="comment.id" class="px-3 py-3 ps-5">
        <PostBlock :post="comment" small />
      </div>
      <p v-if="thread.total > thread.comments.length" class="px-3 py-2 text-[12px] text-muted">
        {{ t('pull.moreOnGitHub', { n: formatNumber(thread.total - thread.comments.length) }) }}
      </p>
    </div>
  </div>
</template>
