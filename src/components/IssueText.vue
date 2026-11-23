<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { clean, direction } from '@/lib/clean'

/** The text of an issue or a comment, as GitHub renders it, cleaned. `link` is where it is on GitHub. */
const props = defineProps<{ html: string; link: string }>()
const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')

// GitHub signs the links to the files people upload, on this host, anew in every answer, and each lasts five minutes.
// Read again with nothing new but those signatures, a post takes the fresh links in place, and nothing else changes, so
// what the reader did stays: a section opened, the focus, a selection. New text replaces what's shown, but an image
// that has loaded stays: loading it again would only make it flash.
const SIGNED_HOST = 'private-user-images.githubusercontent.com'
// The cleaned text keeps an address only on a link and on an image.
const ADDRESSED = 'a, img'
const addressOf = (element: Element) => (element.tagName === 'IMG' ? 'src' : 'href')
const loaded = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0

/** The address without its signature, should it be one of GitHub's signed links. */
function unsigned(address: string): string {
  try {
    const url = new URL(address)
    if (url.hostname !== SIGNED_HOST) return address
    url.searchParams.delete('jwt')
    return url.href
  } catch {
    return address
  }
}

const sameness = (image: HTMLImageElement) =>
  JSON.stringify([...image.attributes].map(({ name, value }) => [name, name === 'src' ? unsigned(value) : value]))

/** The text as it would show, but for the signatures of its links. */
function gist(fragment: DocumentFragment): string {
  const box = fragment.ownerDocument.createElement('div')
  box.append(fragment.cloneNode(true))
  for (const element of box.querySelectorAll(ADDRESSED)) {
    const name = addressOf(element)
    const value = element.getAttribute(name)
    if (value !== null) element.setAttribute(name, unsigned(value))
  }
  return box.innerHTML
}

// The gist of the text shown, and its links and images, in order, as placed.
let placed: string | null = null
let addressed: Element[] = []

function render() {
  const element = root.value
  if (!element) return
  const fragment = clean(props.html, { video: { href: props.link, label: t('issue.video') } })
  const now = gist(fragment)
  // Nothing new but the signatures: each link takes its fresh one in place. An image that has loaded keeps its own.
  if (now === placed) {
    const fresh = fragment.querySelectorAll(ADDRESSED)
    for (const [index, node] of addressed.entries()) {
      const name = addressOf(node)
      const value = fresh.item(index)?.getAttribute(name)
      if (!value || node.getAttribute(name) === value) continue
      if (node instanceof HTMLImageElement && loaded(node)) continue
      node.setAttribute(name, value)
    }
    return
  }
  placed = now

  const shown = new Map<string, HTMLImageElement[]>()
  for (const image of element.querySelectorAll('img')) {
    if (!loaded(image)) continue
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
  addressed = [...element.querySelectorAll(ADDRESSED)]
}

onMounted(render)
watch([() => props.html, () => props.link, () => t('issue.video')], render)
</script>

<template>
  <div ref="root" class="issue-text" />
</template>
