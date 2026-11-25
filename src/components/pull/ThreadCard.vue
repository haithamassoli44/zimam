<script setup lang="ts">
// A review thread on the code: its comments, folded when resolved or written by a bot. Under its line it needs no more;
// beside its file it shows the code it was written on, and in the conversation where that is too.
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import PersonLink from '@/components/PersonLink.vue'
import PostBlock from '@/components/PostBlock.vue'
import HunkSnippet from '@/components/pull/HunkSnippet.vue'
import { showThread } from '@/components/pull/navigation'
import type { ReviewThread } from '@/lib/pull'
import { formatNumber } from '@/locale'
import { isFresh } from '@/stores/pull'
import { postLook } from '@/stores/settings'

const props = defineProps<{ thread: ReviewThread; place: 'line' | 'file' | 'conversation' }>()
const { t } = useI18n()

const look = computed(() => postLook(props.thread.comments[0]?.author))
const unfolded = ref(false)
const folded = computed(() => !unfolded.value && (props.thread.resolved || look.value === 'collapse'))
const fresh = computed(() => props.thread.comments.some((comment) => isFresh(comment.createdAt)))
const location = computed(() => {
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
      v-if="place === 'conversation' || thread.outdated || thread.resolved || fresh"
      class="flex min-h-9 items-center gap-2 border-b border-default bg-muted px-3 text-[12px] text-muted"
    >
      <button
        v-if="place === 'conversation'"
        type="button"
        class="min-w-0 truncate font-mono text-toned transition-colors hover:text-primary hover:underline"
        dir="ltr"
        @click="showThread(thread)"
      >
        {{ location }}
      </button>
      <span class="flex-1" />
      <span v-if="fresh" class="inline-flex items-center gap-1 font-medium text-primary">
        <span class="size-1.5 rounded-full bg-primary" />{{ t('pull.new') }}
      </span>
      <span v-if="thread.outdated" class="tag">{{ t('pull.outdated') }}</span>
      <span v-if="thread.resolved" class="inline-flex items-center gap-1">
        <UIcon name="i-octicon-check-circle-16" class="size-3.5" />{{ t('pull.resolved') }}
      </span>
    </div>
    <HunkSnippet v-if="place !== 'line' && first?.diffHunk" :hunk="first.diffHunk" />
    <div v-if="folded" class="flex min-h-10 items-center gap-2 px-3 text-[13px] text-muted">
      <span class="min-w-0 flex-1 truncate">
        <PersonLink :who="first?.author ?? null" :picture="false" class="text-toned" />
        · {{ t('pull.threadComments', { n: formatNumber(thread.total) }, thread.total) }}
        <template v-if="thread.resolved && thread.resolvedBy">
          · {{ t('pull.resolvedBy', { login: thread.resolvedBy }) }}</template
        >
      </span>
      <UButton color="neutral" variant="ghost" size="xs" :label="t('issue.show')" @click="unfolded = true" />
    </div>
    <div v-else class="divide-y divide-default">
      <div v-for="comment in thread.comments" :key="comment.id" class="px-3 py-3 ps-5">
        <PostBlock :post="comment" place="thread" :fresh="isFresh(comment.createdAt)" />
      </div>
      <p v-if="thread.total > thread.comments.length" class="px-3 py-2 text-[12px] text-muted">
        {{ t('pull.moreOnGitHub', { n: formatNumber(thread.total - thread.comments.length) }) }}
      </p>
    </div>
  </div>
</template>
