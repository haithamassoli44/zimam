<script setup lang="ts">
import USlideover from '@nuxt/ui/components/Slideover.vue'
import { defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import IssueUnavailable from '@/components/IssueUnavailable.vue'
import { formatRef, type IssueRef } from '@/lib/refs'
import { sides } from '@/locale'
import { wide } from '@/stores/ui'
import { closeIssue, openIssue } from '@/stores/view'

const { t } = useI18n()

// The issue itself, with what cleans GitHub's HTML, loads with the first issue opened.
const IssueView = defineAsyncComponent({
  loader: () => import('@/components/IssueView.vue'),
  errorComponent: IssueUnavailable,
})

// The last issue opened, still shown while the panel slides away.
const shown = ref<IssueRef | null>(openIssue.value)
// What had the focus as the issue opened, noted at once: the issue may load later.
const opener = shallowRef<Element | null>(document.activeElement)
watch(
  openIssue,
  (issue) => {
    if (!issue) return
    shown.value = issue
    opener.value = document.activeElement
  },
  { flush: 'sync' },
)
</script>

<template>
  <aside
    v-if="wide && openIssue"
    class="flex w-[clamp(28rem,36vw,35rem)] shrink-0 flex-col border-s border-default"
    :aria-label="t('issue.title', { ref: formatRef(openIssue) })"
  >
    <IssueView :issue="openIssue" :opener="opener" docked />
  </aside>

  <USlideover
    v-else-if="!wide"
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
