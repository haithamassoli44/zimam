<script setup lang="ts">
// PROTOTYPE ONLY: switches for comparing thread looks and settings, and a pretend last visit to show the marks.
import UButton from '@nuxt/ui/components/Button.vue'
import UFieldGroup from '@nuxt/ui/components/FieldGroup.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import UTooltip from '@nuxt/ui/components/Tooltip.vue'
import { computed } from 'vue'

import { pressed } from '@/components/pressed'
import { relativeTime } from '@/locale'
import { now } from '@/stores/clock'
import { fileMode, pretend, proto, pull, setFileMode, THREAD_LOOKS } from '@/stores/pull'
import { settings } from '@/stores/settings'
import { BOT_POSTS, LONG_LINES } from '@/types'

const THREAD_NAMES = { inline: 'Under the line', margin: 'In the margin', column: 'Beside the code' }
const commits = computed(() => (pull.value?.commits ?? []).slice(0, -1).toReversed())
</script>

<template>
  <UPopover :content="{ side: 'bottom', align: 'end' }">
    <UTooltip text="Prototype">
      <UButton color="neutral" variant="ghost" size="sm" icon="i-octicon-beaker-16" aria-label="Prototype" />
    </UTooltip>
    <template #content>
      <div class="w-[22rem] max-w-[calc(100vw-1.5rem)] space-y-3 p-3 text-[13px]" lang="en" dir="ltr">
        <p class="text-[12px] text-muted">Switches for comparing. Not part of the design.</p>
        <div class="space-y-1.5">
          <p class="font-medium text-highlighted">Review threads in the diff</p>
          <UFieldGroup size="sm" class="flex w-full">
            <UButton
              v-for="look in THREAD_LOOKS"
              :key="look"
              v-bind="pressed(proto.threads === look)"
              size="sm"
              class="flex-1 justify-center"
              :label="THREAD_NAMES[look]"
              @click="proto.threads = look"
            />
          </UFieldGroup>
        </div>
        <div class="space-y-1.5">
          <p class="font-medium text-highlighted">Pretend I last looked at</p>
          <select
            class="h-8 w-full rounded-md bg-default px-2 text-[13px] ring-1 ring-accented ring-inset"
            :value="pretend ?? ''"
            @change="pretend = ($event.target as HTMLSelectElement).value || null"
          >
            <option value="">My real last visit (this browser)</option>
            <option v-for="commit in commits" :key="commit.oid" :value="commit.oid">
              {{ commit.short }} · {{ commit.headline.slice(0, 40) }} ({{ relativeTime(Date.parse(commit.at), now) }})
            </option>
          </select>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <p class="font-medium text-highlighted">Files (this PR)</p>
            <UFieldGroup size="sm" class="flex w-full">
              <UButton
                v-bind="pressed(fileMode === 'all')"
                size="sm"
                class="flex-1 justify-center"
                label="All"
                @click="setFileMode('all')"
              />
              <UButton
                v-bind="pressed(fileMode === 'one')"
                size="sm"
                class="flex-1 justify-center"
                label="One"
                @click="setFileMode('one')"
              />
            </UFieldGroup>
          </div>
          <div class="space-y-1.5">
            <p class="font-medium text-highlighted">Long lines</p>
            <UFieldGroup size="sm" class="flex w-full">
              <UButton
                v-for="value in LONG_LINES"
                :key="value"
                v-bind="pressed(settings.longLines === value)"
                size="sm"
                class="flex-1 justify-center capitalize"
                :label="value"
                @click="settings.longLines = value"
              />
            </UFieldGroup>
          </div>
        </div>
        <div class="space-y-1.5">
          <p class="font-medium text-highlighted">Bot comments</p>
          <UFieldGroup size="sm" class="flex w-full">
            <UButton
              v-for="value in BOT_POSTS"
              :key="value"
              v-bind="pressed(settings.bots === value)"
              size="sm"
              class="flex-1 justify-center capitalize"
              :label="value"
              @click="settings.bots = value"
            />
          </UFieldGroup>
        </div>
        <div class="space-y-1.5">
          <p class="font-medium text-highlighted">Language and theme</p>
          <UFieldGroup size="sm" class="flex w-full">
            <UButton
              v-bind="pressed(settings.locale === 'en')"
              size="sm"
              class="flex-1 justify-center"
              label="English"
              @click="settings.locale = 'en'"
            />
            <UButton
              v-bind="pressed(settings.locale === 'ar')"
              size="sm"
              class="flex-1 justify-center"
              label="العربية"
              @click="settings.locale = 'ar'"
            />
            <UButton
              v-bind="pressed(settings.theme === 'light')"
              size="sm"
              class="flex-1 justify-center"
              label="Light"
              @click="settings.theme = 'light'"
            />
            <UButton
              v-bind="pressed(settings.theme === 'dark')"
              size="sm"
              class="flex-1 justify-center"
              label="Dark"
              @click="settings.theme = 'dark'"
            />
          </UFieldGroup>
        </div>
      </div>
    </template>
  </UPopover>
</template>
