import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import IssueText from '@/components/IssueText.vue'
import { i18n } from '@/locale'

const LINK = 'https://github.com/acme/web/issues/12'
const SHOT = 'https://private-user-images.githubusercontent.com/1/2-abc.png'
// How GitHub renders an uploaded screenshot: the image in a link to itself, both signed.
const screenshot = (jwt: string, alt = 'A screenshot') =>
  `<p>See:</p><p><a target="_blank" rel="noopener noreferrer" href="${SHOT}?jwt=${jwt}"><img src="${SHOT}?jwt=${jwt}" alt="${alt}"></a></p>`

// A post with a section the reader can open, the screenshot in it.
const section = (jwt: string) => `<p>Seen in Safari</p><details><summary>Safari</summary>${screenshot(jwt)}</details>`

// Two screenshots, each its own file.
const two = (jwt: string) => screenshot(jwt) + screenshot(jwt).replaceAll('2-abc', '3-def')

let wrapper: VueWrapper | null = null
const show = (html: string) => {
  wrapper = mount(IssueText, { props: { html, link: LINK }, global: { plugins: [i18n] }, attachTo: document.body })
  return wrapper
}

// jsdom loads no images. Here they all have, unless a test says otherwise.
let loads = true
beforeEach(() => {
  loads = true
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockImplementation(() => (loads ? 640 : 0))
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.restoreAllMocks()
})

describe('text read again', () => {
  it("takes a screenshot's freshly signed link, and keeps the image that loaded", async () => {
    const text = show(screenshot('expired'))
    const image = text.find('img').element
    await text.setProps({ html: screenshot('fresh') })
    expect(text.find('a').attributes('href')).toBe(`${SHOT}?jwt=fresh`)
    expect(text.find('img').element).toBe(image)
    expect(text.findAll('img')).toHaveLength(1)
  })

  it('renews only the links when nothing else changed, so what the reader did stays', async () => {
    const text = show(section('expired'))
    const details = text.find('details').element as HTMLDetailsElement
    details.open = true
    const link = text.find('a').element as HTMLAnchorElement
    link.focus()
    const words = text.find('p').element
    document.getSelection()!.selectAllChildren(words)
    const image = text.find('img').element
    expect(document.activeElement).toBe(link)
    for (const jwt of ['fresh', 'fresher']) {
      await text.setProps({ html: section(jwt) })
      expect(text.find('a').attributes('href')).toBe(`${SHOT}?jwt=${jwt}`)
      expect(text.find('img').element).toBe(image)
      // Loaded, it isn't loaded again.
      expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=expired`)
      expect(text.find('details').element).toBe(details)
      expect(details.open).toBe(true)
      expect(document.activeElement).toBe(link)
      expect(document.getSelection()!.toString()).toBe('Seen in Safari')
    }
  })

  it('gives each link its own fresh address', async () => {
    const text = show(two('old'))
    await text.setProps({ html: two('new') })
    expect(text.findAll('a').map((a) => a.attributes('href'))).toEqual([
      `${SHOT}?jwt=new`,
      `${SHOT.replace('2-abc', '3-def')}?jwt=new`,
    ])
  })

  it("gives an image that didn't load its fresh link", async () => {
    loads = false
    const text = show(screenshot('expired'))
    const image = text.find('img').element
    await text.setProps({ html: screenshot('fresh') })
    expect(text.find('img').element).toBe(image)
    expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=fresh`)
    await text.setProps({ html: `<p>Edited</p>${screenshot('fresher')}` })
    expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=fresher`)
  })

  it('keeps the images that loaded when the text around them changed', async () => {
    const text = show(`<p>before</p>${screenshot('expired')}`)
    const image = text.find('img').element
    await text.setProps({ html: `<p>after</p>${screenshot('fresh')}` })
    expect(text.find('p').text()).toBe('after')
    expect(text.find('a').attributes('href')).toBe(`${SHOT}?jwt=fresh`)
    expect(text.find('img').element).toBe(image)
    // Then read again with only new signatures: the new text stays as placed.
    const words = text.find('p').element
    await text.setProps({ html: `<p>after</p>${screenshot('fresher')}` })
    expect(text.find('p').element).toBe(words)
    expect(text.find('a').attributes('href')).toBe(`${SHOT}?jwt=fresher`)
    expect(text.find('img').element).toBe(image)
  })

  it('places an image anew when anything but its signature changed', async () => {
    const text = show(screenshot('expired'))
    await text.setProps({ html: screenshot('fresh', 'The new screenshot') })
    expect(text.find('img').attributes('alt')).toBe('The new screenshot')
    expect(text.find('img').attributes('src')).toBe(`${SHOT}?jwt=fresh`)
  })

  it('keeps each of two copies of an image once', async () => {
    const text = show(screenshot('old') + screenshot('old'))
    const images = text.findAll('img').map((image) => image.element)
    await text.setProps({ html: screenshot('new') + screenshot('new') })
    expect(text.findAll('img').map((image) => image.element)).toEqual(images)
    expect(text.findAll('a').map((a) => a.attributes('href'))).toEqual([`${SHOT}?jwt=new`, `${SHOT}?jwt=new`])
    await text.setProps({ html: `<p>Edited</p>${screenshot('newer')}${screenshot('newer')}` })
    expect(text.findAll('img').map((image) => image.element)).toEqual(images)
    expect(text.findAll('a').map((a) => a.attributes('href'))).toEqual([`${SHOT}?jwt=newer`, `${SHOT}?jwt=newer`])
  })

  it('takes a new jwt in an address elsewhere for an edit', async () => {
    const OTHER = 'https://camo.githubusercontent.com/abc'
    const picture = (jwt: string) => `<p><img src="${OTHER}?jwt=${jwt}" alt="A picture"></p>`
    const text = show(picture('old'))
    const image = text.find('img').element
    await text.setProps({ html: picture('new') })
    expect(text.find('img').attributes('src')).toBe(`${OTHER}?jwt=new`)
    expect(text.find('img').element).not.toBe(image)
  })

  it('shows text that changed only in a jwt=', async () => {
    const text = show('<p><code>https://example.com/?jwt=old</code></p>')
    await text.setProps({ html: '<p><code>https://example.com/?jwt=new</code></p>' })
    expect(text.text()).toBe('https://example.com/?jwt=new')
  })

  it('shows text that changed', async () => {
    const text = show('<p>before</p>')
    await text.setProps({ html: '<p>after</p>' })
    expect(text.text()).toBe('after')
  })
})
