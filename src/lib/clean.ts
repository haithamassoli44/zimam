import DOMPurify from 'dompurify'

const words = (text: string) => text.trim().split(/\s+/)

// What issue text keeps of GitHub's HTML: text, links, images, code, tables and lists. Nothing that runs, restyles the
// page, sends a form or frames another page. A video becomes a link to GitHub, below.
const TAGS = words(`
  p br hr h1 h2 h3 h4 h5 h6 div span blockquote details summary
  strong b em i del s ins mark sub sup small code pre kbd samp var
  ul ol li dl dt dd input table caption thead tbody tfoot tr th td
  a img video`)
const ATTRS = words(`
  href src alt title width height class dir align aria-label hidden
  type checked disabled open start colspan rowspan`)
// DOMPurify checks the value of any attribute it doesn't know as safe against the allowed addresses below. These hold
// no address, so they're named as safe.
const SAFE = words('dir width height align aria-label hidden type checked disabled open start colspan rowspan')
// Which attributes stay, by element. The rest are dropped after DOMPurify, which allows the same ones on all.
const ONLY_ON: Record<string, string[]> = {
  href: ['A'],
  src: ['IMG'],
  width: ['IMG'],
  height: ['IMG'],
  align: ['P', 'DIV', 'TH', 'TD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
  // A task's box says whether it's done. Anywhere else, a spoken name could differ from what's shown.
  'aria-label': ['INPUT'],
  type: ['INPUT'],
  checked: ['INPUT'],
  disabled: ['INPUT'],
  open: ['DETAILS'],
  start: ['OL'],
  colspan: ['TH', 'TD'],
  rowspan: ['TH', 'TD'],
}
// GitHub's classes for colored code, note boxes, task lists, mentions and references, which style.css styles.
const CLASSES = new Set(
  words(`
    pl-c pl-k pl-ent pl-mh pl-mdr pl-s pl-pds pl-sr pl-sra pl-cce pl-c1 pl-v pl-e pl-en pl-ii pl-bu pl-mb pl-mi pl-mi1 pl-md
    markdown-alert markdown-alert-title markdown-alert-note markdown-alert-tip markdown-alert-important
    markdown-alert-warning markdown-alert-caution task-list-item task-list-item-checkbox contains-task-list
    user-mention issue-link`),
)
const DIRECTIONS = new Set(['auto', 'ltr', 'rtl'])

// Its own instance, so its settings and hooks are this file's alone.
const purify = DOMPurify(window)

/** The elements cleaned text keeps an address on, and which attribute holds it. */
export const ADDRESSED = [...ONLY_ON.href, ...ONLY_ON.src].join(', ')
export const addressOf = (element: Element) => (ONLY_ON.src.includes(element.tagName) ? 'src' : 'href')

/** Images come only from GitHub, which also proxies the outside images people link to. The CSP allows the same. */
function fromGitHub(src: string | null): boolean {
  try {
    const url = new URL(src ?? '')
    return url.protocol === 'https:' && url.hostname.endsWith('.githubusercontent.com') && !url.username
  } catch {
    return false
  }
}

interface CleanOptions {
  /** Where to watch a video, and the words that say so. */
  video: { href: string; label: string }
}

/**
 * Cleans GitHub's rendering of an issue or a comment, to be shown on Zimam's page, where a script could read the
 * token. GitHub cleans it too; this doesn't rely on that. The fragment belongs to a document of its own, so nothing in
 * it loads until it is placed in the page.
 */
export function clean(html: string, { video }: CleanOptions): DocumentFragment {
  const fragment = purify.sanitize(html, {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ATTRS,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
    ADD_URI_SAFE_ATTR: SAFE,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })
  const document = fragment.ownerDocument

  // What GitHub hides stays hidden, like the controls its own page adds to an animated image.
  for (const hidden of fragment.querySelectorAll('[hidden]')) hidden.remove()

  // The panel's title is a level 2 heading, so the text's headings go two levels under it.
  for (const heading of fragment.querySelectorAll('h1, h2, h3, h4, h5')) {
    const lower = document.createElement(`h${Math.min(6, Number(heading.tagName[1]) + 2)}`)
    for (const name of heading.getAttributeNames()) lower.setAttribute(name, heading.getAttribute(name)!)
    lower.append(...heading.childNodes)
    heading.replaceWith(lower)
  }

  for (const element of fragment.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (ONLY_ON[name] && !ONLY_ON[name].includes(element.tagName)) element.removeAttribute(name)
    }
    const classes = [...element.classList].filter((name) => CLASSES.has(name))
    if (classes.length) element.className = classes.join(' ')
    else element.removeAttribute('class')
    if (element.hasAttribute('dir') && !DIRECTIONS.has(element.getAttribute('dir')!)) element.removeAttribute('dir')
  }

  for (const link of fragment.querySelectorAll('a[href]')) {
    link.setAttribute('target', '_blank')
    link.setAttribute('rel', 'noopener noreferrer')
  }

  for (const image of fragment.querySelectorAll('img')) {
    if (fromGitHub(image.getAttribute('src'))) continue
    const alt = image.getAttribute('alt')
    image.replaceWith(alt ? document.createTextNode(alt) : '')
  }

  // A task list's boxes show what's done. They can't be ticked here.
  for (const input of fragment.querySelectorAll('input')) {
    if (input.getAttribute('type') === 'checkbox') input.setAttribute('disabled', '')
    else input.remove()
  }

  for (const each of fragment.querySelectorAll('video')) {
    const link = document.createElement('a')
    link.href = video.href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = video.label
    const line = document.createElement('p')
    line.append(link)
    each.replaceWith(line)
  }

  return fragment
}

// Hebrew, Arabic, Syriac, Thaana, N'Ko and the Arabic presentation forms.
const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/
const LETTER = /\p{L}/u

/**
 * The direction of a post, from its first letter outside code, mentions and references. GitHub marks each paragraph
 * `dir="auto"`, but a paragraph with no letters, like a lone image, takes the direction around it, so the post sets it.
 */
export function direction(root: DocumentFragment | Element): 'ltr' | 'rtl' | null {
  const walker = (root.ownerDocument ?? document).createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('pre, code, kbd, .user-mention, .issue-link')) continue
    const letter = LETTER.exec((node as Text).data)?.[0]
    if (letter) return RTL.test(letter) ? 'rtl' : 'ltr'
  }
  return null
}
