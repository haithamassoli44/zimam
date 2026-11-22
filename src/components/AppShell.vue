<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import USlideover from '@nuxt/ui/components/Slideover.vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import FilterBar from '@/components/FilterBar.vue'
import ItemList from '@/components/ItemList.vue'
import ReposPage from '@/components/ReposPage.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import SideBar from '@/components/SideBar.vue'
import ViewDialog from '@/components/ViewDialog.vue'
import { sides } from '@/locale'
import { ui } from '@/stores/ui'
import { page } from '@/stores/view'

const { t } = useI18n()
</script>

<template>
  <div class="flex h-dvh">
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
      <ReposPage v-if="page === 'repos'" class="min-h-0 flex-1" />
      <template v-else>
        <FilterBar class="shrink-0" />
        <ItemList class="min-h-0 flex-1" />
      </template>
    </main>

    <SettingsPanel />
    <ViewDialog />
  </div>
</template>
