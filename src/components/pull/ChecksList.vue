<script setup lang="ts">
// PROTOTYPE: every check on the pull request's last commit, grouped by how it ended, the ones that need a look first.
// Each opens its log on GitHub.
import UIcon from '@nuxt/ui/components/Icon.vue'
import USkeleton from '@nuxt/ui/components/Skeleton.vue'
import { useI18n } from 'vue-i18n'

import { CHECK_LOOKS } from '@/components/looks'
import { formatNumber } from '@/locale'
import { pull, runGroups, runs, runsFailed } from '@/stores/pull'

const { t } = useI18n()
</script>

<template>
  <div v-if="pull" class="pb-6 text-[13px]">
    <p v-if="!pull.checks" class="p-4 text-muted">{{ t('checks.none') }}</p>
    <div v-else-if="!runs && !runsFailed" class="space-y-3 p-4" aria-busy="true">
      <USkeleton v-for="n in 6" :key="n" class="h-3" :style="{ width: `${40 + ((n * 17) % 45)}%` }" />
    </div>
    <p v-else-if="runsFailed" class="p-4 text-muted">{{ t('checks.failed') }}</p>
    <section v-for="group in runGroups" :key="group.state" class="pt-4">
      <h3 class="px-4 pb-1 text-[12px] font-medium text-muted">
        {{ t(`checks.count.${group.state}`, { n: formatNumber(group.runs.length) }, group.runs.length) }}
      </h3>
      <ul>
        <li v-for="(run, index) in group.runs" :key="index">
          <a
            :href="run.url ?? undefined"
            target="_blank"
            rel="noopener"
            class="group flex min-h-8 items-center gap-2 px-4 transition-colors hover:bg-elevated pointer-coarse:min-h-11"
          >
            <UIcon :name="CHECK_LOOKS[run.state].icon" class="size-4 shrink-0" :class="CHECK_LOOKS[run.state].color" />
            <bdi class="min-w-0 flex-1 truncate text-toned" dir="auto">{{
              run.detail ? `${run.detail} / ${run.name}` : run.name
            }}</bdi>
            <UIcon
              name="i-octicon-link-external-16"
              class="size-4 shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>
