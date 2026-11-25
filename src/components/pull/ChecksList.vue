<script setup lang="ts">
// Every check on the pull request's last commit, grouped by how it ended, the ones that need a look first.
// Each opens its log on GitHub.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import CheckRow from '@/components/CheckRow.vue'
import SkeletonLines from '@/components/SkeletonLines.vue'
import { groupRuns } from '@/lib/checks'
import { formatNumber } from '@/locale'
import { pull, runs, runsState } from '@/stores/pull'

const { t } = useI18n()
const more = computed(() => (runs.value ? runs.value.total - runs.value.runs.length : 0))
</script>

<template>
  <div class="pb-6 text-[13px]">
    <SkeletonLines
      v-if="!pull || (pull.checks && runsState === 'loading')"
      :lines="6"
      :label="t('checks.loading')"
      class="p-4"
    />
    <p v-else-if="!pull.checks" class="p-4 text-muted">{{ t('checks.none') }}</p>
    <p v-else-if="runsState === 'failed'" class="p-4 text-muted">{{ t('checks.failed') }}</p>
    <template v-else-if="runs">
      <section v-for="group in groupRuns(runs.runs)" :key="group.state" class="pt-4">
        <h3 class="px-4 pb-1 text-[12px] font-medium text-muted">
          {{ t(`checks.count.${group.state}`, { n: formatNumber(group.runs.length) }, group.runs.length) }}
        </h3>
        <ul>
          <li v-for="(run, index) in group.runs" :key="index"><CheckRow :run="run" class="px-4" /></li>
        </ul>
      </section>
      <p v-if="more > 0" class="px-4 pt-4 text-[12px] text-muted">
        {{ t('checks.more', { n: formatNumber(more) }, more) }}
      </p>
    </template>
  </div>
</template>
