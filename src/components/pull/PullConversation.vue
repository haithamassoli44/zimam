<script setup lang="ts">
// The conversation part: where the pull request stands, then its timeline.
import { useI18n } from 'vue-i18n'

import PullStatus from '@/components/pull/PullStatus.vue'
import PullTimeline from '@/components/pull/PullTimeline.vue'
import SkeletonLines from '@/components/SkeletonLines.vue'
import { pull } from '@/stores/pull'

const { t } = useI18n()
</script>

<template>
  <SkeletonLines v-if="!pull" :lines="8" :label="t('pull.loading')" class="p-4" />
  <template v-else>
    <PullStatus />
    <div class="border-t border-default"><PullTimeline /></div>
  </template>
</template>
