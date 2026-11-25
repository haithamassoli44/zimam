<script setup lang="ts">
// Someone's name or picture as a link to their page on GitHub, with a card about them when a pointer rests on it or the
// keyboard focuses it. The card reads their profile the first time it opens. A deleted account is plain text.
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { profileUrl, type Profile, type Who } from '@/lib/people'
import { compactNumber, monthYear } from '@/locale'
import { profile } from '@/stores/data'

/** `label`: the link's name, when what it shows has no words, like a picture alone. */
const props = defineProps<{ who: Who | null; label?: string }>()
// The link takes the attributes given, not the card around it.
defineOptions({ inheritAttrs: false })
const { t } = useI18n()

const url = computed(() => (props.who ? profileUrl(props.who) : null))
// Bots and teams have no profile to read: their card says what they are.
const person = computed(() => !!props.who?.login && !props.who.bot && !props.who.team)

const found = ref<Profile | null>(null)
const state = ref<'idle' | 'loading' | 'done' | 'failed'>('idle')
function opened(open: boolean) {
  if (!open || !person.value || state.value === 'loading' || state.value === 'done') return
  state.value = 'loading'
  profile(props.who!.login!).then(
    (answer) => {
      found.value = answer
      state.value = 'done'
    },
    () => (state.value = 'failed'),
  )
}

const facts = computed(() => {
  const value = found.value
  if (!value) return []
  return [
    value.company && { icon: 'i-octicon-organization-16', text: value.company },
    value.location && { icon: 'i-octicon-location-16', text: value.location },
    !value.org && {
      icon: 'i-octicon-people-16',
      text: t('person.followers', { n: compactNumber(value.followers) }, value.followers),
    },
    { icon: 'i-octicon-calendar-16', text: t('person.joined', { when: monthYear(value.joined) }) },
  ].filter((fact) => !!fact)
})
</script>

<template>
  <UPopover
    v-if="who && url"
    mode="hover"
    :open-delay="450"
    :close-delay="120"
    :content="{ side: 'bottom', align: 'start' }"
    @update:open="opened"
  >
    <a
      :href="url"
      target="_blank"
      rel="noopener"
      :aria-label="label"
      v-bind="$attrs"
      class="rounded-sm transition-colors hover:text-highlighted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      ><slot
    /></a>
    <template #content>
      <div class="w-72 p-4 text-[13px]">
        <div class="flex items-center gap-3">
          <UAvatar :src="who.avatarUrl" alt="" size="xl" />
          <div class="min-w-0">
            <p class="truncate font-medium text-highlighted">
              <bdi>{{ found?.name ?? who.login }}</bdi>
            </p>
            <p class="truncate text-[12px] text-muted">
              <template v-if="who.team">{{ t('person.team', { owner: who.team.split('/')[0] }) }}</template>
              <template v-else-if="who.bot">{{ t('person.bot') }}</template>
              <template v-else
                ><bdi class="font-mono">{{ who.login }}</bdi
                ><template v-if="found?.pronouns"> · {{ found.pronouns }}</template></template
              >
            </p>
          </div>
        </div>
        <template v-if="person">
          <div v-if="state === 'loading' || state === 'idle'" class="mt-3 space-y-2" aria-busy="true">
            <USkeleton class="h-3 w-11/12" />
            <USkeleton class="h-3 w-2/3" />
          </div>
          <template v-else-if="found">
            <p v-if="found.status" class="mt-3 rounded-md bg-muted px-2 py-1 text-[12px] text-toned" dir="auto">
              {{ found.status }}
            </p>
            <p v-if="found.bio" class="mt-3 line-clamp-3 text-toned" dir="auto">{{ found.bio }}</p>
            <ul class="mt-3 space-y-1 text-[12px] text-muted">
              <li v-for="fact in facts" :key="fact.icon" class="flex items-center gap-2">
                <UIcon :name="fact.icon" class="size-4 shrink-0" />
                <bdi class="min-w-0 truncate">{{ fact.text }}</bdi>
              </li>
            </ul>
          </template>
          <p v-else-if="state === 'failed'" class="mt-3 text-[12px] text-muted">{{ t('person.failed') }}</p>
        </template>
      </div>
    </template>
  </UPopover>
  <span v-else v-bind="$attrs"><slot /></span>
</template>
