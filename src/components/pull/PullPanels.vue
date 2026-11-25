<script setup lang="ts">
// PROTOTYPE: the parts of a pull request for the side column. Each keeps its own scroll, so going back to one finds it
// where it was left.
import ChecksList from '@/components/pull/ChecksList.vue'
import CommitList from '@/components/pull/CommitList.vue'
import FileTree from '@/components/pull/FileTree.vue'
import { showFile } from '@/components/pull/parts'
import PullStatus from '@/components/pull/PullStatus.vue'
import PullTimeline from '@/components/pull/PullTimeline.vue'
import { activeFile } from '@/stores/pull'
import type { PullPart } from '@/stores/view'

defineProps<{ part: PullPart }>()
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div v-show="part === 'files'" class="part-in absolute inset-0">
      <FileTree :active="activeFile" @pick="showFile" />
    </div>
    <div v-show="part === 'conversation'" class="part-in absolute inset-0 overflow-y-auto">
      <PullStatus />
      <div class="border-t border-default"><PullTimeline /></div>
    </div>
    <div v-show="part === 'commits'" class="part-in absolute inset-0 overflow-y-auto"><CommitList /></div>
    <div v-show="part === 'checks'" class="part-in absolute inset-0 overflow-y-auto"><ChecksList /></div>
  </div>
</template>
