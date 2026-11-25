<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import USlideover from '@nuxt/ui/components/Slideover.vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import FilterBar from '@/components/FilterBar.vue'
import IssuePanel from '@/components/IssuePanel.vue'
import ItemList from '@/components/ItemList.vue'
import { useKeys } from '@/components/keys'
import KeysHelp from '@/components/KeysHelp.vue'
import PullPage from '@/components/pull/PullPage.vue'
import ReposPage from '@/components/ReposPage.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SideBar from '@/components/SideBar.vue'
import ViewDialog from '@/components/ViewDialog.vue'
import { sides } from '@/locale'
import { syncNow } from '@/stores/data'
import { activeWorkspace } from '@/stores/settings'
import { openKeys, openSettings, ui } from '@/stores/ui'
import { openView, page } from '@/stores/view'

const { t } = useI18n()

// The shortcuts that work everywhere, asked after what's on the page: a pull request's numbers pick its parts.
const views = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [
    String(n),
    () => {
      const view = activeWorkspace.value?.views[n - 1]
      if (!view) return false
      openView(view)
    },
  ]),
)
useKeys({ '?': openKeys, ',': openSettings, r: () => syncNow(true), ...views }, 0)

/** The first stop of Tab, shown only then: skips the sidebar and the filters, to the list or the diff. */
function skip() {
  document.querySelector<HTMLElement>('[data-main]')?.focus()
}
</script>

<template>
  <button
    type="button"
    class="fixed start-3 top-3 z-50 -translate-y-20 rounded-md bg-default px-3 py-2 text-sm font-medium text-highlighted shadow-md ring-1 ring-default transition-transform focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-primary"
    @click="skip"
  >
    {{ t('nav.skip') }}
  </button>
  <KeysHelp />
  <template v-if="page === 'pull'">
    <PullPage />
    <SettingsPanel />
  </template>
  <div v-else class="enter flex h-dvh">
    <aside class="hidden w-66 shrink-0 border-e border-default bg-muted lg:flex">
      <SideBar />
    </aside>

    <USlideover
      v-model:open="ui.menuOpen"
      :side="sides.start"
      :title="t('nav.menu')"
      :ui="{ content: 'max-w-66 bg-muted', header: 'sr-only', body: 'p-0 sm:p-0' }"
    >
      <template #body>
        <SideBar />
      </template>
    </USlideover>

    <main class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 shrink-0 items-center gap-2 border-b border-default px-2 lg:hidden">
        <UButton
          icon="i-octicon-three-bars-16"
          color="neutral"
          variant="ghost"
          :aria-label="t('nav.menu')"
          @click="ui.menuOpen = true"
        />
        <BrandMark />
      </header>
      <ReposPage v-if="page === 'repos'" class="enter min-h-0 flex-1" />
      <template v-else>
        <FilterBar class="enter shrink-0" />
        <ItemList class="enter min-h-0 flex-1" />
      </template>
    </main>

    <IssuePanel v-if="page === 'items'" />

    <SettingsPanel />
    <ViewDialog />
  </div>
</template>
