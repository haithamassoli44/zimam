<script setup lang="ts">
// The pull request's title, what it merges where, its size without generated files, and who has to act next.
// Once the diff scrolls past it, it folds to a thin row, and it comes back at the top of the diff.
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import LineCounts from '@/components/LineCounts.vue'
import { PULL_LOOKS } from '@/components/looks'
import { easeOut } from '@/components/motion'
import PersonLink from '@/components/PersonLink.vue'
import { scroller, scrolledBySelf } from '@/components/pull/navigation'
import StatusChips from '@/components/pull/StatusChips.vue'
import TimeAgo from '@/components/TimeAgo.vue'
import { formatNumber } from '@/locale'
import { pull, totals } from '@/stores/pull'

const { t } = useI18n()

const state = computed(() => pull.value?.state ?? 'open')
const head = computed(() =>
  pull.value?.cross && pull.value.headOwner ? `${pull.value.headOwner}:${pull.value.head}` : pull.value?.head,
)
const counted = computed(() => (totals.value.files || totals.value.left ? totals.value : null))
const who = computed(() => (state.value === 'merged' ? pull.value?.mergedBy : pull.value?.post.author) ?? null)

// --- Folding ---
const root = useTemplateRef<HTMLElement>('root')
const full = useTemplateRef<HTMLElement>('full')
const thinRow = useTemplateRef<HTMLElement>('thinRow')
const thin = () => thinRow.value?.offsetHeight ?? 0
const MOVE_MS = 300
// It folds once the diff has scrolled this far past where the details would have gone, as if it had scrolled away with
// them; and, asked back by hand, once the diff has moved on this far from there.
const PAST_DETAILS = 24
const PAST_ASKED = 48
const folded = ref(false)
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
  const ease = easeOut()
  // The clock starts at the first frame: a frame's time can come before this call.
  let start: number | null = null
  let last = from
  moving = true
  const step = (time: number) => {
    start ??= time
    const progress = Math.min(1, (time - start) / MOVE_MS)
    const height = Math.round(from + (to - from) * ease(progress))
    box.style.height = `${height}px`
    if (steady && scroller.value) scroller.value.scrollTop -= last - height
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
  move(thin(), steady)
}
function unfold(steady: boolean, done?: () => void) {
  folded.value = false
  move(full.value?.offsetHeight ?? thin(), steady, () => {
    // Unfolded, the header takes its own height again, as the window's width changes it.
    root.value?.style.removeProperty('height')
    done?.()
  })
}

/** Follows the diff's scrolling: folds once it has scrolled past the header, and comes back when it's at the top. */
function follow() {
  const box = scroller.value
  if (!box || moving) return
  const top = box.scrollTop
  // A jump to a file or a thread moves the diff on its own: that may fold the header, never bring it back.
  const self = scrolledBySelf()
  if (folded.value) {
    if (top <= 0 && !self) unfold(false)
    return
  }
  if (top <= 0) held = -Infinity
  const natural = full.value?.offsetHeight ?? 0
  if (top > Math.max(natural - thin() + PAST_DETAILS, held + PAST_ASKED)) fold(!self)
}
watch(
  scroller,
  (box, before) => {
    before?.removeEventListener('scroll', follow)
    box?.addEventListener('scroll', follow, { passive: true })
  },
  { immediate: true },
)
/** The details asked back by hand, from the thin row: the code stays where it is. */
function expand() {
  unfold(true, () => (held = scroller.value?.scrollTop ?? -Infinity))
}

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  scroller.value?.removeEventListener('scroll', follow)
})
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
            <i18n-t
              :keypath="state === 'merged' ? 'pull.merged' : state === 'closed' ? 'pull.wanted' : 'pull.wants'"
              tag="span"
              scope="global"
            >
              <template #who>
                <PersonLink :who="who" class="align-bottom font-medium text-toned" />
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
          <TimeAgo :at="pull.post.createdAt" />
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
              <LineCounts :additions="counted.additions" :deletions="counted.deletions" />
              <span class="text-muted">{{
                t('pull.filesCount', { n: formatNumber(counted.files) }, counted.files)
              }}</span>
            </span>
          </UTooltip>
          <StatusChips />
        </div>
      </div>

      <div
        ref="thinRow"
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
        <LineCounts
          v-if="counted"
          :additions="counted.additions"
          :deletions="counted.deletions"
          class="shrink-0 text-[12px] max-md:hidden"
        />
        <StatusChips small />
      </div>
    </div>
  </div>
  <!-- While the pull request loads: its title and its line of facts. -->
  <div v-else class="shrink-0 space-y-3 border-b border-default px-4 py-3 sm:px-6" aria-hidden="true">
    <USkeleton class="my-1.5 h-4 w-2/3 max-w-xl" />
    <USkeleton class="h-6 w-1/2 max-w-md" />
  </div>
</template>
