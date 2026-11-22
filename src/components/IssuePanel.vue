<script setup lang="ts">
import USlideover from '@nuxt/ui/components/Slideover.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import IssueView from '@/components/IssueView.vue'
import { ISSUE_PANEL } from '@/components/looks'
import { formatRef, type IssueRef } from '@/lib/issue'
import { sides } from '@/locale'
import { closeIssue, openIssue } from '@/stores/view'

const { t } = useI18n()

// Wide screens keep the issue beside the list, where another row is a click away. Narrower ones lay it over the list.
// 80rem is Tailwind's `xl`, which the room held for the panel while it loads uses too.
const wide = matchMedia('(min-width: 80rem)')
const docked = ref(wide.matches)
const onWide = (event: MediaQueryListEvent) => (docked.value = event.matches)
wide.addEventListener('change', onWide)
onBeforeUnmount(() => wide.removeEventListener('change', onWide))

// The last issue opened, still shown while the panel slides away.
const shown = ref<IssueRef | null>(openIssue.value)
watch(openIssue, (issue) => issue && (shown.value = issue))
</script>

<template>
  <aside
    v-if="docked && openIssue"
    class="flex flex-col"
    :class="ISSUE_PANEL"
    :aria-label="t('issue.title', { ref: formatRef(openIssue) })"
  >
    <IssueView :issue="openIssue" docked />
  </aside>

  <USlideover
    v-else-if="!docked"
    :open="!!openIssue"
    :side="sides.end"
    :title="t('issue.title', { ref: shown ? formatRef(shown) : '' })"
    :ui="{ content: 'divide-y-0 sm:max-w-[35rem]' }"
    @update:open="(open) => !open && closeIssue()"
  >
    <template #content>
      <IssueView v-if="shown" :issue="shown" />
    </template>
  </USlideover>
</template>
