<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { clean, direction } from '@/lib/clean'

/** The text of an issue or a comment, as GitHub renders it, cleaned. `link` is where it is on GitHub. */
const props = defineProps<{ html: string; link: string }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')

// Every answer signs GitHub's image links anew. Text that didn't change keeps the images it already shows, unless one
// of them hasn't loaded: its link may have expired.
const unsigned = (html: string) => html.replace(/([?&])jwt=[^"&\s]*/g, '$1')
const unloaded = () =>
  [...(root.value?.querySelectorAll('img') ?? [])].some((image) => !image.complete || !image.naturalWidth)

function render() {
  const element = root.value
  if (!element) return
  const fragment = clean(props.html, { video: { href: props.link, label: t('issue.video') } })
  const dir = direction(fragment)
  if (dir) element.dir = dir
  else element.removeAttribute('dir')
  element.replaceChildren(fragment)
}

onMounted(render)
watch(
  () => props.html,
  (html, before) => (unsigned(html) !== unsigned(before) || unloaded()) && render(),
)
watch([() => props.link, () => t('issue.video')], render)
</script>

<template>
  <div ref="root" class="issue-text" />
</template>
