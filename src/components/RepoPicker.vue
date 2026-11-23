<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UCheckbox from '@nuxt/ui/components/Checkbox.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChoiceGroup from '@/components/ChoiceGroup.vue'
import { REPO_STATUSES, type RepoStatus } from '@/lib/filters'
import type { GitHub } from '@/lib/github'
import { defaultRepoFilters, findRepos, toggleStatus } from '@/lib/repos'
import { reposOf } from '@/lib/sources'
import { normalize } from '@/lib/text'
import { formatNumber, relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import type { Repo, Source } from '@/types'

// The repositories an account has, to pick the only ones it brings.
const props = defineProps<{ gh: GitHub; source: Source }>()
const only = defineModel<string[]>('only', { required: true })
const { t } = useI18n()

const repos = shallowRef<Repo[] | null>(null)
const failed = ref(false)

async function load() {
  failed.value = false
  try {
    const list = await reposOf(props.gh, props.source)
    repos.value = list.toSorted(
      (a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '') || a.name.localeCompare(b.name),
    )
  } catch {
    failed.value = true
  }
}
void load()
// A new token may see other repositories.
watch(() => props.gh, load)

const filters = reactive({ q: '', status: defaultRepoFilters().status })
// The list shows each repository's name, so the search reads that.
const found = computed(() =>
  findRepos(
    repos.value ?? [],
    (repo) => repo,
    filters,
    (repo) => normalize(repo.name),
  ),
)
const shown = computed(() => found.value.kept)
const statuses = computed(() =>
  REPO_STATUSES.map((value) => ({ value, label: t(`filters.status.${value}`), count: found.value.counts[value] })),
)

const ticked = computed(() => new Set(only.value))
const count = computed(() => (repos.value ?? []).filter((repo) => ticked.value.has(repo.id)).length)

function tick(id: string, on: boolean | 'indeterminate') {
  only.value = on === true ? [...only.value, id] : only.value.filter((other) => other !== id)
}

function tickShown() {
  only.value = [...new Set([...only.value, ...shown.value.map((repo) => repo.id)])]
}

const pushed = (repo: Repo) => (repo.pushedAt ? relativeTime(Date.parse(repo.pushedAt), now.value) : '')
</script>

<template>
  <div class="space-y-3 p-3">
    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="filters.q"
        icon="i-octicon-search-16"
        :placeholder="t('repos.search')"
        :aria-label="t('repos.search')"
        class="min-w-40 flex-1"
      />
      <ChoiceGroup
        :label="t('filters.status.title')"
        :choices="statuses"
        :picked="(value) => filters.status.includes(value as RepoStatus)"
        @pick="toggleStatus(filters, $event as RepoStatus)"
      />
    </div>

    <div v-if="failed" class="flex flex-col items-center gap-2 py-6 text-center">
      <p class="text-sm text-toned">{{ t('setup.reposFailed') }}</p>
      <UButton color="neutral" variant="outline" size="sm" :label="t('sync.retry')" @click="load" />
    </div>
    <div v-else-if="!repos" class="space-y-3 rounded-md border border-default p-3" aria-busy="true">
      <USkeleton v-for="index in 5" :key="index" class="h-4" :style="{ width: `${30 + ((index * 17) % 40)}%` }" />
    </div>
    <div
      v-else
      class="max-h-72 overflow-y-auto rounded-md border border-default"
      role="group"
      :aria-label="t('setup.pickFrom', { name: source.name })"
    >
      <label
        v-for="repo in shown"
        :key="repo.id"
        class="flex cursor-pointer items-center gap-3 border-b border-default px-3 py-2 transition-colors last:border-b-0 hover:bg-elevated/50"
      >
        <UCheckbox :model-value="ticked.has(repo.id)" @update:model-value="tick(repo.id, $event)" />
        <bdi class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ repo.name }}</bdi>
        <span
          v-if="repo.isArchived"
          class="inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs text-toned ring-1 ring-default ring-inset"
          >{{ t('item.archived') }}</span
        >
        <span class="shrink-0 text-xs text-muted">{{ pushed(repo) }}</span>
      </label>
      <p v-if="!shown.length" class="px-3 py-6 text-center text-sm text-muted">{{ t('filters.nothing') }}</p>
    </div>

    <div v-if="repos" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
      <span class="text-toned">{{
        only.length
          ? t('setup.pickedCount', { n: formatNumber(count), total: formatNumber(repos.length) })
          : t('setup.pickOne')
      }}</span>
      <span class="flex items-center gap-3">
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          class="p-0"
          :disabled="!shown.length"
          :label="t('setup.pickShown')"
          @click="tickShown"
        />
        <UButton
          color="neutral"
          variant="link"
          size="sm"
          class="p-0"
          :disabled="!only.length"
          :label="t('setup.clearPicked')"
          @click="only = []"
        />
      </span>
    </div>
  </div>
</template>
