<script setup lang="ts">
// PROTOTYPE: the commits the diff shows, above it: one commit's message, who made it and when, or a run of commits by
// their first lines. A way back to all the changes stays in sight beside it.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PersonLink from '@/components/PersonLink.vue'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { filesCapped, filesState, pull, scope, showAllChanges, shownTotals } from '@/stores/pull'

const { t } = useI18n()

const shown = computed(() =>
  scope.value && pull.value ? pull.value.commits.slice(scope.value.from, scope.value.to + 1) : [],
)
const single = computed(() => (shown.value.length === 1 ? shown.value[0] : null))
const place = computed(() => {
  const at = scope.value
  const of = formatNumber(pull.value?.commits.length ?? 0)
  if (!at) return ''
  return at.from === at.to
    ? t('pull.scope.position', { n: formatNumber(at.from + 1), of })
    : t('pull.scope.range', { from: formatNumber(at.from + 1), to: formatNumber(at.to + 1), of })
})

// A long message shows its first lines until asked for the rest.
const LINES = 4
const whole = ref(false)
watch(single, () => (whole.value = false))
const long = computed(() => {
  const body = single.value?.body ?? ''
  return body.split('\n').length > LINES || body.length > 320
})
const commitUrl = (oid: string) =>
  pull.value ? `https://github.com/${pull.value.ref.repo}/pull/${pull.value.ref.number}/commits/${oid}` : '#'
</script>

<template>
  <div v-if="scope && pull" class="border-b border-default bg-muted px-4 py-3 text-[13px] sm:px-6">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      <span class="inline-flex items-center gap-1.5 font-medium text-toned">
        <UIcon name="i-octicon-git-commit-16" class="size-4" />{{ place }}
      </span>
      <span v-if="filesState === 'ready'" class="font-mono tabular-nums" dir="ltr">
        <span class="text-success">+{{ formatNumber(shownTotals.additions) }}</span>
        <span class="ms-1 text-error">−{{ formatNumber(shownTotals.deletions) }}</span>
      </span>
      <span class="flex-1" />
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        icon="i-octicon-diff-16"
        :label="t('pull.scope.showAll')"
        @click="showAllChanges"
      />
    </div>

    <template v-if="single">
      <p class="mt-2 font-medium break-words text-highlighted" dir="auto">{{ single.headline }}</p>
      <p
        v-if="single.body"
        class="mt-1 font-mono text-[12px] leading-5 break-words whitespace-pre-wrap text-toned"
        :class="!whole && 'line-clamp-4'"
        dir="auto"
      >
        {{ single.body }}
      </p>
      <button
        v-if="long"
        type="button"
        class="mt-1 rounded-sm text-[12px] font-medium text-toned transition-colors hover:text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
        :aria-expanded="whole"
        @click="whole = !whole"
      >
        {{ whole ? t('pull.scope.less') : t('pull.scope.more') }}
      </button>
      <p class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted">
        <PersonLink
          :who="single.author.login ? single.author : null"
          class="inline-flex items-center gap-1.5 font-medium text-toned"
        >
          <UAvatar :src="single.author.avatarUrl" alt="" size="3xs" />
          <bdi>{{ single.author.login ?? single.author.name }}</bdi>
        </PersonLink>
        <UTooltip :text="fullDate(single.at)"
          ><span>{{ t('pull.scope.committed', { when: relativeTime(Date.parse(single.at), now) }) }}</span></UTooltip
        >
        <span aria-hidden="true">·</span>
        <a
          :href="commitUrl(single.oid)"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 rounded-sm font-mono transition-colors hover:text-highlighted hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          >{{ single.short }}<UIcon name="i-octicon-link-external-16" class="size-3.5"
        /></a>
      </p>
    </template>
    <ul v-else class="mt-2 space-y-1">
      <li v-for="commit in shown" :key="commit.oid" class="flex items-baseline gap-2">
        <code class="shrink-0 font-mono text-[11px] text-muted">{{ commit.short }}</code>
        <bdi class="min-w-0 flex-1 truncate text-toned" dir="auto">{{ commit.headline }}</bdi>
      </li>
    </ul>

    <p v-if="filesCapped" class="mt-2 text-[12px] text-muted">{{ t('pull.scope.capped') }}</p>
  </div>
</template>
