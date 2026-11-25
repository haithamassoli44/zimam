<script setup lang="ts">
// A post: an issue's or a pull request's description, a comment, a review, or a comment in a review's thread. Where it
// sits decides how a bot's shows: folded to a line in a conversation when Settings say so, never as a description or
// in a thread. One hidden on GitHub folds anywhere. Folded, it folds what it holds too, like a review's threads.
import UButton from '@nuxt/ui/components/Button.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import IssueText from '@/components/IssueText.vue'
import PersonLink from '@/components/PersonLink.vue'
import TimeAgo from '@/components/TimeAgo.vue'
import type { Post } from '@/lib/posts'
import { relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { postLook } from '@/stores/settings'

/** `action`: what the line says the author did, when not just a comment. `fresh`: new since the last visit. */
const props = defineProps<{
  post: Post
  place: 'description' | 'conversation' | 'thread'
  action?: string
  fresh?: boolean
}>()
/** `unfold`: shown in full by hand. */
const emit = defineEmits<{ unfold: [] }>()
const { t } = useI18n()

const folds = computed(
  () => props.post.hidden !== null || (props.place === 'conversation' && postLook(props.post.author) === 'collapse'),
)
const unfolded = ref(false)
const folded = computed(() => folds.value && !unfolded.value)
function unfold() {
  unfolded.value = true
  emit('unfold')
}
const small = computed(() => props.place === 'thread')
const ago = computed(() => relativeTime(Date.parse(props.post.createdAt), now.value))
</script>

<template>
  <div class="relative" :data-folded="folded || undefined">
    <span
      v-if="fresh"
      class="absolute -start-3 top-2.5 size-1.5 rounded-full bg-primary"
      :aria-label="t('pull.new')"
      role="img"
    />
    <div v-if="folded" class="flex min-h-8 items-center gap-2 text-[13px] text-muted">
      <PersonLink :who="post.author" class="shrink-0 text-toned" />
      <span class="-ms-1 min-w-0 flex-1 truncate">
        · {{ post.hidden ? t(`issue.hidden.${post.hidden}`) : `${action ?? t('pull.commented')} ${ago}` }}
      </span>
      <UButton color="neutral" variant="ghost" size="xs" :label="t('issue.show')" @click="unfold" />
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <PersonLink :who="post.author" :picture="small ? '3xs' : '2xs'" class="font-medium text-highlighted" />
        <span v-if="post.author?.bot" class="tag">{{ t('issue.bot') }}</span>
        <span v-else-if="post.role && !small" class="tag">{{ t(`issue.roles.${post.role}`) }}</span>
        <span v-if="action">{{ action }}</span>
        <TimeAgo :at="post.createdAt" :href="post.url" />
        <template v-if="post.edited">
          <span aria-hidden="true">·</span>
          <span>{{ t('issue.edited') }}</span>
        </template>
        <span v-if="fresh" class="text-[12px] font-medium text-primary">{{ t('pull.new') }}</span>
        <UButton
          v-if="folds"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-octicon-fold-up-16"
          :aria-label="t('pull.foldPost')"
          @click="unfolded = false"
        />
      </div>
      <IssueText v-if="post.html" class="mt-2" :html="post.html" :link="post.url" />
      <slot />
    </template>
  </div>
</template>
