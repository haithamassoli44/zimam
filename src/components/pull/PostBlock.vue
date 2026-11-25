<script setup lang="ts">
// PROTOTYPE: a post in a pull request: its description, a comment, a review's text, or a comment in a thread.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import IssueText from '@/components/IssueText.vue'
import PersonLink from '@/components/PersonLink.vue'
import type { Post } from '@/lib/issue'
import { fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { isFresh } from '@/stores/pull'
import { postFolds } from '@/stores/settings'
import type { BotPosts } from '@/types'

/** `look`: how the post shows, as its place decides; a bot's comment in the conversation may fold, one in a thread doesn't. */
const props = withDefaults(defineProps<{ post: Post; action?: string; small?: boolean; look?: BotPosts }>(), {
  look: 'show',
})
const { t } = useI18n()

const unfolded = ref(false)
const folded = computed(() => !unfolded.value && postFolds(props.post, props.look))
const fresh = computed(() => isFresh(props.post.createdAt))
const ago = computed(() => relativeTime(Date.parse(props.post.createdAt), now.value))
const BADGE = 'inline-flex h-4.5 items-center rounded-sm px-1.5 text-[11px] text-toned ring-1 ring-accented ring-inset'
</script>

<template>
  <div class="relative">
    <span
      v-if="fresh"
      class="absolute -start-3 top-2.5 size-1.5 rounded-full bg-primary"
      :aria-label="t('pull.new')"
      role="img"
    />
    <div v-if="folded" class="flex min-h-8 items-center gap-2 text-[13px] text-muted">
      <PersonLink :who="post.author" class="inline-flex shrink-0 items-center gap-2 text-toned">
        <UAvatar v-if="post.author" :src="post.author.avatarUrl" alt="" size="3xs" />
        <bdi>{{ post.author?.login ?? t('issue.ghost') }}</bdi>
      </PersonLink>
      <span class="-ms-1 min-w-0 flex-1 truncate">
        <template v-if="post.hidden"> · {{ t(`issue.hidden.${post.hidden}`) }}</template>
        <template v-else> · {{ action ?? t('pull.commented') }} {{ ago }}</template>
      </span>
      <UButton color="neutral" variant="ghost" size="xs" :label="t('issue.show')" @click="unfolded = true" />
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <PersonLink :who="post.author" class="inline-flex items-center gap-2 font-medium text-highlighted">
          <UAvatar v-if="post.author" :src="post.author.avatarUrl" alt="" :size="small ? '3xs' : '2xs'" />
          <bdi>{{ post.author?.login ?? t('issue.ghost') }}</bdi>
        </PersonLink>
        <span v-if="post.author?.bot" :class="BADGE">{{ t('issue.bot') }}</span>
        <span v-else-if="post.role && !small" :class="BADGE">{{ t(`issue.roles.${post.role}`) }}</span>
        <span v-if="action">{{ action }}</span>
        <UTooltip :text="fullDate(post.createdAt)">
          <a
            :href="post.url"
            target="_blank"
            rel="noopener"
            class="rounded-sm transition-colors hover:text-toned hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            >{{ ago }}</a
          >
        </UTooltip>
        <span v-if="fresh" class="text-[12px] font-medium text-primary">{{ t('pull.new') }}</span>
        <UButton
          v-if="look === 'collapse'"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-octicon-fold-up-16"
          :aria-label="t('pull.fold')"
          @click="unfolded = false"
        />
      </div>
      <IssueText v-if="post.html" class="mt-2" :html="post.html" :link="post.url" />
    </template>
  </div>
</template>
