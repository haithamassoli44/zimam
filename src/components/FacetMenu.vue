<script setup lang="ts">
import UAvatar from '@nuxt/ui/components/Avatar.vue'
import UButton from '@nuxt/ui/components/Button.vue'
import UIcon from '@nuxt/ui/components/Icon.vue'
import UInput from '@nuxt/ui/components/Input.vue'
import UPopover from '@nuxt/ui/components/Popover.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { pressed } from '@/components/pressed'
import { normalize } from '@/lib/text'
import { formatNumber } from '@/locale'

export interface Option {
  value: string
  label: string
  count: number
  avatar?: string
  color?: string
}

const props = defineProps<{ title: string; options: Option[]; single?: boolean }>()
const model = defineModel<string[]>({ required: true })
const { t } = useI18n()
const search = ref('')

const selectedLabels = computed(() =>
  model.value.map((value) => props.options.find((option) => option.value === value)?.label ?? value),
)

const marked = computed(() => props.options.some((option) => option.avatar || option.color))

const LIMIT = 300

const matching = computed(() => {
  const term = normalize(search.value.trim())
  return props.options.filter((option) => !term || normalize(option.label).includes(term))
})

const shown = computed(() =>
  matching.value
    .toSorted(
      (a, b) =>
        Number(model.value.includes(b.value)) - Number(model.value.includes(a.value)) ||
        b.count - a.count ||
        a.label.localeCompare(b.label),
    )
    .slice(0, LIMIT),
)

function toggle(value: string) {
  if (props.single) model.value = model.value.includes(value) ? [] : [value]
  else
    model.value = model.value.includes(value) ? model.value.filter((other) => other !== value) : [...model.value, value]
}
</script>

<template>
  <UPopover :content="{ align: 'start' }" @update:open="search = ''">
    <UButton
      v-bind="pressed(model.length > 0)"
      trailing-icon="i-octicon-chevron-down-16"
      :ui="{ label: 'max-w-48 truncate', trailingIcon: 'opacity-70' }"
    >
      <span>{{ title }}</span>
      <template v-if="model.length">
        <span class="opacity-50">·</span>
        <bdi>{{ selectedLabels[0] }}</bdi>
        <span v-if="model.length > 1" class="font-mono text-xs tabular-nums">+{{ model.length - 1 }}</span>
      </template>
    </UButton>

    <template #content>
      <div class="w-72">
        <div v-if="options.length > 8" class="border-b border-default p-1">
          <UInput
            v-model="search"
            icon="i-octicon-search-16"
            variant="none"
            :placeholder="t('filters.find')"
            autofocus
            class="w-full"
          />
        </div>
        <ul class="max-h-80 overflow-y-auto p-1" :aria-label="title">
          <li v-for="option in shown" :key="option.value">
            <button
              type="button"
              :aria-pressed="model.includes(option.value)"
              class="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors hover:bg-elevated focus-visible:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              @click="toggle(option.value)"
            >
              <span
                class="flex size-4 shrink-0 items-center justify-center border transition-colors"
                :class="[
                  single ? 'rounded-full' : 'rounded-sm',
                  model.includes(option.value) ? 'border-primary bg-primary text-inverted' : 'border-accented',
                ]"
              >
                <UIcon v-if="model.includes(option.value)" name="i-octicon-check-16" class="size-3" />
              </span>
              <span v-if="marked" class="flex size-4 shrink-0 items-center justify-center">
                <UAvatar v-if="option.avatar" :src="option.avatar" :alt="option.label" size="3xs" />
                <span
                  v-else-if="option.color"
                  class="size-2 rounded-full"
                  :style="{ background: `#${option.color}` }"
                />
              </span>
              <bdi class="min-w-0 flex-1 truncate rtl:text-right">{{ option.label }}</bdi>
              <span class="font-mono text-xs text-muted tabular-nums">{{ formatNumber(option.count) }}</span>
            </button>
          </li>
          <li v-if="!shown.length" class="px-2 py-6 text-center text-sm text-muted">{{ t('filters.nothing') }}</li>
          <li v-if="matching.length > LIMIT" class="px-2 py-2 text-xs text-muted">
            {{ t('filters.more', { n: formatNumber(matching.length - LIMIT) }) }}
          </li>
        </ul>
      </div>
    </template>
  </UPopover>
</template>
