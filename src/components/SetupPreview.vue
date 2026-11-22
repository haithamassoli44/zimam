<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BrandMark from '@/components/BrandMark.vue'
import ItemRow from '@/components/ItemRow.vue'
import NavRow from '@/components/NavRow.vue'
import { formatNumber } from '@/locale'
import { settings } from '@/stores/settings'
import type { Checks, Item, ItemKind, Merge, Preset, Review } from '@/types'

const { t } = useI18n()
const MINUTE = 60_000
const now = Date.now()

interface Sample {
  kind: ItemKind | 'draft'
  title: { en: string; ar: string }
  repo: string
  number: number
  author: string
  ago: number
  labels: [string, string][]
  checks?: Checks
  review?: Review
  merge?: Merge
  diff?: [number, number]
  comments?: number
  fresh?: boolean
}

const SAMPLES: Sample[] = [
  {
    kind: 'pr',
    title: { en: 'Cache book covers on the reader page', ar: 'تخزين أغلفة الكتب مؤقتًا في صفحة القارئ' },
    repo: 'reader-web',
    number: 412,
    author: 'layla-h',
    ago: 2,
    labels: [['performance', 'fbca04']],
    checks: 'pending',
    review: 'required',
    diff: [84, 12],
    fresh: true,
  },
  {
    kind: 'issue',
    title: { en: 'Search ignores hamza forms in titles', ar: 'البحث لا يوحّد صور الهمزة في العناوين' },
    repo: 'search-api',
    number: 88,
    author: 'omar-k',
    ago: 64,
    labels: [['bug', 'd73a4a']],
    comments: 4,
  },
  {
    kind: 'pr',
    title: { en: 'Upgrade to Node 24', ar: 'الترقية إلى Node 24' },
    repo: 'search-api',
    number: 203,
    author: 'dependabot',
    ago: 180,
    labels: [['dependencies', '0366d6']],
    checks: 'failure',
    review: 'optional',
    merge: 'conflicts',
    diff: [3, 3],
  },
  {
    kind: 'issue',
    title: { en: 'Export a reading list as a PDF', ar: 'تصدير قائمة القراءة ملفَّ PDF' },
    repo: 'reader-web',
    number: 398,
    author: 'sara-m',
    ago: 1500,
    labels: [['enhancement', 'a2eeef']],
    comments: 2,
  },
  {
    kind: 'draft',
    title: { en: 'Right-to-left layout for settings', ar: 'اتجاه من اليمين إلى اليسار في الإعدادات' },
    repo: 'mobile-app',
    number: 57,
    author: 'yusuf-a',
    ago: 4320,
    labels: [],
    checks: 'success',
    diff: [210, 95],
  },
]

const VIEWS: [Preset, number][] = [
  ['open', 42],
  ['issues', 25],
  ['awaiting', 6],
  ['quiet', 9],
]

function toItem(sample: Sample): Item {
  const at = new Date(now - sample.ago * MINUTE).toISOString()
  return {
    id: `${sample.repo}#${sample.number}`,
    kind: sample.kind === 'draft' ? 'pr' : sample.kind,
    repoId: sample.repo,
    number: sample.number,
    title: sample.title[settings.locale],
    url: '',
    state: 'open',
    notPlanned: false,
    author: { login: sample.author, avatarUrl: '' },
    assignees: [],
    labels: sample.labels.map(([name, color]) => ({ name, color })),
    comments: sample.comments ?? 0,
    createdAt: at,
    updatedAt: at,
    review: sample.kind === 'draft' ? 'draft' : (sample.review ?? null),
    checks: sample.checks ?? null,
    merge: sample.merge ?? null,
    diff: sample.diff ? { additions: sample.diff[0], deletions: sample.diff[1] } : null,
  }
}

const rows = computed(() => SAMPLES.map((sample) => ({ item: toItem(sample), fresh: sample.fresh })))
</script>

<template>
  <figure class="preview w-full max-w-[600px]" aria-hidden="true" inert>
    <div
      class="flex [zoom:0.8] overflow-hidden rounded-xl bg-default shadow-[0_8px_24px_rgba(0,0,0,0.06)] ring-1 ring-default dark:shadow-none"
    >
      <div class="hidden w-48 shrink-0 border-e border-default bg-muted p-2 sm:block">
        <div class="flex h-12 items-center px-2"><BrandMark /></div>
        <p class="mt-2 mb-2 px-2 text-xs text-muted">{{ t('nav.views') }}</p>
        <div class="space-y-0.5">
          <NavRow
            v-for="([preset, count], index) in VIEWS"
            :key="preset"
            :label="t(`presets.${preset}`)"
            :count="count"
            :active="index === 0"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex h-16 items-center gap-2 border-b border-default px-6">
          <span class="truncate text-xl font-medium text-highlighted">{{ t('presets.open') }}</span>
          <span class="text-xl text-muted tabular-nums">{{ formatNumber(42) }}</span>
        </div>
        <ItemRow
          v-for="(row, index) in rows"
          :key="row.item.id"
          :item="row.item"
          :repo-name="row.item.repoId"
          :fresh="row.fresh"
          :class="[index === rows.length - 1 && 'border-b-0', index > 2 && 'max-sm:hidden']"
        />
      </div>
    </div>
  </figure>
</template>

<style scoped>
@media (prefers-reduced-motion: no-preference) {
  .preview {
    animation: rise 400ms var(--ease-out) both;
  }
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}
</style>
