<script setup lang="ts">
import UButton from '@nuxt/ui/components/Button.vue'
import UDropdownMenu from '@nuxt/ui/components/DropdownMenu.vue'
import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue'
import { useToast } from '@nuxt/ui/composables'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import LanguageSwitch from '@/components/LanguageSwitch.vue'
import NavRow from '@/components/NavRow.vue'
import SyncStatus from '@/components/SyncStatus.vue'
import { activeRepos } from '@/stores/repos'
import { activeWorkspace, settings } from '@/stores/settings'
import { openSettings, openSetup, ui } from '@/stores/ui'
import {
  activeView,
  askToRename,
  deleteView,
  go,
  openView,
  page,
  viewCounts,
  viewLink,
  viewName,
  type Page,
} from '@/stores/view'
import type { View } from '@/types'

const { t } = useI18n()
const toast = useToast()
// The phone's menu draws a second sidebar, so the heading's id can't be fixed.
const viewsHeading = useId()

const workspaceItems = computed<DropdownMenuItem[][]>(() => [
  settings.workspaces.map((ws) => ({
    label: ws.name,
    type: 'checkbox',
    checked: ws.id === activeWorkspace.value?.id,
    onSelect: () => {
      settings.activeWorkspaceId = ws.id
      ui.menuOpen = false
    },
  })),
  [
    { label: t('nav.newWorkspace'), icon: 'i-octicon-plus-16', onSelect: () => openSetup('new') },
    { label: t('nav.settings'), icon: 'i-octicon-gear-16', onSelect: openSettings },
  ],
])

function pick(view: View) {
  openView(view)
  ui.menuOpen = false
}

function open(to: Page) {
  go(to)
  ui.menuOpen = false
}

function viewMenu(view: View): DropdownMenuItem[][] {
  return [
    [
      { label: t('views.rename'), icon: 'i-octicon-pencil-16', onSelect: () => askToRename(view) },
      {
        label: t('views.copyLink'),
        icon: 'i-octicon-link-16',
        onSelect: async () => {
          try {
            await navigator.clipboard.writeText(viewLink(view))
            toast.add({ title: t('views.copied'), icon: 'i-octicon-check-16', duration: 2000 })
          } catch {
            toast.add({ title: t('views.copyFailed'), color: 'error', icon: 'i-octicon-alert-16' })
          }
        },
      },
    ],
    [{ label: t('views.delete'), icon: 'i-octicon-trash-16', color: 'error', onSelect: () => deleteView(view) }],
  ]
}
</script>

<template>
  <div class="flex h-full w-full flex-col">
    <div class="flex h-16 shrink-0 items-center px-5">
      <BrandMark />
    </div>

    <div class="px-3">
      <UDropdownMenu
        :items="workspaceItems"
        :content="{ align: 'start' }"
        :ui="{ content: 'w-(--reka-dropdown-menu-trigger-width)' }"
      >
        <UButton
          color="neutral"
          variant="outline"
          block
          icon="i-octicon-organization-16"
          trailing-icon="i-octicon-chevron-down-16"
          :label="activeWorkspace?.name"
          :ui="{ base: 'h-9 justify-start gap-2 px-2', trailingIcon: 'ms-auto text-muted', leadingIcon: 'text-muted' }"
        />
      </UDropdownMenu>
    </div>

    <nav class="mt-6 flex-1 overflow-y-auto px-3 pb-4" :aria-label="activeWorkspace?.name">
      <NavRow
        class="mb-6"
        icon="i-octicon-repo-16"
        :label="t('nav.repos')"
        :count="activeRepos"
        :active="page === 'repos'"
        @pick="open('repos')"
      />
      <h2 :id="viewsHeading" class="mb-2 px-2 text-xs font-medium text-muted">{{ t('nav.views') }}</h2>
      <ul class="space-y-0.5" :aria-labelledby="viewsHeading">
        <li v-for="view in activeWorkspace?.views" :key="view.id">
          <NavRow
            :label="viewName(view)"
            :count="viewCounts.get(view.id) ?? 0"
            :active="page === 'items' && activeView?.id === view.id"
            @pick="pick(view)"
          >
            <template #actions>
              <!-- The icon draws its dots half a pixel above its middle, so it's moved down that much. -->
              <UDropdownMenu :items="viewMenu(view)" :content="{ align: 'end' }">
                <UButton
                  icon="i-octicon-kebab-horizontal-16"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :ui="{ leadingIcon: 'translate-y-[0.5px]' }"
                  :aria-label="t('views.options', { name: viewName(view) })"
                />
              </UDropdownMenu>
            </template>
          </NavRow>
        </li>
      </ul>
    </nav>

    <footer class="space-y-2 border-t border-default px-3 pt-3 pb-3">
      <div class="px-2">
        <SyncStatus />
      </div>
      <div class="flex items-center">
        <UButton
          icon="i-octicon-gear-16"
          color="neutral"
          variant="ghost"
          :label="t('nav.settings')"
          :ui="{ base: 'px-2 text-toned', leadingIcon: 'text-muted' }"
          @click="openSettings"
        />
        <LanguageSwitch class="ms-auto" />
      </div>
    </footer>
  </div>
</template>
