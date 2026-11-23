<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { clean, direction } from '@/lib/clean'

/** The text of an issue or a comment, as GitHub renders it, cleaned. `link` is where it is on GitHub. */
const props = defineProps<{ html: string; link: string }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')

// GitHub signs the links to uploaded files anew in every answer, and each lasts five minutes. New text always replaces
// what's shown, links and all, but an image that has loaded stays: loading it again would only make it flash.
const unsigned = (src: string) => src.replace(/([?&])jwt=[^&#]*/g, '$1')
const sameness = (image: HTMLImageElement) =>
  JSON.stringify([...image.attributes].map(({ name, value }) => [name, name === 'src' ? unsigned(value) : value]))

function render() {
  const element = root.value
  if (!element) return
  const fragment = clean(props.html, { video: { href: props.link, label: t('issue.video') } })

  const shown = new Map<string, HTMLImageElement[]>()
  for (const image of element.querySelectorAll('img')) {
    if (!image.complete || !image.naturalWidth) continue
    const key = sameness(image)
    shown.set(key, [...(shown.get(key) ?? []), image])
  }
  const kept: [HTMLImageElement, HTMLImageElement][] = []
  for (const image of fragment.querySelectorAll('img')) {
    const old = shown.get(sameness(image))?.shift()
    if (!old) continue
    // Without its link, the new image loads nothing before the old one takes its place.
    image.removeAttribute('src')
    kept.push([image, old])
  }

  const dir = direction(fragment)
  if (dir) element.dir = dir
  else element.removeAttribute('dir')
  element.replaceChildren(fragment)
  for (const [image, old] of kept) image.replaceWith(old)
}

onMounted(render)
watch([() => props.html, () => props.link, () => t('issue.video')], render)
</script>

<template>
  <div ref="root" class="issue-text" />
</template>
