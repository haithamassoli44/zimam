<script setup lang="ts">
// PROTOTYPE: the pull request's title, what it merges where, its size without generated files, and who has to act next.
// Once the diff scrolls past it, it folds to a thin row, and it comes back at the top of the diff.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { PULL_LOOKS } from '@/components/looks'
import StatusChips from '@/components/pull/StatusChips.vue'
import { formatNumber, fullDate, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { files, pull, scrolledBySelf, totals } from '@/stores/pull'

const { t } = useI18n()

const state = computed(() => pull.value?.state ?? 'open')
const head = computed(() =>
  pull.value?.cross && pull.value.headOwner ? `${pull.value.headOwner}:${pull.value.head}` : pull.value?.head,
)
const counted = computed(() => (files.value.length ? totals.value : null))

// --- Folding ---
const root = useTemplateRef<HTMLElement>('root')
const full = useTemplateRef<HTMLElement>('full')
/** The thin row's height, `h-9`. */
const THIN = 36
const MOVE_MS = 300
const folded = ref(false)
let diff: HTMLElement | null = null
// Where the diff was when the details were asked back by hand: they fold again a little past it.
let held = -Infinity
let moving = false
let frame = 0

/**
 * Moves the header to a height. `steady`: the diff scrolls by what the header gives or takes each frame, so its lines
 * stay where they are on screen while everything around them moves.
 */
function move(to: number, steady: boolean, done?: () => void) {
  const box = root.value
  if (!box) return
  cancelAnimationFrame(frame)
  const from = box.offsetHeight
  // The clock starts at the first frame: a frame's time can come before this call.
  let start: number | null = null
  let last = from
  moving = true
  const step = (time: number) => {
    start ??= time
    const progress = Math.min(1, (time - start) / MOVE_MS)
    // The app's ease-out, cubic-bezier(0.22, 1, 0.36, 1), close enough for a height.
    const height = Math.round(from + (to - from) * (1 - (1 - progress) ** 5))
    box.style.height = `${height}px`
    if (steady && diff) diff.scrollTop -= last - height
    last = height
    if (progress < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    moving = false
    done?.()
  }
  frame = requestAnimationFrame(step)
}

function fold(steady: boolean) {
  folded.value = true
  held = -Infinity
  move(THIN, steady)
}
function unfold(steady: boolean, done?: () => void) {
  folded.value = false
  move(full.value?.offsetHeight ?? THIN, steady, () => {
    // Unfolded, the header takes its own height again, as the window's width changes it.
    root.value?.style.removeProperty('height')
    done?.()
  })
}

/** Follows the diff's scrolling: folds once it has scrolled past the header, and comes back when it's at the top. */
function follow(box: HTMLElement) {
  diff = box
  if (moving) return
  const top = box.scrollTop
  // A jump to a file or a thread moves the diff on its own: that may fold the header, never bring it back.
  const self = scrolledBySelf()
  if (folded.value) {
    if (top <= 0 && !self) unfold(false)
    return
  }
  if (top <= 0) held = -Infinity
  // As if the header had scrolled away with the page.
  const natural = full.value?.offsetHeight ?? 0
  if (top > Math.max(natural - THIN + 24, held + 48)) fold(!self)
}
defineExpose({ follow })

/** The details asked back by hand, from the thin row: the code stays where it is. */
function expand() {
  unfold(true, () => (held = diff?.scrollTop ?? -Infinity))
}

watch(
  () => pull.value?.url,
  () => {
    cancelAnimationFrame(frame)
    moving = false
    folded.value = false
    held = -Infinity
    root.value?.style.removeProperty('height')
  },
)
onBeforeUnmount(() => cancelAnimationFrame(frame))
</script>

<template>
  <div v-if="pull" class="shrink-0 border-b border-default">
    <div ref="root" class="relative overflow-hidden">
      <div
        ref="full"
        class="px-4 py-3 transition-opacity sm:px-6"
        :class="folded ? 'opacity-0 duration-150' : 'duration-300'"
        :inert="folded"
      >
        <h1 class="text-lg leading-7 font-medium text-highlighted" dir="auto">
          {{ pull.title }} <span class="font-normal text-muted">#{{ pull.ref.number }}</span>
        </h1>
        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
          <span
            class="inline-flex h-6 items-center gap-1.5 rounded-full ps-2 pe-2.5 font-medium"
            :class="PULL_LOOKS[state].pill"
          >
            <UIcon :name="PULL_LOOKS[state].icon" class="size-4" :class="PULL_LOOKS[state].color" />{{
              t(`pull.states.${state}`)
            }}
          </span>
          <span class="inline-flex items-center gap-1.5">
            <UAvatar v-if="pull.post.author" :src="pull.post.author.avatarUrl" alt="" size="3xs" />
            <i18n-t
              :keypath="state === 'merged' ? 'pull.merged' : state === 'closed' ? 'pull.wanted' : 'pull.wants'"
              tag="span"
              scope="global"
            >
              <template #who>
                <bdi class="font-medium text-toned">{{
                  (state === 'merged' ? pull.mergedBy?.login : pull.post.author?.login) ?? t('issue.ghost')
                }}</bdi>
              </template>
              <template #n>{{ formatNumber(pull.commitCount) }}</template>
              <template #base
                ><code class="rounded-sm bg-elevated px-1.5 py-0.5 font-mono text-[12px] text-toned" dir="ltr">{{
                  pull.base
                }}</code></template
              >
              <template #head
                ><code class="rounded-sm bg-elevated px-1.5 py-0.5 font-mono text-[12px] text-toned" dir="ltr">{{
                  head
                }}</code></template
              >
            </i18n-t>
          </span>
          <UTooltip :text="fullDate(pull.post.createdAt)">
            <span>{{ relativeTime(Date.parse(pull.post.createdAt), now) }}</span>
          </UTooltip>
          <UTooltip
            v-if="counted"
            :text="
              counted.left
                ? t(
                    'pull.withoutGenerated',
                    {
                      n: formatNumber(counted.left),
                      added: formatNumber(pull.additions),
                      removed: formatNumber(pull.deletions),
                    },
                    counted.left,
                  )
                : t('pull.linesChanged')
            "
          >
            <span class="inline-flex items-center gap-2 font-mono text-[12px] tabular-nums" dir="ltr">
              <span class="text-success">+{{ formatNumber(counted.additions) }}</span>
              <span class="text-error">−{{ formatNumber(counted.deletions) }}</span>
              <span class="text-muted">{{
                t('pull.filesCount', { n: formatNumber(counted.files) }, counted.files)
              }}</span>
            </span>
          </UTooltip>
          <StatusChips />
        </div>
      </div>

      <div
        class="absolute inset-x-0 top-0 flex h-9 items-center gap-2 px-4 transition-opacity sm:px-6"
        :class="folded ? 'delay-100 duration-300' : 'pointer-events-none opacity-0 duration-150'"
        :inert="!folded"
      >
        <span class="grid size-6 shrink-0 place-items-center rounded-full" :class="PULL_LOOKS[state].pill">
          <UIcon :name="PULL_LOOKS[state].icon" class="size-3.5" :class="PULL_LOOKS[state].color" />
          <span class="sr-only">{{ t(`pull.states.${state}`) }}</span>
        </span>
        <p class="min-w-0 flex-1 text-[14px] font-medium text-highlighted">
          <UTooltip :text="t('pull.showDetails')">
            <button
              type="button"
              class="group flex max-w-full items-center gap-1.5 rounded-sm text-start"
              @click="expand"
            >
              <span class="truncate" dir="auto">{{ pull.title }}</span>
              <span class="shrink-0 font-normal text-muted">#{{ pull.ref.number }}</span>
              <UIcon
                name="i-octicon-chevron-down-16"
                class="size-4 shrink-0 text-muted transition-colors group-hover:text-highlighted"
              />
            </button>
          </UTooltip>
        </p>
        <span v-if="counted" class="shrink-0 font-mono text-[12px] tabular-nums max-md:hidden" dir="ltr">
          <span class="text-success">+{{ formatNumber(counted.additions) }}</span>
          <span class="ms-1 text-error">−{{ formatNumber(counted.deletions) }}</span>
        </span>
        <StatusChips small />
      </div>
    </div>
  </div>
</template>
